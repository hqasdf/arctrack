import test from 'node:test';
import assert from 'node:assert/strict';
import {scopedReadRuntime,deferred,settle} from './helpers/scoped-read-runtime.mjs';
import {SessionHistoryError} from '../../../packages/core/src/session-history.ts';
import * as analytics from '../../../packages/core/src/analytics-model.ts';
import * as chart from '../../../packages/core/src/chart-axis.ts';
import * as mobile from '../src/mobile-analytics.ts';
import * as axis from '../src/analytics-chart-model.ts';
import * as coachAnalytics from '../../../packages/core/src/coach-analytics-model.ts';
function harness(background=false){
 let scope='account-a:org-a';const pending=[];
 const h=scopedReadRuntime(({react,useScopedFocusRead})=>()=>useScopedFocusRead(scope,react.useCallback(()=>{const d=deferred();pending.push(d);return d.promise;},[scope]),'Retry this view.',background));
 h.render();return {h,pending,scope(value){scope=value;}};
}
for(const background of [false,true]){
 test(`latest success wins and older completion cannot finish newer loading (${background})`,async()=>{
  const {h,pending}=harness(background);const reload=h.render().reload;void reload();pending[0].resolve('old');await settle();assert.equal(h.render().loading,true);assert.equal(h.render().data,null);
  pending[1].resolve('new');await settle();assert.equal(h.render().data,'new');assert.equal(h.render().loading,false);
 });
 test(`older error cannot overwrite newer success (${background})`,async()=>{
  const {h,pending}=harness(background);void h.render().reload();pending[1].resolve('new');await settle();pending[0].reject(new Error('old failure'));await settle();assert.equal(h.render().data,'new');assert.equal(h.render().error,null);
 });
 test(`blur/refocus invalidates even a late authorization error (${background})`,async()=>{
  const {h,pending}=harness(background);h.blur();h.focus();pending[1].resolve('focused result');await settle();pending[0].reject(new SessionHistoryError('authorization'));await settle();assert.equal(h.render().data,'focused result');assert.equal(h.render().error,null);
 });
 for(const lost of [null,new SessionHistoryError('authorization'),Object.assign(new Error('safe'),{cause:{code:'42501'}}),{status:401},{status:403}])test(`current permission loss clears protected snapshot (${background}, ${lost?.reason??lost?.status??lost?.cause?.code??'null'})`,async()=>{
  const {h,pending}=harness(background);pending[0].resolve('private');await settle();void h.render().reload();if(lost===null)pending[1].resolve(null);else pending[1].reject(lost);await settle();assert.equal(h.render().data,null);assert.equal(h.render().loading,false);
 });
 test(`transient failure can retry without a permanent loading state (${background})`,async()=>{
  const {h,pending}=harness(background);pending[0].resolve('verified');await settle();void h.render().reload();pending[1].reject(new SessionHistoryError());await settle();assert.equal(h.render().data,background?'verified':null);assert.equal(h.render().error,'Retry this view.');
  void h.render().reload();pending[2].resolve('recovered');await settle();assert.equal(h.render().data,'recovered');assert.equal(h.render().error,null);
 });
}
for(const scope of ['account-a:org-b','account-b:org-a',null])test(`scope change hides private data before lifecycle effects (${scope})`,async()=>{
 const f=harness();f.pending[0].resolve('scope-a');await settle();assert.equal(f.h.render().data,'scope-a');f.scope(scope);assert.equal(f.h.render(false).data,null);
 // Commit using a fresh harness render to model the same scope change.
 f.h.unmount();assert.equal(f.h.lateWrites,0);
});
test('organisation switching and logout prevent stale results from restoring access',async()=>{
 const f=harness();f.scope('account-a:org-b');f.h.render();f.pending[1].resolve('org-b');await settle();f.pending[0].resolve('org-a');await settle();assert.equal(f.h.render().data,'org-b');
 const old=f.h.render().reload;void old();f.scope(null);f.h.render();f.pending[2].resolve('stale');await settle();assert.equal(f.h.render().data,null);assert.equal(f.h.render().loading,false);
 f.scope('account-b:org-b');f.h.render();f.pending[3].resolve('account-b');await settle();assert.equal(f.h.render().data,'account-b');
});
test('returning to the same scope cannot revive its previous generation',async()=>{
 const f=harness();f.scope('b');f.h.render();f.scope('account-a:org-a');f.h.render();f.pending[2].resolve('new a');await settle();f.pending[0].resolve('old a');f.pending[1].resolve('b');await settle();assert.equal(f.h.render().data,'new a');
});
test('an older success cannot undo the latest access denial',async()=>{
 const {h,pending}=harness(true);void h.render().reload();pending[1].reject(new SessionHistoryError('authorization'));await settle();assert.equal(h.render().data,null);
 pending[0].resolve('previously authorized');await settle();assert.equal(h.render().data,null);assert.equal(h.render().error,'Retry this view.');h.unmount();
});
test('unmount and reload from an old handler cause no late writes or extra reads',async()=>{
 const {h,pending}=harness();const reload=h.render().reload;h.unmount();const writes=h.writes;pending[0].resolve('unmounted');await settle();await reload();assert.equal(h.writes,writes);assert.equal(h.lateWrites,0);assert.equal(pending.length,1);
});
test('ordinary rerenders do not introduce requests or refresh loops',()=>{
 const {h,pending}=harness();for(let i=0;i<20;i++)h.render();assert.equal(pending.length,1);h.blur();void h.render().reload();assert.equal(pending.length,1);h.unmount();
});
test('background refresh preserves the mounted detail reference and drafts',async()=>{
 const {h,pending}=harness(true),data={session:'verified'};pending[0].resolve(data);await settle();void h.render().reload();assert.equal(h.render().data,data);assert.equal(h.render().loading,false);
 pending[1].reject(new Error('temporary'));await settle();assert.equal(h.render().data,data);h.unmount();
});
test('Coach workspace stops obsolete request chains after blur and clears revoked membership',async()=>{
 let actor='a',organization='club';const role=[],counts={roster:0,sessions:0};
 const h=scopedReadRuntime(({load,useScopedFocusRead})=>{
  const {useCoachWorkspace}=load('src/coach-workspace.ts',{'./use-scoped-focus-read':{useScopedFocusRead},'./auth':{useAuth:()=>({user:actor?{id:actor}:null})},'./organizations':{
   readCoachOrganization:()=>{const d=deferred();role.push(d);return d.promise;},readCoachAthletes:async()=>{counts.roster++;return [];},readCoachOrganizationSessions:async()=>{counts.sessions++;return [];},
  }});return()=>useCoachWorkspace(organization);
 });h.render();h.blur();role[0].resolve({id:'club',name:'Club'});await settle();assert.deepEqual(counts,{roster:0,sessions:0});h.focus();role[1].resolve({id:'club',name:'Club'});await settle();assert.equal(h.render().data.organization.id,'club');
 void h.render().reload();role[2].resolve(null);await settle();assert.equal(h.render().data,null);
 actor='b';organization='other';assert.equal(h.render().data,null);role[3].resolve({id:'other',name:'Other'});await settle();assert.equal(h.render().data.organization.id,'other');h.unmount();
});
test('actual Analytics screen never passes the previous account history to its view model',async()=>{
 let actor='account-a';const pending=[],seen=[];
 const palette=new Proxy({},{get:()=> '#123456'});
 const h=scopedReadRuntime(({load,useScopedFocusRead})=>{
  const {default:Screen}=load('app/(tabs)/analytics.tsx',{
   '@arc-track/core/analytics':analytics,'@arc-track/core/chart-axis':chart,
   'react-native':{ActivityIndicator:'ActivityIndicator',Pressable:'Pressable',ScrollView:'ScrollView',Text:'Text',View:'View',StyleSheet:{create:v=>v}},
   'react-native-svg':{default:'Svg',Circle:'Circle',Line:'Line',Polyline:'Polyline',Text:'SvgText'},
   '../../src/analysis-target':{AnalysisTarget:()=>null},'../../src/analytics-chart-model':axis,
   '../../src/auth':{useAuth:()=>({user:actor?{id:actor}:null})},
   '../../src/mobile-analytics':{...mobile,singaporeToday:()=> '2026-10-31',mobileAnalyticsView:(sessions,...args)=>{seen.push(sessions);return mobile.mobileAnalyticsView(sessions,...args);}},
   '../../src/sessions':{readOwnAnalyticsSessions:id=>{const d=deferred();pending.push({...d,owner:id});return d.promise;}},
   '../../src/theme':{PAGE_TOP_SPACING:20},'../../src/appearance':{useAppearance:()=>({colors:palette}),createThemedStyles:f=>()=>f(palette)},
   '../../src/use-scoped-focus-read':{useScopedFocusRead},
  });return Screen;
 });h.render();actor='account-b';h.render();assert.equal(pending.length,2);assert.deepEqual(seen.at(-1),[]);
 const data=id=>[{id,title:id,date:'2026-10-31',sessionType:'training',arrowCount:10,rounds:[]}];
 pending[1].resolve(data('b'));await settle();h.render();assert.equal(seen.at(-1)[0].id,'b');pending[0].resolve(data('a'));await settle();h.render();assert.equal(seen.at(-1)[0].id,'b');
 h.blur();h.focus();pending[2].reject(new SessionHistoryError('authorization'));await settle();h.render();assert.deepEqual(seen.at(-1),[]);
 actor=null;h.render();assert.equal(pending.length,3);h.unmount();assert.equal(h.lateWrites,0);
});
for(const [name,path,keys] of [
 ['Athlete','[userId].tsx',['actor','organizationId','userId']],
 ['Session','[userId]/sessions/[sessionId].tsx',['actor','organizationId','userId','sessionId']],
 ['Round','[userId]/sessions/[sessionId]/rounds/[roundId].tsx',['actor','organizationId','userId','sessionId','roundId']],
])test(`actual Coach ${name} detail binds every route scope and retains safe background mode`,async()=>{
 let actor='coach-a',capture;const params={organizationId:'org-a',userId:'athlete-a',sessionId:'session-a',roundId:'round-a'},calls=[];
 const palette=new Proxy({},{get:()=> '#123456'}),styles=new Proxy({},{get:()=>({})});
 const track=(name,result)=>(...args)=>{calls.push({name,args});return Promise.resolve(result);};
 const h=scopedReadRuntime(({load})=>{
  const {default:Screen}=load('app/(tabs)/organization/[organizationId]/athletes/'+path,{
   '@arc-track/core/coach-analytics':coachAnalytics,'@arc-track/core/analytics':analytics,'@arc-track/core/dates':{},'@arc-track/core/training-plan':{},'@arc-track/core/coach-round':{},'@arc-track/core/scoring':{},
   'expo-router':{useLocalSearchParams:()=>params,router:{push:()=>{}}},
   'react-native':{ActivityIndicator:'ActivityIndicator',Pressable:'Pressable',ScrollView:'ScrollView',Text:'Text',View:'View',StyleSheet:{create:v=>v}},
   '@/src/auth':{useAuth:()=>({user:actor?{id:actor}:null})},
   '@/src/coach-ui':{useCoachPalette:()=>palette,useCoachStyles:()=>styles,createCoachStyles:()=>()=>styles},
   '@/src/mobile-analytics':{singaporeToday:()=> '2026-10-31'},
   '@/src/organizations':{readCoachAthletes:async()=>[{userId:params.userId}],readCoachAthleteSessions:track('athlete',null)},
   '@/src/coach-read':{readCoachSessionDetail:track('session',null),readCoachAthleteSessionIndex:track('index',[]),readCoachRoundDetail:track('round',null)},
   '@/src/notes-feedback-ui':{},'@/src/training-plans-read':{readMobileCoachAthleteTrainingPlanProgress:async()=>[]},'@/src/training-plans-ui':{},
   '@/src/training-plan-route-params':{singleTrainingPlanRouteParam:v=>v},'@/src/coach-mobile-model':{},'@/src/round-insights':{},'@/src/coach-readonly-target':{},'@/src/theme':{PAGE_TOP_SPACING:20},
   '@/src/use-scoped-focus-read':{useScopedFocusRead:(scope,read,_message,background)=>{capture={scope,read,background};return {data:null,loading:true,error:null,reload:()=>{}};}},
  });return Screen;
 });h.render();assert.deepEqual(JSON.parse(capture.scope),keys.map(k=>k==='actor'?actor:params[k]));assert.equal(capture.background,true);
 assert.equal(await capture.read(()=>true),null);assert.ok(calls.every(c=>c.args[0]==='coach-a'&&c.args[1]==='org-a'&&c.args[2]==='athlete-a'));
 actor='coach-b';params.organizationId='org-b';params.userId='athlete-b';h.render();assert.deepEqual(JSON.parse(capture.scope),keys.map(k=>k==='actor'?actor:params[k]));
 actor=null;h.render();assert.equal(capture.scope,null);h.unmount();
});
