/** Actual lock contention in the existing disposable PostgreSQL cluster only. */
export async function testAdmissionConcurrency(db, Client, configuration, check) {
  const user='85000000-0000-4000-8000-000000000001';
  const event={garminUserId:'admission-concurrent',kind:'dailies',sourceId:'admission-concurrent',hash:'b'.repeat(64),
    recordKey:'1792713600',calendarDate:'2026-10-23',startTimeInSeconds:1792713600,durationInSeconds:3600,values:{steps:7}};
  const blocker=new Client(configuration);await blocker.connect();
  try {
    await db.query(`insert into auth.users values($1,'concurrent-admission@example.invalid');`,[user]);
    await db.query(`insert into public.garmin_connections(user_id,garmin_user_id,status,token_ciphertext,access_expires_at,refresh_after,authorized_at,permissions)
      values($1,'admission-concurrent','connected','synthetic',now()-interval '1 second',now(),'2026-10-23','["HEALTH_EXPORT"]')`,[user]);
    await blocker.query('begin');
    await blocker.query(`update public.garmin_connections set operation='refresh',lease_until=now()+interval '1 minute' where user_id=$1`,[user]);
    const result=await db.query('select public.admit_garmin_health_push($1::jsonb) as result',[JSON.stringify([event])]);
    check(result.rows[0].result.status==='temporary','Actual concurrent refresh lock produces bounded retryable admission');
    check((await db.query('select count(*)::int n from public.garmin_health_inbox where user_id=$1',[user])).rows[0].n===0,'Contended notification is not falsely staged');
    await blocker.query(`update public.garmin_connections set operation=null,lease_until=null,access_expires_at=now()+interval '1 day' where user_id=$1`,[user]);
    await blocker.query('commit');
    check((await db.query('select public.admit_garmin_health_push($1::jsonb) as result',[JSON.stringify([event])])).rows[0].result.status==='accepted','Redelivery after concurrent refresh commits is accepted');
  } finally {await blocker.query('rollback');await blocker.end();await db.query('delete from auth.users where id=$1',[user]);}
}
