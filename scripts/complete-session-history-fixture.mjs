import {randomUUID} from 'node:crypto';
export async function testCompleteSessionHistory(db,pg,configuration){
 let passed=0;const check=(v,label)=>{if(!v)throw Error('Complete history: '+label);passed++;};
 const athlete=randomUUID(),coach=randomUUID(),other=randomUUID(),org=randomUUID(),round=randomUUID(),end=randomUUID(),arrow=randomUUID();
 const reader=new pg.Client(configuration),blocker=new pg.Client(configuration);
 const invoke=(client,actor,owner=null,organization=null,session=null,details=true)=>client.query('select public.read_complete_session_history_v1($1,$2,$3,$4,null,$5) value',[actor,owner,organization,session,details]).then(r=>r.rows[0].value);
 const denied=async fn=>{try{await fn();return false;}catch(e){return e.code==='42501';}};
 try{
  await db.query('insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6)',[athlete,'history-athlete@example.invalid',coach,'history-coach@example.invalid',other,'history-other@example.invalid']);
  await db.query('insert into public.organizations(id,name,created_by) values($1,$2,$3)',[org,'History fixture',coach]);
  await db.query("insert into public.organization_members(organization_id,user_id,role,status) values($1,$2,'head_coach','active'),($1,$3,'archer','active') on conflict(organization_id,user_id) do update set role=excluded.role,status=excluded.status",[org,coach,athlete]);
  await reader.connect();await blocker.connect();
  await reader.query('set role authenticated');await reader.query("select set_config('request.jwt.claim.sub',$1,false)",[athlete]);
  let previous=0;
  for(const n of [999,1000,1001,1501]){
   await db.query("insert into public.sessions(user_id,title,session_date,created_at,session_type,arrow_count) select $1,'History '||i,'2026-10-31','2026-10-31T00:00:00Z','training',120 from generate_series($2::int,$3::int) i",[athlete,previous+1,n]);previous=n;
   const value=await invoke(reader,athlete);
   check(value.items.length===n&&value.counts.sessions===n,`${n} Sessions complete in one scalar response`);
   check(new Set(value.items.map(s=>s.id)).size===n,'No duplicate Session IDs at old batch boundaries');
   check(value.items.every((s,i)=>i===0||value.items[i-1].id>s.id),'ID tie-breaker orders equal date/creation timestamps');
  }
  const initial=await invoke(reader,athlete),session=initial.items[0].id;
  await db.query("insert into public.session_rounds(id,session_id,round_number,name,division,distance_metres,face_diameter_cm,face_type,planned_ends,arrows_per_end) values($1,$2,1,'9 × 4','Recurve',30,80,'full_face',4,9)",[round,session]);
  await db.query('insert into public.session_ends(id,session_round_id,end_number) values($1,$2,1)',[end,round]);
  await db.query('insert into public.arrows(id,session_end_id,arrow_number,score_points,is_x,plot_x,plot_y) values($1,$2,1,10,true,0.1,0.2)',[arrow,end]);
  const partial=await invoke(reader,athlete);
  check(partial.counts.rounds===1&&partial.counts.ends===1&&partial.counts.arrows===1,'Independent nested persisted counts include partial custom Round');
  check(partial.items[0].arrow_count===120&&partial.items[0].session_rounds[0].session_ends[0].arrows[0].is_x,'Recorded Arrow volume remains independent of saved scoring');
  const index=await invoke(reader,athlete,null,null,null,false);
  check(index.items.length===1501&&index.counts.arrows===0&&!('session_rounds' in index.items[0]),'Complete Previous/Next index has no fake unloaded scoring arrays');
  check((await invoke(reader,athlete,null,null,session)).items.length===1,'Selected Session read remains owner scoped and complete');
  check(await denied(()=>invoke(reader,other)),'Changed account cannot use previous actor');
  check(await denied(()=>invoke(reader,athlete,other)),'Owner cannot request another account without Coach context');
  await reader.query("select set_config('request.jwt.claim.sub',$1,false)",[coach]);
  check((await invoke(reader,coach,athlete,org)).items.length===1501,'Active Head Coach can read full authorised athlete history');
  check(await denied(()=>invoke(reader,coach,other,org)),'Coach cannot request an athlete outside the selected organisation');
  await db.query("update public.organization_members set status='left',left_at=clock_timestamp() where organization_id=$1 and user_id=$2",[org,coach]);
  check(await denied(()=>invoke(reader,coach,athlete,org)),'Revoked Coach membership denies the next read');
  await reader.query("select set_config('request.jwt.claim.sub',$1,false)",[athlete]);
  // Hold the query before its STABLE function executes. A second connection
  // commits insert/delete/score correction after the reader's snapshot begins.
  const key=918231;await blocker.query('begin');await blocker.query('select pg_advisory_xact_lock($1)',[key]);
  const pending=reader.query('select public.read_complete_session_history_v1($1) value from (select pg_advisory_xact_lock($2)) gate',[athlete,key]);
  const pid=(await db.query("select pid from pg_stat_activity where wait_event='advisory' and query like 'select public.read_complete_session_history_v1%' limit 1")).rows[0]?.pid;
  let waiting=!!pid;for(let i=0;i<200&&!waiting;i++){waiting=(await db.query("select exists(select 1 from pg_stat_activity where wait_event='advisory' and query like 'select public.read_complete_session_history_v1%') ok")).rows[0].ok;await new Promise(r=>setImmediate(r));}
  check(waiting,'Concurrent test observes reader waiting after snapshot acquisition');
  await db.query('begin');
  await db.query('update public.arrows set score_points=9,is_x=false where id=$1',[arrow]);
  await db.query('delete from public.sessions where id=$1',[initial.items.at(-1).id]);
  await db.query("insert into public.sessions(user_id,title,session_date) values($1,'Concurrent insertion','2026-10-31')",[athlete]);
  await db.query('commit');await blocker.query('rollback');
  const snapshot=(await pending).rows[0].value;
  check(snapshot.items.length===1501&&snapshot.items[0].session_rounds[0].session_ends[0].arrows[0].score_points===10,'Concurrent changes cannot mix score/history snapshots');
  const after=await invoke(reader,athlete,null,null,session);
  check(after.items[0].session_rounds[0].session_ends[0].arrows[0].score_points===9,'Subsequent snapshot sees the scoring correction');
  check(!(await db.query("select has_function_privilege('anon','public.read_complete_session_history_v1(uuid,uuid,uuid,uuid,text,boolean)','EXECUTE') ok")).rows[0].ok,'Anonymous RPC execution denied');
  check(!(await db.query("select has_table_privilege('authenticated','public.sessions','UPDATE') ok")).rows[0].ok,'Existing SELECT-only Session update boundary preserved');
  await db.query("insert into public.session_rounds(session_id,round_number,name,division,distance_metres,face_diameter_cm,face_type,planned_ends,arrows_per_end) select $1,i,'Nested fixture','Recurve',30,80,'full_face',4,9 from generate_series(2,1002) i",[session]);
  await db.query('insert into public.session_ends(session_round_id,end_number) select id,1 from public.session_rounds where session_id=$1 and round_number>1',[session]);
  await db.query('insert into public.arrows(session_end_id,arrow_number,score_points,is_x) select e.id,1,9,false from public.session_ends e join public.session_rounds r on r.id=e.session_round_id where r.session_id=$1 and r.round_number>1',[session]);
  const nested=await invoke(reader,athlete,null,null,session);
  check(nested.counts.rounds===1002&&nested.counts.ends===1002&&nested.counts.arrows===1002,'Nested persisted counts exceed 1000 without losing child records');
  check(nested.items[0].session_rounds.length===1002&&nested.items[0].session_rounds.flatMap(r=>r.session_ends).flatMap(e=>e.arrows).length===1002,'Every nested Round, End and Arrow is present in the scalar response');
  await db.query("insert into public.sessions(user_id,title,session_date) select $1,'Budget fixture','2026-10-31' from generate_series(1,8500)",[athlete]);
  let budget=false,code='none';try{await invoke(reader,athlete);}catch(e){code=e.code;budget=e.code==='54000';}check(budget,'Oversize histories return a budget error, never a partial success (SQLSTATE '+code+')');
  return passed;
 }finally{
  await db.query('rollback');await blocker.query('rollback').catch(()=>{});await reader.end();await blocker.end();
  await db.query('delete from public.organizations where id=$1',[org]);
  await db.query('delete from auth.users where id=any($1::uuid[])',[[athlete,coach,other]]);
 }
}
