-- Disposable PostgreSQL only. Synthetic owners, credentials and measurements.
begin;
create function pg_temp.controls_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end;
$$;
do $$begin execute format('grant usage on schema %I to anon,authenticated,service_role',pg_my_temp_schema()::regnamespace); end$$;
create function pg_temp.controls_event(seconds bigint,source text default 'control-daily',provider text default 'controls-owner') returns jsonb language sql as $$
  select jsonb_build_object('garminUserId',provider,'kind','dailies','sourceId',source,'recordKey',seconds::text,
    'hash',encode(sha256(convert_to(source||seconds::text,'UTF8')),'hex'),'calendarDate','2026-10-24',
    'startTimeInSeconds',seconds,'durationInSeconds',1,'values',jsonb_build_object('steps',450));
$$;
insert into auth.users values ('82000000-0000-4000-8000-000000000001','controls@example.invalid'),('82000000-0000-4000-8000-000000000002','controls-other@example.invalid');
insert into public.garmin_connections(user_id,garmin_user_id,status,token_ciphertext,access_expires_at,refresh_after,authorized_at,permissions)
values('82000000-0000-4000-8000-000000000001','controls-owner','connected','synthetic-encrypted',now()+interval '1 day',now()+interval '1 day','2026-10-23T00:00:00Z','["HEALTH_EXPORT","ACTIVITY_EXPORT"]'),
('82000000-0000-4000-8000-000000000002','controls-other','connected','synthetic-other',now()+interval '1 day',now()+interval '1 day','2026-10-23T00:00:00Z','["HEALTH_EXPORT","ACTIVITY_EXPORT"]');

select pg_temp.controls_assert((select relrowsecurity from pg_class where oid='public.garmin_health_controls'::regclass),'Controls RLS enabled');
select pg_temp.controls_assert(not has_function_privilege('authenticated','public.control_garmin_health(uuid,text,uuid,uuid,uuid,timestamptz)','EXECUTE')
  and not has_function_privilege('anon','public.control_garmin_health(uuid,text,uuid,uuid,uuid,timestamptz)','EXECUTE')
  and has_function_privilege('service_role','public.control_garmin_health(uuid,text,uuid,uuid,uuid,timestamptz)','EXECUTE'),'Only service role executes control mutations');
select pg_temp.controls_assert(not has_table_privilege('authenticated','public.garmin_connections','SELECT')
  and not has_table_privilege('authenticated','public.garmin_health_controls','UPDATE,INSERT,DELETE'),'Ordinary clients cannot read tokens or write pause state');

set local role service_role;
do $$
declare u uuid:='82000000-0000-4000-8000-000000000001'; other_user uuid:='82000000-0000-4000-8000-000000000002';
  g uuid; old_g uuid; req uuid:=gen_random_uuid(); v jsonb; again jsonb; oauth jsonb; proof uuid; seconds bigint;
