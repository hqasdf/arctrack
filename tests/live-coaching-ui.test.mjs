import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {loadSessionModule,settle,treeNodes,treeText} from './helpers/session-layout-runtime.mjs';

function fixture(state='active') {
 const slots=[],effects=[],listeners=new Map(),timers=new Set(),calls=[],sources=[];
 let cursor=0,tree;
 const document={visibilityState:'visible',addEventListener:(n,f)=>listeners.set('document:'+n,f),removeEventListener:n=>listeners.delete('document:'+n)};
 const window={addEventListener:(n,f)=>listeners.set('window:'+n,f),removeEventListener:n=>listeners.delete('window:'+n)};
 const hooks={...React,
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
  useRef(initial){const i=cursor++;return slots[i]??={current:initial};},
  useCallback(fn){cursor++;return fn;},
  useEffect(fn,deps){const i=cursor++;if(!slots[i]||!deps.every((v,n)=>Object.is(v,slots[i].deps[n]))){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}},
 };
 class Source {constructor(){this.closed=false;sources.push(this);}addEventListener(){}close(){this.closed=true;}}
 const {createReconciler}=loadSessionModule('src/features/live-coaching/reconcile.ts');
 const value={session:{id:'fixture',title:'Training',state,version:1,training_date:'2026-10-26'},coach:true,viewerId:'coach',organizationName:'Team',participants:[],eligibleSessions:[]};
 const {LiveCoaching}=loadSessionModule('src/features/live-coaching/live-coaching.tsx',{
  'next/navigation':{useRouter:()=>({push(){}})},'./model':{scoringProgress:()=>({})},'./reconcile':{createReconciler},
 },hooks,{document,window,EventSource:Source,setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn),fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>value};}});
 const render=()=>{cursor=0;tree=LiveCoaching({sessionId:'fixture'});while(effects.length)effects.shift()();return tree;};
 return {render,calls,sources,timers,listeners,document,text:()=>treeText(tree),async click(label){const button=treeNodes(tree).find(n=>n.type==='button'&&treeText(n)===label);assert.ok(button,'Missing '+label);await button.props.onClick();},dispose(){for(const s of slots)s?.cleanup?.();}};
}

test('Inline lifecycle confirmation does not mutate until explicitly confirmed',async()=>{
 const ui=fixture();ui.render();await settle();ui.render();await ui.click('Complete live training');ui.render();
 assert.match(ui.text(),/Complete live training\?/);assert.equal(ui.calls.filter(c=>c.options?.method==='POST').length,0);
 await ui.click('Keep training open');ui.render();assert.doesNotMatch(ui.text(),/Complete live training\?/);
 await ui.click('Cancel training');ui.render();await ui.click('Confirm cancellation');
 assert.equal(JSON.parse(ui.calls.find(c=>c.options?.method==='POST').options.body).action,'cancel');ui.dispose();
});
test('Completed review closes updates and suppresses automatic fallback reads',async()=>{
 const ui=fixture('completed');ui.render();await settle();ui.render();assert.ok(ui.sources.every(s=>s.closed));assert.match(ui.text(),/Session completed - review only/);
 const before=ui.calls.length;for(const timer of ui.timers)timer();await settle();assert.equal(ui.calls.length,before);
 await ui.click('Refresh');await settle();assert.equal(ui.calls.length,before+1);ui.dispose();
});
test('Backgrounding clears private data; returning reconciles and unmount removes listeners',async()=>{
 const ui=fixture();ui.render();await settle();ui.render();assert.match(ui.text(),/Team/);
 ui.document.visibilityState='hidden';ui.listeners.get('document:visibilitychange')();ui.render();assert.doesNotMatch(ui.text(),/Team/);assert.ok(ui.sources.every(s=>s.closed));
 ui.document.visibilityState='visible';ui.listeners.get('document:visibilitychange')();await settle();ui.render();assert.match(ui.text(),/Team/);
 ui.dispose();assert.equal(ui.listeners.size,0);assert.equal(ui.timers.size,0);assert.ok(ui.sources.every(s=>s.closed));
});
