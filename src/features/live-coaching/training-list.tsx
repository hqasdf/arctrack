'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import type {LiveSession} from './model';
import styles from './live-coaching.module.css';

export function TrainingList({sessions,coach,busy,basePath,onDelete}:{sessions:LiveSession[];coach:boolean;busy:boolean;basePath:string;onDelete:(session:LiveSession)=>Promise<boolean>}){
 const [removing,setRemoving]=useState<LiveSession|null>(null);
 const submitting=useRef(false),cancel=useRef<HTMLButtonElement>(null),origin=useRef<HTMLButtonElement|null>(null),heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{if(removing)cancel.current?.focus();else if(origin.current?.isConnected)origin.current.focus();else if(origin.current)heading.current?.focus();},[removing]);
 async function confirm(){
  if(!removing||busy||submitting.current)return;
  submitting.current=true;
  try{if(await onDelete(removing))setRemoving(null);}finally{submitting.current=false;}
 }
 return <section aria-labelledby='live-invitations'>
  <div className={styles.listHeading}><h2 id='live-invitations' tabIndex={-1} ref={heading}>{coach?'Your training sessions':'Sessions and invitations'}</h2><span>{sessions.length} {sessions.length===1?'session':'sessions'}</span></div>
  {coach&&removing&&<section className={styles.deleteConfirmation} aria-label='Confirm training deletion'>
   <h3>Delete {removing.title}?</h3><p>{removing.state==='active'?'This ends live monitoring for all participants. ':''}This removes the training, invitations and its shared HR data. Athletes keep their scoring Sessions, Rounds, arrows, notes and feedback.</p>
   <div className={styles.toolbar}><button className={styles.danger} disabled={busy} onClick={()=>void confirm()}>Confirm deletion</button><button ref={cancel} disabled={busy} onClick={()=>setRemoving(null)}>Keep training</button></div>
  </section>}
  <div className={styles.trainingGrid}>{sessions.map(s=><article className={styles.trainingCard} key={s.id}>
   <div className={styles.trainingMeta}><span className={styles.badge}>{s.state}</span><time dateTime={s.training_date}>{s.training_date}</time></div>
   <h3>{s.title}</h3><p className={styles.muted}>{s.organization_name}</p>
   <div className={styles.trainingActions}><Link className={styles.primaryLink} href={basePath+'?session='+s.id}>{coach?'Open training':'Open invitation'}</Link>
    {coach&&<details className={styles.options}><summary aria-label={'Options for '+s.title}>Options</summary><button disabled={busy} onClick={e=>{origin.current=e.currentTarget;setRemoving(s);}}>Delete training</button></details>}
   </div>
  </article>)}</div>
  {!sessions.length&&<p className={styles.emptyState}>{coach?'No training sessions yet. Create training to invite your team.':'No authorised live sessions yet. Invitations appear here after your coach creates training.'}</p>}
 </section>;
}
