import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadSessionModule,treeNodes,treeText} from './helpers/session-layout-runtime.mjs';
const scoring=await import('@arc-track/core/scoring');
const model=loadSessionModule('src/features/live-coaching/model.ts',{'@/features/sessions/scoring-model':scoring});
const monitor=loadSessionModule('src/features/live-coaching/monitor-model.ts',{'./model':model});
const measurement=loadSessionModule('src/features/live-coaching/heart-rate/measurement.ts');
const dependencies={'./model':model,'./monitor-model':monitor,'./heart-rate/measurement':measurement,'./heart-rate/panel':{HeartRatePanel:()=>null,HeartRateStatus:()=>null}};
const chart=loadSessionModule('src/features/live-coaching/monitoring-dashboard.tsx',dependencies);
const at=seconds=>new Date(100000+seconds*1000).toISOString();
const arrows=['8','9','X'].map((score,i)=>({id:'arrow'+i,end:1,arrow:i+1,score,syncState:'saved',plot:null}));
const person=(id,name,values=arrows)=>({athleteId:id,displayName:name,state:'joined',scoringSessionId:'scoring-'+id,scoring:{id:'scoring-'+id,title:'Training',rounds:[{id:'round-'+id,roundNumber:1,name:'70 m',division:'Recurve',distanceMetres:70,arrowsPerEnd:3,ends:2,arrows:values}]}});
const data={session:{id:'live',organization_id:'org',title:'Team practice',state:'active',training_date:'2026-10-27',started_at:at(0)},organizationName:'Team',coach:true,viewerId:'coach',participants:[person('b','Beth',arrows.slice(0,1)),person('a','Alex')],eligibleSessions:[]};

test('Monitoring sorting uses authoritative confirmed scores and progress without mutating roster',()=>{
 const original=data.participants.map(p=>p.athleteId);
 for(const sort of ['score','ends','progress','name'])assert.equal(monitor.monitorAthletes(data.participants,'','all','all',sort,[],110000)[0].participant.athleteId,'a');
 assert.deepEqual(data.participants.map(p=>p.athleteId),original);assert.equal(model.scoringProgress(data.participants[0].scoring).confirmedTotal,0);
});
test('Name, participation and fresh-signal filters distinguish readings from website presence',()=>{
 const readings=[{athleteId:'a',consent:true,sourceId:'sensor',bpm:80,receivedAt:at(0)}];
 assert.equal(monitor.monitorAthletes(data.participants,'alex','joined','receiving','name',readings,105000).length,1);
 assert.equal(monitor.monitorAthletes(data.participants,'','all','receiving','name',readings,111000).length,0);
 assert.equal(monitor.monitorAthletes(data.participants,'','invited','all','name',readings,105000).length,0);
 assert.equal(monitor.monitorAthletes(data.participants,'','all','connected','name',readings,111000,new Set(['a']))[0].participant.athleteId,'a','Local connection is distinct from a stale reading');
 assert.equal(monitor.monitorAthletes(data.participants,'','all','not_connected','name',readings,105000,new Set(['a']))[0].participant.athleteId,'b');
});
test('Training elapsed time follows lifecycle and freezes at completion; old sessions remain unknown',()=>{
 assert.equal(monitor.elapsedTraining(at(0),null,165000),'00:01:05');assert.equal(monitor.elapsedTraining(at(0),at(60),999999),'00:01:00');assert.equal(monitor.elapsedTraining(null,null,0),'Not recorded');
});
test('HR geometry preserves segment gaps, timestamps, finite BPM and the full selected interval',()=>{
 const points=[{at:at(0),bpm:70,segment:1},{at:at(10),bpm:80,segment:1},{at:at(60),bpm:85,segment:2}];
 const g=monitor.hrGeometry(points);assert.equal(g.paths.length,2);assert.equal(g.dots[2].x,580);assert.equal(g.dots[0].point.bpm,70);assert.ok(g.paths[0].includes('L'));
 assert.equal(monitor.hrGeometry(Array.from({length:400},(_,i)=>({at:at(i),bpm:80,segment:1}))).dots.length,400);assert.equal(monitor.hrGeometry([{at:'bad',bpm:0,segment:1}]).dots.length,0);
});
test('HR chart exposes actual statistics, an accessible sample table and honest missing history',()=>{
 const history={athleteId:'a',count:2,minimum:70,maximum:80,average:75,points:[{at:at(0),bpm:70,segment:1},{at:at(10),bpm:80,segment:1}]};
 const html=renderToStaticMarkup(React.createElement(chart.HeartRateChart,{history}));assert.match(html,/75 BPM/);assert.match(html,/Accessible HR sample table/);assert.match(html,/not shot timestamps/);assert.match(html,/70/);assert.match(html,/80/);
 assert.match(renderToStaticMarkup(React.createElement(chart.HeartRateChart,{})),/No retained HR readings/);
});
function ui(state='active'){
 const slots=[],effects=[],listeners=new Map(),timers=new Set();let cursor=0,tree;
 class Element {isConnected=true;getClientRects(){return [{}];}focus(){document.activeElement=this;}}
 const hooks={...React,useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(initial){const i=cursor++;return slots[i]??={current:initial};},useCallback(fn){cursor++;return fn;},useEffect(fn,deps){const i=cursor++;if(!slots[i]||!deps.every((v,n)=>Object.is(v,slots[i].deps[n]))){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}};
 const document={visibilityState:'visible',addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
 const compiled=loadSessionModule('src/features/live-coaching/monitoring-dashboard.tsx',dependencies,hooks,{document,HTMLElement:Element,setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn),process:{env:{NEXT_PUBLIC_LIVE_COACHING_BLE_ENABLED:'true'}}});
 const render=()=>{cursor=0;tree=compiled.LiveMonitor({data:{...data,session:{...data.session,state}},connection:'Connected to updates'});while(effects.length)effects.shift()();return tree;};
 return {render,listeners,timers,document,Element,nodes:()=>treeNodes(tree),text:()=>treeText(tree),async click(label){const b=treeNodes(tree).find(n=>n.type==='button'&&treeText(n)===label);assert.ok(b,label);await b.props.onClick();},dispose(){for(const s of slots)s?.cleanup?.();}};
}
test('Coach overview is a simple list; detailed history controls appear only inside athlete detail',async()=>{
 const f=ui();f.render();assert.match(f.text(),/Monitor Alex/);assert.match(f.text(),/Monitor Beth/);
 assert.ok(!f.nodes().some(n=>n.type==='input'&&n.props.type==='search'));
 assert.doesNotMatch(f.text(),/Find athlete|Sort by|Full-screen monitoring|Earlier HR interval|Grid|Table/);
 await f.click('Monitor Beth');f.render();const detail=f.nodes().find(n=>typeof n.type==='function'&&n.props.participant);assert.equal(detail.props.participant.athleteId,'b');assert.match(treeText(detail.props.historyControls),/Earlier HR interval/);
 detail.props.onClose();f.render();assert.match(f.text(),/Monitor Beth/);f.dispose();assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);
});

