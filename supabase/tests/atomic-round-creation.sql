-- Disposable database only. Requires atomic-round-creation and guarded-scoring-mutations migrations.
-- Requires the existing Stage 6 organisation model. Data and failure trigger roll back.
begin;

select set_config('d2.owner', gen_random_uuid()::text, true);
select set_config('d2.other', gen_random_uuid()::text, true);
select set_config('d2.coach', gen_random_uuid()::text, true);
select set_config('d2.session', gen_random_uuid()::text, true);

insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
select id, 'authenticated', 'authenticated', 'd2-' || id || '@example.invalid', now(), now(), now()
from (values
  (current_setting('d2.owner')::uuid),
  (current_setting('d2.other')::uuid),
  (current_setting('d2.coach')::uuid)
) as users(id);

select set_config('request.jwt.claim.sub', current_setting('d2.owner'), true);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('d2.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

select set_config('d2.session', created.id::text, true)
from public.create_owned_session('Atomic Round fixture', current_date, 'training') created;

-- An empty Session gets Round 1, and all planned Ends are created in the same RPC.
do $$
declare v_round_id uuid; v_round_number smallint;
begin
  select created.round_id, created.round_number into v_round_id, v_round_number
  from public.create_round_with_ends(
    current_setting('d2.session')::uuid, '  70 m fixture  ', 'Recurve',
    70, 122, 'full_face', 3, 6
  ) as created;
  perform set_config('d2.round', v_round_id::text, true);
  if v_round_id is null or v_round_number <> 1 or not exists (
    select 1 from public.session_rounds
    where id = v_round_id and session_id = current_setting('d2.session')::uuid
      and round_number = 1 and name = '70 m fixture'
      and division = 'Recurve' and distance_metres = 70
      and face_diameter_cm = 122 and face_type = 'full_face'
      and planned_ends = 3 and arrows_per_end = 6
  ) then
    raise exception 'FAIL: empty Session did not get Round 1 with the expected configuration';
  end if;
  if (select array_agg(end_number order by end_number) from public.session_ends
      where session_round_id = v_round_id) is distinct from array[1, 2, 3]::smallint[] then
    raise exception 'FAIL: planned Ends were not created exactly as 1..N for the new Round';
  end if;
end;
$$;

-- Simulate a deleted Round 2 between existing Round 1 and Round 3.
-- The next number must be 4, then 5; the gap must not be reused.
do $$
declare v_round_id uuid; v_round_number smallint; v_gap_round_id uuid;
begin
  select created.round_id, created.round_number into v_gap_round_id, v_round_number
  from public.create_round_with_ends(
    current_setting('d2.session')::uuid, 'Temporary Round 2', 'Recurve',
    70, 122, 'full_face', 1, 6
  ) as created;
  if v_round_number <> 2 then raise exception 'FAIL: second Round did not get number 2'; end if;

  select created.round_id, created.round_number into v_round_id, v_round_number
  from public.create_round_with_ends(
    current_setting('d2.session')::uuid, 'Round 3', 'Recurve',
    70, 122, 'full_face', 1, 6
  ) as created;
  if v_round_number <> 3 then raise exception 'FAIL: third Round did not get number 3'; end if;

  perform public.delete_owned_round(v_gap_round_id);
  if exists (select 1 from public.session_rounds where id = v_gap_round_id)
    or exists (select 1 from public.session_ends where session_round_id = v_gap_round_id) then
    raise exception 'FAIL: deleting Round 2 did not remove its Ends';
  end if;

  select created.round_id, created.round_number into v_round_id, v_round_number
  from public.create_round_with_ends(
    current_setting('d2.session')::uuid, 'Round 4', 'Recurve',
    70, 122, 'full_face', 1, 6
  ) as created;
  if v_round_number <> 4 then raise exception 'FAIL: missing Round 2 gap was reused instead of Round 4'; end if;
  perform set_config('d2.round4', v_round_id::text, true);

  select created.round_id, created.round_number into v_round_id, v_round_number
  from public.create_round_with_ends(
    current_setting('d2.session')::uuid, 'Round 5', 'Recurve',
    70, 122, 'full_face', 1, 6
  ) as created;
  if v_round_number <> 5 then raise exception 'FAIL: subsequent Round did not get number 5'; end if;
end;
$$;

-- Owner guarded Arrow save/update/delete remains available; retain one for coach reads.
do $$
declare v_end_id uuid; v_arrow_id uuid;
begin
  select id into v_end_id from public.session_ends
    where session_round_id = current_setting('d2.round')::uuid and end_number = 1;
  select id into v_arrow_id from public.save_owned_arrow(v_end_id, 1, 9, false, null, null, null);
  if not exists (select 1 from public.arrows where id = v_arrow_id and score_points = 9) then
    raise exception 'FAIL: owner cannot read their Arrow';
  end if;
  perform public.save_owned_arrow(v_end_id, 1, 10, false, null, null, null, v_arrow_id);
  if not exists (select 1 from public.arrows where id = v_arrow_id and score_points = 10) then
    raise exception 'FAIL: owner cannot update their Arrow';
  end if;
  perform public.delete_owned_arrow(v_end_id, null, v_arrow_id);
  if exists (select 1 from public.arrows where id = v_arrow_id) then
    raise exception 'FAIL: owner cannot delete their Arrow';
  end if;
  select id into v_arrow_id from public.save_owned_arrow(v_end_id, 1, 9, false, null, null, null);
  perform set_config('d2.arrow', v_arrow_id::text, true);
end;
$$;

-- Invalid configuration is rejected without adding a Round.
do $$
begin
  begin
    perform public.create_round_with_ends(current_setting('d2.session')::uuid,
      ' ', 'Recurve', 70, 122, 'full_face', 3, 6);
    raise exception 'FAIL: blank Round name was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_round_with_ends(current_setting('d2.session')::uuid,
      'Invalid division', 'Unknown', 70, 122, 'full_face', 3, 6);
    raise exception 'FAIL: invalid division was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_round_with_ends(current_setting('d2.session')::uuid,
      'Invalid Ends', 'Recurve', 70, 122, 'full_face', 0, 6);
    raise exception 'FAIL: zero planned Ends were accepted';
  exception when invalid_parameter_value then null;
  end;
  if (select array_agg(round_number order by round_number) from public.session_rounds
      where session_id = current_setting('d2.session')::uuid)
      is distinct from array[1, 3, 4, 5]::smallint[] then
    raise exception 'FAIL: invalid input left a Round behind or altered numbering';
  end if;
