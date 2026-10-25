'use client';
import { useMemo, useState } from 'react';
import { chartPoints, hrAnalysis, singaporeTime, type HRSample } from './model';
import styles from './session-health.module.css';
type Analysis=ReturnType<typeof hrAnalysis>;
export function HeartRateTimeline({analysis,start,end}:{analysis:Analysis;start:number;end:number}) {
 const [range,setRange]=useState<[number,number]>([0,100]);
 const [selected,setSelected]=useState<number|null>(null);
 const left=start+(end-start)*range[0]/100,right=start+(end-start)*range[1]/100;
 const original=useMemo(()=>analysis.valid.filter(p=>p[0]>=left&&p[0]<=right),[analysis,left,right]);
 const runs=useMemo(()=>{
  const list:HRSample[][]=[];let run:HRSample[]=[];
  for(const p of analysis.points) {
   if(p[0]<left||p[0]>right)continue;
   if(p[1]===null) {if(run.length)list.push(run);run=[];continue;}
   if(run.length&&p[0]-run.at(-1)![0]>(analysis.source==='daily'?15:60)){list.push(run);run=[];}
   run.push(p);
  }
  if(run.length)list.push(run);
  // Extreme fragmentation is shown as sampled dots, never a continuous line.
  if(list.length>200)return chartPoints(original,600).map(p=>[p]);
  return list.map(r=>chartPoints(r,Math.max(4,Math.floor(600/Math.max(1,list.length)))));
 },[analysis,left,right,original]);
 const min=analysis.minimum===null?40:Math.max(0,Math.floor((analysis.minimum-10)/10)*10);
 const max=analysis.maximum===null?180:Math.ceil((analysis.maximum+10)/10)*10;
 const x=(t:number)=>50+(t-left)/Math.max(1,right-left)*900;
 const y=(b:number)=>200-(b-min)/Math.max(1,max-min)*170;
 const point=selected===null?null:original[Math.min(selected,original.length-1)];
 function nearest(time:number){let lo=0,hi=original.length-1;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(original[mid][0]<time)lo=mid+1;else hi=mid;}if(lo>0&&Math.abs(original[lo-1][0]-time)<Math.abs(original[lo][0]-time))lo--;setSelected(lo);}
 return <div className={styles.timeline}>
  <svg viewBox="0 0 1000 250" role="img" aria-label={`Recorded heart rate from ${singaporeTime(left)} to ${singaporeTime(right)}, Singapore time. Gaps are not filled.`}
   onPointerMove={event=>{if(!original.length)return;const box=event.currentTarget.getBoundingClientRect();nearest(left+Math.max(0,Math.min(1,(event.clientX-box.left-box.width*.05)/(box.width*.9)))*(right-left));}}>
   <text x="8" y="18">bpm</text>
   {[min,(min+max)/2,max].map(v=><g key={v}><line x1="50" x2="950" y1={y(v)} y2={y(v)} className={styles.grid}/><text x="5" y={y(v)+5}>{Math.round(v)}</text></g>)}
   {runs.map((run,i)=>run.length===1?<circle key={i} cx={x(run[0][0])} cy={y(run[0][1]!)} r="2.5" className={styles.dot}/>:<path key={i} className={styles.trace} d={run.map((p,j)=>`${j?'L':'M'}${x(p[0])},${y(p[1]!)}`).join(' ')}/>)}
   <text x="50" y="235">{singaporeTime(left)}</text><text x="950" y="235" textAnchor="end">{singaporeTime(right)}</text>
   {point&&<g><line x1={x(point[0])} x2={x(point[0])} y1="25" y2="205" className={styles.cursor}/><circle cx={x(point[0])} cy={y(point[1])} r="5" className={styles.dot}/></g>}
  </svg>
  <output className={styles.tooltip}>{point?`${singaporeTime(point[0])} SGT · ${point[1]} bpm`:'Point or touch the timeline to inspect an original sample.'}</output>
  {original.length>0&&<label>Inspect recorded samples<input type="range" min="0" max={original.length-1} value={selected===null?0:Math.min(selected,original.length-1)} onChange={e=>setSelected(Number(e.target.value))} aria-valuetext={point?`${singaporeTime(point[0])}, ${point[1]} bpm`:'First recorded sample'}/></label>}
  <div className={styles.range}><label>Range start<input type="range" min="0" max={range[1]-1} value={range[0]} onChange={e=>{setRange([Number(e.target.value),range[1]]);setSelected(null);}}/></label><label>Range end<input type="range" min={range[0]+1} max="100" value={range[1]} onChange={e=>{setRange([range[0],Number(e.target.value)]);setSelected(null);}}/></label><button type="button" onClick={()=>{setRange([0,100]);setSelected(null);}}>Full interval</button></div>
  <p className={styles.muted}>Lines summarize recorded points; tooltips use original samples. Gaps over {analysis.source==='daily'?'15':'60'} seconds and missing measurements remain breaks. This is synchronized recording data, not live streaming.</p>
 </div>;
}
