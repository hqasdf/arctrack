-- DISPOSABLE DATABASE ONLY. Requires all migrations through session_weather_snapshots.
-- psql -v ON_ERROR_STOP=1 -f this-file.sql. Never remove BEGIN / ROLLBACK.
begin;
create function pg_temp.weather_expect_sqlstate(p_sql text, p_state text)
returns void language plpgsql security invoker as $$
declare v_state text;
begin
  begin execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> p_state then raise exception 'Expected %, got % for %', p_state, v_state, p_sql; end if;
    return;
  end;
  raise exception 'Expected rejection for %', p_sql;
end;
$$;
select set_config('weather.owner', gen_random_uuid()::text, true);
select set_config('weather.other', gen_random_uuid()::text, true);
select set_config('weather.coach', gen_random_uuid()::text, true);
select set_config('weather.unconfirmed', gen_random_uuid()::text, true);
select set_config('weather.session', gen_random_uuid()::text, true);
select set_config('weather.old_session', gen_random_uuid()::text, true);
select set_config('weather.unconfirmed_session', gen_random_uuid()::text, true);
select set_config('weather.unconfirmed_round', gen_random_uuid()::text, true);
select set_config('weather.round', gen_random_uuid()::text, true);
select set_config('weather.round_18', gen_random_uuid()::text, true);
select set_config('weather.round_other', gen_random_uuid()::text, true);
select set_config('weather.round_bad', gen_random_uuid()::text, true);
select set_config('weather.round_full', gen_random_uuid()::text, true);
select set_config('weather.round_old', gen_random_uuid()::text, true);
select set_config('weather.observed', now()::text, true);
insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
select id, 'authenticated', 'authenticated', 'weather-' || id || '@example.invalid',
  case when id = current_setting('weather.unconfirmed')::uuid then null else now() end, now(), now()
from (values (current_setting('weather.owner')::uuid), (current_setting('weather.other')::uuid),
  (current_setting('weather.coach')::uuid), (current_setting('weather.unconfirmed')::uuid)) u(id);
insert into public.sessions (id, user_id, title, session_date, session_type)
values (current_setting('weather.session')::uuid, current_setting('weather.owner')::uuid,
  'Weather fixture', (now() at time zone 'Asia/Singapore')::date, 'training'),
  (current_setting('weather.old_session')::uuid, current_setting('weather.owner')::uuid,
  'Historical weather fixture', (now() at time zone 'Asia/Singapore')::date - 1, 'training'),
  (current_setting('weather.unconfirmed_session')::uuid, current_setting('weather.unconfirmed')::uuid,
  'Unconfirmed weather fixture', (now() at time zone 'Asia/Singapore')::date, 'training');
insert into public.session_rounds
  (id, session_id, round_number, name, division, distance_metres, face_diameter_cm, face_type, planned_ends, arrows_per_end)
select id, current_setting('weather.session')::uuid, n, 'Weather fixture Round', 'Recurve', distance, 122, 'full_face', 1, 2
from (values (current_setting('weather.round')::uuid, 1, 70),
  (current_setting('weather.round_18')::uuid, 2, 18),
  (current_setting('weather.round_other')::uuid, 3, 90),
  (current_setting('weather.round_bad')::uuid, 4, 0),
  (current_setting('weather.round_full')::uuid, 5, 50)) r(id,n,distance);
insert into public.session_rounds
  (id, session_id, round_number, name, division, distance_metres, face_diameter_cm, face_type, planned_ends, arrows_per_end)
values (current_setting('weather.round_old')::uuid, current_setting('weather.old_session')::uuid,
  1, 'Historical Round', 'Recurve', 70, 122, 'full_face', 1, 2),
  (current_setting('weather.unconfirmed_round')::uuid, current_setting('weather.unconfirmed_session')::uuid,
  1, 'Unconfirmed Round', 'Recurve', 70, 122, 'full_face', 1, 2);