begin
  perform public.stage_garmin_health_push(jsonb_build_array(pg_temp.controls_event(1792713600),pg_temp.controls_event(1792713600,provider=>'controls-other')),array[u,other_user]);
  perform public.process_garmin_health_queue(array[u,other_user],25);
  -- Keep a quarantined raw value as well as a pending receipt to test erasure.
  perform public.stage_garmin_health_push(jsonb_build_array(pg_temp.controls_event(1792713700,'queued')),array[u]);
  update public.garmin_health_inbox set state='conflict',error_code='ambiguous_update' where user_id=u and source_id='queued';
  select to_jsonb(c) into oauth from public.garmin_connections c where user_id=u;
  select generation into old_g from public.garmin_health_controls where user_id=u;
  v:=public.control_garmin_health(u,'delete',old_g,req);
  perform pg_temp.controls_assert((v->>'paused')::boolean and v->>'deletedAt' is not null,'Delete commits a durable pause and deletion receipt');
  perform pg_temp.controls_assert(not exists(select 1 from public.garmin_health_records where user_id=u)
    and not exists(select 1 from public.garmin_health_inbox where user_id=u) and not exists(select 1 from public.garmin_health_sync_state where user_id=u),'Delete erases imported, pending and quarantined user data');
  perform pg_temp.controls_assert(oauth=(select to_jsonb(c) from public.garmin_connections c where user_id=u),'Delete preserves the complete OAuth connection and encrypted credentials');
  perform pg_temp.controls_assert(exists(select 1 from public.garmin_health_records where user_id=other_user),'Delete preserves another owners records');
  again:=public.control_garmin_health(u,'delete',old_g,req);
  perform pg_temp.controls_assert(v=again,'Retry of the same delete request is idempotent');
  perform pg_temp.controls_assert(public.stage_garmin_health_push(jsonb_build_array(pg_temp.controls_event(1792713800,'while-paused')),array[u])=0,'Paused webhook creates no measurement receipt');
  perform pg_temp.controls_assert(public.process_garmin_health_queue(array[u],25)=0,'Paused worker cannot recreate deleted measurements');
  g:=(v->>'generation')::uuid;
  begin perform public.control_garmin_health(u,'resume',g,gen_random_uuid()); raise exception 'Missing proof accepted'; exception when serialization_failure then null; end;
  begin perform public.control_garmin_health(u,'resume',g,gen_random_uuid(),gen_random_uuid(),'2026-10-23T00:00:00Z'); raise exception 'Stale proof accepted'; exception when serialization_failure then null; end;
  select version into proof from public.garmin_connections where user_id=u;
  update public.garmin_connections set permissions='["HEALTH_EXPORT"]' where user_id=u;
  begin perform public.control_garmin_health(u,'resume',g,gen_random_uuid(),proof,'2026-10-23T00:00:00Z'); raise exception 'Missing permission accepted'; exception when serialization_failure then null; end;
  update public.garmin_connections set permissions='["HEALTH_EXPORT","ACTIVITY_EXPORT"]' where user_id=u;
  v:=public.control_garmin_health(u,'resume',g,gen_random_uuid(),proof,'2026-10-23T00:00:00Z');
  perform pg_temp.controls_assert(not(v->>'paused')::boolean and (v->>'generation')::uuid<>g,'Explicit verified Resume creates a new processing generation');
  begin perform public.control_garmin_health(u,'delete',old_g,req); raise exception 'Delayed delete accepted'; exception when serialization_failure then null; end;
  perform pg_temp.controls_assert(public.stage_garmin_health_push(jsonb_build_array(pg_temp.controls_event(1792713600,'old-replay-new-id')),array[u])=0,'Pre-deletion history cannot replay with a changed source id');
  seconds:=floor(extract(epoch from clock_timestamp()))::bigint;
  perform pg_temp.controls_assert(public.stage_garmin_health_push(jsonb_build_array(pg_temp.controls_event(seconds,'same-second')),array[u])=0,'A measurement in the cutoff second is rejected conservatively');
  perform pg_temp.controls_assert(public.stage_garmin_health_push(jsonb_build_array(pg_temp.controls_event(seconds+3600,'future')),array[u])=0,'Future timestamps cannot bypass the resume cutoff');
  -- Advance the synthetic fence instead of sleeping; no provider time guarantee.
  update public.garmin_health_controls set accept_after=clock_timestamp()-interval '5 seconds' where user_id=u;
  perform pg_temp.controls_assert(public.stage_garmin_health_push(jsonb_build_array(pg_temp.controls_event(seconds-1,'fresh')),array[u])=1,'A genuine post-cutoff measurement is accepted');
  perform public.process_garmin_health_queue(array[u],25);
  perform pg_temp.controls_assert(exists(select 1 from public.garmin_health_records where user_id=u),'Resumed worker stores the new generation');
  perform public.stage_garmin_health_push(jsonb_build_array(pg_temp.controls_event(seconds-2,'stale-generation')),array[u]);
  update public.garmin_health_inbox set sync_generation=gen_random_uuid() where user_id=u and state='pending';
  perform public.process_garmin_health_queue(array[u],25);
  perform pg_temp.controls_assert(exists(select 1 from public.garmin_health_inbox where user_id=u and source_id='stale-generation' and payload is null and state='rejected'),'Worker scrubs a stale processing generation');
  select generation into g from public.garmin_health_controls where user_id=u;
  v:=public.control_garmin_health(u,'pause',g,gen_random_uuid());
  perform pg_temp.controls_assert(exists(select 1 from public.garmin_health_records where user_id=u),'Pause alone preserves imported measurements');
  update public.garmin_health_controls set accept_after=clock_timestamp()-interval '5 seconds' where user_id=u;
  select version into proof from public.garmin_connections where user_id=u;
  perform public.stage_garmin_health_push(jsonb_build_array(jsonb_build_object('garminUserId','controls-owner','kind','userPermissionsChange',
    'sourceId','revoked-while-paused','hash',repeat('a',64),'changeTimeInSeconds',seconds-1,'permissions','[]'::jsonb)),array[u]);
  perform pg_temp.controls_assert(proof<>(select version from public.garmin_connections where user_id=u),'Consent notification immediately invalidates a pending provider proof');
  begin perform public.control_garmin_health(u,'resume',(v->>'generation')::uuid,gen_random_uuid(),proof,'2026-10-23T00:00:00Z'); raise exception 'Pending revocation bypassed'; exception when serialization_failure then null; end;
  perform public.process_garmin_health_queue(array[u],25);
  perform pg_temp.controls_assert(not exists(select 1 from public.garmin_health_records where user_id=u)
    and (select paused from public.garmin_health_controls where user_id=u),'Revocation cleanup still removes sensitive data while pause remains in force');
  -- Fresh setup for direct database authorization tests.
  update public.garmin_health_controls set paused=false,accept_after=null where user_id=u;
  delete from public.garmin_health_sync_state where user_id=u;
  perform public.stage_garmin_health_push(jsonb_build_array(pg_temp.controls_event(1792713600,'rls-daily')),array[u]);
  perform public.process_garmin_health_queue(array[u],25);
