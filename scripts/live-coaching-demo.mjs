/** LOOPBACK SYNTHETIC DEMO ONLY. Invoked inside the owned disposable PG runner. */
import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';import {loadSessionModule} from '../tests/helpers/session-layout-runtime.mjs';import {newestRoundsFirst} from '@arc-track/core/round-order';
const {mapSession}=loadSessionModule('src/features/sessions/read.server.ts',{'server-only':{},'@/lib/auth/session.server':{},'@/lib/supabase/server':{},'@arc-track/core/round-order':{newestRoundsFirst}});
const {validateArrowInput}=loadSessionModule('src/features/sessions/validation.ts');
export async function runLiveDemo(owner,pg,configuration){
 pg.types.setTypeParser(1082,value=>value);
 const id=n=>'b1000000-0000-4000-8000-'+String(n).padStart(12,'0');const actors={coach:id(1),a:id(2),b:id(3)};const org=id(5),sessions={a:id(7),b:id(8)};
 await owner.query('reset role');await owner.query("update public.organization_members set status='active',left_at=null where organization_id=$1 and user_id=$2",[org,actors.b]);
 for(const [role,actor] of Object.entries(actors))await owner.query('insert into public.profiles(id,display_name) values($1,$2) on conflict(id) do update set display_name=excluded.display_name',[actor,role==='coach'?'Synthetic Coach':'Synthetic Athlete '+role.toUpperCase()]);
 await owner.query('delete from public.arrows where session_end_id in ($1,$2)',[id(11),id(12)]);
 const css=(await readFile('src/styles/globals.css','utf8'))+(await readFile('src/styles/theme.css','utf8'));
 const clients=new Set(),peers=new Set();const listener=new pg.Client(configuration);await listener.connect();await listener.query('listen fixture_live_changes');
 listener.on('notification',message=>{const {topic}=JSON.parse(message.payload);for(const peer of peers)if(peer.topic===topic)peer.response.write('event: change\ndata: {}\n\n');});
 const withActor=async(actor,work)=>{const c=new pg.Client(configuration);clients.add(c);await c.connect();try{await c.query('set role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);return await work(c);}finally{clients.delete(c);await c.end();}};
 const scoring=async(c,actor,sessionId)=>{const s=(await c.query('select * from public.sessions where id=$1 and user_id=$2',[sessionId,actor])).rows[0];if(!s)throw Error('Session unavailable');s.session_rounds=(await c.query('select * from public.session_rounds where session_id=$1',[s.id])).rows;for(const r of s.session_rounds){r.session_ends=(await c.query('select * from public.session_ends where session_round_id=$1 order by end_number',[r.id])).rows;for(const e of r.session_ends)e.arrows=(await c.query('select * from public.arrows where session_end_id=$1 order by arrow_number',[e.id])).rows;}return mapSession(s);};
 const server=createServer(async(request,response)=>{const url=new URL(request.url,'http://127.0.0.1:3218'),role=url.searchParams.get('role')??'coach',actor=actors[role];const json=(data,status=200)=>{response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(data));};
 try{
  if(!actor)return json({error:'Unknown synthetic identity'},403);
  if(url.pathname==='/bundle.js'){response.setHeader('Content-Type','text/javascript');response.end(await readFile('.verification/live-coaching-preview/bundle.js'));return;}
  if(url.pathname==='/api/live-coaching/events'){
   const live=url.searchParams.get('id');const allowed=await withActor(actor,async c=>(await c.query('select public.live_coaching_access($1) ok',[live])).rows[0].ok);if(!allowed)return json({error:'denied'},403);
   response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});response.write('event: connection\ndata: {"connected":true}\n\nevent: change\ndata: {}\n\n');const peer={topic:'live-coaching:'+live+':'+actor,response};peers.add(peer);request.on('close',()=>peers.delete(peer));return;
  }
  if(url.pathname==='/api/live-coaching'){
   if(request.method==='POST'){let raw='';for await(const chunk of request){raw+=chunk;if(raw.length>8192)throw Error('Too large');}const b=JSON.parse(raw);const value=await withActor(actor,async c=>(await c.query('select public.live_coaching_command($1,$2,$3,$4,$5,$6,$7,$8) id',[b.action,b.id??null,b.organizationId??null,b.title??null,b.date??null,b.athletes??[],b.scoringSessionId??null,b.expected??null])).rows[0].id);return json({id:value});}
   const value=await withActor(actor,async c=>(await c.query('select public.read_live_coaching($1,$2) value',[url.searchParams.get('id'),url.searchParams.get('organizationId')])).rows[0].value);if(value.participants)value.participants=value.participants.map(p=>({...p,scoring:p.scoring?mapSession(p.scoring):null}));return json(value);
  }
  if(url.pathname==='/demo/scoring')return json(await withActor(actor,c=>scoring(c,actor,sessions[role])));
  if(url.pathname==='/api/session-arrows'||url.pathname==='/demo/delete-arrow'){
   let raw='';for await(const chunk of request)raw+=chunk;const b=JSON.parse(raw);return json(await withActor(actor,async c=>{const end=(await c.query('select id from public.session_ends where session_round_id=$1 and end_number=$2',[b.roundId,b.endNumber])).rows[0];if(!end)throw Error('End not found');if(url.pathname.includes('delete')){await c.query('select public.delete_owned_arrow($1,$2)',[end.id,b.arrowNumber]);return {ok:true};}const valid=validateArrowInput(b);if(!valid.ok)return valid;const v=valid.value,p=v.plot;const a=(await c.query('select * from public.save_owned_arrow($1,$2,$3,$4,$5,$6,$7)',[end.id,v.arrowNumber,v.scorePoints,v.isX,p?.x??null,p?.y??null,p?.faceIndex??null])).rows[0];return {ok:true,data:{id:a.id,end:v.endNumber,arrow:a.arrow_number,score:a.is_x?'X':a.score_points===0?'M':String(a.score_points),plot:null,syncState:'saved'}};}));
  }
  response.setHeader('Content-Type','text/html');response.end(`<!doctype html><html data-theme="${url.searchParams.get('theme')==='dark'?'dark':'light'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main data-authenticated-theme style="max-width:1200px;margin:auto;padding:20px"><p>LOCAL SYNTHETIC DEMO ONLY · ${role} · disposable PostgreSQL, emulated Realtime transport</p><div id="app"></div></main><script src="/bundle.js"></script></body></html>`);
 }catch(error){json({error:'Synthetic operation denied: '+error.message},error.code==='42501'?403:409);}});
 await new Promise(resolve=>server.listen(3218,'127.0.0.1',resolve));console.log('DISPOSABLE LIVE DEMO READY http://127.0.0.1:3218/live-coaching?role=coach');
 await new Promise(resolve=>process.once('SIGINT',resolve));for(const peer of peers)peer.response.end();await new Promise(resolve=>server.close(resolve));for(const c of clients)await c.end();await listener.end();
}
