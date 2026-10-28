'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {memo,useCallback,useEffect,useRef,useState} from 'react';
import {scoringProgress,type LiveData,type Participant} from './model';
import {EMPTY_MONITOR,elapsedTraining,monitorAthletes,type EndActivity,type HrHistory,type MonitorSnapshot} from './monitor-model';
import {HeartRatePanel,HeartRateStatus,type SensorControls} from './heart-rate/panel';
import type {SensorState} from './heart-rate/sensor-manager';
import type {HeartRateReading} from './heart-rate/measurement';
import {createReadingStore,historyAuthorityMatches,type ReadingStore} from './heart-rate/measurement';
import styles from './monitoring-dashboard.module.css';


const AthleteTarget=dynamic(()=>import('./athlete-target'),{loading:()=> <p role='status'>Loading recorded target...</p>});

const clockFormatter=new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',second:'2-digit'});
const time=(value:string)=>clockFormatter.format(new Date(value));

export const HeartRateChart=dynamic(()=>import('./heart-rate/history-chart'),{loading:()=> <p role='status'>Loading retained HR history...</p>});

export const ScoreboardRow=memo(function ScoreboardRow({participant:p,progress:s,readingStore,onSelect}:{participant:Participant;progress:ReturnType<typeof scoringProgress>;readingStore:ReadingStore;onSelect:(id:string)=>void}){
 return <tr><th scope='row'><span className={styles.athleteName}>{p.displayName}</span><small>{s.finished?'Scoring complete':p.scoring?'Scoring connected':'Awaiting scoring connection'}</small></th><td data-label='Confirmed score'><strong className={styles.scoreNumber}>{p.scoring?s.confirmedTotal:'—'}</strong><small>{p.scoring?s.completedEnds+' / '+s.plannedEnds+' Ends completed':'No scoring Session linked'}</small></td><td data-label='Latest completed End'><strong>{s.latest?.total??'—'}</strong></td><td data-label='Live HR'><HeartRateStatus store={readingStore} athleteId={p.athleteId} compact/></td><td><button aria-label={'View Details for '+p.displayName} data-athlete-details={p.athleteId} onClick={()=>onSelect(p.athleteId)}>View Details</button></td></tr>;
});

function Presence({reading,now}:{reading?:HeartRateReading;now:number}){
 const age=reading?.lastSeenAt?now-Date.parse(reading.lastSeenAt):Infinity;
 return <span className={styles.presence}>{Number.isFinite(age)&&age>=-5000&&age<=45000?'Website seen recently':reading?.lastSeenAt?'No recent website heartbeat':'Website presence unknown'}</span>;
}

