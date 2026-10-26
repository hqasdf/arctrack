import 'server-only';
import { createAuthClient } from '@/lib/supabase/server';
import { mapSession, type DbSession } from '@/features/sessions/read.server';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
export const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
export async function liveCoachingRequest(request:Request){
 const reply=(value:unknown,status=200)=>Response.json(value,{status,headers});
 const client=await createAuthClient({writable:true});const {data:auth,error}=await client.auth.getUser();
 if(error||!auth.user)return reply({error:'Sign in required.'},401);
 try{
  let id:string|null=null,org:string|null=null;
  if(request.method==='POST'){
   if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return reply({error:'Use Arc Track to change participation.'},403);
   if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return reply({error:'JSON required.'},415);
   const reader=request.body?.getReader();if(!reader)return reply({error:'Input required.'},400);let size=0;const chunks:Uint8Array[]=[];
   try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>8192){await reader.cancel();return reply({error:'Request too large.'},413);}chunks.push(part.value);}}finally{reader.releaseLock();}
   const b=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!b||Array.isArray(b)||Object.keys(b).some(k=>!['action','id','organizationId','title','date','athletes','scoringSessionId','expected'].includes(k))||!['create','waiting','start','complete','cancel','join','decline','leave','link'].includes(b.action))return reply({error:'Invalid action.'},400);
   if(b.action==='create'?!uuid(b.organizationId)||typeof b.title!=='string'||b.title.trim().length<1||b.title.length>100||!/^\d{4}-\d{2}-\d{2}$/.test(b.date??'')||!Array.isArray(b.athletes)||b.athletes.length<1||b.athletes.length>32||!b.athletes.every(uuid):!uuid(b.id)||!Number.isSafeInteger(b.expected)||b.expected<1)return reply({error:'Check the session and selected athletes.'},400);
   if(['join','link'].includes(b.action)&&!uuid(b.scoringSessionId))return reply({error:'Select your own scoring Session.'},400);
   const result=await client.rpc('live_coaching_command',{p_action:b.action,p_id:b.id??null,p_org:b.organizationId??null,p_title:b.title??null,p_date:b.date??null,p_athletes:b.athletes??[],p_scoring:b.scoringSessionId??null,p_expected:b.expected??null});
   if(result.error)return reply({error:result.error.code==='40001'?'Session changed. Refresh and retry.':'Change not confirmed. Check current membership, participation and scoring Session.',code:result.error.code==='42501'?'denied':'conflict'},result.error.code==='42501'?403:409);
   return reply({id:result.data});
  }
  const url=new URL(request.url);id=url.searchParams.get('id');org=url.searchParams.get('organizationId');
  if(id&&!uuid(id)||org&&!uuid(org))return reply({error:'Invalid session.'},400);
  const result=await client.rpc('read_live_coaching',{p_id:id,p_org:org});
  if(result.error)return reply({error:result.error.code==='42501'?'Live access unavailable.':'Live Coaching could not be loaded. Its local migration must be installed before use.'},result.error.code==='42501'?403:503);
  const data=result.data;
  if(id&&data?.participants)data.participants=data.participants.map((p:{scoring:DbSession|null})=>({...p,scoring:p.scoring?mapSession(p.scoring):null}));
  return reply(data);
 }catch{return reply({error:'Live Coaching request could not be completed.'},400);}
}
