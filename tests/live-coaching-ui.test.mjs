import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {loadSessionModule,settle,treeNodes,treeText} from './helpers/session-layout-runtime.mjs';

function fixture(state='active',coachContext=true,indexView=false,roster=[]) {
 const slots=[],effects=[],listeners=new Map(),timers=new Set(),calls=[],sources=[];
 let cursor=0,tree,deniedRead=false;
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
 const value={session:{organization_id:'org',id:'fixture',title:'Training',state,version:1,training_date:'2026-10-26'},coach:coachContext,viewerId:coachContext?'coach':'athlete',organizationName:'Team',participants:[],eligibleSessions:[]};
 const {LiveCoaching}=loadSessionModule('src/features/live-coaching/live-coaching.tsx',{
  'next/navigation':{useRouter:()=>({push(){}})},'./model':{scoringProgress:()=>({})},'./athlete-identity':loadSessionModule('src/features/live-coaching/athlete-identity.ts'),'./reconcile':{createReconciler},
  './monitoring-dashboard':{LiveMonitor:()=>null},'./presence':{LivePresence:()=>null},'./athlete-training':{AthleteTraining:()=>null},'./heart-rate/sensor-test':{SensorTest:()=>null},'./training-list':{TrainingList:()=>null},
 },hooks,{document,window,EventSource:Source,setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn),fetch:async(url,options)=>{calls.push({url,options});return {ok:!deniedRead,status:deniedRead?403:200,json:async()=>options?.method==='POST'?{id:'fixture'}:indexView?{sessions:[value.session],roster}:value};}});
 const render=()=>{cursor=0;tree=LiveCoaching({sessionId:indexView?undefined:'fixture',organizationId:coachContext?'org':undefined});while(effects.length)effects.shift()();return tree;};
 return {render,calls,sources,timers,listeners,document,denyRead(){deniedRead=true;},nodes:()=>treeNodes(tree),text:()=>treeText(tree),async click(label){const button=treeNodes(tree).find(n=>n.type==='button'&&treeText(n)===label);assert.ok(button,'Missing '+label);await button.props.onClick();},dispose(){for(const s of slots)s?.cleanup?.();}};
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

test('Athlete view never mounts team monitoring or coach lifecycle controls',async()=>{const ui=fixture('active',false);ui.render();await settle();const tree=ui.render();assert.doesNotMatch(ui.text(),/Coach.s Workspace|Complete live training|Cancel training/);assert.ok(!treeNodes(tree).some(n=>n.type?.name==='LiveMonitor'));assert.ok(treeNodes(tree).some(n=>n.type?.name==='AthleteTraining'));assert.ok(ui.calls[0].url.includes('id=fixture'));assert.ok(!ui.calls[0].url.includes('organizationId='));ui.dispose();});


test('Create Training opens and closes the existing creation form without a request',async()=>{
 const ui=fixture('active',true,true);ui.render();await settle();ui.render();assert.match(ui.text(),/Create Training/);assert.ok(!ui.nodes().some(n=>n.type==='form'));await ui.click('Create Training');ui.render();assert.ok(ui.nodes().some(n=>n.type==='form'));await ui.click('Close creation');ui.render();assert.ok(!ui.nodes().some(n=>n.type==='form'));assert.equal(ui.calls.filter(c=>c.options?.method==='POST').length,0);ui.dispose();
});
test('Successful deletion immediately removes list entry and a stale index cannot restore it',async()=>{
 const ui=fixture('active',true,true);ui.render();await settle();ui.render();const list=ui.nodes().find(n=>n.props.sessions);assert.equal(list.props.sessions.length,1);await list.props.onDelete(list.props.sessions[0]);await settle();ui.render();assert.equal(ui.nodes().find(n=>n.props.sessions).props.sessions.length,0);assert.match(ui.text(),/Training deleted/);const request=JSON.parse(ui.calls.find(c=>c.options?.method==='POST').options.body);assert.equal(request.action,'delete');assert.equal(request.organizationId,'org');assert.equal(request.expected,1);ui.dispose();
});
test('A deleted or revoked training clears cached data and closes the stale event stream',async()=>{
 const ui=fixture();ui.render();await settle();ui.render();ui.denyRead();await ui.click('Refresh');await settle();ui.render();assert.ok(ui.sources.every(s=>s.closed));assert.doesNotMatch(ui.text(),/Team/);ui.dispose();
});

test('Stable Live Coaching rerenders do not refetch or recreate event streams',async()=>{const ui=fixture();ui.render();await settle();ui.render();const reads=ui.calls.length,streams=ui.sources.length;for(let i=0;i<20;i++)ui.render();await settle();assert.equal(ui.calls.length,reads);assert.equal(ui.sources.length,streams);for(const tick of ui.timers)tick();await settle();assert.equal(ui.calls.length,reads+1);ui.dispose();});

test('Create Training displays saved profile names and enforces 32 selections without truncating the roster',async()=>{const roster=Array.from({length:33},(_,i)=>({userId:'athlete-'+i,displayName:i===0?'Archer':i===1?'Li Wei':'Saved Profile '+i}));const ui=fixture('active',true,true,roster);ui.render();await settle();ui.render();await ui.click('Create Training');ui.render();assert.match(ui.text(),/Archer|Li Wei/);for(let i=0;i<32;i++){ui.nodes().filter(n=>n.type==='input'&&n.props.type==='checkbox')[i].props.onChange({target:{checked:true}});ui.render();}const boxes=ui.nodes().filter(n=>n.type==='input'&&n.props.type==='checkbox');assert.equal(boxes.length,33);assert.equal(boxes[32].props.disabled,true);assert.equal(boxes[0].props.disabled,false);boxes[0].props.onChange({target:{checked:false}});ui.render();assert.equal(ui.nodes().filter(n=>n.type==='input'&&n.props.type==='checkbox')[32].props.disabled,false);ui.dispose();});