end;
$$;
do $$
declare u uuid:='82000000-0000-4000-8000-000000000002'; g uuid;
begin
  perform public.stage_garmin_health_push(jsonb_build_array(jsonb_build_object('garminUserId','controls-other','kind','userPermissionsChange',
    'sourceId','pending-consent-before-pause','hash',repeat('b',64),'changeTimeInSeconds',floor(extract(epoch from clock_timestamp()))-1,'permissions','[]'::jsonb)),array[u]);
  select generation into g from public.garmin_health_controls where user_id=u;
  perform public.control_garmin_health(u,'pause',g,gen_random_uuid());
  perform pg_temp.controls_assert(exists(select 1 from public.garmin_health_inbox where user_id=u and kind='userPermissionsChange' and state='pending'),
    'Pause retaining measurements cannot discard pending consent revocation');
  perform public.process_garmin_health_queue(array[u],25);
  perform pg_temp.controls_assert(not exists(select 1 from public.garmin_health_records where user_id=u),'Queued revocation removes retained records after Pause');
  perform public.stage_garmin_health_push(jsonb_build_array(jsonb_build_object('garminUserId','controls-other','kind','deregistrations',
    'sourceId','deregistration','hash',repeat('c',64))),array[u]);
  perform pg_temp.controls_assert((select state='reconciliation_required' from public.garmin_health_sync_state where user_id=u)
    and not exists(select 1 from public.garmin_health_inbox where user_id=u and kind='deregistrations'),
    'Untimestamped deregistration after a cutoff records uncertainty without keeping a raw payload or presuming cleanup');
end;
$$;
reset role;
set local role authenticated;
set local request.jwt.claim.sub='82000000-0000-4000-8000-000000000001';
select pg_temp.controls_assert((select count(*)=1 from public.garmin_health_records),'Connected owner sees their own measurements');
select pg_temp.controls_assert((public.read_garmin_health_dashboard(auth.uid(),'2026-10-01','2026-10-31')->'records'->0->'metrics'->>'steps')='450','Owner snapshot RPC returns genuine SQL records');
select pg_temp.controls_assert(public.read_garmin_health_dashboard('82000000-0000-4000-8000-000000000002','2026-10-01','2026-10-31') is null,'Snapshot RPC cannot select a submitted other owner');
select pg_temp.controls_assert(not exists(select 1 from public.garmin_health_controls where user_id<>auth.uid()),'Controls hide other owners metadata');
reset role;
update public.garmin_connections set status='reauthorization_required' where user_id='82000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.controls_assert((select count(*)=0 from public.garmin_health_records),'Invalid connection cannot read records directly through RLS');
select pg_temp.controls_assert(public.read_garmin_health_dashboard(auth.uid(),'2026-10-01','2026-10-31') is null,'Invalid connection cannot bypass the server dashboard gate');
reset role;
update public.garmin_connections set status='connected',access_expires_at=now()-interval '1 second' where user_id='82000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.controls_assert((select count(*)=0 from public.garmin_health_records),'An expired connection cannot bypass connected-only RLS');
reset role;
update public.garmin_connections set status='connected' where user_id='82000000-0000-4000-8000-000000000001';
update public.garmin_connections set status='disconnected',token_ciphertext=null,garmin_user_id=null,permissions='[]',access_expires_at=null where user_id='82000000-0000-4000-8000-000000000001';
select pg_temp.controls_assert(not exists(select 1 from public.garmin_health_records where user_id='82000000-0000-4000-8000-000000000001')
  and not exists(select 1 from public.garmin_health_inbox where user_id='82000000-0000-4000-8000-000000000001'),'Confirmed disconnect erases imported and queued data');
select pg_temp.controls_assert((select paused and accept_after is not null and last_request_id is null from public.garmin_health_controls where user_id='82000000-0000-4000-8000-000000000001'),'Disconnect retains only its minimal replay fence without an action receipt');
delete from auth.users where id='82000000-0000-4000-8000-000000000001';
select pg_temp.controls_assert(not exists(select 1 from public.garmin_health_controls where user_id='82000000-0000-4000-8000-000000000001'),'Account deletion cascades the remaining pause and replay fence');
rollback;
