-- Synthetic, rollback-only fixture. Run exclusively in the disposable runner.
begin;
create function pg_temp.admission_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end; $$;
create function pg_temp.admission_event(provider text,source text) returns jsonb language sql as $$
 select jsonb_build_object('garminUserId',provider,'kind','dailies','sourceId',source,'hash',repeat('a',64),
 'recordKey','1792713600','calendarDate','2026-10-23','startTimeInSeconds',1792713600,'durationInSeconds',3600,'values','{"steps":7}'::jsonb);
$$;
insert into auth.users values('84000000-0000-4000-8000-000000000001','admission-one@example.invalid'),
 ('84000000-0000-4000-8000-000000000002','admission-two@example.invalid');
insert into public.garmin_connections(user_id,garmin_user_id,status,token_ciphertext,access_expires_at,refresh_after,authorized_at,permissions)
 values('84000000-0000-4000-8000-000000000001','admission-one','connected','synthetic',now()+interval '1 day',now()+interval '1 day','2026-10-23','["HEALTH_EXPORT","ACTIVITY_EXPORT"]'),
 ('84000000-0000-4000-8000-000000000002','admission-two','connected','synthetic',now()+interval '1 day',now()+interval '1 day','2026-10-23','["HEALTH_EXPORT","ACTIVITY_EXPORT"]');
select pg_temp.admission_assert(not has_function_privilege('anon','public.admit_garmin_health_push(jsonb)','EXECUTE')
 and not has_function_privilege('authenticated','public.admit_garmin_health_push(jsonb)','EXECUTE')
 and has_function_privilege('service_role','public.admit_garmin_health_push(jsonb)','EXECUTE'),'Admission RPC is service-only');
set local role service_role;
select pg_temp.admission_assert(public.admit_garmin_health_push(jsonb_build_array(pg_temp.admission_event('admission-one','valid')))
 =' {"status":"accepted","accepted":1,"duplicate":0,"ineligible":0}'::jsonb,'Valid event reports durable acceptance');
select public.process_garmin_health_queue(50);
select pg_temp.admission_assert(public.admit_garmin_health_push(jsonb_build_array(pg_temp.admission_event('admission-one','valid')))->>'status'='duplicate','Processed equivalent receipt reports duplicate');
update public.garmin_connections set access_expires_at=clock_timestamp()-interval '1 second' where garmin_user_id='admission-two';
select pg_temp.admission_assert(public.admit_garmin_health_push(jsonb_build_array(pg_temp.admission_event('admission-two','expired')))->>'status'='temporary','Expired token is retryable, not a successful zero insert');
select pg_temp.admission_assert(public.admit_garmin_health_push(jsonb_build_array(pg_temp.admission_event('admission-one','mixed-first'),pg_temp.admission_event('admission-two','mixed-second')))->>'status'='temporary','Mixed delivery reports temporary failure');
select pg_temp.admission_assert(not exists(select 1 from public.garmin_health_inbox where source_id in ('mixed-first','mixed-second','expired')),'Temporary failure atomically rolls back all batch receipts');
do $$begin
 begin perform public.stage_garmin_health_push(jsonb_build_array(pg_temp.admission_event('admission-two','old-receiver')));
   raise exception 'Expected retry error'; exception when serialization_failure then null; end;
 perform pg_temp.admission_assert(not exists(select 1 from public.garmin_health_inbox where source_id='old-receiver'),'Old receiver RPC also fails safely during rollout');
end;$$;
update public.garmin_connections set access_expires_at=now()+interval '1 day' where garmin_user_id='admission-two';
select pg_temp.admission_assert((public.admit_garmin_health_push(jsonb_build_array(pg_temp.admission_event('admission-one','mixed-first'),pg_temp.admission_event('admission-two','mixed-second')))->>'accepted')::int=2,'Refresh followed by redelivery durably admits both owners');
reset role;
create function pg_temp.admission_break() returns trigger language plpgsql as $$begin
 if new.source_id='admission-storage-fail' then raise exception 'Synthetic storage failure.' using errcode='XX000'; end if;
 if new.source_id='admission-silent-fail' then return null; end if;
 return new; end;$$;
