-- Disposable PostgreSQL only. Never run fixtures on production.
begin;
create function pg_temp.ga_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end; $$;
create function pg_temp.ga_event(provider text,source text,seconds bigint default 1792713600) returns jsonb language sql as $$
select jsonb_build_object('garminUserId',provider,'kind','dailies','sourceId',source,'recordKey',source,
 'hash',encode(sha256(convert_to(provider||source||seconds::text,'UTF8')),'hex'),'calendarDate','2026-10-24',
 'startTimeInSeconds',seconds,'durationInSeconds',1,'values',jsonb_build_object('steps',600)); $$;
do $$begin execute format('grant usage on schema %I to authenticated',pg_my_temp_schema()::regnamespace); end$$;
insert into auth.users values('83000000-0000-4000-8000-000000000001','ga-one@example.invalid'),
 ('83000000-0000-4000-8000-000000000002','ga-two@example.invalid'),('83000000-0000-4000-8000-000000000003','ga-no-permission@example.invalid');
insert into public.garmin_connections(user_id,garmin_user_id,status,token_ciphertext,access_expires_at,refresh_after,authorized_at,permissions)
values('83000000-0000-4000-8000-000000000001','ga-one','connected','synthetic-one',now()+interval '1 day',now()+interval '1 day','2026-10-23','["HEALTH_EXPORT","ACTIVITY_EXPORT"]'),
 ('83000000-0000-4000-8000-000000000002','ga-two','connected','synthetic-two',now()+interval '1 day',now()+interval '1 day','2026-10-23','["HEALTH_EXPORT","ACTIVITY_EXPORT"]'),
 ('83000000-0000-4000-8000-000000000003','ga-none','connected','synthetic-none',now()+interval '1 day',now()+interval '1 day','2026-10-23','[]');
select pg_temp.ga_assert((select count(*)=3 from public.garmin_health_controls where user_id::text like '83000000%' and not paused),'New connections receive controls without administrator enrollment');
update public.garmin_connections set refresh_after=clock_timestamp()-interval '1 second' where user_id::text like '83000000%';
select pg_temp.ga_assert((select count(*)=2 from public.garmin_health_refresh_candidates(3)),'Refresh candidates are database-owned and exclude missing permissions');
select pg_temp.ga_assert((select count(*)=1 from public.garmin_health_refresh_candidates(1)),'Due authorization lookup is bounded independently of account count');
select pg_temp.ga_assert(not has_function_privilege('authenticated','public.stage_garmin_health_push(jsonb)','EXECUTE')
 and not has_function_privilege('anon','public.process_garmin_health_queue(integer)','EXECUTE')
 and has_function_privilege('service_role','public.process_garmin_health_queue(integer)','EXECUTE'),'General-availability mutation RPCs remain service-only');
select pg_temp.ga_assert(public.stage_garmin_health_push(jsonb_build_array(pg_temp.ga_event('ga-one','one'),pg_temp.ga_event('ga-two','two'),
 pg_temp.ga_event('ga-none','denied'),pg_temp.ga_event('unknown','unknown')))=2,'Multiple eligible users admitted; unknown and unpermitted accounts rejected without UUID lists');
select pg_temp.ga_assert(public.stage_garmin_health_push(jsonb_build_array(pg_temp.ga_event('ga-one','one')))=0,'General-availability receipt deduplication preserved');
select pg_temp.ga_assert(public.process_garmin_health_queue(1)=1,'Worker enforces requested cross-user batch limit');
select pg_temp.ga_assert((select count(*)=1 from public.garmin_health_inbox where state='pending'),'One other user remains durably queued');
select pg_temp.ga_assert(public.process_garmin_health_queue(50)=1,'Remaining eligible user is processed on next run');
set local role authenticated;
set local request.jwt.claim.sub='83000000-0000-4000-8000-000000000001';
select pg_temp.ga_assert((select count(*)=1 from public.garmin_health_records),'Real SQL RLS isolates two populated owners');
select pg_temp.ga_assert(public.read_garmin_health_dashboard('83000000-0000-4000-8000-000000000002','2026-01-01','2026-12-31') is null,'Dashboard RPC denies another owner');
reset role;
do $$declare u uuid:='83000000-0000-4000-8000-000000000001'; g uuid; proof uuid; stamp timestamptz; begin
 select generation into g from public.garmin_health_controls where user_id=u;
 perform public.control_garmin_health(u,'delete',g,gen_random_uuid());
 perform pg_temp.ga_assert((select paused from public.garmin_health_controls where user_id=u)
   and not exists(select 1 from public.garmin_health_records where user_id=u)
   and (select token_ciphertext='synthetic-one' from public.garmin_connections where user_id=u),'Delete preserves OAuth and durable pause');
 perform pg_temp.ga_assert(public.stage_garmin_health_push(jsonb_build_array(pg_temp.ga_event('ga-one','paused')))=0,'Paused users cannot receive general-availability notifications');
 select generation into g from public.garmin_health_controls where user_id=u;
 select version,authorized_at into proof,stamp from public.garmin_connections where user_id=u;
 perform public.control_garmin_health(u,'resume',g,gen_random_uuid(),proof,stamp);
 perform pg_temp.ga_assert(public.stage_garmin_health_push(jsonb_build_array(pg_temp.ga_event('ga-one','replayed')))=0,'Resume cannot replay deleted historical deliveries');
 update public.garmin_health_controls set accept_after=clock_timestamp()-interval '5 seconds' where user_id=u;
 perform pg_temp.ga_assert(public.stage_garmin_health_push(jsonb_build_array(pg_temp.ga_event('ga-one','fresh',floor(extract(epoch from clock_timestamp()))::bigint-1)))=1,'Explicit Resume admits fresh, attributable notifications');
 perform public.process_garmin_health_queue(50);
 perform pg_temp.ga_assert((select count(*)=1 from public.garmin_health_records where user_id=u),'Resumed data remains owner-scoped');
 update public.garmin_connections set permissions='[]' where user_id=u;
 perform pg_temp.ga_assert(not exists(select 1 from public.garmin_health_records where user_id=u),'Permission revocation erases affected imported records');
end$$;
do $$declare u uuid:='83000000-0000-4000-8000-000000000002'; i integer; begin
 for i in 1..6 loop perform public.stage_garmin_health_push(jsonb_build_array(pg_temp.ga_event('ga-two','stale-'||i))); end loop;
 update public.garmin_health_controls set generation=gen_random_uuid() where user_id=u;
 perform pg_temp.ga_assert(public.process_garmin_health_queue(2)=2,'Stale-generation rejection respects the processing limit');
 perform pg_temp.ga_assert((select count(*)=4 from public.garmin_health_inbox where user_id=u and state='pending'),'Stale-generation cleanup leaves the unprocessed batch durably queued');
 perform public.process_garmin_health_queue(50);
 perform pg_temp.ga_assert((select count(*)=1 from public.garmin_health_records where user_id=u),'Stale work cannot resurrect records');
 update public.garmin_connections set status='disconnected',token_ciphertext=null where user_id=u;
 perform pg_temp.ga_assert(not exists(select 1 from public.garmin_health_records where user_id=u)
   and not exists(select 1 from public.garmin_health_inbox where user_id=u),'Disconnect removes imports and queued payloads');
end$$;
rollback;
