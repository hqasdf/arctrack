import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { createAuthClient } from '@/lib/supabase/server';
import { getAuthConfig } from '@/lib/auth/config';
import { uuid } from './http.server';
/** Private Realtime bridge: existing HttpOnly authentication stays server-only. */
export async function liveCoachingEvents(request:Request){
 const query=new URL(request.url).searchParams,id=query.get('id'),org=query.get('organizationId');if(!uuid(id)||org!==null&&!uuid(org))return new Response(null,{status:400});
 const config=getAuthConfig();if(!config)return new Response(null,{status:503});
 const auth=await createAuthClient();const user=await auth.auth.getUser();if(user.error||!user.data.user)return new Response(null,{status:401});
 const access=await auth.rpc('live_coaching_view_access',{p_id:id,p_org:org});if(access.error||access.data!==true)return new Response(null,{status:403});
 const session=await auth.auth.getSession();const token=session.data.session?.access_token;if(!token)return new Response(null,{status:401});
 const client=createClient(config.url,config.publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 await client.realtime.setAuth(token);
 let cleanup=()=>{};
 const stream=new ReadableStream<Uint8Array>({start(controller){
  let closed=false,checking=false;const encoder=new TextEncoder();
  const send=(event:string,data:unknown={})=>{if(!closed)controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));};
  const channel=client.channel(`live-coaching:${id}:${user.data.user!.id}`,{config:{private:true}}).on('broadcast',{event:'changed'},()=>send('change')).subscribe(status=>{send('connection',{connected:status==='SUBSCRIBED'});if(status==='SUBSCRIBED')send('change');});
  const heartbeat=setInterval(async()=>{if(checking||closed)return;checking=true;try{const result=await auth.rpc('live_coaching_view_access',{p_id:id,p_org:org});if(result.error||result.data!==true){send('revoked');cleanup();}else send('heartbeat');}catch{send('revoked');cleanup();}finally{checking=false;}},15000);
  const lifetime=setTimeout(()=>cleanup(),55000);
  cleanup=()=>{if(closed)return;closed=true;clearInterval(heartbeat);clearTimeout(lifetime);request.signal.removeEventListener('abort',cleanup);void client.removeChannel(channel);try{controller.close();}catch{/* The consumer may already have cancelled the stream. */}};
  request.signal.addEventListener('abort',cleanup,{once:true});controller.enqueue(encoder.encode('retry: 1500\n\n'));if(request.signal.aborted)cleanup();
 },cancel(){cleanup();}});
 return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'private, no-store','X-Accel-Buffering':'no','Referrer-Policy':'no-referrer'}});
}
