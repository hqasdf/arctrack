import 'server-only';
import {createAuthClient} from '@/lib/supabase/server';
import {uuid} from '../http.server';

const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
export async function liveHeartRateRequest(request: Request) {
  const reply=(value:unknown,status=200)=>Response.json(value,{status,headers});
  if(process.env.LIVE_COACHING_BLE_ENABLED!=='true')return reply({error:'Live Bluetooth HR is not enabled.'},503);
  const client=await createAuthClient({writable:true}),identity=await client.auth.getUser();
  if(identity.error||!identity.data.user)return reply({error:'Sign in required.'},401);
  try {
    if(request.method==='GET') {
      const query=new URL(request.url).searchParams,id=query.get('id'),window=Number(query.get('window')??900);if(!uuid(id)||![60,300,900,1800,10800,86400].includes(window))return reply({error:'Invalid live session or interval.'},400);
      if(query.get('before')&&(query.get('before')!.length>32||!Number.isFinite(Date.parse(query.get('before')!))))return reply({error:'Invalid history boundary.'},400);
      const result=await client.rpc(query.get('view')==='athlete'?'read_live_athlete_hr':'read_live_monitor',{p_live:id,p_window:window,p_history:query.get('history')==='true',p_before:query.get('before')??null});
      return result.error?reply({error:'Live HR access unavailable.'},403):reply(result.data);
    }
    if(request.method!=='POST')return reply({error:'Method unavailable.'},405);
    if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return reply({error:'Use Arc Track to manage sharing.'},403);
    if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return reply({error:'JSON required.'},415);
    const reader=request.body?.getReader();if(!reader)return reply({error:'Input required.'},400);
    let size=0;const chunks:Uint8Array[]=[];
    try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>8192){await reader.cancel();return reply({error:'Request too large.'},413);}chunks.push(part.value);}}finally{reader.releaseLock();}
    const b=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(b?.action==='batch'){
      const valid=(v:Record<string,unknown>)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>['athleteId','generation','sourceId','bpm','sequence','receivedAt'].includes(k))&&uuid(v.athleteId)&&uuid(v.generation)&&uuid(v.sourceId)&&Number.isInteger(v.bpm)&&Number(v.bpm)>=1&&Number(v.bpm)<=300&&Number.isSafeInteger(v.sequence)&&Number(v.sequence)>=1&&typeof v.receivedAt==='string'&&v.receivedAt.length<=32&&Number.isFinite(Date.parse(v.receivedAt));
      if(Object.keys(b).some(k=>!['action','liveId','samples'].includes(k))||!uuid(b.liveId)||!Array.isArray(b.samples)||b.samples.length<1||b.samples.length>12||!b.samples.every(valid)||new Set(b.samples.map((v:{athleteId:string})=>v.athleteId)).size!==b.samples.length)return reply({error:'Invalid measurement batch.'},400);
      const result=await client.rpc('live_hr_batch',{p_live:b.liveId,p_samples:b.samples});
      return result.error?reply({error:'Batch admission unavailable.'},result.error.code==='42501'?403:503):reply(result.data);
    }
    const allowed=['action','liveId','athleteId','generation','sourceId','bpm','sequence','receivedAt','historyVersion'];
    if(!b||Array.isArray(b)||Object.keys(b).some(k=>!allowed.includes(k))||!['consent','revoke','assign','sample','disconnect','history_consent','history_revoke'].includes(b.action)||!uuid(b.liveId)||!uuid(b.athleteId))return reply({error:'Invalid sharing request.'},400);
    if(b.generation!=null&&!uuid(b.generation))return reply({error:'Invalid consent version.'},400);
    if(['history_consent','history_revoke'].includes(b.action)){
      if(b.athleteId!==identity.data.user.id||!uuid(b.generation)||!Number.isSafeInteger(b.historyVersion)||b.historyVersion<0)return reply({error:'Current owner consent required.'},400);
      const result=await client.rpc('set_live_hr_history',{p_live:b.liveId,p_enabled:b.action==='history_consent',p_generation:b.generation,p_expected:b.historyVersion});
      return result.error?reply({error:'Timeline consent was not confirmed. Refresh and try again.'},result.error.code==='42501'?403:409):reply(result.data);
    }
    if(!['consent','revoke'].includes(b.action)&&(!uuid(b.generation)||!uuid(b.sourceId)))return reply({error:'A current sensor assignment is required.'},400);
    if(b.action==='sample'&&(!Number.isInteger(b.bpm)||b.bpm<1||b.bpm>300||!Number.isSafeInteger(b.sequence)||b.sequence<1||typeof b.receivedAt!=='string'||b.receivedAt.length>32||!Number.isFinite(Date.parse(b.receivedAt))))return reply({error:'Invalid measurement.'},400);
    const result=await client.rpc('live_hr_command',{p_action:b.action,p_live:b.liveId,p_athlete:b.athleteId,p_generation:b.generation??null,p_source:b.sourceId??null,p_bpm:b.bpm??null,p_sequence:b.sequence??null,p_observed:b.receivedAt??null});
    if(result.error)return reply({error:'Sharing was not confirmed. Check current consent, session and sensor assignment.'},result.error.code==='42501'?403:result.error.code==='P0001'?429:409);
    return reply(result.data);
  } catch {return reply({error:'Live HR request could not be completed.'},400);}
}
