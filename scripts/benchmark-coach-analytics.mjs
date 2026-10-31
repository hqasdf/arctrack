import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import * as original from '../packages/core/tests/fixtures/coach-analytics-before-phase3d3.ts';
import * as current from '../packages/core/src/coach-analytics-model.ts';
import {coachHistoryFixture} from '../packages/core/tests/helpers/coach-analytics-fixtures.mjs';
if(!global.gc)throw Error('Run with --expose-gc for comparable pre-call heap baselines.');
const beforeOnly=process.argv.includes('--before');
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const rows=[];
for(const count of [500,2000,5000])for(const scenario of ['athlete','team']){
 const {athletes,sessions,today}=coachHistoryFixture(count,scenario==='athlete'?1:32);
 const filters={...current.DEFAULT_COACH_FILTERS,period:'all'};
 const call=model=>scenario==='athlete'?model.buildCoachAthleteInsights(athletes[0],sessions,filters,today):model.buildCoachTeamAnalytics(athletes,sessions,filters,today);
 assert.deepStrictEqual(call(current),call(original));
 for(let warm=0;warm<2;warm++){call(original);call(current);}
 const measurements={before:[],after:[]};
 const measure=(name,model)=>{
  global.gc();const heap=process.memoryUsage().heapUsed,start=performance.now();const result=call(model);const elapsed=performance.now()-start,heapDelta=process.memoryUsage().heapUsed-heap;
  global.gc();const retainedHeapDelta=process.memoryUsage().heapUsed-heap;
  // Keep the result reachable across GC, as a rendered view would retain it.
  assert.ok(result.summary.sessionCount>0&&result.filteredRounds.length>0);
  measurements[name].push({elapsed,heapDelta,retainedHeapDelta});
 };
 for(let run=0;run<7;run++){
  if(beforeOnly)measure('before',original);
  else if(run%2){measure('after',current);measure('before',original);}
  else {measure('before',original);measure('after',current);}
 }
 const summarize=name=>({medianMs:median(measurements[name].map(r=>r.elapsed)),medianHeapDeltaKiB:median(measurements[name].map(r=>r.heapDelta))/1024,medianRetainedHeapDeltaKiB:median(measurements[name].map(r=>r.retainedHeapDelta))/1024,runs:measurements[name]});
 const before=summarize('before'),after=beforeOnly?null:summarize('after');
 const rounds=sessions.flatMap(s=>s.rounds),arrows=rounds.flatMap(r=>r.arrows);
 rows.push({scenario,sessions:count,athletes:athletes.length,rounds:rounds.length,arrows:arrows.length,plottedArrows:arrows.filter(a=>a.plot).length,jsonBytes:Buffer.byteLength(JSON.stringify({athletes,sessions})),before,after,speedup:after?before.medianMs/after.medianMs:null});
}
console.log(JSON.stringify({synthetic:true,phase:beforeOnly?'reference-only baseline':'paired original versus optimized',node:process.version,warmups:2,runs:7,scope:'Pure models; no database, HTTP, UI or device measurements. Timing excludes explicit GC. Immediate heap delta includes uncollected allocations; retained delta is after forced GC with the result reachable. Neither is peak memory.',rows},null,2));
