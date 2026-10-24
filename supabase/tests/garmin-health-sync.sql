-- DISPOSABLE DATABASE ONLY. Synthetic normalized events; no real Garmin payloads.
begin;
create temporary table health_fixture_marker(id integer);
create function pg_temp.assert_true(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end;
$$;
do $$begin execute format('grant usage on schema %I to anon,authenticated,service_role',pg_my_temp_schema()::regnamespace); end$$;
create function pg_temp.health_event(kind text,seconds integer,metrics jsonb,source text default 'summary-one',duration integer default 3600,provider text default 'provider-one')
returns jsonb language sql as $$
  select body||jsonb_build_object('hash',encode(sha256(convert_to(body::text,'UTF8')),'hex')) from
  (select jsonb_build_object('garminUserId',provider,'kind',kind,'sourceId',source,
    'recordKey',case when kind='activities' then source else seconds::text end,'calendarDate','2026-10-23',
    'startTimeInSeconds',seconds,'durationInSeconds',duration,'values',metrics,'permissions',null,'changeTimeInSeconds',null) body) b;
$$;

select pg_temp.assert_true((select count(*)=3 and bool_and(relrowsecurity) from pg_class where oid in
  ('public.garmin_health_inbox'::regclass,'public.garmin_health_records'::regclass,'public.garmin_health_sync_state'::regclass)),
  'RLS is enabled on all three health tables');
select pg_temp.assert_true((select count(*)=3 and bool_and(convalidated and confdeltype='c') from pg_constraint
  where contype='f' and confrelid='public.garmin_connections'::regclass and conrelid in
  ('public.garmin_health_inbox'::regclass,'public.garmin_health_records'::regclass,'public.garmin_health_sync_state'::regclass)),
  'All health ownership foreign keys are valid and cascade from the Garmin connection');
select pg_temp.assert_true(not has_function_privilege('anon','public.process_garmin_health_queue(uuid[],integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.process_garmin_health_queue(uuid[],integer)','EXECUTE')
  and has_function_privilege('service_role','public.process_garmin_health_queue(uuid[],integer)','EXECUTE'),
  'Only the service role can execute health queue processing');
select pg_temp.assert_true((select bool_and(has_table_privilege('service_role',table_name,privilege))
  from unnest(array['public.garmin_health_inbox','public.garmin_health_records','public.garmin_health_sync_state']) table_name
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) privilege),
  'The service role has every required health-table privilege');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.garmin_health_sync_state','INSERT,UPDATE,DELETE')
  and not has_table_privilege('anon','public.garmin_health_sync_state','SELECT'),
  'Import status cannot be edited by clients or read anonymously');
select pg_temp.assert_true(exists(select 1 from pg_trigger where tgname='garmin_health_lifecycle'
  and tgrelid='public.garmin_connections'::regclass and tgenabled='O' and not tgisinternal),
  'The health cleanup trigger is enabled on the Garmin connection only');

insert into auth.users values ('80000000-0000-4000-8000-000000000001','health-owner@example.invalid'),('80000000-0000-4000-8000-000000000002','health-other@example.invalid');
insert into public.garmin_connections(user_id,garmin_user_id,status,token_ciphertext,access_expires_at,refresh_after,authorized_at,permissions)
values('80000000-0000-4000-8000-000000000001','provider-one','connected','synthetic',now()+interval '1 day',now()+interval '1 day','2026-10-23T00:00:00Z','["HEALTH_EXPORT","ACTIVITY_EXPORT"]'),
('80000000-0000-4000-8000-000000000002','provider-two','connected','synthetic',now()+interval '1 day',now()+interval '1 day','2026-10-23T00:00:00Z','["HEALTH_EXPORT"]');

