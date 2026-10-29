/** Owned disposable PostgreSQL only. Never run on production. */
import {randomUUID} from 'node:crypto';
export async function testQueueFairness(db,check,pg,configuration){
 await db.query('begin');
 try{
  await db.query(`delete from public.garmin_health_inbox;
   insert into auth.users(id,email) values('99000000-0000-4000-8000-000000000001','fairness-one@example.invalid'),('99000000-0000-4000-8000-000000000002','fairness-two@example.invalid');
   insert into public.garmin_connections(user_id,garmin_user_id,status,token_ciphertext,access_expires_at,refresh_after,authorized_at,permissions) values
   ('99000000-0000-4000-8000-000000000001','fairness-one','connected','synthetic',now()+interval '1 day',now()+interval '1 day',now()-interval '1 day','["HEALTH_EXPORT","ACTIVITY_EXPORT"]'),
   ('99000000-0000-4000-8000-000000000002','fairness-two','connected','synthetic',now()+interval '1 day',now()+interval '1 day',now()-interval '1 day','["HEALTH_EXPORT","ACTIVITY_EXPORT"]');`);
  const event=(provider,n)=>({garminUserId:provider,kind:'dailies',sourceId:'fairness-'+n,recordKey:'fairness-'+n,hash:String(n).padStart(64,'0'),calendarDate:'2026-10-29',startTimeInSeconds:1793232000,durationInSeconds:1,values:{steps:1}});
  for(let offset=0;offset<240;offset+=80)await db.query('select public.stage_garmin_health_push($1::jsonb)',[JSON.stringify(Array.from({length:80},(_,i)=>event('fairness-one',offset+i+1)))]);
  await db.query('select public.stage_garmin_health_push($1::jsonb)',[JSON.stringify([event('fairness-two',241)])]);
  await db.query("update public.garmin_connections set operation='authorize',lease_until=now()-interval '1 hour' where garmin_user_id='fairness-one'");
  check((await db.query('select public.process_garmin_health_queue(50) n')).rows[0].n===1,'Healthy later owner progresses past240 expired-busy receipts');
  check((await db.query("select operation='authorize' and lease_until<now() preserved from public.garmin_connections where garmin_user_id='fairness-one'")).rows[0].preserved,'Worker does not erase uncertain OAuth lease');
  check((await db.query("select count(*)::int n from public.garmin_health_inbox where user_id='99000000-0000-4000-8000-000000000001' and state='pending'")).rows[0].n===240,'Busy owner receipts remain durable');
  check((await db.query('select public.process_garmin_health_queue(50) n')).rows[0].n===0,'Completed healthy receipt cannot duplicate');
  await db.query("update public.garmin_connections set operation=null,lease_until=null where garmin_user_id='fairness-one';update public.garmin_health_controls set paused=true where user_id='99000000-0000-4000-8000-000000000001'");
  check((await db.query('select public.process_garmin_health_queue(7) n')).rows[0].n===7,'Paused-owner rejection remains bounded');
  check((await db.query("select count(*)::int n from public.garmin_health_inbox where user_id='99000000-0000-4000-8000-000000000001' and state='pending'")).rows[0].n===233,'Rejection processes only requested batch');
 }finally{await db.query('rollback');}
 // Committed synthetic owners are visible to a separate locking connection.
 const owners=Array.from({length:5},()=>randomUUID()),blocker=new pg.Client(configuration);
 await blocker.connect();
 try{
  for(let i=0;i<owners.length;i++){
   await db.query("insert into auth.users(id,email) values($1,'fairness-lock@example.invalid')",[owners[i]]);
   await db.query(`insert into public.garmin_connections(user_id,garmin_user_id,status,token_ciphertext,access_expires_at,refresh_after,authorized_at,permissions)
    values($1,$2,'connected','synthetic',now()+interval '1 day',now()+interval '1 day',now()-interval '1 day','["HEALTH_EXPORT"]')`,[owners[i],owners[i]]);
   await db.query('select public.stage_garmin_health_push($1::jsonb)',[JSON.stringify([{garminUserId:owners[i],kind:'dailies',sourceId:'locked-owner',recordKey:'locked-owner',hash:'e'.repeat(64),calendarDate:'2026-10-29',startTimeInSeconds:1793232000,durationInSeconds:1,values:{steps:1}}])]);
  }
  await blocker.query('begin');await blocker.query('select user_id from public.garmin_connections where user_id=any($1::uuid[]) for update',[owners.slice(0,4)]);
  check((await db.query('select public.process_garmin_health_queue(1) n')).rows[0].n===1,'Four locked oldest owners cannot hide fifth healthy owner at batch1');
  check((await db.query('select count(*)::int n from public.garmin_health_records where user_id=$1',[owners[4]])).rows[0].n===1,'Unlocked owner record is imported exactly once');
  await blocker.query('rollback');
  const results=await Promise.all([db.query('select public.process_garmin_health_queue(2) n'),blocker.query('select public.process_garmin_health_queue(2) n')]);
  check(results.reduce((n,r)=>n+r.rows[0].n,0)===4,'Concurrent workers drain four receipts without duplication');
  check((await db.query('select count(*)::int n from public.garmin_health_records where user_id=any($1::uuid[])',[owners])).rows[0].n===5,'Every synthetic owner has exactly one imported record');
 }finally{await blocker.query('rollback');await blocker.end();await db.query('delete from auth.users where id=any($1::uuid[])',[owners]);}
}
