import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {readFileSync} from 'node:fs';
import {loadSessionModule,settle,treeNodes,treeText} from './helpers/session-layout-runtime.mjs';
const {athleteIdentities}=loadSessionModule('src/features/live-coaching/athlete-identity.ts');
test('Saved profile names take precedence, preserve Unicode and distinguish duplicates without contact data',()=>{
 const entries=athleteIdentities([{userId:'aaaaaaaa-1',firstName:'Account',lastName:'Name',displayName:' Li Wei '},{userId:'aaaaaaaa-2',displayName:'Li Wei'},{userId:'bbbbbbbb',displayName:null},{userId:'cccccccc',displayName:'Archer'},{userId:'dddddddd',displayName:'Nur   Aisyah Abdullah'}]);
 assert.equal(entries[0].name,'Li Wei');assert.notEqual(entries[0].identifier,entries[1].identifier);assert.equal(entries[2].name,'Name not provided');assert.equal(entries[3].name,'Archer');assert.equal(entries[4].name,'Nur Aisyah Abdullah');assert.equal(entries[4].identifier,null);
 assert.equal(athleteIdentities(Array.from({length:32},(_,i)=>({userId:String(i).padStart(8,'0'),displayName:'A'.repeat(80)}))).length,32);
});
function invitations({fail=false,hold=false}={}){
 const slots=[],effects=[],listeners=new Map(),timers=new Set(),calls=[];let cursor=0,tree,release;
 const hooks={...React,useState(v){const i=cursor++;if(!(i in slots))slots[i]=v;return [slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},useRef(v){const i=cursor++;return slots[i]??={current:v};},useCallback(fn){cursor++;return fn;},useEffect(fn,deps){const i=cursor++;if(!slots[i]||!deps.every((v,j)=>v===slots[i].deps[j])){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}};
 const document={visibilityState:'visible',addEventListener:(n,f)=>listeners.set('doc:'+n,f),removeEventListener:n=>listeners.delete('doc:'+n)};
 const window={addEventListener:(n,f)=>listeners.set('win:'+n,f),removeEventListener:n=>listeners.delete('win:'+n)};
 const session={id:'live',title:'Evening team training',training_date:'2026-10-28',state:'active',version:3,coach_name:'Coach Full Name',participation_state:'invited',organization_name:'Archery team'};
 const {AthleteInvitations}=loadSessionModule('src/features/live-coaching/athlete-invitations.tsx',{'./live-coaching':{LiveCoaching:()=>null},'./reconcile':loadSessionModule('src/features/live-coaching/reconcile.ts')},hooks,{document,window,setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn),fetch:async(url,options)=>{calls.push({url,options});if(options.method==='POST'){if(hold)await new Promise(r=>release=r);if(fail)return {ok:false,json:async()=>({error:'Response not confirmed'})};session.participation_state=JSON.parse(options.body).action==='join'?'joined':'declined';return {ok:true,json:async()=>({id:'live'})};}return {ok:!fail,json:async()=>fail?{error:'Offline'}:{sessions:session.participation_state==='declined'?[]:[{...session}]}};}});
 return {calls,timers,listeners,document,session,release:()=>release?.(),setFailure:v=>{fail=v;},render(){cursor=0;tree=AthleteInvitations({organizationId:'org'});while(effects.length)effects.shift()();return tree;},text:()=>treeText(tree),nodes:()=>treeNodes(tree),click(label){return treeNodes(tree).find(n=>n.type==='button'&&treeText(n)===label).props.onClick();},dispose(){for(const s of slots)s?.cleanup?.();}};
}
test('Pending invitations are inline with coach/date and direct Join/Decline; joining reveals scoring controls only after confirmation',async()=>{
 const ui=invitations();ui.render();await settle();ui.render();assert.match(ui.text(),/Evening team training|Coach Full Name/);assert.match(ui.text(),/2026-10-28/);assert.ok(ui.calls[0].url.includes('membershipOrganizationId=org'));
 ui.click('Join Training');await settle();ui.render();assert.match(ui.text(),/Training joined/);assert.ok(ui.nodes().some(n=>n.props.embedded&&n.props.sessionId==='live'));assert.equal(JSON.parse(ui.calls.find(c=>c.options.method==='POST').options.body).expected,3);ui.dispose();
});
test('Duplicate invitation actions issue one mutation and decline refreshes the inline list',async()=>{
 const ui=invitations({hold:true});ui.render();await settle();ui.render();ui.click('Decline');ui.click('Decline');assert.equal(ui.calls.filter(c=>c.options.method==='POST').length,1);ui.release();await settle();ui.render();assert.match(ui.text(),/Invitation declined/);assert.match(ui.text(),/No current training invitations/);ui.dispose();
});
test('Invitation reads recover automatically, refresh on foreground and remove timers/listeners on exit',async()=>{
 const ui=invitations({fail:true});ui.render();await settle();ui.render();assert.match(ui.text(),/Offline/);ui.setFailure(false);for(const timer of ui.timers)timer();await settle();ui.render();assert.match(ui.text(),/Coach Full Name/);
 ui.document.visibilityState='hidden';ui.listeners.get('doc:visibilitychange')();ui.render();assert.doesNotMatch(ui.text(),/Coach Full Name/);const before=ui.calls.length;for(const timer of ui.timers)timer();await settle();assert.equal(ui.calls.length,before);
 ui.document.visibilityState='visible';ui.listeners.get('doc:visibilitychange')();await settle();ui.render();assert.match(ui.text(),/Coach Full Name/);ui.dispose();assert.equal(ui.listeners.size,0);assert.equal(ui.timers.size,0);
});
test('Invitation summary API uses authenticated scoped RPC and rejects mixed coach context',async()=>{
 const calls=[];const {liveCoachingRequest}=loadSessionModule('src/features/live-coaching/http.server.ts',{'server-only':{},'@/features/sessions/read.server':{mapSession:v=>v},'@/lib/supabase/server':{createAuthClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'athlete'}}})},rpc:async(name,args)=>{calls.push({name,args});return {data:{sessions:[]}};}})}});
 assert.equal((await liveCoachingRequest(new Request('https://arc.example/api/live-coaching?invitations=1'))).status,200);assert.equal(calls[0].name,'read_live_coaching_invitations');assert.equal(calls[0].args.p_org,null);
 assert.equal((await liveCoachingRequest(new Request('https://arc.example/api/live-coaching?invitations=1&organizationId=b5000000-0000-4000-8000-000000000001'))).status,400);assert.equal(calls.length,1);
});
test('Membership landing embeds invitations directly and uses athlete organisation wording',()=>{
 const source=readFileSync('src/app/(platform)/organization/member/[organizationId]/page.tsx','utf8');assert.match(source,/<AthleteInvitations organizationId=\{organizationId\}/);assert.doesNotMatch(source,/Coach&apos;s Workspace|href="\/live-coaching"/);
});
