import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
export async function testActivityExclusions(db,check){
 await db.query(await readFile(new URL('../supabase/migrations/20261031050052_garmin_session_activity_exclusions.sql',import.meta.url),'utf8'));
 const owner=randomUUID(),other=randomUUID(),session=randomUUID();
 await db.query('begin');
 try{
 await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)',[owner,'exclusion-owner@example.invalid',other,'exclusion-other@example.invalid']);
 await db.query("insert into public.garmin_connections(user_id,status,permissions) values($1,'disconnected','[]')",[owner]);
 await db.query("insert into public.sessions(id,user_id,title,session_date,arrow_count) values($1,$2,'Exclusion fixture','2026-10-31',0)",[session,owner]);
 check(!(await db.query("select has_table_privilege('anon','public.session_garmin_activity_exclusions','SELECT') allowed")).rows[0].allowed,'Anonymous users cannot read exclusions');
 await db.query('set local role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
 await db.query('insert into public.session_garmin_activity_exclusions(session_id,user_id,activity_id) values($1,$2,$3) on conflict(session_id,activity_id) do update set user_id=excluded.user_id',[session,owner,'archery-one']);
 await db.query('insert into public.session_garmin_activity_exclusions(session_id,user_id,activity_id) values($1,$2,$3) on conflict(session_id,activity_id) do update set user_id=excluded.user_id',[session,owner,'archery-one']);
 check((await db.query('select count(*)::int n from public.session_garmin_activity_exclusions')).rows[0].n===1,'Owner exclusions are persistent and idempotent');
 await db.query("select set_config('request.jwt.claim.sub',$1,true)",[other]);
 check((await db.query('select count(*)::int n from public.session_garmin_activity_exclusions')).rows[0].n===0,'Other accounts cannot read exclusions');
 check((await db.query('delete from public.session_garmin_activity_exclusions returning *')).rowCount===0,'Other accounts cannot restore owner exclusions');
 await db.query('savepoint unauthorized');try{await db.query('insert into public.session_garmin_activity_exclusions(session_id,user_id,activity_id) values($1,$2,$3)',[session,other,'forged']);throw Error('Unauthorized insert succeeded');}catch(e){await db.query('rollback to savepoint unauthorized');check(e.code==='42501','Other accounts cannot forge Session exclusions');}
 await db.query('reset role');
 const before=(await db.query('select count(*)::int n from public.sessions where id=$1',[session])).rows[0].n;
 await db.query("update public.garmin_connections set authorized_at=clock_timestamp() where user_id=$1",[owner]);
 check((await db.query('select count(*)::int n from public.session_garmin_activity_exclusions where user_id=$1',[owner])).rows[0].n===0,'Connection lifecycle cleanup removes exclusion metadata');
 check((await db.query('select count(*)::int n from public.sessions where id=$1',[session])).rows[0].n===before,'Exclusion cleanup preserves scoring Sessions');
 }finally{await db.query('rollback');}
 await db.query('begin');await db.query('drop trigger garmin_exclusions_connection_cleanup on public.garmin_connections;drop trigger garmin_exclusions_health_cleanup on public.garmin_health_controls;drop function private.cleanup_garmin_activity_exclusions();drop table public.session_garmin_activity_exclusions;');await db.query('rollback');
 check((await db.query("select to_regclass('public.session_garmin_activity_exclusions') is not null ok")).rows[0].ok,'Transactional rollback of exclusion schema recovery preserves installation');
}
