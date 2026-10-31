'use client';
import {MatchedActivities} from './matched-activities';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { HeartRateTimeline } from './heart-rate-timeline';
import { hrAnalysis, singaporeTime, type SessionHealth } from './model';
import styles from './session-health.module.css';
export function GarminSessionHealth({sessionId}:{sessionId:string}) {
 const [data,setData]=useState<SessionHealth|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const sequence=useRef(0),controller=useRef<AbortController|null>(null),saving=useRef(false);
 const revision=useRef('');
 const cancel=useCallback(()=>{sequence.current++;controller.current?.abort();},[]);
 const load=useCallback(async()=>{
  if(saving.current||controller.current&&!controller.current.signal.aborted)return;
  let responseStatus=0;const seq=++sequence.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;
  try {const response=await fetch(`/api/sessions/${sessionId}/garmin-health`,{cache:'no-store',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20000)]),headers:revision.current?{'If-None-Match':revision.current}:{}});
   responseStatus=response.status;if(response.status===304)return;
   const next=await response.json();if(!response.ok)throw new Error(next.error??'Session Health unavailable.');
   if(seq===sequence.current&&!abort.signal.aborted){revision.current=next.link?next.revision??'':'';setData(next);setError('');}
  }catch(e){if(!abort.signal.aborted&&seq===sequence.current){revision.current='';if(responseStatus===401||responseStatus===403||responseStatus===404)setData(null);setError(e instanceof Error?e.message:'Session Health unavailable.');}}finally{if(controller.current===abort)controller.current=null;}
 },[sessionId]);
 useEffect(()=>{
  void load();const visible=()=>{if(document.visibilityState==='visible')void load();else {revision.current='';cancel();setData(current=>current?{...current,authorized:false,candidates:[],datasets:[]}:null);}};
  const timer=setInterval(visible,60000);document.addEventListener('visibilitychange',visible);window.addEventListener('focus',visible);
  return()=>{cancel();clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',visible);};
 },[load,cancel]);
 async function selectActivity(activityId:string|null) {
  if(saving.current||!data)return;saving.current=true;setBusy(true);setError('');sequence.current++;controller.current?.abort();
  const seq=sequence.current;const abort=new AbortController();controller.current=abort;
  try {
   const response=await fetch(`/api/sessions/${sessionId}/garmin-health`,{method:'POST',headers:{'Content-Type':'application/json'},signal:abort.signal,
    body:JSON.stringify({activityId,expected:data.link?.updated_at??null})});
   const next=await response.json();if(!response.ok)throw new Error(next.error??'Change could not be confirmed.');
   if(sequence.current===seq&&!abort.signal.aborted){revision.current=next.revision??'';setData(next);}
  }catch(e){if(!abort.signal.aborted&&sequence.current===seq){revision.current='';setData(current=>current?{...current,authorized:false,candidates:[],datasets:[]}:null);setError(e instanceof Error?e.message:'Change could not be confirmed.');}}
  finally{if(controller.current===abort)controller.current=null;saving.current=false;setBusy(false);if(sequence.current!==seq&&document.visibilityState==='visible')void load();}
 }
 async function excludeActivity(activityId:string,excluded:boolean){
  if(saving.current)return;saving.current=true;setBusy(true);sequence.current++;controller.current?.abort();const seq=sequence.current,abort=new AbortController();controller.current=abort;
  try{const response=await fetch(`/api/sessions/${sessionId}/garmin-health`,{method:'POST',headers:{'Content-Type':'application/json'},signal:abort.signal,body:JSON.stringify({action:'exclude',activityId,excluded})});const next=await response.json();if(!response.ok)throw Error(next.error??'Exclusion was not confirmed.');if(sequence.current===seq&&!abort.signal.aborted){revision.current='';setData(next);setError('');}}
  catch{if(!abort.signal.aborted&&sequence.current===seq)setError('Exclusion was not confirmed. Your previous selection remains. Retry after connectivity is restored.');}
  finally{if(controller.current===abort)controller.current=null;saving.current=false;setBusy(false);}
 }
 const recording=data?.recording,start=recording?.start_seconds??null,end=recording?recording.start_seconds+recording.duration_seconds:null;
 const analysis=useMemo(()=>start!==null&&end!==null&&end>start?hrAnalysis(data?.datasets??[],start,end):null,[data,start,end]);
 const candidates=useMemo(()=>[...new Map((data?.candidates??[]).map(c=>[c.source_id,c])).values()],[data]);
 if(data?.authorized===false)return <p role="status" className={styles.muted}>Garmin connection or Activity permission is unavailable. <Link href="/profile">Review Garmin connection</Link></p>;
 if(data?.authorized!==true) return error?<p role="status" className={styles.muted}>Activity availability could not be checked. <button type="button" onClick={()=>void load()}>Retry</button></p>:null;
 return <section className={styles.panel} aria-labelledby={`session-health-${sessionId}`}>
   <div className={styles.heading}><div><p className={styles.eyebrow}>Private athlete data</p><h3 id={`session-health-${sessionId}`}>Garmin Session Health</h3></div><button type="button" onClick={()=>void load()} disabled={busy}>Refresh</button></div>
   {data.paused&&<p role="status">Health Sync Paused. Previously imported recordings remain available. <Link href="/analytics/health">Manage Health Sync</Link></p>}
   {data.sync?.error&&<p role="status">Garmin synchronization needs attention. Existing recordings may be incomplete. <Link href="/analytics/health">Review Health status</Link></p>}
   {error&&<p role="alert">{error}</p>}
   {data.matched&&<MatchedActivities activities={data.matched} excluded={data.excluded??[]} onExclude={(id,excluded)=>void excludeActivity(id,excluded)} busy={busy} incomplete={data.incomplete===true}/>}
    <p role="status">{data.match?.reason??(data.link?.activity_id?"Your selected Garmin activity is preserved.":"Select a recording only when the available activities are ambiguous.")}</p><details open={data.match?.mode==='ambiguous'}><summary>Manage Garmin activity</summary><div className={styles.matching}><label>Garmin activity<select disabled={busy} value={data.link?.activity_id??recording?.source_id??''} onChange={e=>void selectActivity(e.target.value||null)}><option value="">Select a Garmin activity</option>{data.link?.activity_id&&!candidates.some(c=>c.source_id===data.link?.activity_id)&&<option value={data.link.activity_id}>Linked recording currently unavailable</option>}{candidates.map(c=><option key={c.source_id} value={c.source_id}>{c.activity_name??c.activity_type??'Activity'}  -  {singaporeTime(c.start_seconds)}  -  {Math.round(c.duration_seconds/60)} min  -  {c.state==='receiving'?'import processing':c.state==='conflict'?'revision requires reconciliation':c.sample_count?`${c.sample_count} samples`:'no detailed HR'}</option>)}</select></label>{(data.link?.activity_id||recording)&&<button type="button" disabled={busy} onClick={()=>void selectActivity(null)}>Unlink activity</button>}</div></details>
    {!candidates.length&&<p>No compatible Garmin activity has arrived for this Session date in Singapore time. Record and sync an activity in Garmin Connect; a summary alone cannot supply detailed HR.</p>}
    {recording&&start!==null&&end!==null?<>
     <p><strong>{String(data.metrics?.activityName??recording.activity_type??"Garmin activity")}</strong> · {recording.activity_type}</p>{data.metrics&&<div className={styles.stats}>{[["Garmin average HR",data.metrics.averageHeartRate],["Garmin maximum HR",data.metrics.maxHeartRate]].filter(([,value])=>typeof value==="number").map(([label,value])=><div key={String(label)}><span>{label}</span><strong>{value} bpm</strong></div>)}</div>}
     <dl className={styles.details}><div><dt>Garmin recording start (SGT)</dt><dd>{singaporeTime(start)}</dd></div><div><dt>Garmin recording finish (SGT)</dt><dd>{singaporeTime(end)}</dd></div><div><dt>Recorded duration</dt><dd>{Math.round(recording.duration_seconds/60)} minutes</dd></div></dl>
    {analysis&&analysis.count>0?<>
     <p><strong>{analysis.source==='activity'?'Confirmed activity HR recording':'Lower-resolution all-day HR samples'}</strong>{analysis.source==='daily'?'  -  representative measurements for preceding 15-second intervals; not a workout recording.':''}</p>
     <div className={styles.stats}>{[['Recording average',analysis.average===null?'Unavailable':`${Math.round(analysis.average)} bpm`],['Minimum observed',`${analysis.minimum} bpm`],['Maximum observed',`${analysis.maximum} bpm`],['Original valid samples',String(analysis.count)]].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
     <HeartRateTimeline key={`${start}:${end}`} analysis={analysis} start={start} end={end}/>
     <dl className={styles.details}><div><dt>Garmin recording interval</dt><dd>{Math.round(analysis.duration/60)} minutes</dd></div><div><dt>First / last sample (SGT)</dt><dd>{singaporeTime(analysis.first!)} / {singaporeTime(analysis.last!)}</dd></div><div><dt>Estimated represented time</dt><dd>{Math.round(analysis.covered/60)} min  -  {Math.round(analysis.coverage*100)}%{analysis.coverage<.99?'  -  incomplete recording':''}</dd></div></dl>
     <p className={styles.muted}>The average is time-weighted within supported intervals, not Garmin&apos;s whole-activity average. Coverage is conservative, not proof of continuous sensor recording. Activity holds are capped at 60 seconds; daily measurements represent 15-second bins. Maximum observed is not physiological maximum.</p>
    </>:<p>Activity found. Detailed heart-rate samples are not available. Missing samples are never replaced with averages or zeros. Sync Garmin Connect and return after provider delivery; historical backfill is not promised.</p>}
   </>:<p>{data.link?.activity_id?'The linked Garmin recording is unavailable. Select another recording or unlink it.':data.match?.reason??'Awaiting a matching Garmin activity. Synchronize Garmin Connect and return after delivery.'}</p>}
   <p className={styles.muted}>Only you can view these measurements. Session sharing and coach feedback do not share Garmin heart rate. <Link href="/privacy">Privacy Policy</Link></p>
 </section>;
}
