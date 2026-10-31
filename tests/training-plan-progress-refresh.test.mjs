import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { loadSessionModule,treeNodes } from './helpers/session-layout-runtime.mjs';
const tick=()=>new Promise(setImmediate);
function runtime(load,revision=0){
  const slots=[],effects=[],listeners=new Map();let cursor=0,tree,requests=0;
  const hooks={...React,useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>{slots[i]=value;}];},useRef:value=>slots[cursor++]??={current:value},useEffect(fn,deps){const i=cursor++;if(!slots[i]||!deps.every((v,n)=>v===slots[i].deps[n])){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}};
  const window={addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:n=>listeners.delete(n)};
  const {AthletePlanProgress}=loadSessionModule('src/features/organizations/components/athlete-plan-progress.tsx',{
    './training-plan-ui':{AthletePlanCard:'PlanCard'},'../training-plan-events':{TRAINING_PLAN_PROGRESS_CHANGED:'change',trainingPlanProgressRevision:()=>revision},
    '../training-plan-progress-actions':{loadOwnTrainingPlanProgress:()=>{requests++;return load();}},
  },hooks,{window});
  const plans=[{plan:{id:'original'}}];
  const render=()=>{cursor=0;tree=AthletePlanProgress({plans,today:'2026-10-30'});while(effects.length)effects.shift()();return tree;};
  return{render,refresh:()=>listeners.get('change')(),requests:()=>requests,plans:()=>treeNodes(tree).find(n=>n.type==='PlanCard').props.plans,dispose:()=>slots.forEach(s=>s?.cleanup?.())};
}
test('initial server progress is reused; Back refreshes progress without fetching Session history',async()=>{
  const latest=[{plan:{id:'updated'}}],h=runtime(async()=>({ok:true,data:latest}));h.render();assert.equal(h.requests(),0);
  h.refresh();await tick();h.render();assert.equal(h.requests(),1);assert.deepEqual(h.plans(),latest);h.dispose();
});
test('progress refresh is recovered if notification occurred while scoring had the panel unmounted',async()=>{
  const h=runtime(async()=>({ok:true,data:[]}),1);h.render();await tick();h.render();assert.equal(h.requests(),1);assert.deepEqual(h.plans(),[]);h.dispose();
});
test('overlapping notifications coalesce and a failed refresh preserves existing progress',async()=>{
  let resolve;const h=runtime(()=>new Promise(done=>{resolve=done;}));h.render();h.refresh();h.refresh();h.refresh();assert.equal(h.requests(),1);
  resolve({ok:false,message:'Progress unavailable'});await tick();assert.equal(h.requests(),2);resolve({ok:false,message:'Progress unavailable'});await tick();h.render();assert.equal(h.plans()[0].plan.id,'original');h.dispose();
});
test('the progress server action derives identity itself and delegates only the existing bounded progress reader',async()=>{
  let actor=0,reads=0;
  const actions=loadSessionModule('src/features/organizations/training-plan-progress-actions.ts',{
    '@/lib/auth/session.server':{requireUser:async()=>{actor++;}},'@/lib/date':{singaporeDate:()=> '2026-10-30'},
    './training-plans-read.server':{readOwnTrainingPlanProgress:async date=>{assert.equal(actor,1);assert.equal(date,'2026-10-30');reads++;return[];}},
  });
  assert.deepEqual(await actions.loadOwnTrainingPlanProgress(),{ok:true,data:[]});assert.equal(reads,1);
});
