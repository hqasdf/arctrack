'use client';
import {useEffect} from 'react';
/** A visible, authenticated website heartbeat; never proof of shooting activity. */
export function LivePresence({liveId,scoringSessionId}:{liveId?:string;scoringSessionId?:string}){
 useEffect(()=>{
  if(process.env.NEXT_PUBLIC_LIVE_COACHING_BLE_ENABLED!=='true')return;
  let pending:AbortController|null=null;
  const touch=()=>{if(document.visibilityState!=='visible'||pending)return;pending=new AbortController();void fetch('/api/live-coaching/presence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(liveId?{liveId}:{scoringSessionId}),signal:pending.signal}).catch(()=>{}).finally(()=>{pending=null;});};
  const visible=()=>{if(document.visibilityState==='visible')touch();else pending?.abort();};
  touch();const timer=setInterval(touch,20000);document.addEventListener('visibilitychange',visible);
  return()=>{clearInterval(timer);pending?.abort();document.removeEventListener('visibilitychange',visible);};
 },[liveId,scoringSessionId]);
 return null;
}
