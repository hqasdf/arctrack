begin;
create function pg_temp.hr_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end; $$;
create function pg_temp.pull_event(p_user text,p_suffix text,p_hash text) returns jsonb language sql as $$
 select jsonb_build_object('garminUserId',p_user,'kind','activities','sourceId','activity-pull:'||p_suffix,
 'recordKey','activity-pull:'||p_suffix,'hash',p_hash,'calendarDate',current_date::text,
 'startTimeInSeconds',floor(extract(epoch from clock_timestamp()))::bigint-60,'durationInSeconds',0,'values','{}'::jsonb,
 'permissions',null,'changeTimeInSeconds',null,'activityDetailsPull',jsonb_build_object('kind','activityDetails','callbackCiphertext','v1.encrypted-callback-capability')); $$;
insert into auth.users values('86000000-0000-4000-8000-000000000001','hr-owner@example.invalid'),('86000000-0000-4000-8000-000000000002','hr-other@example.invalid');
insert into public.sessions values('86000000-0000-4000-8000-000000000010','86000000-0000-4000-8000-000000000001','HR test',0);
insert into public.garmin_connections(user_id,garmin_user_id,status,token_ciphertext,access_expires_at,refresh_after,authorized_at,permissions)
values('86000000-0000-4000-8000-000000000001','hr-fixture','connected','synthetic',now()+interval '1 day',now()+interval '1 day','2026-10-23','["HEALTH_EXPORT","ACTIVITY_EXPORT"]');
set local role service_role;
select public.admit_garmin_health_push(jsonb_build_array(jsonb_build_object(
 'garminUserId','hr-fixture','kind','activities','sourceId','activity-pull:'||repeat('b',64),'recordKey','activity-pull:'||repeat('b',64),
 'hash',repeat('c',64),'calendarDate',current_date::text,'startTimeInSeconds',floor(extract(epoch from clock_timestamp()))::bigint-60,'durationInSeconds',0,
 'values','{}'::jsonb,'permissions',null,'changeTimeInSeconds',null,
 'activityDetailsPull',jsonb_build_object('kind','activityDetails','callbackCiphertext','v1.encrypted-callback-capability'))));
select public.process_garmin_health_queue(50);
select pg_temp.hr_assert((select count(*)=1 and bool_and(state='pending' and callback_ciphertext like 'v1.%') from public.garmin_activity_detail_pulls),'Activity Details ping becomes a durable encrypted pull receipt');
select pg_temp.hr_assert(not exists(select 1 from public.garmin_health_inbox where payload::text like '%callbackUrl%'),'Plain callback URL is never retained in the generic inbox');
select pg_temp.hr_assert((select count(*)=1 from public.claim_garmin_activity_detail_pulls(2)),'Service worker claims one bounded due Activity pull');
select pg_temp.hr_assert(public.finish_garmin_activity_detail_pull((select id from public.garmin_activity_detail_pulls limit 1),(select lease_token from public.garmin_activity_detail_pulls limit 1),'retry','provider_retryable'),'Retryable provider result is durably rescheduled');
select pg_temp.hr_assert((select state='retry' and attempts=1 and callback_ciphertext is not null and lease_token is null from public.garmin_activity_detail_pulls limit 1),'Retry retains encrypted callback state and increments its attempt');
update public.garmin_activity_detail_pulls set next_attempt_at=clock_timestamp();
select public.claim_garmin_activity_detail_pulls(1);
select pg_temp.hr_assert(not public.finish_garmin_activity_detail_pull((select id from public.garmin_activity_detail_pulls limit 1),gen_random_uuid(),'complete',null),'A stale worker lease cannot complete a reclaimed pull');
select pg_temp.hr_assert(public.finish_garmin_activity_detail_pull((select id from public.garmin_activity_detail_pulls limit 1),(select lease_token from public.garmin_activity_detail_pulls limit 1),'reject','provider_rejected'),'Current worker lease can safely reject a permanent provider response');
reset role;
select pg_temp.hr_assert(not has_table_privilege('anon','public.garmin_activity_detail_pulls','select'),'Anonymous users cannot read Activity callback credentials');
select pg_temp.hr_assert(not has_table_privilege('authenticated','public.garmin_activity_detail_pulls','select'),'Authenticated clients cannot read Activity callback credentials');
select pg_temp.hr_assert(not has_function_privilege('authenticated','public.claim_garmin_activity_detail_pulls(integer)','execute'),'Activity pull claim RPC is service-only');
set local role service_role;
create function pg_temp.hr_event(part integer,revision text default 'a',samples jsonb default '[[1792882800,100],[1792882810,110]]',parts integer default 2,total integer default 3) returns jsonb language sql as $$
 select jsonb_build_object('garminUserId','hr-fixture','kind','activities','sourceId','hr-activity','recordKey','hr-activity',
 'hash',md5(revision||part::text)||md5(samples::text),'calendarDate','2026-10-25','startTimeInSeconds',1792882800,'durationInSeconds',3600,'values','{}'::jsonb,
 'heartRate',jsonb_build_object('source','activity','revision',repeat(revision,64),'part',part,'parts',parts,'count',total,'activityType','ARCHERY','samples',samples)); $$;