insert into public.session_ends (session_round_id, end_number)
select id, 1 from public.session_rounds where session_id in
  (current_setting('weather.session')::uuid, current_setting('weather.old_session')::uuid);
insert into public.arrows (session_end_id, arrow_number, score_points, is_x)
select e.id, n, 9, false from public.session_ends e cross join generate_series(1,2) n
where e.session_round_id = current_setting('weather.round_full')::uuid;
-- Give a genuine active Coach Session visibility, without granting weather visibility.
do $$ declare v_org uuid;
begin
  insert into public.organizations (name, created_by) values ('Weather fixture organisation', current_setting('weather.coach')::uuid)
    returning id into v_org;
  insert into public.organization_members (organization_id,user_id,role,status)
    values (v_org, current_setting('weather.owner')::uuid,'archer','active');
end; $$;

set local role service_role;
select pg_temp.weather_expect_sqlstate(format('select * from public.claim_session_weather_refresh(%L,%L)',
  current_setting('weather.unconfirmed'), current_setting('weather.unconfirmed_round')), '42501');
select pg_temp.weather_expect_sqlstate(format('select * from public.claim_session_weather_refresh(%L,%L)',
  current_setting('weather.other'), current_setting('weather.round')), '42501');
select pg_temp.weather_expect_sqlstate(format('select * from public.claim_session_weather_refresh(%L,%L)',
  current_setting('weather.owner'), gen_random_uuid()), '42501');
select pg_temp.weather_expect_sqlstate(format('select * from public.claim_session_weather_refresh(%L,%L)',
  current_setting('weather.owner'), current_setting('weather.round_18')), '22023');
select pg_temp.weather_expect_sqlstate(format('select * from public.claim_session_weather_refresh(%L,%L)',
  current_setting('weather.owner'), current_setting('weather.round_bad')), '22023');
select pg_temp.weather_expect_sqlstate(format('select * from public.claim_session_weather_refresh(%L,%L)',
  current_setting('weather.owner'), current_setting('weather.round_full')), '22023');
select pg_temp.weather_expect_sqlstate(format('select * from public.claim_session_weather_refresh(%L,%L)',
  current_setting('weather.owner'), current_setting('weather.round_old')), '22023');
-- First claimant wins; a second device/another eligible Round in the same Session waits.
do $$ declare v_claim record; v_second record;
begin
  select * into v_claim from public.claim_session_weather_refresh(current_setting('weather.owner')::uuid,current_setting('weather.round')::uuid);
  if not v_claim.claimed or v_claim.claim_id is null or v_claim.session_id <> current_setting('weather.session')::uuid then
    raise exception 'First valid owner did not receive a weather lease'; end if;
  perform set_config('weather.claim',v_claim.claim_id::text,true);
  select * into v_second from public.claim_session_weather_refresh(current_setting('weather.owner')::uuid,current_setting('weather.round_other')::uuid);
  if v_second.claimed or v_second.claim_id is not null then raise exception 'Concurrent Session claim was not deduplicated'; end if;
end; $$;
-- Same Session, wrong active Round cannot reuse a lease.
select pg_temp.weather_expect_sqlstate(format('select public.save_session_weather_snapshot(%L,%L,%L,%L,29,0,0,0,74,0)',
  current_setting('weather.owner'),current_setting('weather.round_other'),current_setting('weather.claim'),current_setting('weather.observed')), '42501');
select pg_temp.weather_expect_sqlstate(format('select public.save_session_weather_snapshot(%L,%L,%L,%L,29,0,0,0,101,0)',
  current_setting('weather.owner'),current_setting('weather.round'),current_setting('weather.claim'),current_setting('weather.observed')), '22023');
select public.save_session_weather_snapshot(current_setting('weather.owner')::uuid,current_setting('weather.round')::uuid,
  current_setting('weather.claim')::uuid,current_setting('weather.observed')::timestamptz,29,0,0,0,74,0);
