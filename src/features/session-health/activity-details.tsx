'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import type {ActivityDetail} from './activity-read.server';
import {hrAnalysis,singaporeTime} from './model';
import {HeartRateTimeline} from './heart-rate-timeline';
import styles from './session-health.module.css';
export function ActivityDetails({activityId,embedded=false}:{activityId:string;embedded?:boolean}){
 const router=useRouter();const [data,setData]=useState<ActivityDetail|null>(null),[error,setError]=useState('');
 const revision=useRef('');
 const sequence=useRef(0),request=useRef<AbortController|null>(null);
 const cancel=useCallback(()=>{sequence.current++;request.current?.abort();request.current=null;},[]);
 const load=useCallback(async()=>{
  if(document.visibilityState!=='visible'||request.current)return;
  const seq=++sequence.current,abort=new AbortController();request.current=abort;
  try{const response=await fetch(`/api/integrations/garmin/activity?activityId=${encodeURIComponent(activityId)}`,{cache:'no-store',headers:revision.current?{'If-None-Match':revision.current}:{},signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20000)])});
   if(response.status===304){if(seq===sequence.current&&!abort.signal.aborted)setError('');return;}
   if(!response.ok){if([401,403,404].includes(response.status)){revision.current='';setData(null);}throw Error('Activity access or measurements could not be verified.');}
   const detail=await response.json();if(seq===sequence.current&&!abort.signal.aborted){revision.current=detail.revision??'';setData(detail);setError('');}
  }catch{if(seq===sequence.current&&!abort.signal.aborted)setError('Activity details are temporarily unavailable. Retry to verify access and the latest measurements.');}
  finally{if(request.current===abort)request.current=null;}
 },[activityId]);
 useEffect(()=>{let alive=true;queueMicrotask(()=>{if(alive)void load();});const visible=()=>{if(document.visibilityState==='visible')void load();else{revision.current='';cancel();setData(null);}};
  const timer=setInterval(visible,60000);window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible);
  return()=>{alive=false;cancel();clearInterval(timer);window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible);};
 },[load,cancel]);
 const start=data?.recording.start_seconds??0,end=start+(data?.recording.duration_seconds??0);
 const analysis=useMemo(()=>hrAnalysis(data?.datasets??[],start,end),[data,start,end]);
 const metrics=data?.metrics??{};
 const Heading=embedded?'h4':'h1';const headingId=`activity-title-${encodeURIComponent(activityId)}`;
 const statistics:[string,unknown,string][]=[['Garmin average HR',metrics.averageHeartRate,'bpm'],['Garmin maximum HR',metrics.maxHeartRate,'bpm'],['Distance',typeof metrics.distanceMeters==='number'?metrics.distanceMeters/1000:null,'km'],['Active calories',metrics.activeCalories,'kcal'],['Average speed',metrics.averageSpeed,'m/s'],['Elevation gain',metrics.elevationGain,'m'],['Elevation loss',metrics.elevationLoss,'m'],['Running cadence',metrics.runCadence,'steps/min'],['Cycling cadence',metrics.bikeCadence,'rpm']];
 return <section className={styles.panel} aria-labelledby={headingId}>{!embedded&&<div className={styles.heading}><button type="button" onClick={()=>router.back()}>Back</button><Link href="/analytics/health">Health activity history</Link><button type="button" onClick={()=>void load()}>Refresh</button></div>}
 <Heading id={headingId}>{String(metrics.activityName??data?.recording.activity_type??'Garmin activity')}</Heading>
 {error&&<p role="status">{error} <button type="button" onClick={()=>void load()}>Retry</button></p>}
 {!data&&!error&&<p role="status">Loading private activity…</p>}
 {data&&<><p>{data.recording.activity_type} · Garmin Connect{typeof metrics.deviceName==='string'?` · ${metrics.deviceName}`:''}</p><dl className={styles.details}><div><dt>Recording start (SGT)</dt><dd>{singaporeTime(start)}</dd></div><div><dt>Recording end (SGT)</dt><dd>{singaporeTime(end)}</dd></div><div><dt>Recording duration</dt><dd>{(data.recording.duration_seconds/60).toFixed(1)} min</dd></div></dl>
 <div className={styles.stats}>{statistics.filter(([,value])=>typeof value==='number'&&Number.isFinite(value)).map(([label,value,unit])=><div key={label}><span>{label}</span><strong>{Number(value).toLocaleString('en-SG',{maximumFractionDigits:2})} {unit}</strong></div>)}</div>
 <h2>Recorded heart rate</h2>{analysis.count>0?<><p>Activity-recorded samples · minimum observed {analysis.minimum} bpm · maximum observed {analysis.maximum} bpm · {analysis.count.toLocaleString()} valid original samples</p><HeartRateTimeline analysis={analysis} start={start} end={end}/><p className={styles.muted}>Estimated represented time: {(analysis.coverage*100).toFixed(0)}%. This is conservative sample coverage, not proof of continuous recording. Observed extrema are calculated from samples; the cards above are Garmin summary statistics.</p></>:<p>Activity found. Detailed heart-rate samples are not available. Summary values are not drawn as timeline measurements.</p>}
 <h2>Data availability</h2><p>{analysis.count?'Timestamped Activity Details received. Missing measurements remain gaps.':'Summary-only or awaiting Activity Details delivery.'} {data.updatedAt?`Summary last processed ${new Date(data.updatedAt).toLocaleString('en-SG',{timeZone:'Asia/Singapore'})} SGT.`:''}</p>
 <p className={styles.muted}>Private to your account. Automatic Garmin Connect delivery is not live HR streaming. Unsupported zones, laps and other measurements are omitted rather than estimated.</p></>}
 </section>;
}
