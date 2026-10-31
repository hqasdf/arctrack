import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as history from '../packages/core/src/session-history.ts';
import * as order from '../packages/core/src/round-order-model.ts';
import * as coachRound from '../packages/core/src/coach-round-model.ts';
import {loadSessionModule} from './helpers/session-layout-runtime.mjs';
import {renderToStaticMarkup} from 'react-dom/server';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const athlete=id(1),coach=id(2),org=id(3),session=id(4);
test('failed completeness has an accessible retry state instead of partial statistics',()=>{
 let retries=0;const {HistoryLoadError}=loadSessionModule('src/features/sessions/components/history-load-error.tsx');const element=HistoryLoadError({reset:()=>{retries++;}});
 const html=renderToStaticMarkup(element);assert.match(html,/role="alert"/);assert.match(html,/Partial history has not been used/);
 element.props.children.find(child=>child.type==='button').props.onClick();assert.equal(retries,1);
});
function load(path,mocks){const exports={};new Function('require','exports',ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(n=>{assert.ok(n in mocks,n);return mocks[n];},exports);return exports;}
function fixture(actor=athlete,{corrupt=false,denied=false}={}){
 const calls=[];const row={id:session,user_id:athlete,title:'Custom',session_date:'2026-10-31',created_at:'2026-10-31T00:00:00Z',session_type:'training',arrow_count:120,session_rounds:[{id:id(5),round_number:1,name:'9 × 4',division:'Recurve',distance_metres:30,face_diameter_cm:80,face_type:'full_face',planned_ends:4,arrows_per_end:9,session_ends:[{id:id(6),end_number:1,arrows:[{id:id(7),arrow_number:1,score_points:9,is_x:false,plot_x:.1,plot_y:.2,face_index:null}]}]}]};
 const db={from(table){assert.equal(table,'organization_members');const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{organizations:{name:'Club'}},error:null})};return q;},async rpc(name,args){calls.push({name,args});if(name==='read_coach_athlete_roster')return {data:[{user_id:athlete,display_name:'Athlete',joined_at:'2026-01-01'}],error:null};assert.equal(name,'read_complete_session_history_v1');assert.equal(args.p_actor,actor);if(denied)return {data:null,error:{code:'42501'}};const details=args.p_details;const items=[structuredClone(row)];if(!details)delete items[0].session_rounds;return {data:{version:1,complete:true,details,owners:[athlete],counts:{sessions:1,rounds:details?1:0,ends:details?1:0,arrows:details?(corrupt?2:1):0},items},error:null};}};
 const deps={'server-only':{},react:{cache:f=>f},'next/navigation':{notFound:()=>{throw Error('not found');}},'@arc-track/core/session-history':history,'@arc-track/core/round-order':order,'@arc-track/core/coach-round':coachRound,'@/lib/auth/session.server':{requireUser:async()=>({id:actor})},'@/lib/supabase/server':{createAuthClient:async()=>db},'./supabase':{supabase:db},'./organization-model':{mapCoachRoster:r=>r.map(a=>({userId:a.user_id}))}};
 const web=load('src/features/sessions/read.server.ts',deps),mapper=load('apps/mobile/src/session-mapper.ts',deps);deps['./session-mapper']=mapper;
 const mobile=load('apps/mobile/src/sessions.ts',deps),organizations=load('apps/mobile/src/organizations.ts',deps);deps['./organizations']=organizations;deps['@/features/sessions/read.server']=web;
 return {calls,web,mobile,webCoach:load('src/features/organizations/coach-read.server.ts',deps),mobileCoach:load('apps/mobile/src/coach-read.ts',deps),organizations};
}
for(const platform of ['web','mobile'])test(`${platform} history and selected detail preserve complete custom scoring`,async()=>{
 const f=fixture();const all=platform==='web'?await f.web.readSessions():await f.mobile.readOwnAnalyticsSessions(athlete);const selected=platform==='web'?await f.web.readOwnedSession(session):await f.mobile.readOwnSession(athlete,session);
 assert.deepEqual(all[0],selected);assert.equal(selected.arrowCount,120);assert.equal(selected.rounds[0].arrows.length,1);assert.equal(selected.rounds[0].arrows[0].plot.x,.1);assert.equal(selected.rounds[0].ends,4);assert.ok(f.calls.every(c=>c.name==='read_complete_session_history_v1'));
});
for(const platform of ['web','mobile'])for(const scenario of ['corrupt','denied'])test(`${platform} ${scenario} history never becomes an empty successful dataset`,async()=>{
 const f=fixture(athlete,{[scenario]:true});await assert.rejects(platform==='web'?f.web.readSessions():f.mobile.readOwnAnalyticsSessions(athlete),history.SessionHistoryError);
});
for(const platform of ['web','mobile'])test(`${platform} Coach detail, organization totals and navigation use authorized snapshot contract`,async()=>{
 const f=fixture(coach);const all=platform==='web'?await f.webCoach.readCoachOrganizationSessions(org):await f.organizations.readCoachOrganizationSessions(coach,org);
 const detail=platform==='web'?await f.webCoach.readCoachSessionDetail(org,athlete,session):await f.mobileCoach.readCoachSessionDetail(coach,org,athlete,session);
 const index=platform==='web'?await f.webCoach.readCoachAthleteSessionIndex(org,athlete):await f.mobileCoach.readCoachAthleteSessionIndex(coach,org,athlete);
 assert.equal(all[0].userId,athlete);assert.equal(detail.rounds[0].ends[0].id,id(6));assert.equal(index[0].id,session);assert.equal('session_rounds' in index[0],false);
 const requests=f.calls.filter(c=>c.name==='read_complete_session_history_v1');assert.ok(requests.every(c=>c.args.p_organization===org));assert.equal(requests.at(-1).args.p_details,false);
});
