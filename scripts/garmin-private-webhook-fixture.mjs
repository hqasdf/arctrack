/** Maintained synthetic HTTP -> native PostgreSQL -> owner reader regression. */
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createIngress} from '../infra/garmin-ingress/worker.mjs';
const require=createRequire(import.meta.url);
async function load(path,deps={}){
 const code=ts.transpileModule(await readFile(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const exports={};new Function('require','exports',code)(name=>{if(name in deps)return deps[name];if(name==='server-only')return {};if(name==='react'||name==='react/jsx-runtime')return require(name);if(name.endsWith('.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>key})};if(name.startsWith('node:'))return require(name);throw Error('Unexpected isolated webhook import');},exports);return exports;
}
export async function testPrivateWebhookDatabase(db,check){
 const user='91000000-0000-4000-8000-000000000001',other='91000000-0000-4000-8000-000000000002';
 const secret=randomBytes(32).toString('hex'),workerSecret=randomBytes(32).toString('hex');
 const previous=process.env.GARMIN_HEALTH_WEBHOOK_SECRET;
 process.env.GARMIN_HEALTH_WEBHOOK_SECRET=secret;
 let server;
 try {
  await db.query(`insert into auth.users values($1,'webhook@example.invalid'),($2,'other-webhook@example.invalid')`,[user,other]);
  await db.query(`insert into public.garmin_connections(user_id,garmin_user_id,status,token_ciphertext,access_expires_at,refresh_after,authorized_at,permissions)
   values($1,'synthetic-webhook-provider','connected','synthetic',now()+interval '1 day',now()+interval '1 day',now(),'["HEALTH_EXPORT","ACTIVITY_EXPORT"]')`,[user]);
  const model=await load('src/features/health/model.ts');
  const normalize=await load('src/features/garmin/health/normalize.server.ts',{'@/features/health/model':model});
  // Bridge the unchanged Supabase store contract to actual local SQL, not an in-memory inbox.
  const store=await load('src/features/garmin/health/store.server.ts',{'@/lib/supabase/admin.server':{createAdminClient:()=>({rpc:async(name,args)=>{
   try{
    let result;
    if(name==='stage_garmin_health_push')result=await db.query('select public.stage_garmin_health_push($1::jsonb,$2::uuid[]) as value',[JSON.stringify(args.p_events),args.p_allowed_users]);
    else if(name==='process_garmin_health_queue')result=await db.query('select public.process_garmin_health_queue($1::uuid[],$2) as value',[args.p_allowed_users,args.p_limit]);
    else throw Error('Unexpected RPC');
    return {data:result.rows[0].value,error:null};
   }catch{return {data:null,error:{code:'synthetic-sql-failure'}};}
  }})}});
  const config={garminHealthEnabled:()=>false,garminHealthTestUsers:()=>[]};
  const http=await load('src/features/garmin/health/http.server.ts',{'next/server':{after:()=>{}},'./config.server':config,'./normalize.server':normalize,'./store.server':store});
  const ingressHttp=await load('src/features/garmin/health/ingress.server.ts',{'next/server':{after:()=>{}},'./config.server':config,'./store.server':store,'./private-push.server':await load('src/features/garmin/health/private-push.server.ts',{'next/server':{after:()=>{}},'./config.server':config,'./store.server':store,'./http.server':http})});
  const forwardKey=randomBytes(32).toString('hex');
  const internal=ingressHttp.createGarminIngressReceiver({enabled:true,secret:forwardKey,allowedUsers:[user],inbox:store.createGarminHealthInbox,schedule:()=>{}});
  const privateHttp=await load('src/features/garmin/health/private-push.server.ts',{'next/server':{after:()=>{}},'./config.server':config,'./store.server':store,'./http.server':http});
  const receive=privateHttp.createPrivateGarminPushReceiver({enabled:true,secret:process.env.GARMIN_HEALTH_WEBHOOK_SECRET,allowedUsers:[user],inbox:store.createGarminHealthInbox,schedule:()=>{}});
  const worker=http.createGarminHealthWorker({enabled:true,verifierReady:true,secret:workerSecret,users:[user],inbox:store.createGarminHealthInbox});
  server=createServer(async(incoming,outgoing)=>{
   try{
    const url=new URL(incoming.url,'http://127.0.0.1');
    const request=new Request(url,{method:incoming.method,headers:incoming.headers,...(incoming.method==='POST'?{body:Readable.toWeb(incoming),duplex:'half'}:{})});
    const response=url.pathname==='/internal'?await internal(request):url.pathname==='/worker'?await worker(request):url.pathname==='/push'?await http.garminHealthPush(request):await receive(request,url.pathname.split('/')[2]);
    outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end(await response.text());
   }catch{outgoing.writeHead(503);outgoing.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const daily={userId:'synthetic-webhook-provider',summaryId:'http-daily',calendarDate:'2026-10-23',startTimeInSeconds:1792713600,durationInSeconds:86400,steps:450};
  const send=async(path,value={dailies:[daily]},method='POST',headers={})=>{
   try{return await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify(value)}:{})});}
   catch{throw Error('Synthetic loopback request failed; URL withheld.');}
  };
  await db.query('set role service_role');
  check((await send('/private/'+secret)).status===200,'Private HTTP authenticates and durably stages a synthetic daily');
  check((await db.query('select count(*)::int as n from public.garmin_health_inbox')).rows[0].n===1,'Receipt exists in PostgreSQL before worker runs');
  check((await db.query('select count(*)::int as n from public.garmin_health_records')).rows[0].n===0,'Acknowledgment does not pretend measurement processing completed');
  check((await send('/private/'+secret)).status===200,'Duplicate private HTTP delivery safely acknowledges');
  check((await send('/private/'+secret,{dailies:[{...daily,userId:'unknown-provider'}]})).status===200,'Unknown Garmin identity is safely ignored');
  check((await db.query('select count(*)::int as n from public.garmin_health_inbox')).rows[0].n===1,'Duplicate and unknown-user requests create no extra receipts');
  check((await send('/private/wrong')).status===401&&(await send('/private')).status===401,'Real HTTP rejects wrong and missing capabilities');
  check((await send('/push')).status===503,'Original HTTP endpoint cannot bypass capability authentication');
  check((await send('/private/'+secret,{})).status===400,'Real HTTP rejects invalid payload with a valid capability');
  check((await send('/worker',null,'GET')).status===401,'Scheduled worker refuses missing authentication');
  check((await send('/worker',null,'GET',{Authorization:'Bearer '+workerSecret})).status===200,'Authenticated HTTP worker processes the durable inbox');
  check((await db.query('select metrics->>\'steps\' as steps from public.garmin_health_records')).rows[0].steps==='450','Private database measurement preserves the synthetic 450 steps');
  await db.query('reset role');
  const gateway=createIngress({target:origin+'/internal'});
  const gatewayEnv={INGRESS_ENABLED:'true',GARMIN_ENDPOINT_SECRET:secret,GARMIN_FORWARD_KEY:forwardKey,
    LIMITS:{idFromName:id=>id,get:()=>({fetch:async url=>new Response(url.endsWith('/reserve')?'synthetic-ticket':null,{status:url.endsWith('/reserve')?200:204})})}};
  const gatewayRequest=()=>new Request('https://ingress.invalid/garmin/'+secret,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({dailies:[{...daily,summaryId:'gateway-daily',calendarDate:'2026-10-25',startTimeInSeconds:daily.startTimeInSeconds+172800,steps:725}]})});
  await db.query('set role service_role');
  check((await gateway(gatewayRequest(),gatewayEnv)).status===200,'Cloudflare adapter -> fixed authenticated HTTP receiver -> real SQL inbox');
  check((await db.query("select count(*)::int n from public.garmin_health_inbox where source_id='gateway-daily' and state='pending'")).rows[0].n===1,'Gateway acknowledgment precedes durable processing');
  check((await send('/internal',{},'POST')).status===401,'Direct fixed endpoint rejects missing server authentication');
  check((await send('/internal',{},'POST',{Authorization:'Bearer '+forwardKey})).status===400,'Authenticated internal receiver preserves strict payload validation');
  check((await gateway(gatewayRequest(),gatewayEnv)).status===200,'Gateway replay safely acknowledges without a duplicate receipt');
  await db.query('reset role');
  await (await import('./garmin-scheduler-fixture.mjs')).testScheduler(db,check,async(headers)=>send('/worker',null,'GET',headers),workerSecret,user);
  const authClient={from(table){
   const filters={};let single=false;
   const builder={select:()=>builder,eq:(key,value)=>{filters[key]=value;return builder;},gte:(_key,value)=>{filters.start=value;return builder;},lte:(_key,value)=>{filters.end=value;return builder;},order:()=>builder,limit:()=>builder,maybeSingle:()=>{single=true;return builder;},then(resolve,reject){
    const query=table==='garmin_health_records'?db.query(`select kind,source_id,record_key,calendar_date::text,start_seconds,duration_seconds,metrics,imported_at,updated_at from public.garmin_health_records where user_id=$1 and calendar_date between $2 and $3 order by calendar_date desc,updated_at desc limit 10000`,[filters.user_id,filters.start,filters.end]):db.query('select state,last_received_at,last_processed_at,error_code,granted_permissions from public.garmin_health_sync_state where user_id=$1',[filters.user_id]);
    return query.then(result=>({data:single?result.rows[0]??null:result.rows.map(row=>({...row,updated_at:row.updated_at.toISOString(),imported_at:row.imported_at.toISOString()})),error:null})).then(resolve,reject);
   }};return builder;
  }};
  const reader=await load('src/features/garmin/health/read.server.ts',{'@/lib/supabase/server':{createAuthClient:async()=>authClient},'@/features/health/model':model,'./config.server':{garminHealthEnabled:()=>true}});
  const dashboard=await load('src/features/garmin/health/dashboard.ts',{'@/features/health/model':model});
  await db.query('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
  const read=await reader.readGarminHealth(user,'2026-10-23');
  check(!read.unavailable&&read.records.length===1&&dashboard.garminHealthDataset(read.records,null).days[0].steps===450,'Actual Health reader and dashboard mapping return 450 under owner RLS');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
  const denied=await reader.readGarminHealth(user,'2026-10-23');
  check(!denied.unavailable&&denied.records.length===0,'RLS hides the first owner data even when another user requests that owner ID');
  await db.query('reset role');await db.query('set role service_role');
  check((await send('/private/'+secret,{dailies:[{...daily,summaryId:'http-daily-correction',steps:500}]})).status===200,
   'A same-window correction is durably acknowledged for explicit reconciliation');
  await send('/worker',null,'GET',{Authorization:'Bearer '+workerSecret});
  check((await db.query("select state,error_code from public.garmin_health_inbox where source_id='http-daily-correction'")).rows.some(row=>row.state==='conflict'&&row.error_code==='ambiguous_update'),
   'Equal-duration corrections remain quarantined rather than falsely advertised as an automatic update');
  check((await db.query("select metrics->>'steps' as steps from public.garmin_health_records where calendar_date='2026-10-23'")).rows[0].steps==='450',
   'Ambiguous correction does not overwrite the known 450-step record');
  check((await send('/private/'+secret,{dailies:[{...daily,summaryId:'http-next-day',calendarDate:'2026-10-24',startTimeInSeconds:daily.startTimeInSeconds+86400,steps:600}]})).status===200,
   'A later distinct daily reaches the same durable HTTP pipeline');
  await send('/worker',null,'GET',{Authorization:'Bearer '+workerSecret});
  await db.query('reset role');await db.query('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
  const synced=await reader.readGarminHealth(user,'2026-10-25');
  check(dashboard.garminHealthDataset(synced.records,null).days.find(day=>day.date==='2026-10-25')?.steps===725,'Scheduled ingress record reaches the genuine owner Health reader and dashboard');
  const icon=await load('src/components/ui/icon.tsx');
  const chart=await load('src/features/health/components/health-chart.tsx',{'../model':model});
  const cards=await load('src/features/health/components/health-cards.tsx',{'../model':model,'@/components/ui/icon':icon,
    'next/link':{__esModule:true,default:props=>React.createElement('a',props)}});
  const control=await load('src/features/garmin/components/garmin-connection-card.tsx',{
    'next/image':{__esModule:true,default:props=>React.createElement('img',props)}});
  const ui=await load('src/features/health/components/health-dashboard.tsx',{'../model':model,'@/components/ui/icon':icon,
    './health-chart':chart,'./health-cards':cards,'@/features/garmin/components/garmin-connection-card':control,
    'next/navigation':{useRouter:()=>({refresh(){}})}});
  const html=renderToStaticMarkup(React.createElement(ui.HealthDashboard,{data:{today:'2026-10-25',
    dataset:dashboard.garminHealthDataset(synced.records,null),
    connection:{available:true,canConnect:true,status:'connected',permissions:[],authorizedAt:null,checkedAt:null,expiresAt:null,error:null},
    sync:{state:'received',lastReceivedAt:null,lastProcessedAt:null}}}));
  check(html.includes('725')&&html.includes('Garmin measurements')&&!html.includes('Demo Data'),
    'Actual Health Dashboard markup renders the scheduled private SQL measurement without a demo fallback');
  const next=await reader.readGarminHealth(user,'2026-10-24');
  check(!next.unavailable&&dashboard.garminHealthDataset(next.records,null).days.find(day=>day.date==='2026-10-24')?.steps===600,
   'Owner Health reader shows a subsequent distinct day while retaining the earlier known measurement');
 } finally {
  await db.query('reset role');
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  if(previous===undefined)delete process.env.GARMIN_HEALTH_WEBHOOK_SECRET;else process.env.GARMIN_HEALTH_WEBHOOK_SECRET=previous;
 }
}
