'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {LiveCoaching} from './live-coaching';
import {createReconciler} from './reconcile';
import type {LiveSession,Participant} from './model';
import styles from './live-coaching.module.css';
export type Invitation=LiveSession&{coach_name:string|null;participation_state:Participant['state']};
export function AthleteInvitations({organizationId}:{organizationId?:string}){
 const [sessions,setSessions]=useState<Invitation[]|null>(null),[error,setError]=useState(''),[loadError,setLoadError]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const saving=useRef(false),refresh=useRef<()=>void>(()=>{}),alive=useRef(false);
 useEffect(()=>{
  alive.current=true;let active=true;
  const reconciler=createReconciler(async signal=>{
   try{const response=await fetch('/api/live-coaching?invitations=1'+(organizationId?'&membershipOrganizationId='+organizationId:''),{cache:'no-store',signal});const value=await response.json();if(!response.ok)throw Error(value.error??'Invitations unavailable.');if(active&&!signal.aborted&&document.visibilityState==='visible'){setSessions(value.sessions);setLoadError('');}}
   catch(e){if(active&&!signal.aborted){setSessions(null);setLoadError(e instanceof Error?e.message:'Invitations unavailable.');}}
  });
  refresh.current=()=>{void reconciler.request();};refresh.current();
  const visible=()=>{if(document.visibilityState==='visible')refresh.current();else setSessions(null);};
  const timer=setInterval(()=>{if(document.visibilityState==='visible')refresh.current();},60000);
  document.addEventListener('visibilitychange',visible);window.addEventListener('focus',visible);window.addEventListener('online',visible);
  return()=>{active=false;alive.current=false;reconciler.stop();clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',visible);window.removeEventListener('online',visible);refresh.current=()=>{};};
 },[organizationId]);
 const updated=useCallback(()=>refresh.current(),[]);
 async function respond(session:Invitation,action:'join'|'decline'){
  if(saving.current)return;saving.current=true;setBusy(true);setError('');setMessage('');
  try{const response=await fetch('/api/live-coaching',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id:session.id,expected:session.version})});const value=await response.json();if(!response.ok)throw Error(value.error??'Response could not be confirmed.');if(alive.current){setMessage(action==='join'?'Training joined. Choose a scoring Session to share.':'Invitation declined.');refresh.current();}}
  catch(e){if(alive.current){setError(e instanceof Error?e.message:'Response could not be confirmed.');refresh.current();}}
  finally{saving.current=false;if(alive.current)setBusy(false);}
 }
 return <section className={styles.workspace} aria-label='Your training invitations'>
  <div className={styles.listHeading}><div><p className={styles.kicker}>Your team</p><h2>Training invitations</h2><p className={styles.muted}>Joining a training is separate from organisation membership. You choose when to share a scoring Session.</p></div></div>
  {message&&<p role='status' className={styles.success}>{message}</p>}
  {(error||loadError)&&<p role='alert'>{error||loadError} <button onClick={updated} disabled={busy}>Retry</button></p>}
  {!sessions&&!loadError&&<p role='status'>Loading invitations...</p>}
  {sessions?.length===0&&<p className={styles.emptyState}>No current training invitations. New invitations from your coach appear here automatically.</p>}
  <div className={styles.invitationList}>{sessions?.map(s=><article key={s.id} className={styles.trainingCard}>
   <div className={styles.trainingMeta}><span className={styles.badge}>{s.participation_state==='invited'?'Invited':s.participation_state} &middot; {s.state}</span><time dateTime={s.training_date}>{s.training_date}</time></div>
   <h3>{s.title}</h3><p>{s.organization_name} &middot; Coach: {s.coach_name||'Name not provided'}</p>
   {s.participation_state==='invited'&&(['waiting','active'].includes(s.state)?<><p>Your scoring and heart rate stay private until you join and explicitly connect or consent.</p><div className={styles.toolbar}><button className={styles.primaryButton} disabled={busy} onClick={()=>void respond(s,'join')}>Join Training</button><button disabled={busy} onClick={()=>void respond(s,'decline')}>Decline</button></div></>:<p>{s.state==='created'?'Your coach has not opened joining yet.':'This training is closed.'}</p>)}
   {s.participation_state==='joined'&&<LiveCoaching embedded sessionId={s.id} onParticipationChange={updated}/>}
  </article>)}</div>
  <p className={styles.muted}><Link href={organizationId?'/organization/member/'+organizationId:'/organization'}>Manage organisation membership</Link> &middot; <Link href='/privacy#live-coaching-hr'>Sharing and privacy</Link></p>
 </section>;
}
