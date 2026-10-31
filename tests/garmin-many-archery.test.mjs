import test from 'node:test';
import assert from 'node:assert/strict';
import {matchSessionActivity,isGarminArchery} from '../src/features/session-health/activity-matching.ts';
import {combinedActivityHR} from '../src/features/session-health/combined-hr.ts';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const discoveryExports={};
new Function('require','exports',ts.transpileModule(readFileSync('src/features/session-health/activity-discovery.server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(()=>({}),discoveryExports);
test('paged discovery retrieves all 450 candidates without the legacy 50 cap',async()=>{
 const records=Array.from({length:450},(_,i)=>c(String(i).padStart(4,'0')));let calls=0;
 const db={rpc:async(name,args)=>{assert.equal(name,'session_garmin_archery_candidates_v2');calls++;const offset=args.p_after_id===null?0:Number(args.p_after_id)+1;return {data:records.slice(offset,offset+200)};}};
 const rows=await discoveryExports.discoverSessionArchery(db,'session');
 assert.equal(rows.length,450);assert.equal(calls,3);assert.equal(new Set(rows.map(r=>r.source_id)).size,450);
 assert.equal(matchSessionActivity(rows,null,2,[],'2026-10-31',true).incomplete,false);
});
test('discovery transport failure never returns a partial successful day',async()=>{
 let calls=0;const rows=Array.from({length:200},(_,i)=>c(String(i)));
 await assert.rejects(discoveryExports.discoverSessionArchery({rpc:async()=>++calls===1?{data:rows}:{error:{message:'temporary'}}},'session'));
});
test('discovery rejects a repeated page rather than looping or duplicating activities',async()=>{
 const rows=Array.from({length:200},(_,i)=>c(String(i)));
 await assert.rejects(discoveryExports.discoverSessionArchery({rpc:async()=>({data:rows})},'session'));
});
const c=(id,start='2026-10-31T01:00:00Z',type='ARCHERY')=>({source_id:id,start_seconds:Date.parse(start)/1000,duration_seconds:3600,activity_type:type,state:'summary_only',sample_count:0,published:false});
test('three same-day Archery recordings are reusable across two Sessions without writes or timing',()=>{const records=[c('a'),c('b','2026-10-31T03:00:00Z'),c('gym','2026-10-31T06:00:00Z','STRENGTH_TRAINING'),c('c','2026-10-31T08:00:00Z')];for(let i=0;i<2;i++)assert.deepEqual(matchSessionActivity(records,null,2,[],'2026-10-31').activities.map(a=>a.source_id),['a','b','c']);});
for(const type of ['WALKING','RUNNING','CYCLING','STRENGTH_TRAINING','UNKNOWN',null,'ARCHERY_TRAINING'])test(`non-documented category ${type} is not automatic Archery`,()=>{assert.equal(isGarminArchery(type),false);assert.equal(matchSessionActivity([c('fake',undefined,type)],null).activities.length,0);});
test('Archery case is normalized; names are not a sport classifier',()=>{assert.equal(isGarminArchery('archery'),true);assert.equal(matchSessionActivity([{...c('one',undefined,'RUNNING'),activity_name:'Archery practice'}],null).activities.length,0);});
test('exclusions survive deterministic reloads without affecting another Session',()=>{const data=[c('a'),c('b')];for(let i=0;i<3;i++)assert.deepEqual(matchSessionActivity(data,null,2,['a']).activities.map(c=>c.source_id),['b']);assert.equal(matchSessionActivity(data,null,2).activities.length,2);});
test('Singapore start-date matching excludes previous-day activities even when they cross midnight',()=>{const records=[c('previous','2026-10-30T15:30:00Z'),c('current','2026-10-30T16:30:00Z')];assert.deepEqual(matchSessionActivity(records,null,1,[],'2026-10-31').activities.map(c=>c.source_id),['current']);});
test('stable time/ID ordering, duplicate deliveries and late imports are deterministic',()=>{const old=[c('b'),c('a'),c('a')];assert.deepEqual(matchSessionActivity(old,null).activities.map(c=>c.source_id),['a','b']);assert.equal(matchSessionActivity([...old,c('late','2026-10-31T09:00:00Z')],null).activities.length,3);});
test('combined series retain independent overlapping timestamps and explicit missing-data gaps',()=>{const d=(id,samples)=>({id,source:'activity',sourceId:id,start:1000,duration:500,samples});const chart=combinedActivityHR([d('a',[[1000,100],[1010,110],[1020,null],[1100,120]]),d('b',[[1000,140],[1005,150]])]);assert.equal(chart.series.length,2);assert.equal(chart.series[0].runs.length,2);assert.equal(chart.series[0].analysis.valid[0][1],100);assert.equal(chart.series[1].analysis.valid[0][1],140);assert.equal(chart.minimum,100);assert.equal(chart.maximum,150);assert.equal('average' in chart,false);});
test('combined empty samples do not invent extrema',()=>{assert.equal(matchSessionActivity([{...c('receiving'),state:'receiving'},{...c('conflict'),state:'conflict'}],null).activities.length,2);const result=combinedActivityHR([]);assert.equal(result.minimum,null);assert.equal(result.maximum,null);});
