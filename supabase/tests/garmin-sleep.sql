-- Synthetic sleep only. Rollback-only; invoked exclusively by the disposable runner.
begin;
create function pg_temp.sleep_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end; $$;
create function pg_temp.sleep_event(validation text,score integer,hash text) returns jsonb language sql as $$
  select jsonb_build_object('garminUserId','sleep-fixture','kind','sleeps','sourceId','sleep-summary',
    'recordKey','1792882800','hash',repeat(hash,64),'calendarDate','2026-10-25','startTimeInSeconds',1792882800,
    'durationInSeconds',27000,'values',jsonb_build_object('sleepSeconds',27000,'sleepScore',score,
      'sleepScoreQualifier','GOOD','sleepValidation',validation,'lightSeconds',18000,'deepSeconds',4500,'remSeconds',4500,'awakeSeconds',1800));
$$;
insert into auth.users values('85000000-0000-4000-8000-000000000001','sleep@example.invalid'),
  ('85000000-0000-4000-8000-000000000002','sleep-other@example.invalid');
insert into public.garmin_connections(user_id,garmin_user_id,status,token_ciphertext,access_expires_at,refresh_after,authorized_at,permissions)
  values('85000000-0000-4000-8000-000000000001','sleep-fixture','connected','synthetic',now()+interval '1 day',now()+interval '1 day','2026-10-23','["HEALTH_EXPORT","ACTIVITY_EXPORT"]');
set local role service_role;
select public.admit_garmin_health_push(jsonb_build_array(pg_temp.sleep_event('ENHANCED_TENTATIVE',70,'a')));
select public.process_garmin_health_queue(25);
select pg_temp.sleep_assert((select metrics->>'sleepScore'='70' from public.garmin_health_records where source_id='sleep-summary'),'Sleep tentative score is stored');
select public.admit_garmin_health_push(jsonb_build_array(pg_temp.sleep_event('ENHANCED_FINAL',87,'b')));
select public.process_garmin_health_queue(25);
select pg_temp.sleep_assert((select metrics->>'sleepScore'='87' and metrics->>'sleepValidation'='ENHANCED_FINAL' from public.garmin_health_records where source_id='sleep-summary'),'Same-duration documented tentative-to-final sleep refinement is accepted');
select pg_temp.sleep_assert(public.admit_garmin_health_push(jsonb_build_array(pg_temp.sleep_event('ENHANCED_FINAL',87,'b')))->>'status'='duplicate','Sleep duplicate cannot create another record');
select public.admit_garmin_health_push(jsonb_build_array(pg_temp.sleep_event('ENHANCED_TENTATIVE',60,'c')));
select public.process_garmin_health_queue(25);
select pg_temp.sleep_assert((select metrics->>'sleepScore'='87' from public.garmin_health_records where source_id='sleep-summary'),'Delayed preliminary sleep cannot overwrite a final record');
select public.admit_garmin_health_push(jsonb_build_array(pg_temp.sleep_event('ENHANCED_TENTATIVE',60,'f') || '{"durationInSeconds":28000}'::jsonb));
select public.process_garmin_health_queue(25);
select pg_temp.sleep_assert((select duration_seconds=27000 and metrics->>'sleepScore'='87' from public.garmin_health_records where source_id='sleep-summary'),'Even a longer delayed preliminary sleep cannot regress final analysis');
select public.admit_garmin_health_push(jsonb_build_array(pg_temp.sleep_event('ENHANCED_FINAL',88,'d')));
select public.process_garmin_health_queue(25);
select pg_temp.sleep_assert((select state='conflict' from public.garmin_health_inbox where content_hash=repeat('d',64)),'Ambiguous final-to-final correction remains quarantined');
select public.admit_garmin_health_push(jsonb_build_array(pg_temp.sleep_event('AUTO_TENTATIVE',null,'1') ||
  '{"sourceId":"auto-summary","recordKey":"1792969200","startTimeInSeconds":1792969200,"calendarDate":"2026-10-26"}'::jsonb));
select public.process_garmin_health_queue(25);
select pg_temp.sleep_assert((select metrics->'sleepScore'='null'::jsonb and metrics->>'sleepSeconds'='27000' from public.garmin_health_records where source_id='auto-summary'),'Missing Sleep Score does not prevent duration storage');
select public.admit_garmin_health_push(jsonb_build_array(pg_temp.sleep_event('AUTO_FINAL',87,'2') ||
  '{"sourceId":"auto-summary","recordKey":"1792969200","startTimeInSeconds":1792969200,"calendarDate":"2026-10-26"}'::jsonb));
select public.process_garmin_health_queue(25);
select pg_temp.sleep_assert((select metrics->>'sleepScore'='87' and metrics->>'sleepValidation'='AUTO_FINAL' from public.garmin_health_records where source_id='auto-summary'),'AUTO tentative-to-final refinement is accepted');
select public.admit_garmin_health_push(jsonb_build_array(pg_temp.sleep_event('AUTO_FINAL',88,'3') ||
  '{"sourceId":"auto-summary","recordKey":"1792969200","startTimeInSeconds":1792969200,"calendarDate":"2026-10-26","durationInSeconds":26900}'::jsonb));
select public.process_garmin_health_queue(25);
select pg_temp.sleep_assert((select duration_seconds=27000 and metrics->>'sleepScore'='87' from public.garmin_health_records where source_id='auto-summary'),'Unsupported shorter sleep revision remains rejected');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','85000000-0000-4000-8000-000000000002',true);
select pg_temp.sleep_assert(not exists(select 1 from public.garmin_health_records where source_id='sleep-summary'),'Another user cannot read sleep data');
select set_config('request.jwt.claim.sub','85000000-0000-4000-8000-000000000001',true);
select pg_temp.sleep_assert((select count(*)=1 from public.garmin_health_records where source_id='sleep-summary'),'Sleep remains owner-readable');
reset role;
select pg_temp.sleep_assert(not has_function_privilege('authenticated','private.process_garmin_health_queue_v1(uuid[],integer)','EXECUTE')
  and not has_function_privilege('anon','private.process_garmin_health_queue_v1(uuid[],integer)','EXECUTE'),'Inner sleep processor remains service-only');
update public.garmin_connections set permissions='["ACTIVITY_EXPORT"]' where garmin_user_id='sleep-fixture';
select pg_temp.sleep_assert(not exists(select 1 from public.garmin_health_records where source_id='sleep-summary'),'HEALTH_EXPORT revocation deletes sleep measurements');
update public.garmin_connections set permissions='["HEALTH_EXPORT","ACTIVITY_EXPORT"]' where garmin_user_id='sleep-fixture';
set local role service_role;
select public.control_garmin_health('85000000-0000-4000-8000-000000000001','delete',
  (select generation from public.garmin_health_controls where user_id='85000000-0000-4000-8000-000000000001'),gen_random_uuid());
select pg_temp.sleep_assert(not exists(select 1 from public.garmin_health_inbox where source_id='sleep-summary'),'Delete Health Data erases sleep receipts and conflicts');
select pg_temp.sleep_assert((select paused from public.garmin_health_controls where user_id='85000000-0000-4000-8000-000000000001'),'Sleep deletion preserves the durable pause');
select pg_temp.sleep_assert((select status='connected' and token_ciphertext='synthetic' from public.garmin_connections where garmin_user_id='sleep-fixture'),'Sleep deletion preserves OAuth');
select pg_temp.sleep_assert(public.admit_garmin_health_push(jsonb_build_array(pg_temp.sleep_event('ENHANCED_FINAL',87,'e')))->>'status'='ineligible','Paused sleep cannot be re-imported');
rollback;