test('Cached review history is removed immediately when authoritative timeline consent disappears',()=>{
 const f=ui('completed');f.render();const panel=()=>f.nodes().find(n=>n.props.onSnapshot);const h={athleteId:'a',points:[{at:at(0),bpm:70,segment:1}],count:1,minimum:70,maximum:70,average:70};
 panel().props.onSnapshot({readings:[{athleteId:'a',consent:true,historyConsent:true}],history:[h],endActivity:[]});f.render();assert.match(f.text(),/TRAINING REVIEW/);
 panel().props.onSnapshot({readings:[{athleteId:'a',consent:true,historyConsent:false}],history:null,endActivity:[]});f.render();const chartNode=f.nodes().find(n=>n.props.compact);assert.equal(chartNode.props.history,undefined);assert.doesNotMatch(f.text(),/Connect HR sensor/);f.dispose();
});
test('Visible website presence is bounded, aborts on background and cleans up on unmount',()=>{
 let effect;const calls=[],timers=new Set(),listeners=new Map(),document={visibilityState:'visible',addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
 const {LivePresence}=loadSessionModule('src/features/live-coaching/presence.tsx',{}, {...React,useEffect:fn=>{effect=fn;}},{process:{env:{NEXT_PUBLIC_LIVE_COACHING_BLE_ENABLED:'true'}},document,fetch:(_url,options)=>{calls.push(options);return new Promise(()=>{});},setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn)});
 LivePresence({scoringSessionId:'owned'});const cleanup=effect();assert.equal(calls.length,1);for(const t of timers)t();assert.equal(calls.length,1);document.visibilityState='hidden';listeners.get('visibilitychange')();assert.ok(calls[0].signal.aborted);cleanup();assert.equal(timers.size,0);assert.equal(listeners.size,0);
});
test('Presence HTTP denies cross-origin, oversized and injected identities before its checked RPC',async()=>{
 const id='b1000000-0000-4000-8000-000000000001',calls=[];
 const client={auth:{getUser:async()=>({data:{user:{id}}})},rpc:async(name,args)=>{calls.push({name,args});return {data:1};}};
 const {POST}=loadSessionModule('src/app/api/live-coaching/presence/route.ts',{'@/lib/supabase/server':{createAuthClient:async()=>client},'@/features/live-coaching/http.server':{uuid:value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value)}},React,{process:{env:{LIVE_COACHING_BLE_ENABLED:'true'}}});
 const req=(body,origin='https://arc.example')=>new Request('https://arc.example/api/live-coaching/presence',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await POST(req({liveId:id},'https://evil.example'))).status,403);assert.equal((await POST(req({liveId:id,athleteId:id}))).status,400);assert.equal((await POST(req({liveId:id,extra:'x'.repeat(1100)}))).status,413);assert.equal(calls.length,0);
 assert.equal((await POST(req({liveId:id}))).status,200);assert.equal(calls[0].name,'touch_live_presence');assert.deepEqual(calls[0].args,{p_live:id,p_scoring:null});
});
