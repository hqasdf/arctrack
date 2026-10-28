'use client';
import Link from 'next/link';
import {useCallback,useEffect,useImperativeHandle,useRef,useState,useSyncExternalStore,type Ref} from 'react';
import type {LiveData} from '../model';
import {historyAuthorityMatches,heartRateFresh,type HeartRateReading,type ReadingStore} from './measurement';
import {HeartRateBatcher} from './batch';
import {HeartRateSensorManager,type BluetoothAdapter,type SensorState} from './sensor-manager';
import type {MonitorSnapshot} from '../monitor-model';
import styles from '../live-coaching.module.css';
export type SensorControls={connect:(id:string)=>void;disconnect:(id:string)=>void};
const subscribeSupport=()=>()=>{};
const browserSupport=()=>typeof navigator!=='undefined'&&'bluetooth' in navigator&&window.isSecureContext;

export function HeartRatePanel({data,onReadings,onSnapshot,onSensors,onSupport,controlsRef,windowSeconds=900,historyBefore}:{data:LiveData;onReadings:(rows:HeartRateReading[])=>void;onSnapshot?:(value:MonitorSnapshot)=>void;onSensors?:(value:Record<string,SensorState>)=>void;onSupport?:(supported:boolean)=>void;controlsRef?:Ref<SensorControls>;windowSeconds?:number;historyBefore?:string|null}) {
  const [rows,setRows]=useState<HeartRateReading[]>([]),[states,setStates]=useState<Record<string,SensorState>>({});
  const [selected,setSelected]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const supported=useSyncExternalStore(subscribeSupport,browserSupport,()=>false);
  const manager=useRef<HeartRateSensorManager|null>(null),current=useRef<HeartRateReading[]>([]),refresh=useRef<()=>Promise<void>>(async()=>{});
  const liveId=data.session.id,coach=data.coach,viewerId=data.viewerId,active=data.session.state==='active',terminal=['completed','cancelled'].includes(data.session.state);
  useImperativeHandle(controlsRef,()=>({connect:id=>{void manager.current?.connect(id).catch(()=>setError('Disconnect a sensor before adding another. Hardware connection limits vary.'));},disconnect:id=>manager.current?.disconnect(id)}),[]);
  useEffect(()=>{onSensors?.(active?states:{});},[states,onSensors,active]);
  useEffect(()=>{onSupport?.(supported);},[supported,onSupport]);
  const settings=useRef({windowSeconds,historyBefore});
  useEffect(()=>{settings.current={windowSeconds,historyBefore};void refresh.current();},[windowSeconds,historyBefore]);
  useEffect(()=>{
    let alive=true,reading=false,historyReading=false,lastHistory=0,lastMetadata=0,historyKey='';const pending=new Set<AbortController>();
    const post=async(action:string,athleteId:string,extra:Record<string,unknown>={})=>{
      const response=await fetch('/api/live-coaching/heart-rate',{method:'POST',keepalive:action==='disconnect',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,liveId,athleteId,...extra})});
      const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error??'Live HR unavailable.'),{status:response.status});return result;
    };
    const batcher=new HeartRateBatcher(async(samples,signal)=>{
      const response=await fetch('/api/live-coaching/heart-rate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'batch',liveId,samples}),signal});
      const result=await response.json();if(!response.ok||!Array.isArray(result))throw Error('Upload unavailable');return result;
    });
    const uploadTimer=setInterval(()=>{if(document.visibilityState==='visible')void batcher.flush();},1000);
    const instance=supported&&coach&&active?new HeartRateSensorManager({
      bluetooth:(navigator as Navigator&{bluetooth:BluetoothAdapter}).bluetooth,
      authorize:async(id,sourceId)=>{
        const consent=current.current.find(r=>r.athleteId===id&&r.consent);if(!consent)throw Error('Athlete consent required.');
        return post('assign',id,{sourceId,generation:consent.generation});
      },
      publish:async(id,lease,sample)=>{await batcher.enqueue({athleteId:id,...lease,...sample});},
      release:async(id,lease)=>{await post('disconnect',id,lease);if(alive)await read();},
      state:value=>{if(alive){setStates(s=>({...s,[value.athleteId]:value}));if(value.state==='disconnected'||value.state==='error'){const next=current.current.map(r=>r.athleteId===value.athleteId?{...r,bpm:null,sourceId:null}:r);setRows(next);onReadings(next);}}},
    }):null;
    manager.current=instance;
    const clear=()=>{for(const abort of pending)abort.abort();batcher.clear();current.current=[];instance?.retain(new Set());if(alive){setRows([]);setLoaded(false);onReadings([]);onSnapshot?.({readings:[],history:[],endActivity:[]});}};
    const readHistory=async(view:typeof settings.current,key:string)=>{
      if(historyReading)return;historyReading=true;lastHistory=Date.now();historyKey=key;
      const abort=new AbortController();pending.add(abort);const deadline=setTimeout(()=>abort.abort(),10000);
      try{
        const response=await fetch('/api/live-coaching/heart-rate?id='+liveId+(coach?'':'&view=athlete')+'&window='+view.windowSeconds+'&history=true'+(view.historyBefore?'&before='+encodeURIComponent(view.historyBefore):''),{cache:'no-store',signal:abort.signal});
        const value=await response.json();if(!response.ok||!Array.isArray(value.history)||!Array.isArray(value.readings)||!Array.isArray(value.endActivity))throw Error('Timeline access unavailable.');
        if(alive&&!abort.signal.aborted&&document.visibilityState==='visible'&&key===JSON.stringify(settings.current))onSnapshot?.({...value,readings:current.current,history:value.history.filter((h:{athleteId:string})=>{const checked:HeartRateReading|undefined=value.readings.find((r:HeartRateReading)=>r.athleteId===h.athleteId),latest=current.current.find(r=>r.athleteId===h.athleteId);return historyAuthorityMatches(checked,latest);})});
      }catch{if(alive&&document.visibilityState==='visible')onSnapshot?.({readings:current.current,history:[],endActivity:[]});}
      finally{clearTimeout(deadline);historyReading=false;pending.delete(abort);}
    };
    const read=async()=>{
      if(!alive||reading||document.visibilityState!=='visible')return;
      reading=true;const abort=new AbortController();pending.add(abort);const deadline=setTimeout(()=>abort.abort(),5000);
      try{
        const response=await fetch('/api/live-coaching/heart-rate?id='+liveId+(coach?'':'&view=athlete')+'&window=60&history=false',{cache:'no-store',signal:abort.signal});
        const value=await response.json();if(!response.ok||!Array.isArray(value.readings)||!Array.isArray(value.endActivity))throw Error('HR sharing could not be verified. Scoring is still available.');
        if(alive&&!abort.signal.aborted&&document.visibilityState==='visible'){
          const readings:HeartRateReading[]=value.readings,changed=JSON.stringify(current.current.map(r=>[r.athleteId,r.consent,r.historyConsent]))!==JSON.stringify(readings.map(r=>[r.athleteId,r.consent,r.historyConsent]));
          current.current=readings;setLoaded(true);onReadings(readings);
          if(changed||Date.now()-lastMetadata>=5000){setRows(readings);onSnapshot?.(value);lastMetadata=Date.now();}
          setError('');instance?.retain(new Set(readings.filter(r=>r.consent).map(r=>r.athleteId)));
          const view=settings.current,key=JSON.stringify(view);if(key!==historyKey||Date.now()-lastHistory>=(view.windowSeconds>=10800?30000:5000))void readHistory(view,key);
        }
      }catch(e){if(alive&&document.visibilityState==='visible'){clear();setError(e instanceof Error?e.message:'HR sharing unavailable.');}}
      finally{clearTimeout(deadline);reading=false;pending.delete(abort);}
    };
    refresh.current=read;
    const visible=()=>{if(document.visibilityState==='visible')void read();else{for(const abort of pending)abort.abort();clear();}};
    document.addEventListener('visibilitychange',visible);window.addEventListener('online',visible);
    const timer=setInterval(()=>{void read();},terminal?15000:1000);void read();
    return()=>{alive=false;batcher.dispose();clearInterval(uploadTimer);for(const abort of pending)abort.abort();instance?.dispose();manager.current=null;current.current=[];onReadings([]);onSnapshot?.({readings:[],history:[],endActivity:[]});clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',visible);refresh.current=async()=>{};};
  },[liveId,coach,supported,onReadings,onSnapshot,active,terminal]);
  const mine=rows.find(r=>r.athleteId===viewerId);
  const changeConsent=async(history=false)=>{
    if(busy)return;setBusy(true);setError('');
    try{const response=await fetch('/api/live-coaching/heart-rate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:history?(mine?.historyConsent?'history_revoke':'history_consent'):(mine?.consent?'revoke':'consent'),liveId,athleteId:viewerId,generation:mine?.generation??null,...(history?{historyVersion:mine?.historyVersion??0}:{})})});const result=await response.json();if(!response.ok)throw Error(result.error??'Consent not confirmed.');await refresh.current();}
    catch(e){setError(e instanceof Error?e.message:'Consent not confirmed.');await refresh.current();}finally{setBusy(false);}
  };
  const candidate=rows.find(r=>r.athleteId===selected),sensor=states[selected];
  return <section className={styles.panel} aria-label='Live Bluetooth heart rate'>
    <h2>{terminal?'HR review and consent':'Live Bluetooth heart rate'}</h2>
    <p>Optional sharing for this live training only. These readings stay separate from Garmin Health and scoring. Latest readings expire. A separate athlete opt-in retains at most one actual reading per second for up to 24 hours; gaps remain gaps.</p>
    <p><Link href='/privacy#live-coaching-hr'>Live HR privacy and retention</Link></p>
    {error&&<p role='alert'>{error} <button onClick={()=>void refresh.current()}>Retry HR status</button></p>}
    {coach?terminal?<p>Training has ended. Live sensor connections are closed; separately consented history remains available only until expiry or revocation.</p>:<>
      {!supported&&<p role='status'>This browser cannot connect to Bluetooth HR sensors. Use an HTTPS page in a browser with Web Bluetooth support, such as supported Chrome or Edge installations.</p>}
      <label>Athlete for sensor<select value={selected} onChange={e=>setSelected(e.target.value)}><option value=''>Select an athlete</option>{data.participants.filter(p=>p.state==='joined').map(p=><option key={p.athleteId} value={p.athleteId}>{p.displayName}{rows.find(r=>r.athleteId===p.athleteId)?.consent?' — consent granted':' — awaiting consent'}</option>)}</select></label>
      <div className={styles.toolbar}><button disabled={!supported||!candidate?.consent||data.session.state!=='active'||sensor?.state==='connecting'} onClick={()=>{void manager.current?.connect(selected).catch(()=>setError('Disconnect a sensor before adding another. Hardware connection limits vary.'));}}>{sensor?.state==='connected'?'Replace sensor':'Connect sensor'}</button><button disabled={!selected||sensor?.state!=='connected'} onClick={()=>manager.current?.disconnect(selected)}>Disconnect sensor</button></div>
      {sensor&&<p role='status'>{sensor.state}{sensor.message?' — '+sensor.message:''}</p>}
      <ul>{Object.values(states).filter(s=>s.state==='connected').map(s=><li key={s.athleteId}>{data.participants.find(p=>p.athleteId===s.athleteId)?.displayName}: sensor connected <button onClick={()=>manager.current?.disconnect(s.athleteId)}>Disconnect</button></li>)}</ul>
      <p className={styles.muted}>Enable standard Bluetooth HR broadcasting on the sensor. Connections are initiated manually. Multiple sensors depend on the browser, adapter and device limits; twelve simultaneous connections are not guaranteed.</p>
    </>:<>
      <p>Your coach can associate a nearby compatible sensor with you only after you grant consent. You can revoke sharing at any time. Sharing stops when you leave, membership is revoked, or training ends.</p>
      <button disabled={busy||!loaded||terminal||!data.participants.some(p=>p.athleteId===viewerId&&p.state==='joined')} onClick={()=>void changeConsent()}>{mine?.consent?'Revoke HR sharing':'Share HR with this live session'}</button>
      <p>Optional timeline retention shares a bounded HR history with this coach for this session, including completed review. Readings expire after 24 hours. Revoking timeline consent deletes retained readings.</p><button disabled={busy||!loaded||!mine?.consent||(terminal&&!mine?.historyConsent)} onClick={()=>void changeConsent(true)}>{mine?.historyConsent?'Delete retained HR timeline':'Allow 24-hour HR timeline'}</button>
      <p role='status'>{!loaded?'Checking HR consent...':terminal?'Live sharing stopped. '+(mine?.historyConsent?'Timeline retained under your consent.':'No timeline retention consent.') :mine?.consent?'HR sharing consent granted':'HR sharing is off'}</p>
    </>}
    <p className={styles.muted}>Apple Watch support requires a relay that actually exposes the standard BLE Heart Rate Service. No relay or physical sensor has been verified for Arc Track yet. Switching away from this page disconnects local sensors.</p>
  </section>;
}

export function HeartRateStatus({reading:fallback,store,athleteId='',compact=false}:{reading?:HeartRateReading;store?:ReadingStore;athleteId?:string;compact?:boolean}) {
  const subscribe=useCallback((listener:()=>void)=>store?.subscribe(athleteId,listener)??(()=>{}),[store,athleteId]);
  const snapshot=useCallback(()=>store?store.get(athleteId):fallback,[store,athleteId,fallback]);
  const reading=useSyncExternalStore(subscribe,snapshot,snapshot);
  const [time,setTime]=useState(()=>Date.now());
  useEffect(()=>{
    if(!reading?.receivedAt)return;
    const timer=setTimeout(()=>setTime(Date.now()),Math.max(0,Date.parse(reading.receivedAt)+10001-Date.now()));
    return()=>clearTimeout(timer);
  },[reading?.receivedAt]);
  const fresh=heartRateFresh(reading,Math.max(time,Date.parse(reading?.receivedAt??'')||0));
  if(compact)return <span>{fresh?reading!.bpm+' BPM':'Unavailable'}</span>;
  return <div className={styles.hrStatus}><strong>{fresh?`${reading!.bpm} BPM`:!reading?'HR unavailable':!reading.consent?'Not shared':!reading.sourceId?'No sensor':'HR unavailable'}</strong><span>{!reading?'HR status not verified':!reading.consent?'HR sharing off':fresh?'Live sensor reading':reading.sourceId?'Waiting for a fresh reading':'Sensor disconnected'}</span>{reading?.receivedAt&&<small>Last received {new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(reading.receivedAt))} SGT</small>}</div>;
}