export function LiveMonitor({data,connection}:{data:LiveData;connection:string}){
 const [readingStore]=useState(createReadingStore);
 const publishReadings=useCallback((rows:HeartRateReading[])=>readingStore.publish(rows),[readingStore]);
 const [snapshot,setSnapshot]=useState<MonitorSnapshot>(EMPTY_MONITOR),[sensors,setSensors]=useState<Record<string,SensorState>>({}),[supported,setSupported]=useState(false);
 const [selected,setSelected]=useState<string|null>(null);
 const [windowSeconds,setWindow]=useState(900),[historyBefore,setHistoryBefore]=useState<string|null>(null),[now,setNow]=useState(()=>Date.now());
 const controls=useRef<SensorControls>(null),lastSelected=useRef<string|null>(null),root=useRef<HTMLElement>(null);
 useEffect(()=>{if(!selected&&lastSelected.current){const button=Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[data-athlete-details]')??[]).find(b=>b.dataset.athleteDetails===lastSelected.current);button?.focus();}lastSelected.current=selected;},[selected]);
 const enabled=process.env.NEXT_PUBLIC_LIVE_COACHING_BLE_ENABLED==='true',active=data.session.state==='active',terminal=['completed','cancelled'].includes(data.session.state);
 const receive=useCallback((next:MonitorSnapshot)=>setSnapshot(old=>({...next,history:(next.history??old.history??[]).filter(h=>next.readings.some(r=>r.athleteId===h.athleteId&&r.consent&&r.historyConsent&&(next.history!==null||historyAuthorityMatches(old.readings.find(o=>o.athleteId===r.athleteId),r))))})),[]);
 useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible')setNow(Date.now());},5000);return()=>clearInterval(timer);},[]);
 const people=monitorAthletes(data.participants,'','all','all','name',snapshot.readings,now);
 const selectedPerson=data.participants.find(p=>p.athleteId===selected&&p.state==='joined'),selectedHistory=snapshot.history?.find(h=>h.athleteId===selected);
 const connected=Object.values(sensors).filter(s=>s.state==='connected').length;
 const connectSensor=useCallback((id:string)=>controls.current?.connect(id),[]),disconnectSensor=useCallback((id:string)=>controls.current?.disconnect(id),[]);
 const sensorActions=(p:Participant)=>data.coach&&enabled&&!terminal?<div className={styles.actions}><button disabled={!supported||!active||!snapshot.readings.find(r=>r.athleteId===p.athleteId)?.consent||sensors[p.athleteId]?.state==='connecting'} onClick={()=>connectSensor(p.athleteId)}>{sensors[p.athleteId]?.state==='connected'?'Reconnect Heart Rate':'Connect Heart Rate'}</button><button disabled={!['connected','connecting'].includes(sensors[p.athleteId]?.state??'')} onClick={()=>disconnectSensor(p.athleteId)}>Disconnect sensor</button></div>:null;
 if(!data.coach)return null;
 return <section ref={root} className={styles.monitor} aria-label='Team training monitor'>
  <header className={styles.monitorHeading}><div><p className={styles.eyebrow}>{terminal?'TRAINING REVIEW':'TEAM MONITOR'}</p><h2>{data.session.title}</h2><p className={styles.muted}>{data.organizationName} · {data.session.training_date} <span className={styles.badge} data-state={data.session.state}>{data.session.state}</span></p></div><div className={styles.clock}><span>Team training elapsed</span><strong>{elapsedTraining(data.session.started_at,data.session.ended_at,now)}</strong><small>{connection}</small></div></header>
  <div className={styles.teamMetrics}>{[['Joined',data.participants.filter(p=>p.state==='joined').length+' / '+data.participants.length],['Scoring',data.participants.filter(p=>p.state==='joined'&&p.scoring).length],['HR connected',connected]].map(([label,value])=><div key={label}><span>{label}{label==='HR connected'&&<small className={styles.metricHint}>This browser</small>}</span><strong>{value}</strong></div>)}</div>

  <p className={styles.muted}>Website presence, recent saved scoring and HR signals are separate indicators. None proves an athlete is shooting. {terminal?'Review uses current authorised scoring records; it is not an immutable scoring snapshot. HR is shown only while retained and consented.':''}</p>
  {enabled&&<details className={styles.sensorPanel}><summary>Bluetooth sensors and athlete consent</summary><HeartRatePanel data={data} onReadings={publishReadings} onSnapshot={receive} onSensors={setSensors} onSupport={setSupported} controlsRef={controls} windowSeconds={windowSeconds} historyBefore={historyBefore} historyEnabled={Boolean(selectedPerson)}/></details>}
  {!enabled&&<p className={styles.empty}>Live Bluetooth HR is not enabled. Authorised scoring remains available.</p>}
  <p className={styles.muted}><Link href={'/organization/'+data.session.organization_id+'/live-coaching'}>Test Heart Rate Sensor</Link> on the coach&apos;s Live Coaching page. Leaving training disconnects local sensors.</p>
  {selectedPerson?<AthleteDetail participant={selectedPerson} data={data} reading={snapshot.readings.find(r=>r.athleteId===selected)} history={selectedHistory} historyControls={<><div className={styles.actions}><label>HR interval<select value={windowSeconds} onChange={e=>{setWindow(Number(e.target.value));setSnapshot(old=>({...old,history:[]}));}}><option value={60}>1 minute (full resolution)</option><option value={300}>5 minutes</option><option value={900}>15 minutes</option><option value={1800}>30 minutes</option><option value={10800}>3 hours</option><option value={86400}>Retained session · up to 24 hours</option></select></label></div>  <div className={styles.actions}><button disabled={(historyBefore?Date.parse(historyBefore):data.session.ended_at?Date.parse(data.session.ended_at):now)-windowSeconds*1000<now-86400000} onClick={()=>{setSnapshot(old=>({...old,history:[]}));setHistoryBefore(new Date((historyBefore?Date.parse(historyBefore):data.session.ended_at?Date.parse(data.session.ended_at):Date.now())-windowSeconds*1000).toISOString());}}>Earlier HR interval</button><button disabled={!historyBefore} onClick={()=>{const next=Date.parse(historyBefore!)+windowSeconds*1000,upper=data.session.ended_at?Date.parse(data.session.ended_at):Date.now();setHistoryBefore(next>=upper?null:new Date(next).toISOString());setSnapshot(old=>({...old,history:[]}));}}>Later HR interval</button><button disabled={!historyBefore} onClick={()=>{setHistoryBefore(null);setSnapshot(old=>({...old,history:[]}));}}>Return to latest HR</button>{historyBefore&&<span>History ending {time(historyBefore)} SGT</span>}</div></>} events={snapshot.endActivity.filter(e=>e.athleteId===selected)} onClose={()=>setSelected(null)} readingStore={readingStore} sensorActions={sensorActions(selectedPerson)} now={now}/>:<div className={styles.scoreboard}><table><caption>Live team scoreboard</caption><thead><tr><th scope='col'>Athlete</th><th scope='col'>Confirmed score</th><th scope='col'>Latest completed End</th><th scope='col'>Live HR</th><th scope='col'>Details</th></tr></thead><tbody>{people.map(({participant:p,progress:s})=>p.state!=='joined'?<tr key={p.athleteId}><th scope='row'>{p.displayName}</th><td colSpan={4}><span className={styles.badge}>{p.state==='invited'?'Invited':p.state==='declined'?'Declined':'Left'}</span><small>Scoring and heart rate are not shared.</small></td></tr>:<ScoreboardRow key={p.athleteId} participant={p} progress={s} readingStore={readingStore} onSelect={setSelected}/>)}</tbody></table></div>}

  {!selectedPerson&&!people.length&&<p className={styles.empty}>No participants in this training yet.</p>}
 </section>;
}

export function AthleteDetail({participant:p,data,reading,history,historyControls,events,onClose,sensorActions,now,readingStore}:{participant:Participant;data:LiveData;reading?:HeartRateReading;history?:HrHistory;historyControls:React.ReactNode;events:EndActivity[];onClose:()=>void;sensorActions:React.ReactNode;now:number;readingStore:ReadingStore}){
 const s=scoringProgress(p.scoring);
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{heading.current?.focus();},[p.athleteId]);
 const cumulative=new Map<string,number>();let confirmed=0;
 for(const {round,ends} of s.rounds)for(const e of ends){if(e.complete)confirmed+=e.total;cumulative.set(round.id+':'+e.number,confirmed);}
 return <section className={styles.detail} aria-label={'Monitoring '+p.displayName}>
  <button onClick={onClose}>← Back to team</button><h3 ref={heading} tabIndex={-1}>{p.displayName}</h3><p className={styles.muted}>{p.scoring?.title??'No linked scoring Session'} · {p.state}</p><Presence reading={reading} now={now}/>
  {p.scoring?<div className={styles.metrics}><div><span>Confirmed score</span><strong>{s.confirmedTotal}</strong></div><div><span>Completed Ends</span><strong>{s.completedEnds} / {s.plannedEnds}</strong></div><div><span>Latest completed End</span><strong>{s.latest?.total??'—'}</strong></div><div><span>Saved X-count</span><strong>{s.rounds.flatMap(r=>r.ends.flatMap(e=>e.arrows)).filter(a=>a.score==='X').length}</strong></div></div>:<p className={styles.empty}>Awaiting scoring connection. No scoring measurements are available.</p>}
  <div className={styles.detailColumns}><section aria-label='Target plotting'><h3>Target Plotting</h3>{p.scoring?<AthleteTarget key={p.athleteId} rounds={s.rounds.map(r=>({...r.round,arrows:r.ends.flatMap(e=>e.arrows)}))}/>:<p className={styles.empty}>Connect a scoring Session to view recorded placements.</p>}</section>
  <section className={styles.scoringSheet} aria-label='Complete scoring' tabIndex={0}><h3>Complete Scoring</h3><p className={styles.muted}>Only completed Ends contribute to the confirmed cumulative score. Saved arrows in unfinished Ends remain provisional. Corrections follow the authorised scoring records.</p>
  {s.rounds.map(({round,ends})=><section key={round.id}><h4>{round.name} · {round.distanceMetres} m · {ends.filter(e=>e.complete).length}/{round.ends} Ends</h4><ol className={styles.endHistory}>{ends.map(e=>{const activity=events.find(a=>a.roundId===round.id&&a.end===e.number);return <li key={e.number}><strong>End {e.number} · {e.arrows.length?e.total:'—'} · {e.complete?'Confirmed':e.arrows.length?'Unfinished':'Not started'}</strong><span className={styles.arrowScores}>{Array.from({length:round.arrowsPerEnd},(_,i)=>{const a=e.arrows.find(a=>a.arrow===i+1);return <span key={i} aria-label={'Arrow '+(i+1)+': '+(a?.score??'not recorded')}>{a?.score??'—'}</span>;})}</span><span>Confirmed cumulative: {cumulative.get(round.id+':'+e.number)} · {e.arrows.filter(a=>a.score==='X').length} X · {e.arrows.length}/{round.arrowsPerEnd} arrows</span><small>{activity?'Latest scoring update '+time(activity.changedAt)+' SGT':'Submission time not recorded'}</small></li>;})}</ol></section>)}
  {!s.savedArrows&&<p className={styles.empty}>No saved arrows available.</p>}</section></div>
  <section aria-label='Heart rate trend'><h3>Heart Rate Trend</h3><HeartRateStatus reading={reading} store={readingStore} athleteId={p.athleteId}/>{sensorActions}{!reading?.historyConsent?<p className={styles.empty}>HR history requires separate athlete consent and expires after 24 hours. Live sharing alone does not retain a timeline.</p>:<>{historyControls}<HeartRateChart history={history} markers={events}/></>}</section>
  {data.coach&&p.scoringSessionId&&<Link href={'/organization/'+data.session.organization_id+'/athletes/'+p.athleteId+'/sessions/'+p.scoringSessionId}>Open authorised Session notes and coach feedback</Link>}
 </section>;
}
