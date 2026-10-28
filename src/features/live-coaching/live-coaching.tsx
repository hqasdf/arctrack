'use client';
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {type LiveData,type LiveIndex} from './model';
import {createReconciler} from './reconcile';
import {LiveMonitor} from './monitoring-dashboard';
import {LivePresence} from './presence';
import {AthleteTraining} from './athlete-training';
import styles from './live-coaching.module.css';
export function LiveCoaching({organizationId,sessionId,basePath='/live-coaching'}:{organizationId?:string;sessionId?:string;basePath?:string}){
 const router=useRouter(),[index,setIndex]=useState<LiveIndex|null>(null),[data,setData]=useState<LiveData|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[connection,setConnection]=useState('Connecting'),[athletes,setAthletes]=useState<string[]>([]);
 const [confirmation,setConfirmation]=useState<'complete'|'cancel'|null>(null);
 const saving=useRef(false),refresh=useRef<()=>void>(()=>{});
 useEffect(()=>{
  let alive=true,terminal=false;let source:EventSource|null=null;
  const reconciler=createReconciler(async signal=>{try{const q=new URLSearchParams({...sessionId?{id:sessionId}:{},...organizationId?{organizationId}:{}});const response=await fetch('/api/live-coaching?'+q,{cache:'no-store',signal});const value=await response.json();if(!response.ok)throw Error(value.error??'Live session unavailable.');if(sessionId&&(organizationId?value.coach!==true||value.session?.organization_id!==organizationId:value.coach!==false))throw Error('Live role access could not be verified.');if(alive&&!signal.aborted&&document.visibilityState==='visible'){if(sessionId){setData(value);terminal=['completed','cancelled'].includes(value.session.state);if(terminal){source?.close();setConnection('Session '+value.session.state+' - review only');}}else setIndex(value);setError('');}}catch(e){if(alive&&!signal.aborted){setData(null);setIndex(null);setError(e instanceof Error?e.message:'Live session unavailable.');}}});
  refresh.current=()=>{void reconciler.request();};void reconciler.request();
  const connect=()=>{source?.close();if(!sessionId||terminal||document.visibilityState!=='visible')return;source=new EventSource('/api/live-coaching/events?id='+sessionId+(organizationId?'&organizationId='+organizationId:''));
   source.addEventListener('change',()=>refresh.current());source.addEventListener('connection',event=>{const connected=JSON.parse((event as MessageEvent).data).connected;setConnection(connected?'Connected to updates':'Reconnecting');if(connected)refresh.current();});
   source.addEventListener('revoked',()=>{source?.close();setData(null);setConnection('Access unavailable');setError('Live access could not be verified.');});source.onerror=()=>{if(alive)setConnection('Disconnected - updates may be stale');};
  };
  const visible=()=>{if(document.visibilityState==='visible'){refresh.current();connect();}else{source?.close();setData(null);setIndex(null);setConnection('Backgrounded');}};
  connect();document.addEventListener('visibilitychange',visible);window.addEventListener('online',visible);
  // Low-frequency recovery covers missed invalidations and transport failures; never aggregate events.
  const fallback=setInterval(()=>{if(document.visibilityState==='visible'&&!terminal)refresh.current();},60000);
  return()=>{alive=false;source?.close();reconciler.stop();clearInterval(fallback);document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',visible);refresh.current=()=>{};};
 },[sessionId,organizationId]);
 const change=useCallback(async(action:string,extra:Record<string,unknown>={})=>{if(saving.current)return false;saving.current=true;setBusy(true);setError('');try{const response=await fetch('/api/live-coaching',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...(data?{id:data.session.id,expected:data.session.version}:{}),...extra})});const result=await response.json();if(!response.ok)throw Error(result.error??'Change not confirmed.');if(action==='create')router.push(basePath+'?session='+result.id);else refresh.current();return true;}catch(e){setError(e instanceof Error?e.message:'Change not confirmed.');refresh.current();return false;}finally{saving.current=false;setBusy(false);}},[data,router,basePath]);
 const me=data?.participants.find(p=>p.athleteId===data.viewerId);
 const coachView=!!organizationId&&data?.coach===true;
 return <div className={styles.workspace}>
  <header className={styles.heading}><div><p className={styles.kicker}>{organizationId?"Coach's Workspace":'Your Live Training'}</p><h1>{data?.session.title??'Live Coaching'}</h1><p>Confirmed scoring, together. Health measurements remain private.</p></div>{sessionId&&<Link href={basePath}>All live sessions</Link>}</header>
  {error&&<p role='alert' className={styles.error}>{error} <button onClick={()=>refresh.current()}>Retry</button></p>}
  {!data&&!index&&!error&&<p role='status' aria-busy='true'>Loading authorised live sessions...</p>}
  {index&&<>
   {organizationId&&<form className={styles.panel} onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);void change('create',{organizationId,title:form.get('title'),date:form.get('date'),athletes});}}><h2>Create live training</h2><div className={styles.fields}><label>Session name<input name='title' required maxLength={100}/></label><label>Training date<input name='date' type='date' required defaultValue={new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}/></label></div><fieldset><legend>Invite active athletes (maximum 32)</legend>{index.roster.length?index.roster.map(a=><label className={styles.check} key={a.userId}><input type='checkbox' checked={athletes.includes(a.userId)} onChange={e=>setAthletes(current=>e.target.checked?[...current,a.userId]:current.filter(id=>id!==a.userId))}/>{a.displayName}</label>):<p>No eligible athletes in this organisation.</p>}</fieldset><button disabled={busy||athletes.length<1||athletes.length>32}>Create training</button></form>}
   <section aria-labelledby='live-invitations'><h2 id='live-invitations'>Sessions and invitations</h2><div className={styles.grid}>{index.sessions.map(s=><Link className={styles.card} key={s.id} href={basePath+'?session='+s.id}><span className={styles.badge}>{s.state}</span><h3>{s.title}</h3><p>{s.organization_name} - {s.training_date}</p><span>Open live session ?</span></Link>)}</div>{!index.sessions.length&&<p>No authorised live sessions yet. Invitations appear here after your coach creates a training session.</p>}</section>
  </>}
  {data&&<>
   <div className={styles.toolbar}><span className={styles.badge}>{data.session.state}</span><span>{data.organizationName} · {data.session.training_date}</span><span role='status'>{connection}</span><button disabled={busy} onClick={()=>refresh.current()}>Refresh</button></div>
   {coachView?<div className={styles.toolbar}>{data.session.state==='created'&&<button disabled={busy} onClick={()=>void change('waiting')}>Open waiting room</button>}{data.session.state==='waiting'&&<button disabled={busy||!data.participants.some(p=>p.state==='joined')} onClick={()=>void change('start')}>Start live training</button>}{data.session.state==='active'&&<button disabled={busy} onClick={()=>setConfirmation('complete')}>Complete live training</button>}{['created','waiting','active'].includes(data.session.state)&&<button disabled={busy} onClick={()=>setConfirmation('cancel')}>Cancel training</button>}</div>:<AthleteTraining key={data.session.id} data={data} busy={busy} onChange={change}/>}
   {coachView&&confirmation&&<section className={styles.panel} aria-label='Confirm training lifecycle change'><h2>{confirmation==='complete'?'Complete live training?':'Cancel live training?'}</h2><p>Individual scoring Sessions and saved arrows remain intact.</p><button disabled={busy} onClick={()=>{const action=confirmation;setConfirmation(null);void change(action);}}>Confirm {confirmation==='complete'?'completion':'cancellation'}</button> <button disabled={busy} onClick={()=>setConfirmation(null)}>Keep training open</button></section>}
   {!data.coach&&me?.state==='joined'&&['waiting','active'].includes(data.session.state)&&<LivePresence liveId={data.session.id}/>}
   {coachView&&<LiveMonitor key={data.session.id} data={data} connection={connection}/>}
  </>}
 </div>;
}
