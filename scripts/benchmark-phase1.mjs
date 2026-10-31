/** Local synthetic CPU benchmark only. No database, environment files or network. */
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = resolve(process.argv[2] ?? 'packages/core/src');
const model = await import(pathToFileURL(resolve(directory,'analytics-model.ts')).href);
const filters={sessionType:'training',dateRange:'all',distance:'all',division:'all',targetFace:'all'};
for(const count of [100,1000]) {
  const sessions=Array.from({length:count},(_,i)=>({id:`session-${i}`,title:'Synthetic practice',date:'2026-10-30',sessionType:i%4?'training':'competition',arrowCount:72,rounds:[{id:`round-${i}`,roundNumber:1,name:'Synthetic round',division:'Recurve',distanceMetres:70,ends:12,arrowsPerEnd:6,faceDiameterCm:122,faceType:'full_face',arrows:Array.from({length:72},(_,j)=>({id:`arrow-${i}-${j}`,end:Math.floor(j/6)+1,arrow:j%6+1,score:j%11===0?'X':String(j%10),plot:{x:.1,y:.2},syncState:'saved'}))}]}));
  const times=[];
  let comparison;
  for(let run=0;run<5;run++) {
    const start=performance.now();
    const rounds=model.filterAnalyticsRounds(sessions,filters,'2026-10-30');
    model.calculateOverview(rounds);model.calculateTrend(rounds);model.calculateTargetGroupings(rounds);
    comparison=model.calculateTrainingCompetitionComparison(model.filterComparisonRounds(sessions,filters,'2026-10-30'));
    model.calculateArrowVolume(sessions,filters,'2026-10-30','daily');
    times.push(performance.now()-start);
  }
  console.log(JSON.stringify({synthetic:true,node:process.version,sessions:count,arrows:count*72,
    runsMs:times.map(time=>Number(time.toFixed(3))),medianMs:Number([...times].sort((a,b)=>a-b)[2].toFixed(3)),comparison,
    scope:'Pure model execution; excludes database, HTTP, RSC, hydration, DOM and compression'}));
}
