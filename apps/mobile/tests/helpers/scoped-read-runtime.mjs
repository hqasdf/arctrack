import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
export const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
export const settle=()=>new Promise(setImmediate);
export function scopedReadRuntime(renderHook){
 const slots=[];let cursor=0,focused=true,mounted=true,focusHandler,focusCleanup;
 let layouts=[],effects=[],writes=0,lateWrites=0;
 const same=(a,b)=>a?.length===b?.length&&a.every((v,i)=>Object.is(v,b[i]));
 const effect=(fn,deps,layout)=>{const i=cursor++,old=slots[i];if(old&&same(old.deps,deps))return;const entry={deps,cleanup:old?.cleanup};slots[i]=entry;(layout?layouts:effects).push(()=>{entry.cleanup?.();entry.cleanup=fn();});};
 const react={
  Fragment:require('react').Fragment,
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],update=>{writes++;if(!mounted)lateWrites++;slots[i]=typeof update==='function'?update(slots[i]):update;}];},
  useRef(value){const i=cursor++;return slots[i]??(slots[i]={current:value});},
  useMemo(fn,deps){const i=cursor++,old=slots[i];if(!old||!same(old.deps,deps))slots[i]={deps,value:fn()};return slots[i].value;},
  useCallback(fn,deps){return react.useMemo(()=>fn,deps);},
  useLayoutEffect:(fn,deps)=>effect(fn,deps,true),useEffect:(fn,deps)=>effect(fn,deps,false),
 };
 const router={useFocusEffect(fn){effect(()=>{focusHandler=fn;if(focused)focusCleanup=fn();return()=>{focusCleanup?.();focusCleanup=undefined;focusHandler=undefined;};},[fn],false);}};
 const load=(relative,deps={})=>{const exports={};const source=readFileSync(new URL('../../'+relative,import.meta.url),'utf8');const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require','exports',code)(name=>{if(name in deps)return deps[name];if(name==='react')return react;if(name==='expo-router')return router;if(name==='react/jsx-runtime')return require(name);throw Error('Unmocked refresh dependency '+name);},exports);return exports;};
 const hook=load('src/use-scoped-focus-read.ts');
 const run=renderHook({react,router,load,useScopedFocusRead:hook.useScopedFocusRead});
 return {render(commit=true){cursor=0;layouts=[];effects=[];const result=run();if(commit){for(const fn of layouts)fn();for(const fn of effects)fn();}return result;},
  blur(){focused=false;focusCleanup?.();focusCleanup=undefined;},focus(){focused=true;focusCleanup=focusHandler?.();},
  unmount(){mounted=false;for(const slot of slots)slot?.cleanup?.();focusCleanup?.();focusCleanup=undefined;},
  get writes(){return writes;},get lateWrites(){return lateWrites;},load};
}
