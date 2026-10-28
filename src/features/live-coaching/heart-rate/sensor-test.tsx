'use client';
import {useEffect,useRef,useState} from 'react';
import {HeartRateSensorManager,type BluetoothAdapter,type SensorState} from './sensor-manager';
import {rememberTestedDevice,testedDevice} from './tested-device';
import styles from '../live-coaching.module.css';

/** Local diagnostic: callbacks below never use the upload, consent or session APIs. */
export function SensorTest({scope}:{scope:string}){
 const [open,setOpen]=useState(false),[state,setState]=useState<SensorState|null>(null);
 const [reading,setReading]=useState<{bpm:number;at:string}|null>(null),[stale,setStale]=useState(false);
 const manager=useRef<HeartRateSensorManager|null>(null);
 useEffect(()=>{
  if(!open||typeof navigator==='undefined'||!('bluetooth' in navigator)||!window.isSecureContext)return;
  let alive=true;
  const instance=new HeartRateSensorManager({
   bluetooth:(navigator as Navigator&{bluetooth:BluetoothAdapter}).bluetooth,
   authorize:async()=>({generation:'local-test',sourceId:'local-test'}),
   publish:async(_id,_lease,sample)=>{if(alive){setReading({bpm:sample.bpm,at:sample.receivedAt});setStale(false);}},
   release:async()=>{},
   connectedDevice:device=>{if(alive)rememberTestedDevice(scope,device);},
   state:value=>{if(alive)setState(value);},
  });
  manager.current=instance;
  const hidden=()=>{if(document.visibilityState!=='visible')instance.disconnect('diagnostic');};
  const exit=()=>instance.disconnect('diagnostic');
  document.addEventListener('visibilitychange',hidden);
  window.addEventListener('pagehide',exit);
  return()=>{alive=false;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',exit);instance.dispose();manager.current=null;};
 },[open,scope]);
 useEffect(()=>{if(!reading)return;const timer=setTimeout(()=>setStale(true),Math.max(0,Date.parse(reading.at)+10001-Date.now()));return()=>clearTimeout(timer);},[reading]);
 const supported=typeof navigator!=='undefined'&&'bluetooth' in navigator&&typeof window!=='undefined'&&window.isSecureContext;
 const connect=(reuse:boolean)=>{setReading(null);setStale(false);void manager.current?.connect('diagnostic',reuse?testedDevice(scope):undefined);};
 const close=()=>{manager.current?.disconnect('diagnostic');setOpen(false);setState(null);setReading(null);};
 return <section className={styles.panel} aria-label='Heart rate sensor test'>
  <h2>Test Heart Rate Sensor</h2>
  {!open?<button onClick={()=>setOpen(true)}>Test Heart Rate Sensor</button>:<>
   <p>Enable heart-rate broadcasting on your Garmin Venu 4 or another compatible sensor. This test stays on this device: it does not upload, assign or save heart-rate readings.</p>
   {!supported&&<p role='status'>Bluetooth is unavailable here. Use a secure HTTPS page or localhost in supported Chrome or Edge, and check Bluetooth permissions.</p>}
   <div className={styles.toolbar}><button disabled={!supported||state?.state==='connecting'||state?.state==='connected'} onClick={()=>connect(false)}>Connect &amp; Test</button>{testedDevice(scope)&&state?.state!=='connected'&&<button disabled={!supported||state?.state==='connecting'} onClick={()=>connect(true)}>Retry tested sensor</button>}<button disabled={!state||!['connecting','connected'].includes(state.state)} onClick={()=>manager.current?.disconnect('diagnostic')}>Disconnect</button><button onClick={close}>Close test</button></div>
   <p role='status'>{state?.state==='connecting'?'Connecting…':state?.state==='connected'?(reading&&!stale?'Connected — receiving readings':'Connected — waiting for a fresh reading'):state?.state==='error'?'Connection failed — retry':state?.state==='disconnected'?'Disconnected':'Ready to test'}</p>
   {state?.message&&<p role='alert'>{state.message}</p>}
   {reading&&<p><strong>{state?.state==='connected'&&!stale?`${reading.bpm} BPM`:'Last reading: '+reading.bpm+' BPM'}</strong><br/><small>Received {new Date(reading.at).toLocaleTimeString()}{stale?' — no recent reading':''}</small></p>}
  </>}
 </section>;
}