set local role service_role;
select pg_temp.assert_true(public.stage_garmin_health_push(jsonb_build_array(pg_temp.health_event('dailies',1792713600,'{"steps":450,"stress":null}')),array['80000000-0000-4000-8000-000000000001']::uuid[])=1,'Valid delivery is durably staged');
select pg_temp.assert_true((select count(*)=0 from public.garmin_health_records),'No domain processing before durable receipt');
select pg_temp.assert_true(public.stage_garmin_health_push(jsonb_build_array(pg_temp.health_event('dailies',1792713600,'{"steps":450,"stress":null}')),array['80000000-0000-4000-8000-000000000001']::uuid[])=0,'Exact redelivery is idempotent');
select pg_temp.assert_true(public.process_garmin_health_queue(array['80000000-0000-4000-8000-000000000001']::uuid[],25)=1,'Worker processes staged delivery');
select pg_temp.assert_true((select metrics->>'steps'='450' and metrics->'stress'='null'::jsonb from public.garmin_health_records),'Missing metrics stay null and measurements persist');
select pg_temp.assert_true((select payload is null from public.garmin_health_inbox),'Processed payload is erased, receipt hash retained');
select public.stage_garmin_health_push(jsonb_build_array(pg_temp.health_event('dailies',1792713600,'{"steps":500}',duration=>7200)),array['80000000-0000-4000-8000-000000000001']::uuid[]);
select public.process_garmin_health_queue(array['80000000-0000-4000-8000-000000000001']::uuid[],25);
select pg_temp.assert_true((select metrics->>'steps'='500' from public.garmin_health_records),'Longer updated monitoring window replaces prior summary');
select public.stage_garmin_health_push(jsonb_build_array(pg_temp.health_event('dailies',1792713600,'{"steps":400}',duration=>1800)),array['80000000-0000-4000-8000-000000000001']::uuid[]);
select public.process_garmin_health_queue(array['80000000-0000-4000-8000-000000000001']::uuid[],25);
select pg_temp.assert_true((select metrics->>'steps'='500' from public.garmin_health_records),'Out-of-order shorter record cannot regress the saved summary');
select public.stage_garmin_health_push(jsonb_build_array(pg_temp.health_event('dailies',1792713600,'{"steps":550}',duration=>7200)),array['80000000-0000-4000-8000-000000000001']::uuid[]);
select public.process_garmin_health_queue(array['80000000-0000-4000-8000-000000000001']::uuid[],25);
select pg_temp.assert_true((select count(*)=1 from public.garmin_health_inbox where state='conflict'),'Unversioned equal-duration change is quarantined');
select pg_temp.assert_true((select metrics->>'steps'='500' from public.garmin_health_records),'Ambiguous correction preserves known measurement');
select pg_temp.assert_true(public.stage_garmin_health_push(jsonb_build_array(pg_temp.health_event('dailies',1792713600,'{}',provider=>'unknown')),array['80000000-0000-4000-8000-000000000001']::uuid[])=0,'Unknown Garmin identity is ignored without creating a connection');
select pg_temp.assert_true(public.stage_garmin_health_push(jsonb_build_array(pg_temp.health_event('dailies',1792713600,'{}',provider=>'provider-two')),array['80000000-0000-4000-8000-000000000001']::uuid[])=0,'Unapproved linked user is not staged');
do $$begin
  begin perform public.stage_garmin_health_push(jsonb_build_array(pg_temp.health_event('dailies',1792713600,'{}')),null); raise exception 'Null allowlist accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.process_garmin_health_queue(null,25); raise exception 'Null worker allowlist accepted'; exception when invalid_parameter_value then null; end;
end$$;
select pg_temp.assert_true(true,'Null allowlist fails closed');
reset role;

set local role authenticated;
set local request.jwt.claim.sub='80000000-0000-4000-8000-000000000001';
select pg_temp.assert_true((select count(*)=1 from public.garmin_health_records),'Owner can SELECT their health records');
select pg_temp.assert_true((select count(*)=1 from public.garmin_health_sync_state),'Owner can SELECT safe import status');
do $$begin
  begin perform public.stage_garmin_health_push('[]',array[]::uuid[]); raise exception 'Client RPC allowed'; exception when insufficient_privilege then null; end;
  begin insert into public.garmin_health_records(user_id) values(auth.uid()); raise exception 'Client write allowed'; exception when insufficient_privilege then null; end;
  begin perform * from public.garmin_health_inbox; raise exception 'Inbox exposed'; exception when insufficient_privilege then null; end;
