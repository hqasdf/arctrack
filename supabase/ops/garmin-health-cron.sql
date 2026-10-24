-- INACTIVE PREPARATION. Requires production approval for extensions, Vault
-- secret, job and these admin-only monitoring objects. Never run via db push.
-- Install pg_cron and pg_net using the Supabase integrations UI first; put the
-- independent 64-hex CRON_SECRET in Vault as garmin_health_worker_bearer.
-- Before executing against Supabase, verify public Data API Accept-Profile probes
-- for net, vault and private all return 406/PGRST106. Never expose these schemas.
begin;
do $$declare client_role text; queue_table text; begin
  if to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') is null
     or to_regprocedure('cron.schedule(text,text,text)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Cron, pg_net and Vault must be configured first';
  end if;
  if exists(select 1 from cron.job where jobname='arctrack-garmin-health-pilot'
    and command<>'select private.enqueue_garmin_health_worker()') then
    raise exception 'Existing Garmin job has an unexpected command';
  end if;
  foreach client_role in array array['anon','authenticated'] loop
    if has_table_privilege(client_role,'vault.decrypted_secrets','select') then
      raise exception 'Client roles must not read Vault secrets';
    end if;
    foreach queue_table in array array['net.http_request_queue','net._http_response'] loop
      if to_regclass(queue_table) is not null then
        if has_table_privilege(client_role,queue_table,'select') then
          -- Supabase-owned pg_net grants PUBLIC SELECT by default; postgres cannot
          -- revoke its owner's ACL. SQL grants alone do not expose a Data API schema.
          -- Accept only genuine managed extension objects and non-login client roles,
          -- after the mandatory external Data API probes above. No grants are added.
          if exists(select 1 from pg_roles where rolname=client_role and rolcanlogin)
            or not exists(select 1 from pg_class c join pg_depend d on d.classid='pg_class'::regclass
              and d.objid=c.oid and d.deptype='e' join pg_extension e on e.oid=d.refobjid
              where c.oid=to_regclass(queue_table) and pg_get_userbyid(c.relowner)='supabase_admin' and e.extname='pg_net') then
            raise exception 'Unexpected client access to scheduler transport tables';
          end if;
          raise notice 'Managed pg_net defaults retained; net must remain outside the Data API';
        end if;
      end if;
    end loop;
  end loop;
end$$;
create table if not exists private.garmin_health_worker_runs (
  request_id bigint primary key, enqueued_at timestamptz not null default now()
);
alter table private.garmin_health_worker_runs enable row level security;
revoke all on private.garmin_health_worker_runs from public,anon,authenticated,service_role;
create or replace function private.enqueue_garmin_health_worker() returns bigint
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
do $$declare garmin_job bigint; begin
  select jobid into garmin_job from cron.job where jobname='arctrack-garmin-health-pilot';
  if not found then
    garmin_job:=cron.schedule('arctrack-garmin-health-pilot','* * * * *',
      'select private.enqueue_garmin_health_worker()');
  end if;
  perform cron.alter_job(job_id:=garmin_job,active:=false);
end$$;
commit;
-- The historical job name is retained; it no longer selects a pilot cohort.
-- Activation is a separately reviewed cron.alter_job(active:=true), never part of this script.
-- After activation, admin-only monitoring: JOIN worker_runs.request_id to
-- net._http_response.id. Cron enqueue success alone does NOT prove processing.
-- pg_net responses are transient; alert on non-200, timeout, missing response,
-- stalled inbox age, queue growth and conflict counts. Do not export headers/body.
