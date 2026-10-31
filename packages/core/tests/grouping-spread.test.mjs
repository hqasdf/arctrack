import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateGroupingSpread, calculateGroupingMetrics } from '../src/session-insights-model.ts';
import { calculateTrainingCompetitionComparison } from '../src/analytics-model.ts';

// Frozen pre-optimization centroid/RMS expression: preserve operation order exactly.
function originalSpread(points) {
  if(!points.length)return null;
  const centreX=points.reduce((sum,p)=>sum+p.x,0)/points.length;
  const centreY=points.reduce((sum,p)=>sum+p.y,0)/points.length;
  return {centreX,centreY,spreadNormalized:points.length>=3?Math.sqrt(points.reduce((sum,p)=>sum+(p.x-centreX)**2+(p.y-centreY)**2,0)/points.length):null};
}
test('spread-only results exactly preserve the original centroid, RMS and minimum count',()=>{
  const cases=[[],[{x:0,y:0}],[{x:-1,y:1},{x:1,y:-1}],Array.from({length:10},()=>({x:.1,y:.2})),[{x:-.1,y:0},{x:.1,y:0},{x:0,y:.3}]];
  for(let size=3;size<=80;size++)cases.push(Array.from({length:size},(_,i)=>({x:Math.sin(i*13.1)/3,y:Math.cos(i*7.9)/4})));
  for(const points of cases){
    const expected=originalSpread(points),actual=calculateGroupingSpread(points);
    assert.deepEqual(actual,expected);
    const complete=calculateGroupingMetrics(points,122);
    if(expected){assert.equal(complete.centreX,expected.centreX);assert.equal(complete.centreY,expected.centreY);assert.equal(complete.spreadNormalized,expected.spreadNormalized);}
    else assert.equal(complete,null);
  }
});
test('full grouping metrics still calculate the actual maximum pairwise distance',()=>{
  const metrics=calculateGroupingMetrics([{x:0,y:0},{x:3,y:0},{x:0,y:4}],40);
  assert.equal(metrics.groupSizeNormalized,5);assert.equal(metrics.groupSizeCm,100);
});
test('Advanced Insights avoids pairwise work on large histories and excludes unassigned triple plots',()=>{
  const points=Array.from({length:72000},(_,i)=>({x:Math.sin(i)/3,y:Math.cos(i)/4,faceIndex:0}));
  const records=[{sessionId:'one',sessionType:'training',date:'2026-10-30',round:{distanceMetres:18,division:'Recurve',faceDiameterCm:40,faceType:'triple_face',arrows:[...points.map((plot,i)=>({id:String(i),score:'X',plot})),{score:'M',plot:{x:99,y:99}},{score:'9',plot:null}]}}];
  const original=Math.hypot;let calls=0;
  Math.hypot=(...args)=>{calls++;return original(...args);};
  let comparison;
  try{comparison=calculateTrainingCompetitionComparison(records);}finally{Math.hypot=original;}
  assert.equal(calls,0);assert.equal(comparison.training.plottedArrowCount,points.length);
  assert.equal(comparison.training.spread,originalSpread(points).spreadNormalized);
  assert.equal(comparison.competition.spread,null);
  assert.equal(records[0].round.arrows.length,72002);
});
test('mixed layouts continue to suppress spread without discarding scoring values',()=>{
  const rounds=['full_face','six_ring'].map((faceType,i)=>({sessionType:i?'competition':'training',round:{faceType,faceDiameterCm:80,distanceMetres:50,division:'Compound',arrows:[{score:'X',plot:{x:0,y:0}},{score:'M',plot:null},{score:'8',plot:{x:.2,y:.3}}]}}));
  const result=calculateTrainingCompetitionComparison(rounds);
  assert.equal(result.training.spread,null);assert.equal(result.competition.spread,null);
  assert.equal(result.training.average,6);assert.equal(result.competition.average,6);
});
