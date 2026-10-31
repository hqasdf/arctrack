import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as contracts from '../packages/core/src/session-contracts.ts';
const row={id:'00000000-0000-4000-8000-000000000001',title:'Practice',session_date:'2026-10-31',created_at:'2026-10-31T03:00:00Z',session_type:'training',arrow_count:180,session_rounds:[{count:3}]};
function load(file,mocks){const compiled=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;const exports={};new Function('require','exports',compiled)(name=>{assert.ok(name in mocks,name);return mocks[name];},exports);return exports;}
for(const platform of ['web','mobile'])for(const scenario of ['valid','query failure','capped','unauthorized'])test(`${platform} summary reader: ${scenario}`,async()=>{
 const calls=[];let reads=0;
 const query={select:(...args)=>{calls.push(['select',...args]);return query;},eq:(...args)=>{calls.push(['eq',...args]);return query;},order:(...args)=>{calls.push(['order',...args]);return query;},then:resolve=>resolve({data:[row],count:scenario==='capped'?2:1,error:scenario==='query failure'?{}:null})};
 const client={auth:{getUser:async()=>({data:{user:{id:scenario==='unauthorized'?'other':'owner'}},error:null})},from:table=>{reads++;assert.equal(table,'sessions');return query;}};
 const web=platform==='web';const loaded=load(web?'src/features/sessions/summary-read.server.ts':'apps/mobile/src/session-summaries.ts',{'server-only':{},'@arc-track/core/sessions':contracts,'@/lib/auth/session.server':{requireUser:async()=>{if(scenario==='unauthorized')throw Error('unauthorized');return{id:'owner'};}},'@/lib/supabase/server':{createAuthClient:async()=>client},'./supabase':{supabase:client}});
 const request=()=>web?loaded.readSessionSummaries({sessionType:'competition'}):loaded.readOwnSessionSummaries('owner',{sessionType:'competition'});
 if(scenario!=='valid'){await assert.rejects(request());if(scenario==='unauthorized')assert.equal(reads,0);return;}
 const result=await request();assert.equal(result[0].arrowCount,180);assert.equal(result[0].roundCount,3);assert.equal(reads,1);
 assert.deepEqual(calls.filter(c=>c[0]==='eq'),[['eq','user_id','owner'],['eq','session_type','competition']]);
 assert.deepEqual(calls.filter(c=>c[0]==='order').map(c=>c[1]),['session_date','created_at','id']);
 const select=calls.find(c=>c[0]==='select');assert.match(select[1],/session_rounds\(count\)/);assert.doesNotMatch(select[1],/plot_|session_ends|score_points/);assert.deepEqual(select[2],{count:'exact'});
});
test('detail, Analytics, Coach and retained-workspace contracts remain separate from summaries',()=>{
 for(const file of ['src/features/sessions/read.server.ts','apps/mobile/src/sessions.ts','src/features/organizations/coach-read.server.ts','src/features/analytics/read.server.ts','src/features/sessions/components/sessions-workspace.tsx']){
  assert.doesNotMatch(readFileSync(file,'utf8'),/readSessionSummaries|readOwnSessionSummaries/);
 }
 const web=readFileSync('src/features/sessions/read.server.ts','utf8'),native=readFileSync('apps/mobile/src/sessions.ts','utf8');for(const s of [web,native]){assert.match(s,/session_ends/);assert.match(s,/plot_x,plot_y,face_index/);}
});
