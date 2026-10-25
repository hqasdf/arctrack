import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as model from '../src/features/arrow-counter/counter-model.ts';
const require=createRequire(import.meta.url),tick=()=>new Promise(setImmediate);
function runtime(raw=null){
 let slots=[],cursor=0,effects=[],readFailure=false,writeFailure=false;
 const timers=new Map(),writes=[];let serial=0;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v]},useRef(initial){return slots[cursor++]??={current:initial}},useEffect(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn()})}},useLayoutEffect(){cursor++;}};
 const win={localStorage:{getItem(){if(readFailure)throw Error('unavailable');return raw},setItem(k,v){if(writeFailure)throw Error('full');raw=v;writes.push(JSON.parse(v))}},matchMedia:()=>({matches:false})};
 const compiled=ts.transpileModule(readFileSync(new URL('../src/features/arrow-counter/components/arrow-counter.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const out={};new Function('require','exports','window','document','setTimeout','clearTimeout',compiled)(n=>n==='react'?react:n==='next/link'?{__esModule:true,default:'a'}:n==='../counter-model'?model:n.endsWith('.css')?{__esModule:true,default:{}}:require(n),out,win,{activeElement:null,getElementById:()=>null},fn=>{const id=++serial;timers.set(id,fn);return id},id=>timers.delete(id));
 const render=()=>{cursor=0;const tree=out.ArrowCounter();const run=effects;effects=[];run.forEach(e=>e());return tree};
 return{render,writes,timers,raw:()=>raw,failRead:v=>readFailure=v,failWrite:v=>writeFailure=v,async ready(){render();await tick();return render()}};
}
const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
const button=(tree,label)=>nodes(tree).find(n=>n.type==='button'&&(n.props['aria-label']===label||n.props.children===label));
const add=tree=>nodes(tree).find(n=>n.type==='button'&&n.props['aria-label']?.startsWith('Add '));
const select=tree=>nodes(tree).find(n=>n.props?.role==='spinbutton');
const scroll=tree=>select(tree).props.onScroll({currentTarget:{clientHeight:570,getBoundingClientRect:()=>({top:0}),querySelector:()=>({dataset:{increment:'1'},offsetHeight:38,getBoundingClientRect:()=>({top:0})})}});
test('Add and a delayed wheel callback always mutate the latest tally; rapid Adds cannot overwrite each other',async()=>{
 const r=runtime();let tree=await r.ready();scroll(tree);const delayed=[...r.timers.values()][0];
 add(tree).props.onClick();add(tree).props.onClick();assert.equal(r.writes.at(-1).totalArrows,16);
 delayed();assert.equal(r.writes.at(-1).totalArrows,16);assert.equal(r.writes.at(-1).increment,8);
 button(r.render(),'Undo last addition').props.onClick();assert.equal(r.writes.at(-1).totalArrows,8);
 nodes(r.render()).find(n=>n.type==='input').props.onChange({target:{value:'12'}});
 assert.equal(r.writes.at(-1).totalArrows,8);assert.equal(r.writes.at(-1).increment,12);
});
test('Reset cancels pending wheel settlement, clears timestamps and history, and keeps the selected increment',async()=>{
 const r=runtime();let tree=await r.ready();add(tree).props.onClick();tree=r.render();scroll(tree);
 button(tree,'Reset counter').props.onClick();tree=r.render();button(tree,'Reset').props.onClick();
 assert.equal(r.timers.size,0);assert.deepEqual(r.writes.at(-1),{...model.DEFAULT_COUNTER});
});
test('failed or malformed initial reads never authorize writes, and Retry restores legacy amounts',async()=>{
 const saved=JSON.stringify({version:2,totalArrows:90,increment:6,history:[6,6]});
 const r=runtime(saved);r.failRead(true);let tree=await r.ready();
 assert.equal(add(tree).props.disabled,true);add(tree).props.onClick();assert.equal(r.raw(),saved);assert.equal(r.writes.length,0);
 r.failRead(false);button(tree,'Retry loading saved counter').props.onClick();tree=await r.ready();assert.equal(add(tree).props.disabled,false);
 assert.equal(r.writes.length,0,'loading/migration does not write');add(tree).props.onClick();assert.equal(r.writes.at(-1).totalArrows,96);assert.equal(r.writes.at(-1).history[0].addedAt,null);
 for(const bad of ['{',JSON.stringify({version:2,totalArrows:50,increment:6,history:[-1]})]){const b=runtime(bad);tree=await b.ready();add(tree).props.onClick();assert.equal(b.raw(),bad);assert.equal(b.writes.length,0);}
});
test('timestamps survive reload, selection does not change them, and save failure keeps the tally with a visible error',async()=>{
 const r=runtime();let tree=await r.ready();add(tree).props.onClick();const stamp=r.writes.at(-1).history[0].addedAt;assert.ok(stamp);
 nodes(r.render()).find(n=>n.type==='input').props.onChange({target:{value:'10'}});assert.equal(r.writes.at(-1).history[0].addedAt,stamp);
 const restored=runtime(r.raw());await restored.ready();assert.equal(model.readCounter(JSON.parse(restored.raw())).history[0].addedAt,stamp);
 r.failWrite(true);add(r.render()).props.onClick();tree=r.render();assert.ok(nodes(tree).some(n=>n.props?.role==='alert'));assert.ok(nodes(tree).some(n=>n.type==='strong'&&n.props.children===16));
});