select pg_temp.weather_expect_sqlstate(format('select public.save_session_weather_snapshot(%L,%L,%L,%L,29,0,0,0,74,0)',
  current_setting('weather.owner'),current_setting('weather.round'),current_setting('weather.claim'),current_setting('weather.observed')), '42501');
do $$ declare v_claim record; v_due timestamptz;
begin
  select * into v_claim from public.claim_session_weather_refresh(current_setting('weather.owner')::uuid,current_setting('weather.round')::uuid);
  if v_claim.claimed then raise exception 'Successful weather reading did not enforce 30-minute freshness'; end if;
  select next_refresh_at into v_due from public.read_session_weather_refresh(current_setting('weather.owner')::uuid,current_setting('weather.session')::uuid);
  if v_due < now() + interval '29 minutes' then raise exception 'Expected next refresh around 30 minutes'; end if;
end; $$;
reset role;
do $$ begin
  if (select count(*) from public.session_weather_snapshots where session_id=current_setting('weather.session')::uuid) <> 1
    or not exists (select 1 from public.session_weather_snapshots where session_id=current_setting('weather.session')::uuid
      and wind_speed_kph=0 and wind_gust_kph=0 and wind_direction_degrees=0 and condition_code=0) then
    raise exception 'Snapshot/zero values not persisted correctly'; end if;
