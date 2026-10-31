'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import Link from 'next/link';
import {ActivityDetails} from './activity-details';
import {combinedActivityHR} from './combined-hr';
import {singaporeTime,type HRDataset,type MatchedSessionActivity} from './model';
import styles from './session-health.module.css';
const colors=['#4169b1','#b35b42','#27816c','#9665ad','#ad7b16','#5c7187'];
export function MatchedActivities({activities,excluded,onExclude,busy,incomplete}:{activities:MatchedSessionActivity[];excluded:string[];onExclude:(id:string,excluded:boolean)=>void;busy:boolean;incomplete:boolean}){
 const [expanded,setExpanded]=useState<string[]>([]);
 return <><p><strong>{activities.length} Archery activities</strong> · {activities.filter(a=>a.sample_count>0&&a.published).length} with detailed HR · {(activities.reduce((n,a)=>n+a.duration_seconds,0)/60).toFixed(1)} summed recording minutes (overlaps counted per recording).</p>
 <p className={styles.muted}>Same-day association only—not evidence these recordings occurred during this particular Session.</p>
 {incomplete&&<p role="alert">Discovery reached 50 candidates. Additional Archery activities may be missing; this is an incomplete result.</p>}
 <CombinedChart key={activities.map(a=>`${a.source_id}:${a.sample_count}:${a.start_seconds}:${a.duration_seconds}`).join("|")} activities={activities}/>
 {activities.map(a=><article key={a.source_id} className={styles.panel}><h4>{String(a.metrics.activityName??a.activity_type??'Archery')}</h4><p>{singaporeTime(a.start_seconds)} SGT · {(a.duration_seconds/60).toFixed(1)} min{typeof a.metrics.deviceName==='string'?` · ${a.metrics.deviceName}`:''}</p>
 <p>{typeof a.metrics.averageHeartRate==='number'?`Garmin average ${a.metrics.averageHeartRate} bpm · `:''}{typeof a.metrics.maxHeartRate==='number'?`Garmin maximum ${a.metrics.maxHeartRate} bpm · `:''}{a.sample_count&&a.published?`${a.sample_count} timestamped samples`:'Summary only; detailed HR unavailable or pending'}</p>
 <div className={styles.heading}><button type="button" aria-expanded={expanded.includes(a.source_id)} onClick={()=>setExpanded(ids=>ids.includes(a.source_id)?ids.filter(id=>id!==a.source_id):[...ids,a.source_id])}> {expanded.includes(a.source_id)?'Hide':'Show'} recorded HR</button><Link href={`/analytics/health/activity?activityId=${encodeURIComponent(a.source_id)}`}>Open Activity Details</Link><button type="button" disabled={busy} onClick={()=>onExclude(a.source_id,true)}>Exclude from this Session</button></div>
 {expanded.includes(a.source_id)&&<ActivityDetails activityId={a.source_id} embedded/>}</article>)}
 {!!excluded.length&&<details><summary>Excluded activities ({excluded.length})</summary>{excluded.map(id=><div key={id}><span>{id}</span> <button type="button" disabled={busy} onClick={()=>onExclude(id,false)}>Include again</button></div>)}</details>}
 </>;
}
function CombinedChart({activities}:{activities:MatchedSessionActivity[]}){
 const [datasets,setDatasets]=useState<HRDataset[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false),[loaded,setLoaded]=useState(false),[selected,setSelected]=useState<Record<string,number>>({});
 const request=useRef<AbortController|null>(null);
 const signature=activities.map(a=>`${a.source_id}:${a.sample_count}:${a.start_seconds}:${a.duration_seconds}`).join('|');
 useEffect(()=>()=>{request.current?.abort();},[]);
 // Remounting by this signature prevents old combined data from being presented as a newer activity set.
 const chart=useMemo(()=>combinedActivityHR(datasets),[datasets]);
 async function load(){if(request.current)return;const abort=new AbortController();request.current=abort;setLoading(true);setError('');
  try{if(activities.reduce((n,a)=>n+a.sample_count,0)>250000)throw Error('Combined view is limited to 250,000 samples. Use each activity’s full detail view.');
   const all:HRDataset[]=[];
   for(let i=0;i<activities.length;i+=2){const responses=await Promise.all(activities.slice(i,i+2).map(async a=>{const response=await fetch(`/api/integrations/garmin/activity?activityId=${encodeURIComponent(a.source_id)}`,{cache:'no-store',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20000)])});if(!response.ok)throw Error('Combined HR could not be verified.');return response.json();}));for(const body of responses)all.push(...body.datasets);if(all.reduce((n,d)=>n+d.samples.length,0)>250000)throw Error('Combined sample limit reached. Open individual activities for complete HR.');}
   if(!abort.signal.aborted){setDatasets(all);setLoaded(true);}
  }catch(e){if(!abort.signal.aborted){setDatasets([]);setError(e instanceof Error?e.message:'Combined HR unavailable.');}}
  finally{if(!abort.signal.aborted)setLoading(false);request.current=null;}
 }
 const span=Math.max(1,chart.end-chart.start),low=chart.minimum??40,high=Math.max(low+1,chart.maximum??180);
 const x=(t:number)=>50+(t-chart.start)/span*900,y=(b:number)=>200-(b-low)/(high-low)*170;
 return <section className={styles.timeline} aria-label="Combined Archery heart rate" data-activity-set={signature}><button type="button" disabled={loading||!activities.length} onClick={()=>void load()}>{loading?'Loading combined HR…':loaded?'Refresh combined HR':'Show combined HR timeline'}</button>{error&&<p role="alert">{error}</p>}
 {loaded&&<>{chart.minimum===null?<p>No detailed activity HR samples are available. Summary averages are not plotted.</p>:<><p>Lowest observed {chart.minimum} bpm · highest observed {chart.maximum} bpm. No combined average is inferred.</p><svg viewBox="0 0 1000 250" role="img" aria-label="Separate chronological activity HR series; overlapping recordings remain separate"><text x="5" y="20">{high} bpm</text><text x="5" y="220">{low} bpm</text><text x="50" y="245">{singaporeTime(chart.start)}</text><text x="950" y="245" textAnchor="end">{singaporeTime(chart.end)} SGT</text>{chart.series.map((s,i)=>s.runs.map((run,j)=><g key={`${s.id}:${j}`}><title>Activity {s.id}</title>{run.length===1?<circle cx={x(run[0][0])} cy={y(run[0][1]!)} r="3" fill={colors[i%colors.length]}/>:<path d={run.map((p,k)=>`${k?'L':'M'}${x(p[0])},${y(p[1]!)}`).join(' ')} fill="none" stroke={colors[i%colors.length]} strokeWidth="2"/>}</g>))}</svg>
 {chart.series.filter(s=>s.analysis.count).map((s,i)=>{const point=s.analysis.valid[Math.min(selected[s.id]??0,s.analysis.valid.length-1)];return <label key={s.id} style={{color:colors[i%colors.length]}}>Activity {s.id}: {singaporeTime(point[0])} · {point[1]} bpm<input type="range" min="0" max={s.analysis.valid.length-1} value={selected[s.id]??0} onChange={e=>setSelected(old=>({...old,[s.id]:Number(e.target.value)}))}/></label>;})}<p className={styles.muted}>Each activity is a separate series. Duplicate times across devices are not averaged. Missing samples and gaps over 60 seconds break the line; inspection uses original samples.</p></>}</>}
 </section>;
}