insert into public.garmin_connections(user_id,garmin_user_id,status,token_ciphertext,access_expires_at,refresh_after,authorized_at,permissions)
values('86000000-0000-4000-8000-000000000002','hr-other-fixture','connected','synthetic',now()+interval '1 day',now()+interval '1 day','2026-10-23','["HEALTH_EXPORT","ACTIVITY_EXPORT"]');
select public.admit_garmin_health_push(jsonb_build_array(pg_temp.pull_event('hr-other-fixture',repeat('f',64),repeat('1',64))));
select public.process_garmin_health_queue(50);
select pg_temp.hr_assert(exists(select 1 from public.garmin_activity_detail_pulls where user_id='86000000-0000-4000-8000-000000000002' and state='pending'),'Second owner has an isolated pending callback pull');
update public.garmin_health_sync_state set granted_permissions='["HEALTH_EXPORT"]' where user_id='86000000-0000-4000-8000-000000000002';
select pg_temp.hr_assert(not exists(select 1 from public.garmin_activity_detail_pulls where user_id='86000000-0000-4000-8000-000000000002'),'Permission revocation removes queued Activity callback capabilities');
update public.garmin_health_sync_state set granted_permissions='["HEALTH_EXPORT","ACTIVITY_EXPORT"]' where user_id='86000000-0000-4000-8000-000000000002';
select public.admit_garmin_health_push(jsonb_build_array(pg_temp.pull_event('hr-other-fixture',repeat('2',64),repeat('2',64))));
select public.process_garmin_health_queue(50);
update public.garmin_connections set status='disconnected' where user_id='86000000-0000-4000-8000-000000000002';
select pg_temp.hr_assert(not exists(select 1 from public.garmin_activity_detail_pulls where user_id='86000000-0000-4000-8000-000000000002'),'Disconnect removes queued Activity callback capabilities');
set local role service_role;
select pg_temp.hr_assert(public.admit_garmin_health_push(jsonb_build_array(pg_temp.hr_event(0)))->>'status'='accepted','HR chunks use durable admission');
select public.process_garmin_health_queue(50);
select pg_temp.hr_assert((select count(*)=1 and bool_and(not published) from public.garmin_hr_datasets),'Partial HR is not published');
select pg_temp.hr_assert(not exists(select 1 from public.garmin_health_records where source_id='hr-activity'),'HR series never enter dashboard metrics JSON');
select public.admit_garmin_health_push(jsonb_build_array(pg_temp.hr_event(1,'a','[[1792882820,120]]')));
select public.process_garmin_health_queue(50);
select pg_temp.hr_assert((select count(*)=1 and bool_and(published) from public.garmin_hr_datasets),'Complete validated HR dataset is published');
select pg_temp.hr_assert(public.admit_garmin_health_push(jsonb_build_array(pg_temp.hr_event(0)))->>'status'='duplicate','HR duplicate receipts do not duplicate samples');
select pg_temp.hr_assert((select sum(jsonb_array_length(samples))=3 from public.garmin_hr_chunks),'Original sample count remains intact');
reset role;
select set_config('request.jwt.claim.sub','86000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.hr_assert((select count(*)=1 from public.garmin_hr_datasets),'Owner can read authorized HR dataset');
select public.set_session_recording_window('86000000-0000-4000-8000-000000000010','manual',null,to_timestamp(1792882800),to_timestamp(1792886400));
select public.set_session_recording_window('86000000-0000-4000-8000-000000000010','link',(select updated_at from public.session_recording_windows),'epoch','epoch','hr-activity');
select pg_temp.hr_assert(public.read_session_garmin_hr('86000000-0000-4000-8000-000000000010')->'datasets'->0->'samples'='[[1792882800,100],[1792882810,110],[1792882820,120]]'::jsonb,'Owner Session RPC returns original bounded HR samples');
select pg_temp.hr_assert((select activity_id='hr-activity' from public.session_recording_windows),'Explicit activity association persists');
select set_config('request.jwt.claim.sub','86000000-0000-4000-8000-000000000002',true);
select pg_temp.hr_assert(not exists(select 1 from public.garmin_hr_datasets),'Other athlete or coach cannot read dataset');
select pg_temp.hr_assert(not exists(select 1 from public.garmin_hr_chunks),'Other athlete or coach cannot read samples');
select pg_temp.hr_assert(public.read_session_garmin_hr('86000000-0000-4000-8000-000000000010') is null,'Scoring Session identity does not grant private HR');
reset role;
select pg_temp.hr_assert(not has_table_privilege('anon','public.garmin_hr_chunks','select'),'Anonymous HR reads denied');
select pg_temp.hr_assert(not has_table_privilege('authenticated','public.garmin_hr_chunks','insert'),'Client cannot forge HR measurements');
select pg_temp.hr_assert(not has_function_privilege('authenticated','private.store_garmin_hr_chunk(uuid,timestamptz,uuid,jsonb)','execute'),'HR processor service-only');
set local role service_role;
select public.admit_garmin_health_push(jsonb_build_array(pg_temp.hr_event(0,'b','[[1792882800,99],[1792882810,110],[1792882820,120]]',1,3)));
select public.process_garmin_health_queue(50);
select pg_temp.hr_assert((select count(*)=1 from public.garmin_hr_datasets where state='conflict' and not published),'Ambiguous HR correction quarantined');
select pg_temp.hr_assert((select revision=repeat('a',64) from public.garmin_hr_datasets where published),'Conflicting revision cannot replace known recording');
select public.admit_garmin_health_push(jsonb_build_array(pg_temp.hr_event(0,'c','[[1792882800,100],[1792882810,110],[1792882820,120],[1792882830,125]]',1,4)));
select public.process_garmin_health_queue(50);
select pg_temp.hr_assert((select sample_count=4 from public.garmin_hr_datasets where published),'Strictly compatible extension replaces published HR atomically');
select public.admit_garmin_health_push(jsonb_build_array(jsonb_build_object('garminUserId','hr-fixture','kind','activities',
 'sourceId','activity-pull:'||repeat('d',64),'recordKey','activity-pull:'||repeat('d',64),'hash',repeat('e',64),'calendarDate',current_date::text,
 'startTimeInSeconds',floor(extract(epoch from clock_timestamp()))::bigint-30,'durationInSeconds',0,'values','{}'::jsonb,'permissions',null,
 'changeTimeInSeconds',null,'activityDetailsPull',jsonb_build_object('kind','activityDetails','callbackCiphertext','v1.encrypted-callback-capability'))));
select public.process_garmin_health_queue(50);
select pg_temp.hr_assert(exists(select 1 from public.garmin_activity_detail_pulls where state='pending'),'A pending callback is queued before pause');
select public.control_garmin_health('86000000-0000-4000-8000-000000000001','pause',(select generation from public.garmin_health_controls where user_id='86000000-0000-4000-8000-000000000001'),gen_random_uuid());
select pg_temp.hr_assert(not exists(select 1 from public.garmin_activity_detail_pulls where state in ('pending','retry','processing')),'Pause fences and erases queued callback capabilities');
select pg_temp.hr_assert((select count(*)=1 from public.garmin_hr_datasets where published),'Pause preserves already imported HR');
select pg_temp.hr_assert(public.admit_garmin_health_push(jsonb_build_array(pg_temp.hr_event(0,'d')))->>'status'='ineligible','Paused HR notification cannot be admitted');
select public.control_garmin_health('86000000-0000-4000-8000-000000000001','delete',(select generation from public.garmin_health_controls where user_id='86000000-0000-4000-8000-000000000001'),gen_random_uuid());
select pg_temp.hr_assert(not exists(select 1 from public.garmin_hr_datasets),'Delete Health Data removes published and quarantined HR');
select pg_temp.hr_assert(not exists(select 1 from public.garmin_hr_chunks),'Delete Health Data cascades all chunks');
select pg_temp.hr_assert((select token_ciphertext='synthetic' and status='connected' from public.garmin_connections where garmin_user_id='hr-fixture'),'Health deletion preserves OAuth credentials');
select pg_temp.hr_assert((select activity_id is null and started_at is not null from public.session_recording_windows),'Health deletion clears association and preserves manual Session timing');
select pg_temp.hr_assert(not exists(select 1 from public.garmin_health_inbox where user_id='86000000-0000-4000-8000-000000000001'),'Deletion removes queued HR and receipt payloads');
select pg_temp.hr_assert(public.admit_garmin_health_push(jsonb_build_array(pg_temp.hr_event(0,'e')))->>'status'='ineligible','Delayed HR replay cannot undo deletion');
reset role;
rollback;
-- Additional isolated ownership, timing, revocation and disconnect checks.
begin;
create function pg_temp.hr2_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end; $$;
insert into auth.users values('87000000-0000-4000-8000-000000000001','hr2@example.invalid'),('87000000-0000-4000-8000-000000000002','hr2-other@example.invalid');
insert into public.sessions values('87000000-0000-4000-8000-000000000010','87000000-0000-4000-8000-000000000001','HR second',0),('87000000-0000-4000-8000-000000000020','87000000-0000-4000-8000-000000000001','HR third',0);
insert into public.garmin_connections(user_id,garmin_user_id,status,token_ciphertext,access_expires_at,refresh_after,authorized_at,permissions)
values('87000000-0000-4000-8000-000000000001','hr2-fixture','connected','synthetic',now()+interval '1 day',now()+interval '1 day','2026-10-23','["HEALTH_EXPORT","ACTIVITY_EXPORT"]');
select set_config('request.jwt.claim.sub','87000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.set_session_recording_window('87000000-0000-4000-8000-000000000010','start',null);
select pg_temp.hr2_assert((select started_at is not null and finished_at is null from public.session_recording_windows),'Server timer starts without guessed arrow times');
select public.set_session_recording_window('87000000-0000-4000-8000-000000000010','finish',(select updated_at from public.session_recording_windows));
select pg_temp.hr2_assert((select finished_at>started_at from public.session_recording_windows),'Server timer finishes with UTC timestamp');
do $$ begin
 begin perform public.set_session_recording_window('87000000-0000-4000-8000-000000000010','manual',null,now(),now()+interval '1 hour');raise exception 'Stale revision accepted';exception when serialization_failure then null;end;
 raise notice 'PASS: Concurrent timing change requires refresh';
 begin perform public.set_session_recording_window('87000000-0000-4000-8000-000000000010','manual',(select updated_at from public.session_recording_windows),now(),now()-interval '1 hour');raise exception 'Negative interval accepted';exception when check_violation then null;end;
 raise notice 'PASS: Negative Session interval rejected';
end $$;
reset role;
set local role service_role;
select public.admit_garmin_health_push(jsonb_build_array(jsonb_build_object('garminUserId','hr2-fixture','kind','activities','sourceId','hr2','recordKey','hr2','hash',repeat('f',64),'calendarDate','2026-10-25','startTimeInSeconds',1792882800,'durationInSeconds',3600,'values','{}'::jsonb,'heartRate',jsonb_build_object('source','activity','revision',repeat('a',64),'part',0,'parts',1,'count',2,'samples','[[1792882800,100],[1792882810,120]]'::jsonb))));
select public.process_garmin_health_queue(50);
reset role;
set local role authenticated;
select public.set_session_recording_window('87000000-0000-4000-8000-000000000010','manual',(select updated_at from public.session_recording_windows),to_timestamp(1792882800),to_timestamp(1792884600));
select public.set_session_recording_window('87000000-0000-4000-8000-000000000020','manual',null,to_timestamp(1792884600),to_timestamp(1792886400));
select public.set_session_recording_window('87000000-0000-4000-8000-000000000010','link',(select updated_at from public.session_recording_windows where session_id='87000000-0000-4000-8000-000000000010'),null,null,'hr2');
select public.set_session_recording_window('87000000-0000-4000-8000-000000000020','link',(select updated_at from public.session_recording_windows where session_id='87000000-0000-4000-8000-000000000020'),null,null,'hr2');
select pg_temp.hr2_assert((select count(*)=2 from public.session_recording_windows where activity_id='hr2'),'Two Sessions may confirm different portions of one recording');
select pg_temp.hr2_assert(public.read_session_garmin_hr('87000000-0000-4000-8000-000000000020')->'datasets'->0->'samples'='[]'::jsonb,'Session samples are clipped to confirmed shooting interval');
select pg_temp.hr2_assert((public.read_session_garmin_hr('87000000-0000-4000-8000-000000000010',public.read_session_garmin_hr('87000000-0000-4000-8000-000000000010')->>'revision')->>'unchanged')::boolean,'Conditional reader skips unchanged HR arrays');
select set_config('request.jwt.claim.sub','87000000-0000-4000-8000-000000000002',true);
do $$ begin
 begin perform public.set_session_recording_window('87000000-0000-4000-8000-000000000010','start',null);raise exception 'Other user allowed';exception when insufficient_privilege then null;end;
 raise notice 'PASS: Other athlete cannot edit Session timing or activity association';
end $$;
reset role;
update public.garmin_health_sync_state set granted_permissions='["HEALTH_EXPORT"]' where user_id='87000000-0000-4000-8000-000000000001';
select pg_temp.hr2_assert(not exists(select 1 from public.garmin_hr_datasets),'Permission-revocation notification erases activity HR');
-- Seed only through the internal validated function to exercise independent cleanup.
set local role service_role;
select private.store_garmin_hr_chunk('87000000-0000-4000-8000-000000000001','2026-10-23',(select generation from public.garmin_health_controls where user_id='87000000-0000-4000-8000-000000000001'),jsonb_build_object('kind','dailies','sourceId','daily-hr','startTimeInSeconds',1792882800,'durationInSeconds',86400,'heartRate',jsonb_build_object('source','daily','revision',repeat('b',64),'part',0,'parts',1,'count',1,'samples','[[1792882815,80]]'::jsonb)));
reset role;
update public.garmin_connections set status='disconnected',token_ciphertext=null,garmin_user_id=null where user_id='87000000-0000-4000-8000-000000000001';
select pg_temp.hr2_assert(not exists(select 1 from public.garmin_hr_datasets),'Confirmed disconnect erases all HR datasets');
select pg_temp.hr2_assert(not exists(select 1 from public.garmin_hr_chunks),'Disconnect erases chunks');
select pg_temp.hr2_assert((select count(*)=2 from public.session_recording_windows where activity_id is null),'Disconnect removes associations while preserving Session timing');
-- The legacy disposable baseline intentionally omits the production Sessions
-- ON DELETE CASCADE FK. Remove only synthetic Sessions before deleting its user.
delete from public.sessions where user_id='87000000-0000-4000-8000-000000000001';
delete from auth.users where id='87000000-0000-4000-8000-000000000001';
select pg_temp.hr2_assert(not exists(select 1 from public.session_recording_windows),'Account deletion cascades timing state');
rollback;

-- Full-data Starter Push: one atomic receipt may contain >100 HR chunks.
begin;
create function pg_temp.hr_batch_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end; $$;
create function pg_temp.hr_batch(p_source text) returns jsonb language sql as $$
 select jsonb_agg(jsonb_build_object('garminUserId','starter-hr','kind','activities','sourceId',p_source,'recordKey',p_source,
 'hash',md5(p_source||i::text)||md5('sample'||i::text),'calendarDate','2026-10-25','startTimeInSeconds',1792882800,'durationInSeconds',1000,
 'values','{}'::jsonb,'heartRate',jsonb_build_object('source','activity','revision',repeat('a',64),'part',i,'parts',101,'count',101,
 'activityType','ARCHERY','samples',jsonb_build_array(jsonb_build_array(1792882800+i,100)))) order by i)
 from generate_series(0,100) i; $$;
insert into auth.users values('88000000-0000-4000-8000-000000000001','starter@example.invalid'),('88000000-0000-4000-8000-000000000002','expired@example.invalid');
insert into public.garmin_connections(user_id,garmin_user_id,status,token_ciphertext,access_expires_at,refresh_after,authorized_at,permissions)
 values('88000000-0000-4000-8000-000000000001','starter-hr','connected','synthetic',now()+interval '1 day',now()+interval '1 day','2026-10-23','["HEALTH_EXPORT","ACTIVITY_EXPORT"]'),
 ('88000000-0000-4000-8000-000000000002','starter-expired','connected','synthetic',now()-interval '1 second',now()+interval '1 day','2026-10-23','["HEALTH_EXPORT","ACTIVITY_EXPORT"]');
set local role service_role;
select pg_temp.hr_batch_assert((public.admit_garmin_hr_push(pg_temp.hr_batch('starter-full'))->>'accepted')::integer=101,'Starter delivery atomically admits more than 100 bounded HR chunks');
select public.process_garmin_health_queue(50);
select pg_temp.hr_batch_assert(not exists(select 1 from public.garmin_hr_datasets where published),'Bounded worker cannot publish a partial Starter recording');
select public.process_garmin_health_queue(50);select public.process_garmin_health_queue(50);
select pg_temp.hr_batch_assert((select count(*)=1 and bool_and(published and sample_count=101) from public.garmin_hr_datasets),'Complete Starter recording publishes only after every chunk is processed');
select pg_temp.hr_batch_assert(public.admit_garmin_hr_push(pg_temp.hr_batch('starter-full'))->>'status'='duplicate','Large Starter replay does not duplicate recorded samples');
select pg_temp.hr_batch_assert(public.admit_garmin_hr_push(pg_temp.hr_batch('must-rollback')||jsonb_build_array(jsonb_build_object(
 'garminUserId','starter-expired','kind','activities','sourceId','expired','recordKey','expired','hash',repeat('c',64),
 'calendarDate','2026-10-25','startTimeInSeconds',1792882800,'durationInSeconds',1000,'values','{}'::jsonb)))->>'status'='temporary',
 'Later retryable owner failure rejects the entire expanded Push');
select pg_temp.hr_batch_assert(not exists(select 1 from public.garmin_health_inbox where source_id='must-rollback'),'Expanded Push rolls back earlier sub-batches on temporary failure');
reset role;
select pg_temp.hr_batch_assert(not has_function_privilege('anon','public.admit_garmin_hr_push(jsonb)','execute')
 and not has_function_privilege('authenticated','public.admit_garmin_hr_push(jsonb)','execute'),'Expanded HR admission remains service-only');
rollback;
