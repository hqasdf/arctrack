import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
export async function testArcheryDiscovery(db,check){
 await db.query(await readFile(new URL('../supabase/migrations/20261031055949_garmin_archery_activity_discovery.sql',import.meta.url),'utf8'));
 const owner=randomUUID(),other=randomUUID(),session=randomUUID(),second=randomUUID();
 await db.query('begin');
 try{
  await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)',[owner,'discovery@example.invalid',other,'other-discovery@example.invalid']);
  await db.query(`insert into public.garmin_connections(user_id,garmin_user_id,status,token_ciphertext,access_expires_at,refresh_after,authorized_at,permissions)
   values($1,$2,'connected','synthetic',now()+interval '1 day',now()+interval '1 day','2026-10-23','["HEALTH_EXPORT","ACTIVITY_EXPORT"]')`,[owner,owner]);
  for(const id of [session,second])await db.query("insert into public.sessions(id,user_id,title,session_date,arrow_count) values($1,$2,'Discovery','2026-10-31',0)",[id,owner]);
  await db.query(`insert into public.garmin_health_records(user_id,kind,record_key,source_id,calendar_date,start_seconds,duration_seconds,metrics,content_hash,received_sequence)
   select $1,'activities','discovery-'||i,'discovery-'||lpad(i::text,4,'0'),'2026-10-31',1793404800+i,60,
    jsonb_build_object('activityType',case when i<=450 then 'ARCHERY' else 'RUNNING' end),repeat('a',64),i from generate_series(1,550) i`,[owner]);
  check(!(await db.query("select has_function_privilege('anon','public.session_garmin_archery_candidates_v2(uuid,bigint,text)','EXECUTE') ok")).rows[0].ok,'Anonymous discovery execution denied');
  await db.query('set local role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
  check((await db.query("select public.garmin_hr_owner_access('activity') ok")).rows[0].ok,'Discovery fixture uses real owner permission authority');
  const first=(await db.query('select * from public.session_garmin_archery_candidates_v2($1)',[session])).rows;
  check(first.length===200&&first.every(r=>r.activity_type==='ARCHERY'),'Discovery filters unrelated sports before its bounded page limit');
  const next=(await db.query('select * from public.session_garmin_archery_candidates_v2($1,$2,$3)',[session,first.at(-1).start_seconds,first.at(-1).source_id])).rows;
  const last=(await db.query('select * from public.session_garmin_archery_candidates_v2($1,$2,$3)',[session,next.at(-1).start_seconds,next.at(-1).source_id])).rows;
  check(next.length===200&&last.length===50&&new Set([...first,...next,...last].map(r=>r.source_id)).size===450,'Keyset pagination discovers all 450 Archery activities without duplicates');
  check((await db.query('select count(*)::int n from public.session_garmin_archery_candidates_v2($1)',[second])).rows[0].n===200,'Same activities are available to another owned same-day Session');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[other]);
  check((await db.query('select * from public.session_garmin_archery_candidates_v2($1)',[session])).rows.length===0,'Foreign Session and activity discovery denied');
  await db.query('reset role');await db.query("update public.sessions set session_date='2026-11-01' where id=$1",[session]);
  await db.query('set local role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
  check((await db.query('select * from public.session_garmin_archery_candidates_v2($1)',[session])).rows.length===0,'Singapore start-date does not include a different day');
  await db.query('reset role');await db.query("update public.garmin_connections set status='reauthorization_required' where user_id=$1",[owner]);
  await db.query('set local role authenticated');
  check((await db.query('select * from public.session_garmin_archery_candidates_v2($1)',[second])).rows.length===0,'Expired Garmin authorization denies discovery');
 }finally{await db.query('rollback');}
}