end$$;
select pg_temp.assert_true(true,'Authenticated client cannot write, stage or read inbox');
set local request.jwt.claim.sub='80000000-0000-4000-8000-000000000002';
select pg_temp.assert_true((select count(*)=0 from public.garmin_health_records),'Other user and coach identity cannot read athlete health');
select pg_temp.assert_true((select count(*)=0 from public.garmin_health_sync_state),'Other user cannot read athlete import status');
reset role;
set local role anon;
do $$begin
  begin perform * from public.garmin_health_records; raise exception 'Anonymous read allowed'; exception when insufficient_privilege then null; end;
end$$;
select pg_temp.assert_true(true,'Anonymous health access denied');
reset role;

-- Transaction rollback models a database/worker failure after staging, before commit.
savepoint interrupted_worker;
set local role service_role;
select public.stage_garmin_health_push(jsonb_build_array(pg_temp.health_event('activities',1792713600,'{"activityType":"RUNNING"}','activity-one')),array['80000000-0000-4000-8000-000000000001']::uuid[]);
reset role;
savepoint processing_failure;
set local role service_role;
select public.process_garmin_health_queue(array['80000000-0000-4000-8000-000000000001']::uuid[],25);
rollback to processing_failure;
select pg_temp.assert_true((select count(*)=1 from public.garmin_health_inbox where state='pending'),'Interrupted processing leaves durable work pending');
set local role service_role;
select public.process_garmin_health_queue(array['80000000-0000-4000-8000-000000000001']::uuid[],25);
select pg_temp.assert_true((select count(*)=1 from public.garmin_health_records where kind='activities'),'Retry safely completes the pending activity');
reset role;
rollback to interrupted_worker;

-- Verified notification schemas, with synthetic identifiers, from OAuth2 §9.
set local role service_role;
select public.stage_garmin_health_push(jsonb_build_array(jsonb_build_object('garminUserId','provider-one','kind','userPermissionsChange','sourceId','permission-one','hash',repeat('a',64),'changeTimeInSeconds',1792800000,'permissions','["ACTIVITY_EXPORT"]'::jsonb)),array['80000000-0000-4000-8000-000000000001']::uuid[]);
select public.process_garmin_health_queue(array['80000000-0000-4000-8000-000000000001']::uuid[],25);
select pg_temp.assert_true((select count(*)=0 from public.garmin_health_records),'Revoking health permission erases affected imported measurements');
select pg_temp.assert_true((select count(*)=0 from public.garmin_health_inbox where state='conflict'
  and kind in ('dailies','sleeps','stressDetails') and payload is not null),
  'Revoking health permission erases quarantined measurement payloads');
select pg_temp.assert_true((select count(*)=1 from public.garmin_health_inbox where state='conflict'
  and kind='dailies' and payload is null and error_code='ambiguous_update'),
  'Revocation preserves conflict receipt metadata without retaining measurement values');
