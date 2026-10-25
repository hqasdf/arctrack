'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { HeartRateTimeline } from './heart-rate-timeline';
import { hrAnalysis, singaporeInput, singaporeTime, singaporeUTC, type SessionHealth } from './model';
import styles from './session-health.module.css';
export function GarminSessionHealth({sessionId}:{sessionId:string}) {
 const [data,setData]=useState<SessionHealth|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [draft,setDraft]=useState<{start:string;finish:string}|null>(null);
 const sequence=useRef(0),controller=useRef<AbortController|null>(null),saving=useRef(false);
 const revision=useRef('');
 const cancel=useCallback(()=>{sequence.current++;controller.current?.abort();},[]);
 const load=useCallback(async()=>{
  if(saving.current)return;
  const seq=++sequence.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;
  try {const response=await fetch(`/api/sessions/${sessionId}/garmin-health`,{cache:'no-store',signal:abort.signal,headers:revision.current?{'If-None-Match':revision.current}:{}});
   if(response.status===304)return;
   const next=await response.json();if(!response.ok)throw new Error(next.error??'Session Health unavailable.');
   if(seq===sequence.current&&!abort.signal.aborted){revision.current=next.revision??'';setData(next);setError('');}
  }catch(e){if(!abort.signal.aborted&&seq===sequence.current){revision.current='';setData(null);setError(e instanceof Error?e.message:'Session Health unavailable.');}}
 },[sessionId]);
 useEffect(()=>{
  void load();const visible=()=>{if(document.visibilityState==='visible')void load();};
  const timer=setInterval(visible,60000);document.addEventListener('visibilitychange',visible);window.addEventListener('focus',visible);
  return()=>{cancel();clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',visible);};
 },[load,cancel]);
 async function action(action:string,extra:Record<string,unknown>={}) {
  if(saving.current||!data)return;saving.current=true;setBusy(true);setError('');sequence.current++;controller.current?.abort();
  const seq=sequence.current;const abort=new AbortController();controller.current=abort;
  try {
   const response=await fetch(`/api/sessions/${sessionId}/garmin-health`,{method:'POST',headers:{'Content-Type':'application/json'},signal:abort.signal,
    body:JSON.stringify({action,expected:data.window?.updated_at??null,...extra})});
   const next=await response.json();if(!response.ok)throw new Error(next.error??'Change could not be confirmed.');
   if(sequence.current===seq&&!abort.signal.aborted){revision.current=next.revision??'';setData(next);setDraft(null);}
  }catch(e){if(!abort.signal.aborted&&sequence.current===seq)setError(e instanceof Error?e.message:'Change could not be confirmed.');}
  finally{saving.current=false;if(sequence.current===seq)setBusy(false);}
 }
 const w=data?.window,start=w?.started_at?Date.parse(w.started_at)/1000:null,end=w?.finished_at?Date.parse(w.finished_at)/1000:null;
 const analysis=useMemo(()=>start!==null&&end!==null&&end>start?hrAnalysis(data?.datasets??[],start,end):null,[data,start,end]);
 const fields=draft??{start:singaporeInput(w?.started_at),finish:singaporeInput(w?.finished_at)};
 const candidates=useMemo(()=>[...new Map((data?.candidates??[]).map(c=>[c.source_id,c])).values()],[data]);
 return <section className={styles.panel} aria-labelledby={`session-health-${sessionId}`}>
  <div className={styles.heading}><div><p className={styles.eyebrow}>Private athlete data</p><h3 id={`session-health-${sessionId}`}>Garmin Session Health</h3></div><button type="button" onClick={()=>void load()} disabled={busy}>Refresh</button></div>
  <p className={styles.muted}>Confirm when you were shooting, then choose your Garmin recording. Scoring and Garmin timing remain independent.</p>
  {error&&<p role="alert">{error} <button type="button" disabled={busy} onClick={()=>void load()}>Retry</button></p>}
  {!data&&!error&&<p role="status">Loading Session Health...</p>}
  {data&&<>
   {data.paused&&<p role="status">Health Sync Paused. Previously imported recordings remain available. <Link href="/health">Manage Health Sync</Link></p>}
   {data.sync?.state==='permission_revoked'&&<p role="status">Garmin permissions were revoked. Reauthorize the required permission before new HR can arrive.</p>}
   {data.sync?.error&&<p role="status">Garmin synchronization needs attention. Existing recordings may be incomplete. <Link href="/health">Review Health status</Link></p>}
   <div className={styles.actions}><button type="button" disabled={busy||!!w?.started_at} onClick={()=>void action('start')}>Start Session timer</button><button type="button" disabled={busy||!w?.started_at||!!w?.finished_at} onClick={()=>void action('finish')}>Finish Session timer</button>{w?.started_at&&!w.finished_at&&<span role="status">Timer running  -  started {singaporeTime(start!)} SGT</span>}</div>
   <form onSubmit={e=>{e.preventDefault();try{void action('manual',{start:singaporeUTC(fields.start),finish:singaporeUTC(fields.finish)});}catch(e){setError(e instanceof Error?e.message:'Check times.');}}} className={styles.timing}>
    <label>Start (Singapore time)<input type="datetime-local" value={fields.start} onChange={e=>setDraft({...fields,start:e.target.value})}/></label>
    <label>Finish (Singapore time)<input type="datetime-local" value={fields.finish} onChange={e=>setDraft({...fields,finish:e.target.value})}/></label>
    <button disabled={busy} type="submit">Save times</button>
   </form>
   {!data.authorized?<p>Connect or reconnect Garmin to view private recordings. <Link href="/health">Manage Garmin</Link>. Session timing works without Garmin.</p>:start===null||end===null?<p>Enter both shooting times or finish the timer to find overlapping recordings. Historical Session dates are not assumed to be shooting times.</p>:<>
    <div className={styles.matching}><label>Confirm Garmin activity<select disabled={busy} value={w?.activity_id??''} onChange={e=>void action(e.target.value?'link':'unlink',{activity:e.target.value})}><option value="">No linked activity  -  use available daily samples</option>{w?.activity_id&&!candidates.some(c=>c.source_id===w.activity_id)&&<option value={w.activity_id}>Linked recording currently unavailable</option>}{candidates.map(c=><option key={c.source_id} value={c.source_id}>{c.activity_type??'Activity'}  -  {singaporeTime(c.start_seconds)}  -  {Math.round(c.duration_seconds/60)} min  -  {c.state==='receiving'?'import processing':c.state==='conflict'?'revision requires reconciliation':c.sample_count?`${c.sample_count} samples`:'no detailed HR'}</option>)}</select></label>{w?.activity_id&&<button type="button" disabled={busy} onClick={()=>void action('unlink')}>Unlink activity</button>}</div>
    {!candidates.length&&<p>No overlapping Garmin activity has arrived. Activity Details delivery must be available for your Garmin application; a summary alone cannot supply a timeline.</p>}
    {analysis&&analysis.count>0?<>
     <p><strong>{analysis.source==='activity'?'Confirmed activity HR recording':'Lower-resolution all-day HR samples'}</strong>{analysis.source==='daily'?'  -  representative measurements for preceding 15-second intervals; not a workout recording.':''}</p>
     <div className={styles.stats}>{[['Interval average',analysis.average===null?'Unavailable':`${Math.round(analysis.average)} bpm`],['Minimum observed',`${analysis.minimum} bpm`],['Maximum observed',`${analysis.maximum} bpm`],['Original valid samples',String(analysis.count)]].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
     <HeartRateTimeline key={`${start}:${end}`} analysis={analysis} start={start} end={end}/>
     <dl className={styles.details}><div><dt>Shooting interval</dt><dd>{Math.round(analysis.duration/60)} minutes</dd></div><div><dt>First / last sample (SGT)</dt><dd>{singaporeTime(analysis.first!)} / {singaporeTime(analysis.last!)}</dd></div><div><dt>Estimated represented time</dt><dd>{Math.round(analysis.covered/60)} min  -  {Math.round(analysis.coverage*100)}%{analysis.coverage<.99?'  -  incomplete recording':''}</dd></div></dl>
     <p className={styles.muted}>The average is time-weighted within supported intervals, not Garmin&apos;s whole-activity average. Coverage is conservative, not proof of continuous sensor recording. Activity holds are capped at 60 seconds; daily measurements represent 15-second bins. Maximum observed is not physiological maximum.</p>
    </>:<p>No timestamped heart-rate measurements are available for this interval. Missing samples are never replaced with averages or zeros. Sync Garmin Connect and return after provider delivery; historical backfill is not promised.</p>}
   </>}
  </>}
  <p className={styles.muted}>Only you can view these measurements. Session sharing and coach feedback do not share Garmin heart rate. <Link href="/privacy">Privacy Policy</Link></p>
 </section>;
}
