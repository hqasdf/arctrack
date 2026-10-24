-- PREPARATION ONLY. Requires separate production approval for extensions, Vault
-- secret, job and these admin-only monitoring objects. Never run via db push.
-- Install pg_cron and pg_net using the Supabase integrations UI first; put the
-- independent 64-hex CRON_SECRET in Vault as garmin_health_worker_bearer.
begin;
do $$declare client_role text; queue_table text; begin
  if to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') is null
     or to_regprocedure('cron.schedule(text,text,text)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Cron, pg_net and Vault must be configured first';
  end if;
  if exists(select 1 from cron.job where jobname='arctrack-garmin-health-pilot') then
    raise exception 'Existing pilot job requires explicit review; not overwriting';
  end if;
  foreach client_role in array array['anon','authenticated'] loop
    if has_table_privilege(client_role,'vault.decrypted_secrets','select') then
      raise exception 'Client roles must not read Vault secrets';
    end if;
    foreach queue_table in array array['net.http_request_queue','net._http_response'] loop
      if to_regclass(queue_table) is not null and has_table_privilege(client_role,queue_table,'select') then
        raise exception 'Review pg_net queue privileges before enabling the scheduler';
      end if;
    end loop;
  end loop;
end$$;
create table private.garmin_health_worker_runs (
  request_id bigint primary key, enqueued_at timestamptz not null default now()
);
alter table private.garmin_health_worker_runs enable row level security;
revoke all on private.garmin_health_worker_runs from public,anon,authenticated,service_role;
create function private.enqueue_garmin_health_worker() returns bigint
language plpgsql security invoker set search_path='' as $$
declare bearer text; request_id bigint;
begin
  select decrypted_secret into strict bearer from vault.decrypted_secrets
    where name='garmin_health_worker_bearer';
  if bearer !~ '^[a-f0-9]{64}$' then raise exception 'Invalid worker credential configuration'; end if;
  select net.http_get(
    url := 'https://archery-website.vercel.app/api/internal/garmin-health/process',
    headers := jsonb_build_object('Authorization','Bearer ' || bearer),
    timeout_milliseconds := 30000
  ) into request_id;
  insert into private.garmin_health_worker_runs(request_id) values(request_id);
  -- Bounded operational IDs only; never payloads or credentials. No health-data purge.
  delete from private.garmin_health_worker_runs old_run where old_run.request_id in (
    select r.request_id from private.garmin_health_worker_runs r order by r.enqueued_at desc,r.request_id desc offset 1000
  );
  return request_id;
end$$;
revoke all on function private.enqueue_garmin_health_worker() from public,anon,authenticated,service_role;
select cron.schedule('arctrack-garmin-health-pilot','* * * * *',
  'select private.enqueue_garmin_health_worker()');
commit;
-- After activation, admin-only monitoring: JOIN worker_runs.request_id to
-- net._http_response.id. Cron enqueue success alone does NOT prove processing.
-- pg_net responses are transient; alert on non-200, timeout, missing response,
-- stalled inbox age, queue growth and conflict counts. Do not export headers/body.