create trigger zz_admission_fixture_failure before insert on public.garmin_health_inbox for each row execute function pg_temp.admission_break();
set local role service_role;
select pg_temp.admission_assert(public.admit_garmin_health_push(jsonb_build_array(pg_temp.admission_event('admission-one','before-silent-failure'),pg_temp.admission_event('admission-two','admission-silent-fail')))->>'status'='temporary','Unexplained zero-insert result cannot become a final acknowledgment');
select pg_temp.admission_assert(not exists(select 1 from public.garmin_health_inbox where source_id='before-silent-failure'),'Unexplained suppressed receipt rolls back its entire mixed batch');
do $$begin
 begin perform public.admit_garmin_health_push(jsonb_build_array(pg_temp.admission_event('admission-one','before-storage-failure'),pg_temp.admission_event('admission-two','admission-storage-fail')));
   raise exception 'Expected storage failure'; exception when internal_error then null; end;
 perform pg_temp.admission_assert(not exists(select 1 from public.garmin_health_inbox where source_id in ('before-storage-failure','admission-storage-fail')),'Storage failure rolls back earlier mixed-batch inserts');
end;$$;
reset role;
drop trigger zz_admission_fixture_failure on public.garmin_health_inbox;
set local role service_role;
update public.garmin_connections set operation='refresh',lease_until=now()+interval '1 minute' where garmin_user_id='admission-two';
select pg_temp.admission_assert(public.admit_garmin_health_push(jsonb_build_array(pg_temp.admission_event('admission-two','refresh-busy')))->>'status'='temporary','In-progress refresh is retryable');
select pg_temp.admission_assert(public.admit_garmin_health_push(jsonb_build_array(pg_temp.admission_event('admission-two','mixed-second')))->>'status'='duplicate','Already durable duplicates remain acknowledged during refresh');
update public.garmin_connections set operation=null,lease_until=null,status='error',error_code='provider_unavailable' where garmin_user_id='admission-two';
select pg_temp.admission_assert(public.admit_garmin_health_push(jsonb_build_array(pg_temp.admission_event('admission-two','error')))->>'status'='temporary','Unknown/transient account error is not a final rejection');
update public.garmin_connections set status='connected',error_code=null where garmin_user_id='admission-two';
insert into public.garmin_health_sync_state(user_id,state) values('84000000-0000-4000-8000-000000000002','reconciliation_required')
 on conflict(user_id) do update set state='reconciliation_required';
select pg_temp.admission_assert(public.admit_garmin_health_push(jsonb_build_array(pg_temp.admission_event('admission-two','reconcile')))->>'status'='temporary','Unverified reconciliation state is retryable');
update public.garmin_health_controls set paused=true where user_id='84000000-0000-4000-8000-000000000002';
select pg_temp.admission_assert(public.admit_garmin_health_push(jsonb_build_array(pg_temp.admission_event('admission-two','paused')))->>'status'='ineligible','Intentional pause is final even during unavailable authorization');
update public.garmin_health_controls set paused=false,accept_after=clock_timestamp() where user_id='84000000-0000-4000-8000-000000000002';
update public.garmin_health_sync_state set state='waiting' where user_id='84000000-0000-4000-8000-000000000002';
select pg_temp.admission_assert(public.admit_garmin_health_push(jsonb_build_array(pg_temp.admission_event('admission-two','stale')))->>'status'='ineligible','Replay cutoff remains a final rejection');
update public.garmin_connections set permissions='[]' where garmin_user_id='admission-two';
select pg_temp.admission_assert(public.admit_garmin_health_push(jsonb_build_array(pg_temp.admission_event('admission-two','revoked')))->>'status'='ineligible','Revoked measurement permission is a final rejection');
update public.garmin_connections set operation='delete',lease_until=now()+interval '1 minute',deletion_requested_at=clock_timestamp() where garmin_user_id='admission-two';
select pg_temp.admission_assert(public.admit_garmin_health_push(jsonb_build_array(pg_temp.admission_event('admission-two','deleting')))->>'status'='ineligible','Account-deletion fence remains final');
update public.garmin_connections set status='disconnected' where garmin_user_id='admission-one';
select pg_temp.admission_assert((public.admit_garmin_health_push(jsonb_build_array(pg_temp.admission_event('admission-one','disconnected'),pg_temp.admission_event('unknown','unknown')))->>'ineligible')::int=2,'Disconnected and unknown owners are final rejections');
reset role;
rollback;
