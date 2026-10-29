import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import React from 'react';
import * as JSX from 'react/jsx-runtime';
import ts from 'typescript';
const settle=()=>new Promise(setImmediate);
function runtime(count=100){
 const instances=new Map(),timers=new Set(),listeners=new Set(),channels=new Set(),calls={summaries:0,details:[],created:0};
 let current,tree,held,failCreate=false,creationHold;
 const pendingEffects=[];
 const hooks={...React,useState(initial){const instance=current,i=instance.cursor++;if(!(i in instance.slots))instance.slots[i]=typeof initial==='function'?initial():initial;return[instance.slots[i],value=>{instance.slots[i]=typeof value==='function'?value(instance.slots[i]):value;}];},
  useRef(value){const i=current.cursor++;return current.slots[i]??={current:value};},
  useCallback(fn,deps){const i=current.cursor++,old=current.slots[i];if(!old||!deps.every((v,j)=>Object.is(v,old.deps[j])))current.slots[i]={deps,fn};return current.slots[i].fn;}};
 const AppState={currentState:'active',addEventListener(_,fn){listeners.add(fn);return{remove:()=>listeners.delete(fn)};}};
 const invitations=Array.from({length:count},(_,i)=>({id:'training-'+i,organization_id:'org',title:'Training '+i,training_date:'2026-10-29',state:'active',participation_state:'joined',coach_name:'Coach',version:1}));
 const detail=id=>({session:{id,state:'active',version:1,training_date:'2026-10-29'},coach:false,viewerId:'owner',participants:[{athleteId:'owner',state:'joined',scoringSessionId:null}],eligibleSessions:[]});
 const deps={react:hooks,'react/jsx-runtime':JSX,'expo-router':{router:{push(){}},useFocusEffect(fn){const instance=current,i=instance.cursor++,old=instance.slots[i];if(!old||old.fn!==fn){instance.slots[i]={fn};pendingEffects.push(()=>{old?.cleanup?.();instance.slots[i].cleanup=fn();});}}},
  'react-native':{...Object.fromEntries(['View','Text','Pressable','ActivityIndicator'].map(n=>[n,n])),StyleSheet:{create:v=>v},AppState,Alert:{alert(){}}},
  './appearance':{useAppearance:()=>({colors:{}}),createThemedStyles:fn=>()=>fn({})},
  './writes':{createMobileSession:async()=>{calls.created++;if(creationHold)await creationHold;if(failCreate)throw Error('Uncertain creation');return{id:'created'};}},
  './live-coaching':{readTrainingInvitations:async()=>{calls.summaries++;return invitations;},readAthleteTraining:async(_,id)=>{calls.details.push(id);if(held?.id===id)await held.promise;return detail(id);},
   watchAthleteTraining:(_,id)=>{channels.add(id);return()=>channels.delete(id);},trainingAction:async()=>{calls.linked=(calls.linked??0)+1;}}};
 const exports={};const code=ts.transpileModule(readFileSync(new URL('../src/live-coaching-ui.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','exports',code+';exports.Card=TrainingCard;')(name=>{assert.ok(name in deps,name);return deps[name];},exports);
 const oldSet=globalThis.setInterval,oldClear=globalThis.clearInterval;
 globalThis.setInterval=fn=>{timers.add(fn);return fn;};globalThis.clearInterval=fn=>timers.delete(fn);
 const nodes=n=>Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...nodes(n.props?.children)]:[];
 function render(){
  const active=new Set();
  function component(id,fn,props){active.add(id);const instance=instances.get(id)??{slots:[],cursor:0};instances.set(id,instance);current=instance;instance.cursor=0;return fn(props);}
  const root=component('root',exports.MobileTrainingInvitations,{userId:'owner',organizationId:'org'});
  const walk=n=>Array.isArray(n)?n.map(walk):n&&typeof n==='object'?n.type===exports.Card?walk(component(n.key,exports.Card,n.props)):{...n,props:{...n.props,children:walk(n.props?.children)}}:n;
  tree=walk(root);
  for(const [key,instance] of instances)if(!active.has(key)){for(const s of instance.slots)s?.cleanup?.();instances.delete(key);}
  while(pendingEffects.length)pendingEffects.shift()();return tree;
 }
 return{calls,timers,listeners,channels,render,async settle(){await settle();render();},
  open(i){const row=nodes(tree).find(n=>n.key==='training-'+i);assert.ok(row,'summary');nodes(row).find(n=>n.props?.label==='Open Training').props.onPress();render();},
  async press(label){const action=nodes(tree).find(n=>n.props?.label===label);assert.ok(action,label);if(!action.props.disabled)action.props.onPress();await settle();render();},
  background(){AppState.currentState='background';for(const fn of [...listeners])fn('background');render();},
  foreground(){AppState.currentState='active';for(const fn of [...listeners])fn('active');},
  hold(id){let release;held={id,promise:new Promise(r=>release=r)};return()=>{held=null;release();};},failCreate(){failCreate=true;},
  holdCreation(){let release;creationHold=new Promise(r=>release=r);return()=>{creationHold=null;release();};},
  dispose(){for(const i of instances.values())for(const s of i.slots)s?.cleanup?.();instances.clear();globalThis.setInterval=oldSet;globalThis.clearInterval=oldClear;}};
}
test('100 invitation summaries create no detail reads/channels and only one refresh lifecycle',async()=>{
 const f=runtime();try{f.render();await f.settle();assert.equal(f.calls.summaries,1);assert.equal(f.calls.details.length,0);assert.equal(f.channels.size,0);assert.equal(f.timers.size,1);assert.equal(f.listeners.size,1);
  f.open(0);await f.settle();assert.deepEqual(f.calls.details,['training-0']);assert.equal(f.channels.size,1);assert.equal(f.timers.size,2);
  f.open(1);await f.settle();assert.deepEqual([...f.channels],['training-1']);assert.equal(f.timers.size,2);
  await f.press('Close training details');assert.equal(f.channels.size,0);assert.equal(f.timers.size,1);
 }finally{f.dispose();}assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);
});
test('switching selection ignores late old detail and background removes every detail subscription',async()=>{
 const f=runtime();try{f.render();await f.settle();const release=f.hold('training-0');f.open(0);await settle();f.open(1);await f.settle();release();await f.settle();assert.deepEqual([...f.channels],['training-1']);
  f.background();assert.equal(f.channels.size,0);f.foreground();await f.settle();await f.settle();assert.deepEqual([...f.channels],['training-1']);
 }finally{f.dispose();}
});
test('closing and reopening a detail preserves uncertain Session creation instead of creating duplicates',async()=>{
 const f=runtime(2);try{f.render();await f.settle();f.open(0);await f.settle();f.failCreate();await f.press('Connect Scoring Session');await f.press('Create and connect new Session');assert.equal(f.calls.created,1);
  await f.press('Close training details');f.open(0);await f.settle();await f.press('Connect Scoring Session');await f.press('Create and connect new Session');assert.equal(f.calls.created,1);
 }finally{f.dispose();}
});
test('a creation finishing after background/remount is adopted for association retry without duplication',async()=>{
 const f=runtime(2);try{f.render();await f.settle();f.open(0);await f.settle();const release=f.holdCreation();await f.press('Connect Scoring Session');await f.press('Create and connect new Session');assert.equal(f.calls.created,1);
  f.background();f.foreground();await f.settle();await f.settle();release();await f.settle();assert.equal(f.calls.linked??0,0,'Retired detail cannot automatically link');
  await f.press('Connect Scoring Session');await f.press('Retry scoring connection');assert.equal(f.calls.created,1);assert.equal(f.calls.linked,1);
 }finally{f.dispose();}
});
