import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {matchSessionActivity} from '../src/features/session-health/activity-matching.ts';
const require=createRequire(import.meta.url);
function load(path,mocks){const exports={};const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','exports',code)(name=>name in mocks?mocks[name]:name==='react/jsx-runtime'||name.startsWith('node:')?require(name):(()=>{throw Error(name)})(),exports);return exports;}
const candidate=(id='one',type='ARCHERY')=>({source_id:id,start_seconds:1792882800,duration_seconds:3600,activity_type:type,state:'summary_only',sample_count:0,published:false});
test('a unique same-day activity is automatic without a write or confirmation',()=>{const match=matchSessionActivity([candidate()],null,1);assert.equal(match.mode,'automatic');assert.equal(match.activity.source_id,'one');});
test('late imports become available on the next deterministic read',()=>{assert.equal(matchSessionActivity([],null,1).mode,'waiting');assert.equal(matchSessionActivity([candidate()],null,1).mode,'automatic');});
test('a single explicit archery category distinguishes gym and walking without invented thresholds',()=>{const m=matchSessionActivity([candidate('gym','STRENGTH_TRAINING'),candidate(),candidate('walk','WALKING')],null,1);assert.equal(m.activity.source_id,'one');});
for(const count of [0,2,4])test(`Archery matching remains automatic across ${count} peer Sessions`,()=>assert.equal(matchSessionActivity([candidate()],null,count).mode,'automatic'));
test('multiple Archery activities match while unrelated types do not',()=>{assert.equal(matchSessionActivity([candidate(),candidate('two')],null,1).activities.length,2);assert.equal(matchSessionActivity([candidate('walk','WALKING'),candidate('gym','STRENGTH_TRAINING')],null,1).activities.length,0);});
test('manual activity and explicit unlink are never overridden by new automatic suggestions',()=>{const link={session_id:'session',activity_id:'walk',updated_at:'now'};assert.equal(matchSessionActivity([candidate(),candidate('walk','WALKING')],link,2).activity.source_id,'walk');assert.equal(matchSessionActivity([candidate()],{...link,activity_id:null},1).mode,'unlinked');assert.equal(matchSessionActivity([candidate()],link,1).activity,null);});
test('duplicates are deduplicated; unknown states and malformed timestamps cannot match',()=>{assert.equal(matchSessionActivity([candidate(),candidate()],null,1).mode,'automatic');for(const c of [{...candidate(),state:'unknown'},{...candidate(),start_seconds:NaN},{...candidate(),duration_seconds:0}])assert.equal(matchSessionActivity([c],null,1).mode,'waiting');});
test('capped discovery does not pretend its first 50 candidates are exhaustive',()=>{assert.equal(matchSessionActivity(Array.from({length:50},(_,i)=>candidate(String(i))),null,1).incomplete,true);});
function readerFixture({permission=true,revoke=false,malformed=false,missing=false}={}){
 const calls=[];let checks=0;
 const d={id:'dataset',source_id:'one',start_seconds:1000,duration_seconds:60,activity_type:'ARCHERY',state:'complete',sample_count:3,part_count:1,published:true};
 const db={rpc:async()=>({data:permission&&!(revoke&&++checks>1),error:null}),from(table){const filters=[];calls.push({table,filters});let single=false;
  const result=()=>({data:table==='garmin_health_records'?[{source_id:'one',start_seconds:1000,duration_seconds:60,metrics:{averageHeartRate:110},updated_at:'2026-10-01T00:00:00Z'}]:table==='garmin_hr_datasets'?(single?d:[d]):missing?[]:[{part:0,samples:[[1000,100],[1013,malformed?999:120],[1060,null]]}],error:null});
  const q={select:()=>q,eq:(...args)=>{filters.push(args);return q;},order:()=>q,limit:async()=>result(),maybeSingle:async()=>{single=true;return result();}};return q;}};
 const loaded=load('src/features/session-health/activity-read.server.ts',{'server-only':{}});return {module:loaded,db,calls};
}
test('detail reader scopes summaries, datasets and chunks to the authenticated owner and activity',async()=>{const f=readerFixture(),d=await f.module.readImportedActivity(f.db,'owner','one');assert.equal(d.datasets[0].samples[1][0],1013);assert.equal(d.metrics.averageHeartRate,110);for(const call of f.calls)assert.ok(call.filters.some(([k,v])=>k==='user_id'&&v==='owner'));assert.ok(f.calls[1].filters.some(([k,v])=>k==='source_id'&&v==='one'));});
for(const scenario of [{permission:false},{revoke:true},{malformed:true},{missing:true}])test(`detail reads fail closed: ${JSON.stringify(scenario)}`,async()=>{const f=readerFixture(scenario);await assert.rejects(f.module.readImportedActivity(f.db,'owner','one'));if(scenario.permission===false)assert.equal(f.calls.length,0);});
test('activity endpoint rejects unauthenticated access and never accepts another submitted owner',async()=>{
 let reads=0,owner;
 for(const signedIn of [false,true]){
  const api=load('src/app/api/integrations/garmin/activity/route.ts',{'@/lib/supabase/server':{createAuthClient:async()=>({auth:{getUser:async()=>({data:{user:signedIn?{id:'verified-owner'}:null},error:null})}})},'@/features/session-health/activity-read.server':{ActivityAccessError:class extends Error{},readImportedActivity:async(_db,id)=>{reads++;owner=id;return null;}}});
  const r=await api.GET(new Request('https://arc.example/api/integrations/garmin/activity?activityId=one&userId=victim'));assert.equal(r.status,signedIn?404:401);assert.equal(r.headers.get('cache-control'),'private, no-store');
 }
 assert.equal(reads,1);assert.equal(owner,'verified-owner');
});
test('activity detail renders available metrics and honest summary-only status without fake graph points',()=>{
 const model=load('src/features/session-health/model.ts',{});
 const component=load('src/features/session-health/activity-details.tsx',{'react':{...React,useState:value=>[value===null?{recording:candidate(),metrics:{activityName:'Archery practice',averageHeartRate:110},datasets:[],updatedAt:null}:value,()=>{}],useEffect:()=>{}},'next/link':{__esModule:true,default:({children})=>React.createElement('a',{},children)},'next/navigation':{useRouter:()=>({back(){}})},'./model':model,'./heart-rate-timeline':{HeartRateTimeline:()=>{throw Error('Summary must not render a fake timeline')}},'./session-health.module.css':{__esModule:true,default:{}}});
 const html=renderToStaticMarkup(React.createElement(component.ActivityDetails,{activityId:'one'}));assert.match(html,/Archery practice/);assert.match(html,/110/);assert.match(html,/Detailed heart-rate samples are not available/);assert.doesNotMatch(html,/Elevation gain|Cycling cadence/);
});
import {createSessionUI,settle} from './helpers/session-layout-runtime.mjs';
test('an arriving automatic match displays HR without a POST, and authorization loss removes it',async()=>{
 let arrived=false,authorized=true;
 const recording=candidate();
 const h=createSessionUI(async()=>Response.json({authorized,link:null,recording:arrived?recording:null,candidates:arrived?[recording]:[],datasets:[],match:{mode:arrived?'automatic':'waiting',reason:arrived?'The only eligible recording on this Session date.':'Awaiting synchronization.'}}));
 try{h.render();await settle();h.render();assert.match(h.text(),/Awaiting synchronization/);
 arrived=true;await h.click('Refresh');await settle();h.render();assert.match(h.text(),/Garmin recording start/);assert.match(h.text(),/only eligible recording/);assert.equal(h.calls.some(c=>c.options.method==='POST'),false);
 authorized=false;await h.click('Refresh');await settle();h.render();assert.doesNotMatch(h.text(),/Garmin recording start|bpm/);
 }finally{h.dispose();}
});
test('unauthorized refresh clears a previously displayed recording rather than treating it as a temporary transport failure',async()=>{
 let denied=false;
 const h=createSessionUI(async()=>denied?Response.json({error:'Sign in again'},{status:401}):Response.json({authorized:true,link:null,recording:candidate(),candidates:[candidate()],datasets:[]}));
 try{h.render();await settle();h.render();assert.match(h.text(),/Garmin recording start/);denied=true;await h.click('Refresh');await settle();h.render();assert.doesNotMatch(h.text(),/Garmin recording start|bpm/);}finally{h.dispose();}
});

test('unchanged activity refresh rechecks authorization without downloading HR chunks',async()=>{
 const f=readerFixture();const first=await f.module.readImportedActivity(f.db,'owner','one');f.calls.length=0;
 const second=await f.module.readImportedActivity(f.db,'owner','one',first.revision);assert.equal(second.unchanged,true);assert.deepEqual(second.datasets,[]);assert.equal(f.calls.some(c=>c.table==='garmin_hr_chunks'),false);
});
