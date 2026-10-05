-- DISPOSABLE DATABASE ONLY. Apply the proposal there first.
-- Run with psql -v ON_ERROR_STOP=1; never remove BEGIN/ROLLBACK.
-- Re-run guarded-scoring-mutations.sql and atomic-round-creation.sql separately.
begin;

create function pg_temp.expect_sqlstate(p_sql text, p_state text, p_message text default null)
returns void language plpgsql security invoker as $$
declare v_state text; v_message text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    if v_state <> p_state or (p_message is not null and v_message <> p_message) then
      raise exception 'FAIL: expected % / %, got % / %', p_state, p_message, v_state, v_message;
    end if;
    return;
  end;
  raise exception 'FAIL: expected rejection for %', p_sql;
end;
$$;

select set_config('abuse.owner', gen_random_uuid()::text, true);
select set_config('abuse.other', gen_random_uuid()::text, true);
select set_config('abuse.coach', gen_random_uuid()::text, true);
insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
select id, 'authenticated', 'authenticated', 'abuse-' || id || '@example.invalid', now(), now(), now()
from (values (current_setting('abuse.owner')::uuid), (current_setting('abuse.other')::uuid),
  (current_setting('abuse.coach')::uuid)) u(id);

-- Seed only disposable membership context. Creator trigger supplies the Coach.
do $$
declare v_org uuid;
begin
  insert into public.organizations (name, created_by)
  values ('Backend abuse fixture', current_setting('abuse.coach')::uuid) returning id into v_org;
  perform set_config('abuse.org', v_org::text, true);
  insert into public.organization_members (organization_id, user_id, role, status)
  values (v_org, current_setting('abuse.owner')::uuid, 'archer', 'active');
  perform set_config('abuse.code', (select join_code from public.organizations where id=v_org), true);
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('abuse.owner'), true);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('abuse.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('abuse.session', id::text, true)
from public.create_owned_session('Backend abuse fixture', current_date, 'training');

-- Min/common/large/exact maximum create and expansion. Same authoritative limits.
do $$
declare v_id uuid; v_ends integer; v_arrows integer; v_bad integer;
begin
  foreach v_ends in array array[1,6,60,120] loop
    v_arrows := case when v_ends=120 then 60 else 6 end;
    select round_id into v_id from public.create_round_with_ends(
      current_setting('abuse.session')::uuid, 'Valid workload', 'Recurve', 70, 122,
      'full_face', v_ends, v_arrows);
    if (select count(*) from public.session_ends where session_round_id=v_id) <> v_ends then
      raise exception 'FAIL: planned End creation for %', v_ends;
    end if;
  end loop;
  select round_id into v_id from public.create_round_with_ends(
    current_setting('abuse.session')::uuid, 'Expansion', 'Recurve', 70, 122, 'full_face', 1, 60);
  perform set_config('abuse.round', v_id::text, true);
  foreach v_ends in array array[1,6,60,120] loop
    perform public.update_owned_round_settings(v_id, 'Expansion', 'Recurve', 70, 122, v_ends);
    if (select count(*) from public.session_ends where session_round_id=v_id) <> v_ends then
      raise exception 'FAIL: planned End expansion for %', v_ends;
    end if;
  end loop;
  foreach v_bad in array array[-1,0,121,32767,2147483647] loop
    perform pg_temp.expect_sqlstate(format(
      'select public.create_round_with_ends(%L::uuid,%L,%L,70,122,%L,%s,6)',
      current_setting('abuse.session'),'Invalid','Recurve','full_face',v_bad), '22023');
    perform pg_temp.expect_sqlstate(format(
      'select public.update_owned_round_settings(%L::uuid,%L,%L,70,122,%s)',
      v_id,'Invalid','Recurve',v_bad), '22023');
  end loop;
  -- Independently cover min/exact maximum/max+1/zero/negative arrows per End.
  select round_id into v_id from public.create_round_with_ends(
    current_setting('abuse.session')::uuid, 'One Arrow', 'Barebow', 18, 40, 'full_face', 1, 1);
  foreach v_bad in array array[-1,0,61,32767,2147483647] loop
    perform pg_temp.expect_sqlstate(format(
      'select public.create_round_with_ends(%L::uuid,%L,%L,18,40,%L,1,%s)',
      current_setting('abuse.session'),'Invalid','Barebow','full_face',v_bad), '22023');
  end loop;
end;
$$;

-- Arrow writes are deliberately outside all operation budgets: 100 immediate edits.
do $$
declare v_end uuid; v_i integer;
begin
  select id into v_end from public.session_ends
  where session_round_id=current_setting('abuse.round')::uuid and end_number=1;
  perform set_config('abuse.end', v_end::text, true);
  for v_i in 1..100 loop
    perform public.save_owned_arrow(v_end, 1, 9, false, 0.084, 0.067, null);
  end loop;
  if (select count(*) from public.arrows where session_end_id=v_end) <> 1 then
    raise exception 'FAIL: rapid Arrow saves';
  end if;
  perform public.update_owned_session_arrow_count(current_setting('abuse.session')::uuid, 2147483647);
  if (select arrow_count from public.sessions where id=current_setting('abuse.session')::uuid) <> 2147483647 then
    raise exception 'FAIL: scalar arrow_count semantics changed';
  end if;
end;
$$;
select pg_temp.expect_sqlstate('select private.consume_operation_budget(''join_code'')','42501');
select pg_temp.expect_sqlstate('select * from private.operation_budgets','42501');
select pg_temp.expect_sqlstate(format(
  'insert into public.sessions(user_id,title,session_date) values (%L::uuid,''Forbidden'',current_date)',
  current_setting('abuse.owner')),'42501');

-- Clear only this fixture user's prior budget, as the disposable DB administrator.
reset role;
delete from private.operation_budgets where user_id=current_setting('abuse.owner')::uuid;
set local role authenticated;
do $$
declare v_i integer; v_before bigint;
begin
  for v_i in 1..20 loop
    perform public.create_round_with_ends(current_setting('abuse.session')::uuid,
      'Burst allowed', 'Recurve', 70,122,'full_face',1,6);
  end loop;
  select count(*) into v_before from public.session_rounds where session_id=current_setting('abuse.session')::uuid;
  perform pg_temp.expect_sqlstate(format(
    'select public.create_round_with_ends(%L::uuid,''Throttled'',''Recurve'',70,122,''full_face'',1,6)',
    current_setting('abuse.session')),'P0001','Too many requests. Try again shortly.');
  if (select count(*) from public.session_rounds where session_id=current_setting('abuse.session')::uuid) <> v_before then
    raise exception 'FAIL: throttled Round left data';
  end if;
  -- Create and update share the same budget.
  perform pg_temp.expect_sqlstate(format(
    'select public.update_owned_round_settings(%L::uuid,''Throttled'',''Recurve'',70,122,120)',
    current_setting('abuse.round')),'P0001','Too many requests. Try again shortly.');
end;
$$;

-- Old windows restore access; the sustained cap still applies after a minute reset.
reset role;
update private.operation_budgets set minute_start=minute_start-interval '1 minute', hour_count=200
where user_id=current_setting('abuse.owner')::uuid and operation='round_configuration';
set local role authenticated;
select pg_temp.expect_sqlstate(format(
  'select public.create_round_with_ends(%L::uuid,''Hour denied'',''Recurve'',70,122,''full_face'',1,6)',
  current_setting('abuse.session')),'P0001','Too many requests. Try again shortly.');
reset role;
update private.operation_budgets set minute_start=minute_start-interval '1 minute',
  hour_start=hour_start-interval '1 hour'
where user_id=current_setting('abuse.owner')::uuid and operation='round_configuration';
set local role authenticated;
select * from public.create_round_with_ends(current_setting('abuse.session')::uuid,
  'Windows expired','Recurve',70,122,'full_face',1,6);

-- Other user has independent limits. Failed joins must actually retain their budget.
reset role;
select set_config('request.jwt.claim.sub',current_setting('abuse.other'),true);
select set_config('request.jwt.claims',
  json_build_object('sub',current_setting('abuse.other'),'role','authenticated')::text,true);
set local role authenticated;
select set_config('abuse.other_session',id::text,true)
from public.create_owned_session('Other independent user',current_date,'training');
select * from public.create_round_with_ends(current_setting('abuse.other_session')::uuid,
  'Independent','Recurve',70,122,'full_face',1,6);
do $$
declare v_i integer; v_result text;
begin
  -- Guaranteed absent input, not guessed production codes.
  for v_i in 1..9 loop
    v_result := public.join_organization_by_code('!');
    if v_result <> 'invalid_code' then raise exception 'FAIL: normal invalid join'; end if;
  end loop;
  v_result := public.join_organization_by_code(current_setting('abuse.code'));
  if v_result <> 'joined' then raise exception 'FAIL: valid join at exact limit'; end if;
  v_result := public.join_organization_by_code(current_setting('abuse.code'));
  if v_result <> 'rate_limited' then raise exception 'FAIL: failed attempts rolled back'; end if;
  if (select count(*) from public.organization_members
      where organization_id=current_setting('abuse.org')::uuid and user_id=auth.uid()
      and status='active' and role='archer') <> 1 then raise exception 'FAIL: valid joining changed'; end if;
end;
$$;
reset role;
do $$
begin
  if (select minute_count from private.operation_budgets
    where user_id=current_setting('abuse.other')::uuid and operation='join_code') <> 10 then
    raise exception 'FAIL: join attempt counter did not persist';
  end if;
end;
$$;
-- Sustain 50 attempts/hour over fresh minute windows; no production brute force.
update private.operation_budgets set minute_start=minute_start-interval '1 minute', hour_count=49
where user_id=current_setting('abuse.other')::uuid and operation='join_code';
set local role authenticated;
do $$
begin
  if public.join_organization_by_code('!') <> 'invalid_code'
    or public.join_organization_by_code(current_setting('abuse.code')) <> 'rate_limited' then
    raise exception 'FAIL: join hourly limit';
  end if;
end;
$$;
reset role;
update private.operation_budgets set minute_start=minute_start-interval '1 minute',
  hour_start=hour_start-interval '1 hour'
where user_id=current_setting('abuse.other')::uuid and operation='join_code';
set local role authenticated;
do $$
begin
  if public.join_organization_by_code(current_setting('abuse.code')) <> 'already_member' then
    raise exception 'FAIL: join after window reset / membership idempotence';
  end if;
end;
$$;

-- Cross-user and Coach read-only access remain intact.
select pg_temp.expect_sqlstate(format(
  'select public.create_round_with_ends(%L::uuid,''Forbidden'',''Recurve'',70,122,''full_face'',1,6)',
  current_setting('abuse.session')),'42501');
reset role;
select set_config('request.jwt.claim.sub',current_setting('abuse.coach'),true);
select set_config('request.jwt.claims',
  json_build_object('sub',current_setting('abuse.coach'),'role','authenticated')::text,true);
set local role authenticated;
do $$
begin
  if not exists (select 1 from public.sessions where id=current_setting('abuse.session')::uuid)
    or not exists (select 1 from public.arrows where session_end_id=current_setting('abuse.end')::uuid) then
    raise exception 'FAIL: existing Coach read access changed';
  end if;
end;
$$;
select pg_temp.expect_sqlstate(format(
  'select public.create_round_with_ends(%L::uuid,''Coach forbidden'',''Recurve'',70,122,''full_face'',1,6)',
  current_setting('abuse.session')),'42501');
select pg_temp.expect_sqlstate(format(
  'select public.save_owned_arrow(%L::uuid,1,10,false,0.084,0.067,null)',
  current_setting('abuse.end')),'42501');

-- Training Plan limits: inclusive 366 days accepted; 367 and infinities denied.
do $$
declare v_plan uuid; v_days jsonb; v_bad text; v_i integer; v_code text;
begin
  select jsonb_agg(jsonb_build_object('date',date '2028-01-01'+n,'arrow_target',300))
    into v_days from generate_series(0,365) n;
  select public.save_training_plan(null,current_setting('abuse.org')::uuid,'Maximum Plan',
    '2028-01-01','2028-12-31',1000,null,v_days,array[current_setting('abuse.owner')::uuid]) into v_plan;
  if (select count(*) from public.training_plan_days where training_plan_id=v_plan) <> 366 then
    raise exception 'FAIL: exact day maximum';
  end if;
  perform pg_temp.expect_sqlstate(format(
    'select public.save_training_plan(null,%L::uuid,''Too long'',''2028-01-01'',''2029-01-01'',1000,null,''[]'',array[%L::uuid])',
    current_setting('abuse.org'),current_setting('abuse.owner')),'22023');
  perform pg_temp.expect_sqlstate(format(
    'select public.save_training_plan(null,%L::uuid,''Infinite'',''-infinity'',''infinity'',1000,null,''[]'',array[%L::uuid])',
    current_setting('abuse.org'),current_setting('abuse.owner')),'22023');
  perform pg_temp.expect_sqlstate(format(
    'select public.save_training_plan(null,%L::uuid,''Oversized days'',''2028-01-01'',''2028-12-31'',1000,null,%L::jsonb,array[%L::uuid])',
    current_setting('abuse.org'),(v_days||jsonb_build_array(jsonb_build_object('date','2028-01-01')))::text,
    current_setting('abuse.owner')),'22023');
  perform pg_temp.expect_sqlstate(format(
    'select public.save_training_plan(null,%L::uuid,''Oversized assignments'',''2028-01-01'',''2028-01-01'',1000,null,''[]'',array_fill(%L::uuid,array[1001]))',
    current_setting('abuse.org'),current_setting('abuse.owner')),'22023');
  perform pg_temp.expect_sqlstate(format(
    'select public.save_training_plan(null,%L::uuid,''Oversized JSON'',''2028-01-01'',''2028-01-01'',1000,null,jsonb_build_array(jsonb_build_object(''date'',''2028-01-01'',''unexpected'',repeat(''x'',4194304))),array[%L::uuid])',
    current_setting('abuse.org'),current_setting('abuse.owner')),'22023');
  for v_i in 1..5 loop
    v_code := public.regenerate_organization_join_code(current_setting('abuse.org')::uuid);
    if v_code !~ '^[A-HJ-NP-Z2-9]{8}$' then raise exception 'FAIL: join code format changed'; end if;
  end loop;
  perform pg_temp.expect_sqlstate(format(
    'select public.regenerate_organization_join_code(%L::uuid)',current_setting('abuse.org')),
    'P0001','Too many requests. Try again shortly.');
end;
$$;

-- Exercise Session caps at exact minute/hour boundaries without a large request loop.
reset role;
select set_config('request.jwt.claim.sub',current_setting('abuse.owner'),true);
select set_config('request.jwt.claims',
  json_build_object('sub',current_setting('abuse.owner'),'role','authenticated')::text,true);
-- The Round burst test removed this user's earlier Session budget row.
insert into private.operation_budgets
  (user_id,operation,minute_start,minute_count,hour_start,hour_count)
values (current_setting('abuse.owner')::uuid,'create_session',
  date_trunc('minute',clock_timestamp(),'UTC'),59,
  date_trunc('hour',clock_timestamp(),'UTC'),59)
on conflict (user_id,operation) do update set
  minute_start=excluded.minute_start,minute_count=excluded.minute_count,
  hour_start=excluded.hour_start,hour_count=excluded.hour_count;
set local role authenticated;
select * from public.create_owned_session('Session minute cap',current_date,'training');
select pg_temp.expect_sqlstate(
  'select public.create_owned_session(''Session minute denied'',current_date,''training'')',
  'P0001','Too many requests. Try again shortly.');
reset role;
update private.operation_budgets set minute_start=minute_start-interval '1 minute',
  hour_count=599 where user_id=current_setting('abuse.owner')::uuid and operation='create_session';
set local role authenticated;
select * from public.create_owned_session('Session hour cap',current_date,'training');
select pg_temp.expect_sqlstate(
  'select public.create_owned_session(''Session hour denied'',current_date,''training'')',
  'P0001','Too many requests. Try again shortly.');

-- Exact assignment cardinality in a disposable database only; all 1000 users roll back.
reset role;
create temporary table abuse_assignees on commit drop as
select gen_random_uuid() as id from generate_series(1,1000);
insert into auth.users (id,aud,role,email,email_confirmed_at,created_at,updated_at)
select id,'authenticated','authenticated','abuse-assignee-'||id||'@example.invalid',now(),now(),now()
from abuse_assignees;
insert into public.organization_members (organization_id,user_id,role,status)
select current_setting('abuse.org')::uuid,id,'archer','active' from abuse_assignees;
select set_config('abuse.assignees',(select array_agg(id)::text from abuse_assignees),true);
select set_config('request.jwt.claim.sub',current_setting('abuse.coach'),true);
select set_config('request.jwt.claims',
  json_build_object('sub',current_setting('abuse.coach'),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare v_id uuid; v_days jsonb; v_overhead integer; v_bytes integer;
begin
  select public.save_training_plan(null,current_setting('abuse.org')::uuid,'1000 assignments',
    '2028-01-01','2028-01-01',1000,null,'[]',current_setting('abuse.assignees')::uuid[]) into v_id;
  if (select count(*) from public.training_plan_assignments where training_plan_id=v_id) <> 1000 then
    raise exception 'FAIL: exact assignment maximum';
  end if;
  -- Unknown fields are ignored by the existing recordset mapping. Use padding only
  -- to test the precise normalized JSON byte gate, not to change product fields.
  v_days := jsonb_build_array(jsonb_build_object('date','2028-01-01','padding',''));
  v_overhead := octet_length(v_days::text);
  v_days := jsonb_build_array(jsonb_build_object('date','2028-01-01',
    'padding',repeat('x',4194304-v_overhead)));
  v_bytes := octet_length(v_days::text);
  if v_bytes <> 4194304 then raise exception 'FAIL: byte-boundary fixture construction'; end if;
  perform public.save_training_plan(null,current_setting('abuse.org')::uuid,'Exact JSON bytes',
    '2028-01-01','2028-01-01',1000,null,v_days,array[current_setting('abuse.owner')::uuid]);
  perform pg_temp.expect_sqlstate(format(
    'select public.save_training_plan(null,%L::uuid,''JSON max plus one'',''2028-01-01'',''2028-01-01'',1000,null,%L::jsonb,array[%L::uuid])',
    current_setting('abuse.org'),
    jsonb_build_array(jsonb_build_object('date','2028-01-01','padding',repeat('x',4194305-v_overhead)))::text,
    current_setting('abuse.owner')),'22023');
end;
$$;

-- Training Plan save caps: exact 30/300 succeeds, next request rejects.
reset role;
update private.operation_budgets set minute_start=date_trunc('minute',clock_timestamp(),'UTC'),
  minute_count=29,hour_start=date_trunc('hour',clock_timestamp(),'UTC'),hour_count=29
where user_id=current_setting('abuse.coach')::uuid and operation='save_training_plan';
set local role authenticated;
select public.save_training_plan(null,current_setting('abuse.org')::uuid,'Plan minute cap',
  '2028-01-01','2028-01-01',1000,null,'[]',array[current_setting('abuse.owner')::uuid]);
select pg_temp.expect_sqlstate(format(
  'select public.save_training_plan(null,%L::uuid,''Plan minute denied'',''2028-01-01'',''2028-01-01'',1000,null,''[]'',array[%L::uuid])',
  current_setting('abuse.org'),current_setting('abuse.owner')),'P0001','Too many requests. Try again shortly.');
reset role;
update private.operation_budgets set minute_start=minute_start-interval '1 minute',hour_count=299
where user_id=current_setting('abuse.coach')::uuid and operation='save_training_plan';
set local role authenticated;
select public.save_training_plan(null,current_setting('abuse.org')::uuid,'Plan hour cap',
  '2028-01-01','2028-01-01',1000,null,'[]',array[current_setting('abuse.owner')::uuid]);
select pg_temp.expect_sqlstate(format(
  'select public.save_training_plan(null,%L::uuid,''Plan hour denied'',''2028-01-01'',''2028-01-01'',1000,null,''[]'',array[%L::uuid])',
  current_setting('abuse.org'),current_setting('abuse.owner')),'P0001','Too many requests. Try again shortly.');


-- Anonymous mutations remain denied.
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select pg_temp.expect_sqlstate('select public.create_owned_session(''Forbidden'',current_date,''training'')','42501');
select pg_temp.expect_sqlstate('select public.join_organization_by_code(''!'')','42501');

reset role;
rollback;
