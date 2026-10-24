/** Disposable SQL only. Actual Cron/Vault/pg_net transport is represented by test stubs. */
import {readFile} from 'node:fs/promises';
export async function testScheduler(db,check,deliver,bearer,user) {
  await db.query(`create schema vault; create schema cron; create schema net;
    create table vault.decrypted_secrets(name text unique,decrypted_secret text);
    create table cron.job(jobid bigint generated always as identity,jobname text, schedule text,command text);
    create function cron.schedule(text,text,text) returns bigint language sql as $$
      insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid$$;
    create table net.fixture_requests(id bigint generated always as identity,url text,headers jsonb);
    create table net._http_response(id bigint,status_code int,timed_out boolean,error_msg text);
    create table cron.job_run_details(jobid bigint,status text,start_time timestamptz default now());
    create function net.http_get(url text,params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 1000)
      returns bigint language sql as $$insert into net.fixture_requests(url,headers) values($1,$3) returning id$$;`);
  await db.query('insert into vault.decrypted_secrets values($1,$2)',['garmin_health_worker_bearer',bearer]);
  await db.query(await readFile(new URL('../supabase/ops/garmin-health-cron.sql',import.meta.url),'utf8'));
  const job=(await db.query('select * from cron.job')).rows[0];
  check(job.schedule==='* * * * *'&&!job.command.includes(bearer),'Cron stores a fixed admin command without embedding its bearer');
  for(const role of ['anon','authenticated','service_role']) {
    check(!(await db.query(`select has_function_privilege($1,'private.enqueue_garmin_health_worker()','execute') as allowed`,[role])).rows[0].allowed,
      role+' cannot invoke the credential-bearing scheduler function');
    check(!(await db.query(`select has_table_privilege($1,'private.garmin_health_worker_runs','select') as allowed`,[role])).rows[0].allowed,
      role+' cannot inspect scheduler operational records');
  }
  const tick=async()=>{
    await db.query(job.command);
    const request=(await db.query('select * from net.fixture_requests order by id desc limit 1')).rows[0];
    check(request.url==='https://archery-website.vercel.app/api/internal/garmin-health/process','Scheduler fixes the worker URL rather than accepting a caller target');
    return request;
  };
  const first=await tick();
  check((await deliver({})).status===401,'Transport cannot invoke the worker without its Vault bearer');
  // Simulate pg_net transport loss after successful enqueue; durable receipt remains.
  await db.query('delete from net.fixture_requests where id=$1',[first.id]);
  check((await db.query("select count(*)::int n from public.garmin_health_inbox where source_id='gateway-daily' and state='pending'")).rows[0].n===1,
    'Lost scheduler transport does not lose the durable inbox receipt');
  // Actual SQL rollback on worker failure, not an in-memory successful process mock.
  await db.query(`create function private.fixture_worker_failure() returns trigger language plpgsql as $$begin
    raise exception 'synthetic processing outage'; end$$;
    create trigger fixture_worker_failure before insert on public.garmin_health_records for each row execute function private.fixture_worker_failure();`);
  const failed=await tick();
  check((await deliver(failed.headers)).status===503,'Scheduled worker reports SQL failure instead of false success');
  await db.query('insert into net._http_response values($1,503,false,null)',[failed.id]);
  check((await db.query("select count(*)::int n from public.garmin_health_inbox where source_id='gateway-daily' and state='pending'")).rows[0].n===1,
    'Processing transaction rollback retains the failed receipt for retry');
  await db.query('drop trigger fixture_worker_failure on public.garmin_health_records; drop function private.fixture_worker_failure()');
  const retried=await tick();
  check((await deliver(retried.headers)).status===200,'Next scheduled tick retries and processes the committed receipt');
  await db.query('insert into net._http_response values($1,200,false,null)',[retried.id]);
  check((await db.query("select metrics->>'steps' value from public.garmin_health_records where user_id=$1 and calendar_date='2026-10-25'",[user])).rows[0]?.value==='725',
    'Scheduled worker produces the expected private 725-step measurement');
  const repeated=await tick();await deliver(repeated.headers);
  check((await db.query("select count(*)::int n from public.garmin_health_records where user_id=$1 and calendar_date='2026-10-25'",[user])).rows[0].n===1,
    'Repeated scheduler delivery does not duplicate a measurement');
  await db.query("update private.garmin_health_worker_runs set enqueued_at=now()-interval '5 minutes' where request_id=$1",[first.id]);
  const monitored=await db.query(await readFile(new URL('../supabase/ops/garmin-health-monitor.sql',import.meta.url),'utf8'));
  check(Number(monitored[2].rows[0].failed_calls)===1 && Number(monitored[2].rows[0].successful_calls)===1
    && Number(monitored[2].rows[0].missing_responses)===1,'Monitoring detects failed and lost HTTP delivery separately from successful Cron enqueue');
  await db.query("delete from vault.decrypted_secrets where name='garmin_health_worker_bearer'");
  let missing=false;try{await db.query(job.command);}catch{missing=true;}
  check(missing,'Missing Vault credential fails without enqueuing an unauthenticated request');
}
