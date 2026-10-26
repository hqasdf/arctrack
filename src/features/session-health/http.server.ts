import { createAuthClient } from '@/lib/supabase/server';
import { getAuthConfig } from '@/lib/auth/config';
import { sameOrigin } from '@/features/garmin/http.server';
const headers = { 'Cache-Control':'private, no-store', 'Referrer-Policy':'no-referrer' };
const uuid = (v:unknown):v is string=>typeof v==='string'&&/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
export async function sessionHealthRequest(request:Request, sessionId:string) {
  const reply=(data:unknown,status=200)=>Response.json(data,{status,headers});
  if(!uuid(sessionId)) return reply({error:'Session unavailable.'},404);
  if(request.method==='POST') {
    const origin=getAuthConfig()?.appUrl;
    if(!origin||!sameOrigin(request,{appOrigin:new URL(origin).origin})) return reply({error:'Use Session settings in Arc Track.'},403);
    if(request.headers.get('content-type')?.split(';')[0]!=='application/json') return reply({error:'Invalid request.'},415);
  }
  const db=await createAuthClient({writable:true});
  const {data:auth,error:authError}=await db.auth.getUser();
  if(authError||!auth.user) return reply({error:'Sign in to view your Session.'},401);
  try {
    if(request.method==='POST') {
      // Stream-bound even when Content-Length is absent or inaccurate.
      const reader=request.body?.getReader(); if(!reader) return reply({error:'Invalid request.'},400);
      const bytes:Uint8Array[]=[];let size=0;
      try { while(true) {const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>2048){await reader.cancel();return reply({error:'Request too large.'},413);}bytes.push(value);} }
      finally {reader.releaseLock();}
      const input=JSON.parse(Buffer.concat(bytes).toString('utf8')) as Record<string,unknown>;
      const timestamp=(v:unknown)=>v===null||typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v));
      if(!input||Array.isArray(input)||Object.keys(input).some(key=>!['activityId','expected'].includes(key))
        ||!(input.activityId===null||typeof input.activityId==='string'&&input.activityId.length>0&&input.activityId.length<=180)
        ||!timestamp(input.expected??null)) return reply({error:'Choose a Garmin activity and refresh before retrying.'},400);
      const {error}=await db.rpc('set_session_garmin_activity',{p_session:sessionId,p_activity:input.activityId,p_expected:input.expected??null});
      if(error) return reply({error:'The activity link could not be confirmed. Refresh and check your Garmin authorization.'},409);
    }
    const {data,error}=await db.rpc('read_session_garmin_activity',{p_session:sessionId,p_known:request.method==='GET'&&/^[a-f0-9]{32}$/.test(request.headers.get('if-none-match')??'')?request.headers.get('if-none-match'):null});
    if(error) return reply({error:'Session Health is unavailable. Scoring remains available.'},503);
    if(!data) return reply({error:'Session unavailable.'},404);
    // Reuse the database's current connection/permission authority, not historical samples.
    const permission = await db.rpc('garmin_hr_owner_access',{p_source:'activity'});
    const authorized = data.authorized === true && !permission.error && permission.data === true;
    if(!authorized) return reply({...data,authorized:false,unchanged:false,recording:null,candidates:[],datasets:[]});
    if(data.unchanged&&request.method==='GET')return new Response(null,{status:304,headers});
    return reply({...data,authorized:true});
  } catch {return reply({error:'Session Health could not be loaded. Please retry.'},400);}
}
