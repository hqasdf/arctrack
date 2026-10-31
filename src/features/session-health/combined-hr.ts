import {hrAnalysis,chartPoints,type HRDataset,type HRSample} from './model.ts';
export function combinedActivityHR(datasets:HRDataset[]){
 const series=datasets.filter(d=>d.source==='activity').map(d=>{
  const analysis=hrAnalysis([d],d.start,d.start+d.duration);const runs:HRSample[][]=[];let current:HRSample[]=[];
  for(const p of analysis.points){if(p[0]<d.start||p[0]>d.start+d.duration)continue;if(p[1]===null||current.length&&p[0]-current.at(-1)![0]>60){if(current.length)runs.push(current);current=[];}if(p[1]!==null)current.push(p);}
  if(current.length)runs.push(current);
  return {id:d.sourceId,analysis,runs:runs.length>200?chartPoints(analysis.valid,600).map(p=>[p]):runs.map(r=>chartPoints(r,Math.max(4,Math.floor(600/Math.max(1,runs.length)))))};
 });
 const valid=series.filter(s=>s.analysis.count>0);
 return {series,start:datasets.length?Math.min(...datasets.map(d=>d.start)):0,end:datasets.length?Math.max(...datasets.map(d=>d.start+d.duration)):0,
 minimum:valid.length?Math.min(...valid.map(s=>s.analysis.minimum!)):null,maximum:valid.length?Math.max(...valid.map(s=>s.analysis.maximum!)):null};
}
