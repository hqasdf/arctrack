import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadSessionModule,treeNodes,treeText} from './helpers/session-layout-runtime.mjs';

function athlete(state='invited',{scoring=null,create,change}={}) {
 const calls=[],slots=[];let cursor=0,tree;
 const hooks={...React,useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(initial){const i=cursor++;return slots[i]??={current:initial};}};
 const data={coach:false,viewerId:'athlete',session:{id:'live',title:'Morning training',state:'active',training_date:'2026-10-28'},participants:[{athleteId:'athlete',state,scoringSessionId:scoring?.id??null,scoring}],eligibleSessions:[{id:'own-session',title:'Own training',session_date:'2026-10-28'}]};
 const {AthleteTraining}=loadSessionModule('src/features/live-coaching/athlete-training.tsx',{
  '@/features/sessions/actions':{createSession:async input=>{calls.push({create:input});return create?create(input):{ok:true,data:{id:'new-scoring'}};}},
  './heart-rate/panel':{HeartRatePanel:()=>null},
 },hooks,{process:{env:{}},FormData:class{get(){return 'New training';}}});
 const onChange=async(action,extra)=>{calls.push({action,...extra});return change?change(action,extra):true;};
 const render=()=>{cursor=0;tree=AthleteTraining({data,busy:false,onChange});return tree;};
 const click=async label=>{const node=treeNodes(tree).find(n=>n.type==='button'&&treeText(n)===label);assert.ok(node,label);await node.props.onClick();};
 return {data,calls,render,click,text:()=>treeText(tree),nodes:()=>treeNodes(tree)};
}

test('Invitation shows only Join and Decline, with no scoring selection or team monitor',async()=>{
 const f=athlete();f.render();assert.match(f.text(),/You are invited/);assert.doesNotMatch(f.text(),/Team monitoring|Find athlete|HR signal|Sort by|Connect Scoring Session/);
 assert.equal(f.nodes().filter(n=>n.type==='select').length,0);await f.click('Join Training');await f.click('Decline');
 assert.deepEqual(f.calls,[{action:'join'},{action:'decline'}]);
});
test('Joined athlete explicitly selects and confirms an owned eligible Session',async()=>{
 const f=athlete('joined');f.render();assert.match(f.text(),/Awaiting scoring connection/);await f.click('Connect Scoring Session');f.render();
 const select=f.nodes().find(n=>n.type==='select');select.props.onChange({target:{value:'own-session'}});f.render();await f.click('Confirm connection');
 assert.deepEqual(f.calls,[{action:'link',scoringSessionId:'own-session'}]);
});
test('Existing confirmed association restores Continue Scoring without reconnecting or creating',()=>{
 const f=athlete('joined',{scoring:{id:'confirmed',title:'Saved training'}});f.render();assert.match(f.text(),/Continue Scoring/);
 assert.ok(f.nodes().some(n=>n.props.href==='/sessions?session=confirmed'));assert.equal(f.calls.length,0);
});
test('New Session uses the existing creation action; failed connection retries the same ID',async()=>{
 let linked=false;const f=athlete('joined',{change:()=>linked});f.render();await f.click('Connect Scoring Session');f.render();
 const submit=()=>f.nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){},currentTarget:{}});
 submit();await new Promise(r=>setImmediate(r));f.render();assert.equal(f.calls.filter(c=>c.create).length,1);assert.equal(f.calls[1].scoringSessionId,'new-scoring');
 linked=true;submit();await new Promise(r=>setImmediate(r));f.render();assert.equal(f.calls.filter(c=>c.create).length,1);assert.equal(f.calls[2].scoringSessionId,'new-scoring');
 assert.deepEqual(f.calls[0].create,{title:'New training',date:'2026-10-28',sessionType:'training'});
});
test('Failed Session creation never attempts association, and duplicate submissions share one creation',async()=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;});const f=athlete('joined',{create:()=>pending});f.render();await f.click('Connect Scoring Session');f.render();
 const form=f.nodes().find(n=>n.type==='form'),event={preventDefault(){},currentTarget:{}};form.props.onSubmit(event);form.props.onSubmit(event);
 assert.equal(f.calls.filter(c=>c.create).length,1);finish({ok:false,message:'Not saved'});await new Promise(r=>setImmediate(r));f.render();assert.match(f.text(),/Not saved/);assert.equal(f.calls.filter(c=>c.action==='link').length,0);
});
test('Cancelled training and declined invitations never offer connection actions',()=>{
 const f=athlete('joined');f.data.session.state='cancelled';f.render();assert.doesNotMatch(f.text(),/Connect Scoring Session/);
 const declined=athlete('declined');declined.render();assert.doesNotMatch(declined.text(),/Join Training|Connect Scoring Session/);
});

test('Join allows no scoring ID, while link requires a valid explicit ID',async()=>{
 const calls=[];const {liveCoachingRequest}=loadSessionModule('src/features/live-coaching/http.server.ts',{'server-only':{},'@/features/sessions/read.server':{mapSession:v=>v},'@/lib/supabase/server':{createAuthClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'actor'}}})},rpc:async(name,args)=>{calls.push({name,args});return {data:'live'};}})}});
 const post=action=>new Request('https://arc.example/api/live-coaching',{method:'POST',headers:{origin:'https://arc.example','Content-Type':'application/json'},body:JSON.stringify({action,id:'b5000000-0000-4000-8000-000000000001',expected:2})});
 assert.equal((await liveCoachingRequest(post('join'))).status,200);assert.equal(calls[0].args.p_scoring,null);assert.equal((await liveCoachingRequest(post('link'))).status,400);assert.equal(calls.length,1);
});

test('Main navigation exposes coach wording only for server-verified coach membership',()=>{
 const {Navigation}=loadSessionModule('src/components/layout/navigation.tsx',{
  'next/navigation':{usePathname:()=>'/live-coaching'},'@/components/theme/theme-control':{ThemeSelector:()=>null},
  '@/components/ui/icon':{Icon:()=>null},'@/features/auth/components/sign-out-button':{SignOutButton:()=>null},
 });
 const athlete=renderToStaticMarkup(React.createElement(Navigation,{authenticated:true,coachAccess:false}));
 assert.doesNotMatch(athlete,/Coach&#x27;s Workspace/);assert.match(athlete,/Organisations/);assert.match(athlete,/Live Training/);
 const coach=renderToStaticMarkup(React.createElement(Navigation,{authenticated:true,coachAccess:true}));assert.match(coach,/Coach&#x27;s Workspace/);
});

test('Athlete HR consent reads use a separate owner RPC; team-monitor failures remain denied',async()=>{
 const calls=[];const {liveHeartRateRequest}=loadSessionModule('src/features/live-coaching/heart-rate/http.server.ts',{'server-only':{},'../http.server':{uuid:v=>/^[a-f0-9-]{36}$/.test(v)},'@/lib/supabase/server':{createAuthClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'athlete'}}})},rpc:async(name,args)=>{calls.push({name,args});return name==='read_live_monitor'?{error:{code:'42501'}}:{data:{readings:[],history:[],endActivity:[]}};}})}},React,{process:{env:{LIVE_COACHING_BLE_ENABLED:'true'}}});
 const url='https://arc.example/api/live-coaching/heart-rate?id=b5000000-0000-4000-8000-000000000001';
 assert.equal((await liveHeartRateRequest(new Request(url+'&view=athlete'))).status,200);assert.equal(calls[0].name,'read_live_athlete_hr');
 assert.equal((await liveHeartRateRequest(new Request(url))).status,403);assert.equal(calls[1].name,'read_live_monitor');
});