end;
$$;

-- A different authenticated user cannot write beneath the owner's Session.
reset role;
select set_config('request.jwt.claim.sub', current_setting('d2.other'), true);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('d2.other'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.create_round_with_ends(current_setting('d2.session')::uuid,
      'Forbidden', 'Recurve', 70, 122, 'full_face', 3, 6);
    raise exception 'FAIL: another user created a Round in the owner Session';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Coach can read the active Archer's Session/scoring, but has no write access.
reset role;
do $$
declare v_organization_id uuid;
begin
  insert into public.organizations (name, created_by)
  values ('D2 coach fixture', current_setting('d2.coach')::uuid)
  returning id into v_organization_id;
  perform set_config('d2.organization', v_organization_id::text, true);
end;
$$;
insert into public.organization_members (organization_id, user_id, role, status)
values (current_setting('d2.organization')::uuid, current_setting('d2.owner')::uuid, 'archer', 'active');
do $$
begin
  if (select count(*) from public.organization_members
      where organization_id = current_setting('d2.organization')::uuid
        and user_id = current_setting('d2.coach')::uuid
        and role = 'head_coach' and status = 'active') <> 1
    or (select count(*) from public.organization_members
      where organization_id = current_setting('d2.organization')::uuid
        and user_id = current_setting('d2.owner')::uuid
        and role = 'archer' and status = 'active') <> 1 then
    raise exception 'FAIL: coach and Archer lack active memberships in the same organisation';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('d2.coach'), true);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('d2.coach'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if not exists (select 1 from public.sessions where id = current_setting('d2.session')::uuid) then
    raise exception 'FAIL: coach cannot read the Archer Session';
  end if;
  if not exists (select 1 from public.session_rounds where id = current_setting('d2.round')::uuid)
    or (select count(*) from public.session_ends
      where session_round_id = current_setting('d2.round')::uuid) <> 3
    or not exists (select 1 from public.arrows where id = current_setting('d2.arrow')::uuid) then
    raise exception 'FAIL: coach cannot read the Archer scoring data';
  end if;
  begin
    perform public.create_round_with_ends(current_setting('d2.session')::uuid,
      'Coach forbidden', 'Recurve', 70, 122, 'full_face', 3, 6);
    raise exception 'FAIL: coach created an Archer Round';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.arrows set score_points = 8 where id = current_setting('d2.arrow')::uuid;
    raise exception 'FAIL: coach directly updated the Archer Arrow';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
set local role anon;
do $$
begin
  begin
    perform public.create_round_with_ends(current_setting('d2.session')::uuid,
      'Anonymous forbidden', 'Recurve', 70, 122, 'full_face', 3, 6);
    raise exception 'FAIL: anonymous caller created a Round';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Force the second End to fail. The Round insert and all its Ends must roll back.
reset role;
create function pg_temp.reject_second_fixture_end()
returns trigger language plpgsql as $$
begin
  if new.end_number = 2 then
    raise exception 'Simulated End insert failure' using errcode = 'P9001';
  end if;
  return new;
end;
$$;
create trigger atomic_round_fixture_reject_end
before insert on public.session_ends
for each row execute function pg_temp.reject_second_fixture_end();

select set_config('request.jwt.claim.sub', current_setting('d2.owner'), true);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('d2.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.create_round_with_ends(current_setting('d2.session')::uuid,
      'Must roll back', 'Recurve', 70, 122, 'full_face', 3, 6);
    raise exception 'FAIL: simulated End failure did not reject Round creation';
  exception when sqlstate 'P9001' then null;
  end;
  if (select array_agg(round_number order by round_number) from public.session_rounds
      where session_id = current_setting('d2.session')::uuid)
      is distinct from array[1, 3, 4, 5]::smallint[]
    or (select count(*) from public.session_ends
      where session_round_id = current_setting('d2.round')::uuid) <> 3 then
    raise exception 'FAIL: End failure left a partial Round or altered existing Ends';
  end if;
end;
$$;

reset role;
select 'PASS: RPC Round numbering, gaps, Ends, owner security, coach reads/write denial, anonymous denial, atomic rollback' as result;
rollback;