select pg_temp.assert_true(public.stage_garmin_health_push(jsonb_build_array(pg_temp.health_event('dailies',1792713600,'{"steps":777}')),array['80000000-0000-4000-8000-000000000001']::uuid[])=0,'Revoked permission blocks subsequent health deliveries');
select public.stage_garmin_health_push(jsonb_build_array(jsonb_build_object('garminUserId','provider-one','kind','userPermissionsChange','sourceId','permission-old','hash',repeat('d',64),'changeTimeInSeconds',1792799999,'permissions','["HEALTH_EXPORT","ACTIVITY_EXPORT"]'::jsonb)),array['80000000-0000-4000-8000-000000000001']::uuid[]);
select public.process_garmin_health_queue(array['80000000-0000-4000-8000-000000000001']::uuid[],25);
select pg_temp.assert_true((select not(granted_permissions ? 'HEALTH_EXPORT') from public.garmin_health_sync_state where user_id='80000000-0000-4000-8000-000000000001'),'Older permission notice cannot restore revoked access');
savepoint quarantined_activity_revocation;
select public.stage_garmin_health_push(jsonb_build_array(pg_temp.health_event('activities',1792713600,'{"distanceMeters":100}','privacy-conflict')),array['80000000-0000-4000-8000-000000000001']::uuid[]);
select public.process_garmin_health_queue(array['80000000-0000-4000-8000-000000000001']::uuid[],25);
select public.stage_garmin_health_push(jsonb_build_array(pg_temp.health_event('activities',1792713600,'{"distanceMeters":200}','privacy-conflict')),array['80000000-0000-4000-8000-000000000001']::uuid[]);
select public.process_garmin_health_queue(array['80000000-0000-4000-8000-000000000001']::uuid[],25);
savepoint direct_activity_revocation;
select public.stage_garmin_health_push(jsonb_build_array(jsonb_build_object('garminUserId','provider-one','kind','userPermissionsChange','sourceId','permission-remove-activity','hash',repeat('f',64),'changeTimeInSeconds',1792800001,'permissions','[]'::jsonb)),array['80000000-0000-4000-8000-000000000001']::uuid[]);
select public.process_garmin_health_queue(array['80000000-0000-4000-8000-000000000001']::uuid[],25);
select pg_temp.assert_true((select count(*)=0 from public.garmin_health_inbox where kind='activities' and state='conflict' and payload is not null),
  'Revoking activity permission erases quarantined activity values');
rollback to direct_activity_revocation;
select public.stage_garmin_health_push(jsonb_build_array(jsonb_build_object('garminUserId','provider-one','kind','userPermissionsChange','sourceId','permission-ambiguous-removal','hash',repeat('f',64),'changeTimeInSeconds',1792800000,'permissions','["HEALTH_EXPORT"]'::jsonb)),array['80000000-0000-4000-8000-000000000001']::uuid[]);
select public.process_garmin_health_queue(array['80000000-0000-4000-8000-000000000001']::uuid[],25);
select pg_temp.assert_true((select count(*)=0 from public.garmin_health_inbox where kind='activities' and state='conflict' and payload is not null),
  'Ambiguous permission intersection erases revoked quarantined activity values');
select pg_temp.assert_true((select count(*)=1 from public.garmin_health_inbox where kind='activities' and state='conflict' and payload is null),
  'Ambiguous permission cleanup keeps the minimal activity conflict receipt');
rollback to quarantined_activity_revocation;
savepoint permission_collision;
select public.stage_garmin_health_push(jsonb_build_array(jsonb_build_object('garminUserId','provider-one','kind','userPermissionsChange','sourceId','permission-tie','hash',repeat('e',64),'changeTimeInSeconds',1792800000,'permissions','["HEALTH_EXPORT","ACTIVITY_EXPORT"]'::jsonb)),array['80000000-0000-4000-8000-000000000001']::uuid[]);
select public.process_garmin_health_queue(array['80000000-0000-4000-8000-000000000001']::uuid[],25);
select pg_temp.assert_true((select state='reconciliation_required' from public.garmin_health_sync_state where user_id='80000000-0000-4000-8000-000000000001'),'Conflicting same-second permission notice requires verification');
select pg_temp.assert_true((select not(granted_permissions ? 'HEALTH_EXPORT') from public.garmin_health_sync_state where user_id='80000000-0000-4000-8000-000000000001'),'Ambiguous permission ordering never restores revoked access');
rollback to permission_collision;
select public.stage_garmin_health_push(jsonb_build_array(pg_temp.health_event('activities',1792713600,'{"activityType":"WALKING"}','activity-two')),array['80000000-0000-4000-8000-000000000001']::uuid[]);
select public.process_garmin_health_queue(array['80000000-0000-4000-8000-000000000001']::uuid[],25);
select pg_temp.assert_true((select count(*)=1 from public.garmin_health_records where kind='activities'),'Unrevoked activity permission remains usable');
select public.stage_garmin_health_push(jsonb_build_array(jsonb_build_object('garminUserId','provider-one','kind','deregistrations','sourceId','deregistration','hash',repeat('b',64))),array['80000000-0000-4000-8000-000000000001']::uuid[]);
select public.process_garmin_health_queue(array['80000000-0000-4000-8000-000000000001']::uuid[],25);
select pg_temp.assert_true((select state='reconciliation_required' from public.garmin_health_sync_state where user_id='80000000-0000-4000-8000-000000000001'),'Untimestamped deregistration pauses ingestion for reconciliation');
select pg_temp.assert_true((select token_ciphertext='synthetic' from public.garmin_connections where garmin_user_id='provider-one'),'Deregistration notice does not erase recovery credentials or fake cleanup');
reset role;

