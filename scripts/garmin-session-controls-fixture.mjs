/** Activity-only association regressions in a disposable database. */
export async function testSessionControlConcurrency(db, Client, configuration, check) {
 const owner='92000000-0000-4000-8000-000000000001',other='92000000-0000-4000-8000-000000000002';
 const sessions=['92000000-0000-4000-8000-000000000010','92000000-0000-4000-8000-000000000020','92000000-0000-4000-8000-000000000030'];
 const clients=[new Client(configuration),new Client(configuration)];
 const link=async(c,id,activity,expected=null)=>(await c.query('select public.set_session_garmin_activity($1,$2,$3) value',[id,activity,expected])).rows[0].value;
 const read=async(c,id)=>(await c.query('select public.read_session_garmin_activity($1) value',[id])).rows[0].value;
 async function rejects(work,code,label){let error;try{await work();}catch(e){error=e;}check(error?.code===code,label);}
 try{
  await db.query('reset role');
  check((await db.query("select to_regprocedure('public.set_session_recording_window(uuid,text,timestamptz,timestamptz,timestamptz,text)') is null gone")).rows[0].gone,'Timer RPC is removed rather than hidden');
  check((await db.query("select not has_table_privilege('authenticated','private.retired_session_recording_windows','SELECT') denied")).rows[0].denied,'Historical timestamps are not exposed to clients');
  check((await db.query("select not has_column_privilege('service_role','private.retired_session_recording_windows','started_at','SELECT') denied")).rows[0].denied,'Archive cleanup does not expose timestamps');
  check((await db.query("select not has_table_privilege('authenticated','public.session_garmin_activity_links','INSERT') and not has_table_privilege('authenticated','public.sessions','UPDATE') safe")).rows[0].safe,'Association RPC does not grant direct writes or scoring UPDATE');
  check((await db.query("select prosecdef and proconfig @> array['search_path=\"\"','lock_timeout=2s'] and has_function_privilege('authenticated',oid,'EXECUTE') and not has_function_privilege('anon',oid,'EXECUTE') and not has_function_privilege('service_role',oid,'EXECUTE') safe from pg_proc where oid='public.set_session_garmin_activity(uuid,text,timestamptz)'::regprocedure")).rows[0].safe,'Privileged association writer has fixed search path, bounded locking and authenticated-only execution');
  await db.query("insert into auth.users values($1,'activity-owner@example.invalid'),($2,'activity-other@example.invalid')",[owner,other]);
  for(const id of sessions)await db.query("insert into public.sessions values($1,$2,'Activity-only Session',0)",[id,owner]);
  await db.query("update public.sessions set session_date='2026-10-26' where id=$1",[sessions[2]]);
  await db.query(`insert into public.garmin_connections(user_id,garmin_user_id,status,token_ciphertext,access_expires_at,refresh_after,authorized_at,permissions)
   values($1,'activity-owner','connected','synthetic',now()+interval '1 day',now()+interval '1 day','2026-10-23','["HEALTH_EXPORT","ACTIVITY_EXPORT"]')`,[owner]);
  for(const [id,start,duration] of [['activity-day',1792882800,3600],['activity-midnight',1792942200,5400]]){
   await db.query(`select public.admit_garmin_health_push(jsonb_build_array(jsonb_build_object('garminUserId','activity-owner','kind','activities','sourceId',$1::text,'recordKey',$1::text,'hash',md5($1)||md5($1),'calendarDate','2026-10-25','startTimeInSeconds',$2::bigint,'durationInSeconds',$3::integer,'values','{"activityType":"ARCHERY"}'::jsonb)))`,[id,start,duration]);
   await db.query('select public.process_garmin_health_queue(50)');
  }
  for(const c of clients){await c.connect();await c.query('set role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);}
  const [a,b]=clients,pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
  const empty=await read(a,sessions[0]);check(empty.candidates.length===2&&!empty.link&&!empty.recording&&empty.datasets.length===0,'Date discovery requires no manual interval and never automatically links');
  check((await read(a,sessions[2])).candidates.some(c=>c.source_id==='activity-midnight'),'Cross-midnight recording appears on both Singapore dates');
  await a.query('begin');const first=await link(a,sessions[0],'activity-day');
  const competing=link(b,sessions[0],'activity-midnight').then(value=>({value}),error=>({error}));
  let blocked=false;for(let i=0;i<100;i++){if((await db.query('select cardinality(pg_blocking_pids($1))>0 blocked',[pid])).rows[0].blocked){blocked=true;break;}await new Promise(resolve=>setImmediate(resolve));}
  check(blocked,'Independent first-link requests serialize on the Session');await a.query('commit');
  check((await competing).error?.code==='40001','Concurrent first link is rejected as stale');
  let current=await read(a,sessions[0]);check(current.recording.start_seconds===1792882800&&current.recording.duration_seconds===3600,'Interval comes directly from Garmin activity timestamps');
  check(!('window' in current)&&!('started_at' in first),'Current contract contains no manual window');check(current.datasets.length===0,'Summary-only activity cannot fabricate HR');
  const changed=await link(a,sessions[0],'activity-midnight',first.updated_at);
  await rejects(()=>link(a,sessions[0],null,first.updated_at),'40001','Stale unlink cannot overwrite a later selection');
  await link(a,sessions[0],null,changed.updated_at);current=await read(a,sessions[0]);check(!current.recording&&current.datasets.length===0,'Unlink does not guess another activity or interval');
  await rejects(()=>link(a,sessions[1],'unrelated-provider-id'),'42501','Unknown or foreign activity is rejected');
  await b.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);check(await read(b,sessions[0])===null,'Other athlete cannot read Session HR');
  await rejects(()=>link(b,sessions[0],'activity-day'),'42501','Other athlete cannot write associations');
  await link(a,sessions[2],'activity-midnight');
  await db.query('delete from public.sessions where id=$1',[sessions[2]]);
  check((await db.query('select count(*)::int n from public.session_garmin_activity_links where session_id=$1',[sessions[2]])).rows[0].n===0,'Session deletion cascades its activity association');
  check((await db.query('select count(*)::int n from public.sessions where id=any($1::uuid[])',[sessions.slice(0,2)])).rows[0].n===2,'Session deletion preserves other scorecards');
  const syntheticSummaries=(await db.query('select * from public.garmin_health_records where user_id=$1',[owner])).rows;
  await db.query("update public.garmin_connections set permissions='[\"HEALTH_EXPORT\"]' where user_id=$1",[owner]);
  current=await read(a,sessions[0]);check(!current.authorized&&current.candidates.length===0&&current.datasets.length===0,'Revoked activity permission removes discovery and HR access');
  await rejects(()=>link(a,sessions[1],'activity-day'),'42501','Revoked permission prevents association writes');
  await db.query("update public.garmin_connections set permissions='[\"HEALTH_EXPORT\",\"ACTIVITY_EXPORT\"]' where user_id=$1",[owner]);
  // Revocation correctly erased these fixtures. Restore only this disposable user's
  // summaries to represent a later authorized delivery before testing pause/deletion.
  await db.query('insert into public.garmin_health_records select * from jsonb_populate_recordset(null::public.garmin_health_records,$1)',[JSON.stringify(syntheticSummaries)]);
  const pausedLink=await link(a,sessions[1],'activity-day');
  await db.query('update public.garmin_health_controls set paused=true where user_id=$1',[owner]);
  current=await read(a,sessions[1]);check(current.paused&&current.recording?.source_id==='activity-day','Pause preserves authorized previously imported recordings');
  await db.query('update public.garmin_health_controls set generation=gen_random_uuid() where user_id=$1',[owner]);
  current=await read(a,sessions[1]);check(!current.recording&&current.datasets.length===0,'Generation change fences the old association without guessing a recording');
  await link(a,sessions[1],'activity-day',pausedLink.updated_at);
  await db.query("insert into private.retired_session_recording_windows(session_id,user_id,started_at,finished_at,activity_id) values($1,$2,'2026-10-25 01:00Z','2026-10-25 02:00Z','activity-day')",[sessions[1],owner]);
  await db.query('set role service_role');
  await db.query('update public.garmin_health_controls set deleted_at=clock_timestamp() where user_id=$1',[owner]);
  await db.query('reset role');
  check((await db.query('select count(*)::int n from public.session_garmin_activity_links where user_id=$1',[owner])).rows[0].n===0,'Health deletion removes activity associations');
  check((await db.query('select count(*)::int n from public.garmin_connections where user_id=$1 and status=\'connected\'',[owner])).rows[0].n===1,'Health deletion preserves the OAuth connection');
  check((await db.query("select activity_id is null and started_at='2026-10-25 01:00Z'::timestamptz and finished_at='2026-10-25 02:00Z'::timestamptz safe from private.retired_session_recording_windows where session_id=$1",[sessions[1]])).rows[0].safe,'Health deletion clears archived imported IDs while preserving historical timestamps');
  const saved=await link(a,sessions[1],'activity-day');
  await db.query('begin');await db.query('select user_id from public.garmin_connections where user_id=$1 for update',[owner]);
  const pending=link(a,sessions[1],'activity-midnight',saved.updated_at).then(value=>({value}),error=>({error}));
  await db.query("update public.garmin_connections set status='disconnected',token_ciphertext=null where user_id=$1",[owner]);await db.query('commit');
  check(['42501','40001'].includes((await pending).error?.code),'In-flight linking cannot outlive completed disconnect');
  check((await db.query('select count(*)::int n from public.session_garmin_activity_links where user_id=$1',[owner])).rows[0].n===0,'Disconnect erases associations without altering scores');
 }finally{try{await db.query('rollback');await db.query('reset role');}catch{}for(const c of clients){try{await c.query('rollback');await c.end();}catch{}}}
}