end; $$;
-- Owner read yes; forged direct writes and trusted RPC calls denied.
select set_config('request.jwt.claim.sub',current_setting('weather.owner'),true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('weather.owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.session_weather_snapshots where session_id=current_setting('weather.session')::uuid) <> 1 then
    raise exception 'Owner cannot read weather'; end if;
end; $$;
select pg_temp.weather_expect_sqlstate(format('select * from public.claim_session_weather_refresh(%L,%L)',
  current_setting('weather.owner'),current_setting('weather.round')), '42501');
select pg_temp.weather_expect_sqlstate(format('select public.save_session_weather_snapshot(%L,%L,%L,now(),99,0,0,0,0,0)',
  current_setting('weather.owner'),current_setting('weather.round'),current_setting('weather.claim')), '42501');
select pg_temp.weather_expect_sqlstate(format('insert into public.session_weather_snapshots(session_id,round_id,provider,observed_at) values(%L,%L,%L,now())',
  current_setting('weather.session'),current_setting('weather.round'),'open-meteo'), '42501');
select pg_temp.weather_expect_sqlstate('update public.session_weather_snapshots set temperature_c=1','42501');
select pg_temp.weather_expect_sqlstate('delete from public.session_weather_snapshots','42501');
reset role;
select set_config('request.jwt.claim.sub',current_setting('weather.other'),true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('weather.other'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin if exists(select 1 from public.session_weather_snapshots) then raise exception 'Other athlete can read weather'; end if; end; $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('weather.coach'),true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('weather.coach'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if not exists(select 1 from public.sessions where id=current_setting('weather.session')::uuid) then raise exception 'Fixture Coach lacks legitimate Session read access'; end if;
  if exists(select 1 from public.session_weather_snapshots) then raise exception 'Coach unexpectedly gained weather access'; end if;
end; $$;
reset role;
set local role anon;
select pg_temp.weather_expect_sqlstate('select * from public.session_weather_snapshots','42501');
select pg_temp.weather_expect_sqlstate(format('select * from public.claim_session_weather_refresh(%L,%L)',
  current_setting('weather.owner'),current_setting('weather.round')), '42501');
reset role;

-- Simulate 30-minute eligibility without waiting: only fixture rows/timestamps change.
update public.session_weather_snapshots set retrieved_at=now()-interval '31 minutes' where session_id=current_setting('weather.session')::uuid;
update private.session_weather_refresh_state set checked_at=now()-interval '31 minutes',next_attempt_at=now()-interval '1 minute'
  where session_id=current_setting('weather.session')::uuid;
set local role service_role;
select set_config('weather.claim',claim_id::text,true) from public.claim_session_weather_refresh(
  current_setting('weather.owner')::uuid,current_setting('weather.round_other')::uuid) where claimed;
select public.save_session_weather_snapshot(current_setting('weather.owner')::uuid,current_setting('weather.round_other')::uuid,
  current_setting('weather.claim')::uuid,current_setting('weather.observed')::timestamptz,null,null,null,null,null,null);
reset role;
do $$ begin
  if (select count(*) from public.session_weather_snapshots where session_id=current_setting('weather.session')::uuid) <> 1 then
    raise exception 'Unchanged provider observation created duplicate snapshot'; end if;
  if not exists(select 1 from public.session_weather_snapshots where session_id=current_setting('weather.session')::uuid
    and round_id=current_setting('weather.round')::uuid and retrieved_at<now()-interval '30 minutes') then
    raise exception 'Dedup relabelled original Round/time'; end if;
end; $$;
set local role service_role;
do $$ declare v_claim record;
begin
  select * into v_claim from public.claim_session_weather_refresh(current_setting('weather.owner')::uuid,current_setting('weather.round')::uuid);
  if v_claim.claimed then raise exception 'Unchanged observation caused refresh loop'; end if;
end; $$;
reset role;

-- Expired lease replaced; its late response cannot win over the replacement.
update private.session_weather_refresh_state set checked_at=now()-interval '31 minutes',next_attempt_at=now()-interval '1 minute'
  where session_id=current_setting('weather.session')::uuid;
set local role service_role;
select set_config('weather.stale_claim',claim_id::text,true) from public.claim_session_weather_refresh(
  current_setting('weather.owner')::uuid,current_setting('weather.round')::uuid) where claimed;
reset role;
update private.session_weather_refresh_state set lease_expires_at=now()-interval '1 second' where session_id=current_setting('weather.session')::uuid;
set local role service_role;
select set_config('weather.claim',claim_id::text,true) from public.claim_session_weather_refresh(
  current_setting('weather.owner')::uuid,current_setting('weather.round')::uuid) where claimed;
select pg_temp.weather_expect_sqlstate(format('select public.save_session_weather_snapshot(%L,%L,%L,%L,29,0,0,0,74,0)',
  current_setting('weather.owner'),current_setting('weather.round'),current_setting('weather.stale_claim'),current_setting('weather.observed')), '42501');
select public.release_session_weather_refresh(current_setting('weather.owner')::uuid,current_setting('weather.round')::uuid,current_setting('weather.claim')::uuid);
do $$ declare v_claim record;
begin
  select * into v_claim from public.claim_session_weather_refresh(current_setting('weather.owner')::uuid,current_setting('weather.round')::uuid);
  if v_claim.claimed then raise exception 'Provider failure has no retry backoff'; end if;
end; $$;
reset role;

-- Round deletion retains Session weather while dropping obsolete attribution.
delete from public.session_rounds where id=current_setting('weather.round')::uuid;
do $$ begin
  if not exists(select 1 from public.session_weather_snapshots
    where session_id=current_setting('weather.session')::uuid and round_id is null) then
    raise exception 'Deleting a Round lost Session weather history'; end if;
end; $$;
-- Recreate coordination under another remaining eligible Round before Session cleanup.
set local role service_role;
select * from public.claim_session_weather_refresh(current_setting('weather.owner')::uuid,current_setting('weather.round_other')::uuid);
reset role;

-- Account/Session deletion removes weather and private coordination by normal FK cascade.
delete from public.sessions where id=current_setting('weather.session')::uuid;
do $$ begin
  if exists(select 1 from public.session_weather_snapshots where session_id=current_setting('weather.session')::uuid)
    or exists(select 1 from private.session_weather_refresh_state where session_id=current_setting('weather.session')::uuid) then
    raise exception 'Session deletion did not cascade weather cleanup'; end if;
end; $$;
rollback;
