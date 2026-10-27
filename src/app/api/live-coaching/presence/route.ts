import {createAuthClient} from '@/lib/supabase/server';
import {uuid} from '@/features/live-coaching/http.server';
export async function POST(request:Request){
 const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
 if(process.env.LIVE_COACHING_BLE_ENABLED!=='true')return reply({error:'Monitoring unavailable.'},503);
 if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return reply({error:'Use Arc Track.'},403);
 if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return reply({error:'JSON required.'},415);
 const client=await createAuthClient({writable:true}),identity=await client.auth.getUser();
 if(identity.error||!identity.data.user)return reply({error:'Sign in required.'},401);
 const reader=request.body?.getReader();if(!reader)return reply({error:'Input required.'},400);
 try{
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>1024){await reader.cancel();return reply({error:'Request too large.'},413);}chunks.push(part.value);}
  const b=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!b||Array.isArray(b)||Object.keys(b).length!==1||(!uuid(b.liveId)&&!uuid(b.scoringSessionId))||Object.keys(b).some(k=>!['liveId','scoringSessionId'].includes(k)))return reply({error:'Invalid session.'},400);
  const result=await client.rpc('touch_live_presence',{p_live:b.liveId??null,p_scoring:b.scoringSessionId??null});
  return result.error?reply({error:'Presence unavailable.'},403):reply({ok:true});
 }catch{return reply({error:'Invalid request.'},400);}finally{reader.releaseLock();}
}