-- Successful existing disconnect clears imported records, inbox and state atomically.
set local role service_role;
update public.garmin_connections set status='disconnected',garmin_user_id=null,token_ciphertext=null where user_id='80000000-0000-4000-8000-000000000001';
select pg_temp.assert_true((select count(*)=0 from public.garmin_health_records),'Successful disconnect removes imported records');
select pg_temp.assert_true((select count(*)=0 from public.garmin_health_inbox),'Successful disconnect removes receipt/conflict records');
select pg_temp.assert_true((select count(*)=0 from public.garmin_health_sync_state),'Successful disconnect removes import status');
select pg_temp.assert_true(public.stage_garmin_health_push(jsonb_build_array(pg_temp.health_event('dailies',1792713600,'{}')),array['80000000-0000-4000-8000-000000000001']::uuid[])=0,'Late delivery cannot recreate a disconnected connection');
select public.stage_garmin_health_push(jsonb_build_array(pg_temp.health_event('dailies',1792713600,'{"steps":123}',provider=>'provider-two')),array['80000000-0000-4000-8000-000000000002']::uuid[]);
select public.process_garmin_health_queue(array['80000000-0000-4000-8000-000000000002']::uuid[],25);
select public.stage_garmin_health_push(jsonb_build_array(pg_temp.health_event('dailies',1792713601,'{"steps":124}',source=>'pending-reauth',provider=>'provider-two')),array['80000000-0000-4000-8000-000000000002']::uuid[]);
update public.garmin_connections set authorized_at='2026-10-24T00:00:00Z' where user_id='80000000-0000-4000-8000-000000000002';
select pg_temp.assert_true((select count(*)=0 from public.garmin_health_inbox where user_id='80000000-0000-4000-8000-000000000002'),'New authorization invalidates pending receipts from the previous authorization');
update public.garmin_connections set deletion_requested_at=now() where user_id='80000000-0000-4000-8000-000000000002';
select pg_temp.assert_true(public.stage_garmin_health_push(jsonb_build_array(pg_temp.health_event('dailies',1792713600,'{}',provider=>'provider-two')),array['80000000-0000-4000-8000-000000000002']::uuid[])=0,'Deletion fence rejects incoming health data');
select pg_temp.assert_true((select deletion_requested_at is not null from public.garmin_connections where garmin_user_id='provider-two'),'Existing deletion fence remains intact');
select pg_temp.assert_true((select count(*)=1 from public.garmin_health_records where user_id='80000000-0000-4000-8000-000000000002'),'Failed or pending cleanup preserves health records until confirmed removal');
reset role;
delete from auth.users where id='80000000-0000-4000-8000-000000000002';
select pg_temp.assert_true((select count(*)=0 from public.garmin_health_records where user_id='80000000-0000-4000-8000-000000000002'),'Auth deletion cascades nonempty owned health storage');
rollback;
