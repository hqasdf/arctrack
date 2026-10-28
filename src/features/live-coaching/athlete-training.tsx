'use client';
import Link from 'next/link';
import {useRef,useState} from 'react';
import {createSession} from '@/features/sessions/actions';
import type {LiveData} from './model';
import {HeartRatePanel} from './heart-rate/panel';
import styles from './live-coaching.module.css';

const ignoreReadings=()=>{};
type Change=(action:string,extra?:Record<string,unknown>)=>Promise<boolean>;

/** Athlete-only controls. The authoritative reader supplies only this athlete's participation. */
export function AthleteTraining({data,busy,onChange}:{data:LiveData;busy:boolean;onChange:Change}) {
 const me=data.participants.find(p=>p.athleteId===data.viewerId);
 const [leaving,setLeaving]=useState(false);
 const [choosing,setChoosing]=useState(false),[selection,setSelection]=useState(''),[creating,setCreating]=useState(false),[hasCreated,setHasCreated]=useState(false),[error,setError]=useState('');
 const submitting=useRef(false),created=useRef<string|null>(null);
 const open=['waiting','active'].includes(data.session.state);
 async function createAndConnect(form:HTMLFormElement){
  if(submitting.current||busy)return;
  submitting.current=true;setCreating(true);setError('');
  try{
   // Retain a successfully created ID if connection fails: retry must not create another Session.
   if(!created.current){const fields=new FormData(form);const result=await createSession({title:String(fields.get('title')??''),date:data.session.training_date,sessionType:'training'});if(!result.ok){setError(result.message);return;}created.current=result.data.id;setHasCreated(true);}
   if(await onChange('link',{scoringSessionId:created.current}))setChoosing(false);
  }catch{setError('Connection could not be confirmed. Retry or select your existing Session.');}
  finally{submitting.current=false;setCreating(false);}
 }
 if(!me)return <p role='status'>Your invitation could not be verified.</p>;
 return <section className={styles.panel} aria-label='Your live training'>
  <h2>{me.state==='joined'?'You have joined this training':me.state==='invited'?'You are invited':me.state==='declined'?'Invitation declined':'You have left this training'}</h2>
  {!open&&<p>{data.session.state==='created'?'Your coach has not opened joining yet.':`Training ${data.session.state}. Saved scoring Sessions remain yours.`}</p>}
  {open&&me.state==='invited'&&<><p>Join first. You choose which scoring Session to share afterward. Garmin Health is not shared.</p><div className={styles.toolbar}><button disabled={busy} onClick={()=>void onChange('join')}>Join Training</button><button disabled={busy} onClick={()=>void onChange('decline')}>Decline</button></div></>}
  {me.state==='joined'&&<>
   {me.scoringSessionId?<><p>Scoring connected: <strong>{me.scoring?.title??'Your scoring Session'}</strong></p><Link className={styles.primaryLink} href={'/sessions?session='+me.scoringSessionId}>Continue Scoring</Link></>:<p>Awaiting scoring connection. Your scores remain private until you connect a Session.</p>}
   {open&&<><div className={styles.toolbar}><button disabled={busy||creating} aria-expanded={choosing} onClick={()=>setChoosing(!choosing)}>{me.scoringSessionId?'Change scoring connection':'Connect Scoring Session'}</button><button disabled={busy||creating} onClick={()=>setLeaving(true)}>Leave Training</button></div>
    {leaving&&<section className={styles.deleteConfirmation} aria-label='Confirm leaving training'><h3>Leave this training?</h3><p>This ends your live scoring and heart-rate sharing for this training. Your scoring Sessions, arrows, notes and feedback remain saved. You will remain in your organisation.</p><div className={styles.toolbar}><button disabled={busy||creating} onClick={async()=>{if(await onChange('leave'))setLeaving(false);}}>Confirm leave training</button><button disabled={busy||creating} onClick={()=>setLeaving(false)}>Stay in training</button></div></section>}
    {choosing&&<div className={styles.connectionOptions}>
     <p>Connecting shares this training Session&apos;s saved scores with your coach.</p>
     <label>Your training Sessions on {data.session.training_date}<select value={selection} onChange={e=>setSelection(e.target.value)} disabled={busy||creating}><option value=''>Choose a Session</option>{data.eligibleSessions.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
     <button disabled={busy||creating||!selection} onClick={async()=>{if(await onChange('link',{scoringSessionId:selection}))setChoosing(false);}}>Confirm connection</button>
     <form onSubmit={e=>{e.preventDefault();void createAndConnect(e.currentTarget);}}><h3>Or start a new scoring Session</h3><label>Session name<input name='title' maxLength={100} placeholder='Training Session' disabled={creating||busy}/></label><button disabled={busy||creating}>{creating?'Connecting…':hasCreated?'Retry connection':'Create and connect new Session'}</button></form>
    </div>}
   </>}
   {process.env.NEXT_PUBLIC_LIVE_COACHING_BLE_ENABLED==='true'&&<details><summary>Optional heart-rate sharing</summary><HeartRatePanel data={data} onReadings={ignoreReadings}/></details>}
  </>}
  {error&&<p role='alert'>{error}</p>}
 </section>;
}
