/** Session controls under production-equivalent read-only scoring grants. */
export async function testSessionControlConcurrency(db, Client, configuration, check) {
 const owner='92000000-0000-4000-8000-000000000001',other='92000000-0000-4000-8000-000000000002';
 const sessions=['92000000-0000-4000-8000-000000000010','92000000-0000-4000-8000-000000000020','92000000-0000-4000-8000-000000000030'];
 const clients=Array.from({length:3},()=>new Client(configuration));
 const connected=[];
 const [a,b,c]=clients;
 const rpc=async(client,session,action,expected=null,start=null,finish=null,activity=null)=>(await client.query(
  'select public.set_session_recording_window($1,$2,$3,$4,$5,$6) value',[session,action,expected,start,finish,activity])).rows[0].value;
 const revision=async session=>(await db.query("select to_jsonb(w)->>'updated_at' revision from public.session_recording_windows w where session_id=$1",[session])).rows[0]?.revision;
 async function rejected(work,code,label){let error;try{await work();}catch(e){error=e;}check(error?.code===code,label);}
 function launch(client,sql,args){const work={settled:false};work.result=client.query(sql,args).then(data=>({data}),error=>({error})).then(result=>{work.settled=true;return result;});return work;}
 async function blocked(pid,work){
  const deadline=Date.now()+8000;
  while(Date.now()<deadline){
   if(work.settled)throw Error('Competing Session operation did not wait on its transaction lock');
   const result=await db.query('select cardinality(pg_blocking_pids($1))>0 blocked',[pid]);
   if(result.rows[0].blocked)return;
   await new Promise(resolve=>setImmediate(resolve));
  }
  throw Error('Session transaction lock was not observed');
 }
 try {
  await db.query('reset role');
  check((await db.query("select has_table_privilege('authenticated','public.sessions','SELECT') s,has_any_column_privilege('authenticated','public.sessions','UPDATE') u,has_table_privilege('authenticated','public.sessions','INSERT') i,has_table_privilege('authenticated','public.sessions','DELETE') d")).rows.every(r=>r.s&&!r.u&&!r.i&&!r.d),
   'Session fixture matches production SELECT-only authenticated scoring grants');
  const fn=(await db.query("select prosecdef,proconfig,has_function_privilege('authenticated',oid,'EXECUTE') allowed,has_function_privilege('anon',oid,'EXECUTE') anonymous from pg_proc where oid='public.set_session_recording_window(uuid,text,timestamptz,timestamptz,timestamptz,text)'::regprocedure")).rows[0];
  check(!fn.prosecdef&&fn.allowed&&!fn.anonymous&&fn.proconfig.includes('search_path=""'),'Session controls retain restricted SECURITY INVOKER and fixed search path');
  await db.query("insert into auth.users values($1,'controls-owner@example.invalid'),($2,'controls-other@example.invalid')",[owner,other]);
  for(const session of sessions)await db.query("insert into public.sessions values($1,$2,'Session controls',0)",[session,owner]);
  await db.query(`insert into public.garmin_connections(user_id,garmin_user_id,status,token_ciphertext,access_expires_at,refresh_after,authorized_at,permissions)
   values($1,'controls-garmin','connected','synthetic',now()+interval '1 day',now()+interval '1 day','2026-10-23','["HEALTH_EXPORT","ACTIVITY_EXPORT"]')`,[owner]);
  await db.query(`select public.admit_garmin_health_push(jsonb_build_array(jsonb_build_object('garminUserId','controls-garmin','kind','activities',
   'sourceId','controls-activity','recordKey','controls-activity','hash',repeat('a',64),'calendarDate','2026-10-25','startTimeInSeconds',1792882800,
   'durationInSeconds',3600,'values','{"activityType":"ARCHERY"}'::jsonb)));select public.process_garmin_health_queue(50);`);
  for(const client of clients){await client.connect();connected.push(client);await client.query('set role authenticated');await client.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);}
  const pids=await Promise.all(clients.map(async client=>(await client.query('select pg_backend_pid() pid')).rows[0].pid));

  await a.query('begin');
  const first=await rpc(a,sessions[0],'start');
  check(!!first.started_at&&!first.finished_at,'Previously failing production-equivalent Start Session operation now succeeds');
  const competing=launch(b,'select public.set_session_recording_window($1,\'start\',null)',[sessions[0]]);
  await blocked(pids[1],competing);
  check(true,'Competing first-window creation waits on the same Session transaction');
  const independent=await rpc(c,sessions[1],'start');
  check(!!independent.started_at,'Different Sessions do not share a broad global lock');
  await a.query('commit');
  check((await competing.result).error?.code==='40001','Competing first-window creation is rejected as stale instead of overwriting');
  check((await db.query('select count(*)::int n from public.session_recording_windows where session_id=$1',[sessions[0]])).rows[0].n===1,'Concurrent creation leaves one authoritative recording window');
  const finished=await rpc(a,sessions[0],'finish',first.updated_at);
  check(!!finished.finished_at&&Date.parse(finished.finished_at)>=Date.parse(finished.started_at),'Finish succeeds under SELECT-only Session grants after transaction lock release');
  const manual=await rpc(a,sessions[0],'manual',finished.updated_at,'2026-10-24T23:05:00Z','2026-10-24T23:30:00Z');
  const updated=await rpc(a,sessions[0],'manual',manual.updated_at,'2026-10-24T23:05:00Z','2026-10-24T23:40:00Z');
  check(updated.updated_at!==manual.updated_at&&Date.parse(updated.finished_at)>Date.parse(manual.finished_at),'Manual interval creation and update advance the authoritative revision');
  await rejected(()=>rpc(b,sessions[0],'manual',manual.updated_at,'2026-10-24T23:05:00Z','2026-10-25T03:00:00Z'),'40001','Stale manual update cannot overwrite the latest interval');
  await rejected(()=>rpc(a,sessions[0],'manual',updated.updated_at,'2026-10-25T03:00:00Z','2026-10-25T01:00:00Z'),'23514','Invalid interval fails atomically');
  check(await revision(sessions[0])===updated.updated_at,'Failed interval leaves the recording-window revision unchanged');
  const linked=await rpc(a,sessions[0],'link',updated.updated_at,null,null,'controls-activity');
  check(linked.activity_id==='controls-activity','Owned overlapping Garmin activity links under actual authenticated permissions');
  await a.query('begin');
  const unlinked=await rpc(a,sessions[0],'unlink',linked.updated_at);
  const competingLink=launch(b,'select public.set_session_recording_window($1,\'link\',$2,null,null,\'controls-activity\')',[sessions[0],linked.updated_at]);
  await blocked(pids[1],competingLink);await a.query('commit');
  check(unlinked.activity_id===null&&(await competingLink.result).error?.code==='40001','Unlink and competing Link serialize and reject a stale association');
  await rejected(()=>rpc(a,sessions[0],'link',unlinked.updated_at,null,null,'unknown-activity'),'42501','Unowned or missing activity cannot be linked');

  // Model a coach-visible parent Session separately from private HR ownership.
  await db.query(`create policy session_controls_fixture_coach_read on public.sessions for select to authenticated
   using((select auth.uid())='92000000-0000-4000-8000-000000000002'::uuid and user_id='92000000-0000-4000-8000-000000000001'::uuid)`);
  await b.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
  check((await b.query('select count(*)::int n from public.sessions where id=$1',[sessions[0]])).rows[0].n===1,'Fixture coach can read the parent scoring Session');
  await rejected(()=>rpc(b,sessions[0],'unlink',unlinked.updated_at),'42501','Coach-visible Session still cannot grant private timing or activity-write ownership');
  check((await b.query('select public.read_session_garmin_hr($1) value',[sessions[0]])).rows[0].value===null,'Coach-visible Session does not expose private Session HR');
  await rejected(()=>rpc(a,'92000000-0000-4000-8000-000000000099','start'),'42501','Missing Session cannot create an orphaned window');

  const deletePid=(await db.query('select pg_backend_pid() pid')).rows[0].pid;
  await a.query('begin');await rpc(a,sessions[2],'start');
  const deletion=launch(db,'delete from public.sessions where id=$1',[sessions[2]]);
  // The parent FK/key-share lock waits for the in-flight child insert.
  const deadline=Date.now()+8000;
  let deleteBlocked=false;
  while(Date.now()<deadline&&!deletion.settled){if((await c.query('select cardinality(pg_blocking_pids($1))>0 blocked',[deletePid])).rows[0].blocked){deleteBlocked=true;break;}await new Promise(resolve=>setImmediate(resolve));}
  check(deleteBlocked,'Concurrent Session deletion waits for the inserted recording-window FK');
  await a.query('commit');const deletionResult=await deletion.result;
  check(!deletionResult.error&&(await db.query('select count(*)::int n from public.session_recording_windows where session_id=$1',[sessions[2]])).rows[0].n===0,'Session deletion cascades the recording window without orphaned records');
  await rejected(()=>rpc(a,sessions[2],'start'),'42501','Deleted Session cannot be recreated through Session HR controls');
  check((await c.query("select count(*)::int n from pg_locks where locktype='advisory' and pid=any($1::int[])",[pids])).rows[0].n===0,'Successful and failed controls leave no transaction advisory locks behind');
  check(!(await c.query("select has_any_column_privilege('authenticated','public.sessions','UPDATE') allowed")).rows[0].allowed,'Session control tests never broaden authenticated scoring privileges');
 } finally {
  for(const client of connected){try{await client.query('rollback');}catch{}try{await client.end();}catch{}}
  await db.query('reset role');
  await db.query('drop policy if exists session_controls_fixture_coach_read on public.sessions');
 }
}
