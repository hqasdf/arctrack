-- PROPOSAL ONLY. Run after the Training Plans migration in a safe test DB.
-- Every fixture row and Auth user is rolled back.
begin;

create function pg_temp.expect_rejection(statement text)
returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'Expected rejection was not raised';
exception when others then
  if sqlerrm = 'Expected rejection was not raised' then raise; end if;
end;
$$;

select set_config('tp.coach', gen_random_uuid()::text, true);
select set_config('tp.coach_b', gen_random_uuid()::text, true);
select set_config('tp.coach_peer', gen_random_uuid()::text, true);
select set_config('tp.coach_left', gen_random_uuid()::text, true);
select set_config('tp.a', gen_random_uuid()::text, true);
select set_config('tp.b', gen_random_uuid()::text, true);
select set_config('tp.c', gen_random_uuid()::text, true);
select set_config('tp.unassigned', gen_random_uuid()::text, true);
select set_config('tp.archer_left', gen_random_uuid()::text, true);
select set_config('tp.outsider', gen_random_uuid()::text, true);

insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
select id, 'authenticated', 'authenticated', 'plan-' || id || '@example.invalid',
  now(), now(), now()
from (values
  (current_setting('tp.coach')::uuid), (current_setting('tp.coach_b')::uuid),
  (current_setting('tp.coach_peer')::uuid),
  (current_setting('tp.coach_left')::uuid), (current_setting('tp.a')::uuid),
  (current_setting('tp.b')::uuid), (current_setting('tp.c')::uuid),
  (current_setting('tp.unassigned')::uuid),
  (current_setting('tp.archer_left')::uuid),
  (current_setting('tp.outsider')::uuid)
) fixture(id);

-- Use the real organisation INSERT / AFTER INSERT Head Coach bootstrap path.
select set_config('request.jwt.claim.sub', current_setting('tp.coach'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('tp.coach'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare v_id uuid; begin
  insert into public.organizations (name, created_by)
  values ('Plan fixture A', auth.uid()) returning id into v_id;
  perform set_config('tp.org', v_id::text, true);
end $$;
reset role;

select set_config('request.jwt.claim.sub', current_setting('tp.coach_b'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('tp.coach_b'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare v_id uuid; begin
  insert into public.organizations (name, created_by)
  values ('Plan fixture B', auth.uid()) returning id into v_id;
  perform set_config('tp.other_org', v_id::text, true);
end $$;
reset role;

insert into public.organization_members (organization_id, user_id, role, status, left_at)
values
  (current_setting('tp.org')::uuid, current_setting('tp.coach_peer')::uuid, 'head_coach', 'active', null),
  (current_setting('tp.org')::uuid, current_setting('tp.coach_left')::uuid, 'head_coach', 'left', now()),
  (current_setting('tp.org')::uuid, current_setting('tp.a')::uuid, 'archer', 'active', null),
  (current_setting('tp.org')::uuid, current_setting('tp.b')::uuid, 'archer', 'active', null),
  (current_setting('tp.org')::uuid, current_setting('tp.c')::uuid, 'archer', 'active', null),
  (current_setting('tp.org')::uuid, current_setting('tp.unassigned')::uuid, 'archer', 'active', null),
  (current_setting('tp.org')::uuid, current_setting('tp.archer_left')::uuid, 'archer', 'left', now()),
  (current_setting('tp.other_org')::uuid, current_setting('tp.outsider')::uuid, 'archer', 'active', null);

-- A/J: all three athlete assignments and both daily targets are atomic.
select set_config('request.jwt.claim.sub', current_setting('tp.coach'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('tp.coach'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare v_id uuid; begin
  select public.save_training_plan(
    null, current_setting('tp.org')::uuid, 'Fixture shared plan',
    date '2026-09-29', date '2026-10-05', 700, 'Shared plan note',
    '[{"date":"2026-09-29","arrow_target":150,"scored_round_target":3,"coach_note":"Focus"},
      {"date":"2026-09-30","arrow_target":120}]'::jsonb,
    array[current_setting('tp.a')::uuid, current_setting('tp.b')::uuid,
      current_setting('tp.c')::uuid]) into v_id;
  perform set_config('tp.plan', v_id::text, true);
  if (select count(*) from public.training_plan_assignments where training_plan_id = v_id) <> 3
    or (select count(*) from public.training_plan_days where training_plan_id = v_id) <> 2
    or (select count(*) from public.training_plans where id = v_id) <> 1
    or (select count(*) from public.training_plans where id = v_id and created_by = auth.uid()) <> 1 then
    raise exception 'Atomic three-athlete plan creation failed';
  end if;
end $$;

-- Active Head Coach sees the shared definition, its days, and all assignments.
do $$ begin
  if (select count(*) from public.training_plans where id = current_setting('tp.plan')::uuid) <> 1
    or (select count(*) from public.training_plan_days where training_plan_id = current_setting('tp.plan')::uuid) <> 2
    or (select count(*) from public.training_plan_assignments where training_plan_id = current_setting('tp.plan')::uuid) <> 3 then
    raise exception 'Head Coach cannot read the complete shared plan';
  end if;
end $$;
-- Org A Coach cannot create a plan under Org B despite knowing its UUID.
select pg_temp.expect_rejection(format(
  'select public.save_training_plan(null,%L::uuid,%L,%L::date,%L::date,700,null,''[]''::jsonb,array[%L::uuid])',
  current_setting('tp.other_org'), 'Cross-org creation', '2026-09-29', '2026-10-05',
  current_setting('tp.outsider')));

-- I: duplicate IDs are rejected, and the assignment key enforces uniqueness.
select pg_temp.expect_rejection(format(
  'select public.save_training_plan(null,%L::uuid,%L,%L::date,%L::date,700,null,''[]''::jsonb,array[%L::uuid,%L::uuid])',
  current_setting('tp.org'), 'Duplicate assignees', '2026-09-29', '2026-10-05',
  current_setting('tp.a'), current_setting('tp.a')));
do $$ begin
  if (select count(*) from public.training_plans where title = 'Duplicate assignees') <> 0 then
    raise exception 'Duplicate input left a plan behind';
  end if;
end $$;

-- E/F/K: a cross-org or inactive Archer invalidates the entire create call.
select pg_temp.expect_rejection(format(
  'select public.save_training_plan(null,%L::uuid,%L,%L::date,%L::date,700,null,''[]''::jsonb,array[%L::uuid,%L::uuid])',
  current_setting('tp.org'), 'Invalid outsider', '2026-09-29', '2026-10-05',
  current_setting('tp.a'), current_setting('tp.outsider')));
select pg_temp.expect_rejection(format(
  'select public.save_training_plan(null,%L::uuid,%L,%L::date,%L::date,700,null,''[]''::jsonb,array[%L::uuid])',
  current_setting('tp.org'), 'Invalid inactive', '2026-09-29', '2026-10-05',
  current_setting('tp.archer_left')));
select pg_temp.expect_rejection(format(
  'select public.save_training_plan(null,%L::uuid,%L,%L::date,%L::date,700,null,%L::jsonb,array[%L::uuid])',
  current_setting('tp.org'), 'Invalid day', '2026-09-29', '2026-10-05',
  '[{"date":"2026-10-06","arrow_target":100}]', current_setting('tp.a')));
select pg_temp.expect_rejection(format(
  'select public.save_training_plan(null,%L::uuid,%L,%L::date,%L::date,700,null,%L::jsonb,array[%L::uuid])',
  current_setting('tp.org'), 'Invalid target', '2026-09-29', '2026-10-05',
  '[{"date":"2026-09-29","scored_round_target":0}]', current_setting('tp.a')));
do $$ begin
  if exists (select 1 from public.training_plans where title like 'Invalid %') then
    raise exception 'Invalid bulk creation left a parent plan behind';
  end if;
end $$;

-- L: a different active Head Coach can manage the same org plan.
reset role;
select set_config('request.jwt.claim.sub', current_setting('tp.coach_peer'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('tp.coach_peer'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare v_id uuid; begin
  select public.save_training_plan(
    current_setting('tp.plan')::uuid, current_setting('tp.org')::uuid,
    'Fixture shared plan edited', date '2026-09-29', date '2026-10-05', 750,
    'Updated note', '[{"date":"2026-09-29","arrow_target":160}]'::jsonb,
    array[current_setting('tp.a')::uuid, current_setting('tp.b')::uuid]) into v_id;
  if v_id <> current_setting('tp.plan')::uuid
    or (select count(*) from public.training_plan_days where training_plan_id = v_id) <> 1
    or (select count(*) from public.training_plan_assignments where training_plan_id = v_id) <> 2
    or (select weekly_arrow_target from public.training_plans where id = v_id) <> 750
    or (select arrow_target from public.training_plan_days
        where training_plan_id = v_id and date = date '2026-09-29') <> 160 then
    raise exception 'Plan edit did not reconcile shared children';
  end if;
end $$;

-- The same active Coach can add an Archer to the shared plan without duplication.
do $$ declare v_id uuid; begin
  select public.save_training_plan(
    current_setting('tp.plan')::uuid, current_setting('tp.org')::uuid,
    'Fixture shared plan edited', date '2026-09-29', date '2026-10-05', 750,
    'Updated note', '[{"date":"2026-09-29","arrow_target":160}]'::jsonb,
    array[current_setting('tp.a')::uuid, current_setting('tp.b')::uuid,
      current_setting('tp.c')::uuid]) into v_id;
  if v_id <> current_setting('tp.plan')::uuid
    or (select count(*) from public.training_plan_assignments where training_plan_id = v_id) <> 3 then
    raise exception 'Coach could not add an assignment';
  end if;
end $$;
do $$ declare v_id uuid; begin
  select public.save_training_plan(
    current_setting('tp.plan')::uuid, current_setting('tp.org')::uuid,
    'Fixture shared plan edited', date '2026-09-29', date '2026-10-05', 750,
    'Updated note', '[{"date":"2026-09-29","arrow_target":160}]'::jsonb,
    array[current_setting('tp.a')::uuid, current_setting('tp.b')::uuid]) into v_id;
  if (select count(*) from public.training_plan_assignments where training_plan_id = v_id) <> 2 then
    raise exception 'Coach could not remove an assignment';
  end if;
end $$;

-- Removed athlete immediately loses read access; their account and membership remain.
reset role;
select set_config('request.jwt.claim.sub', current_setting('tp.c'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('tp.c'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.training_plans where id = current_setting('tp.plan')::uuid)
    or exists (select 1 from public.training_plan_days where training_plan_id = current_setting('tp.plan')::uuid)
    or exists (select 1 from public.training_plan_assignments where training_plan_id = current_setting('tp.plan')::uuid)
    or not exists (select 1 from public.organization_members
      where organization_id = current_setting('tp.org')::uuid and user_id = auth.uid()
        and status = 'active') then
    raise exception 'Removed athlete retained plan access or lost membership';
  end if;
end $$;

-- H: an active but unassigned Archer sees no plan, days, or assignments.
reset role;
select set_config('request.jwt.claim.sub', current_setting('tp.unassigned'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('tp.unassigned'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.training_plans where id = current_setting('tp.plan')::uuid)
    or exists (select 1 from public.training_plan_days where training_plan_id = current_setting('tp.plan')::uuid)
    or exists (select 1 from public.training_plan_assignments where training_plan_id = current_setting('tp.plan')::uuid) then
    raise exception 'Unassigned Archer read plan details';
  end if;
end $$;

-- G/M: an assigned Archer sees the plan and only their own assignment,
-- but cannot alter the plan or its note/targets through SQL or RPC.
reset role;
select set_config('request.jwt.claim.sub', current_setting('tp.a'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('tp.a'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.training_plans where id = current_setting('tp.plan')::uuid) <> 1
    or (select count(*) from public.training_plan_days where training_plan_id = current_setting('tp.plan')::uuid) <> 1
    or (select count(*) from public.training_plan_assignments where training_plan_id = current_setting('tp.plan')::uuid) <> 1 then
    raise exception 'Assigned Archer visibility is incorrect';
  end if;
end $$;
select pg_temp.expect_rejection(format(
  'update public.training_plans set note = %L where id = %L::uuid',
  'Archer edit', current_setting('tp.plan')));
select pg_temp.expect_rejection(format(
  'delete from public.training_plan_assignments where training_plan_id = %L::uuid',
  current_setting('tp.plan')));
select pg_temp.expect_rejection(format(
  'select public.save_training_plan(%L::uuid,%L::uuid,%L,%L::date,%L::date,700,null,''[]''::jsonb,array[%L::uuid])',
  current_setting('tp.plan'), current_setting('tp.org'), 'Archer edit',
  '2026-09-29', '2026-10-05', current_setting('tp.a')));

-- B: left Head Coach has no RLS read or RPC write access.
reset role;
select set_config('request.jwt.claim.sub', current_setting('tp.coach_left'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('tp.coach_left'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.training_plans where id = current_setting('tp.plan')::uuid) then
    raise exception 'Left Head Coach retained plan access';
  end if;
end $$;
select pg_temp.expect_rejection(format(
  'select public.delete_training_plan(%L::uuid)', current_setting('tp.plan')));
select pg_temp.expect_rejection(format(
  'select public.save_training_plan(null,%L::uuid,%L,%L::date,%L::date,700,null,''[]''::jsonb,array[%L::uuid])',
  current_setting('tp.org'), 'Left Coach create', '2026-09-29', '2026-10-05', current_setting('tp.a')));

-- An active Coach in another organisation cannot see or manage this plan.
reset role;
select set_config('request.jwt.claim.sub', current_setting('tp.coach_b'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('tp.coach_b'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.training_plans where id = current_setting('tp.plan')::uuid) then
    raise exception 'Other-organisation Coach read the plan';
  end if;
end $$;
select pg_temp.expect_rejection(format(
  'select public.delete_training_plan(%L::uuid)', current_setting('tp.plan')));

-- C: active Archer cannot create a plan.
reset role;
select set_config('request.jwt.claim.sub', current_setting('tp.b'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('tp.b'), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.expect_rejection(format(
  'select public.save_training_plan(null,%L::uuid,%L,%L::date,%L::date,700,null,''[]''::jsonb,array[%L::uuid])',
  current_setting('tp.org'), 'Archer create', '2026-09-29', '2026-10-05', current_setting('tp.b')));

-- D: anon lacks table access and EXECUTE on the RPC.
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
set local role anon;
select pg_temp.expect_rejection('select * from public.training_plans');
select pg_temp.expect_rejection(format(
  'select public.save_training_plan(null,%L::uuid,%L,%L::date,%L::date,700,null,''[]''::jsonb,array[%L::uuid])',
  current_setting('tp.org'), 'Anonymous create', '2026-09-29', '2026-10-05',
  current_setting('tp.a')));
select pg_temp.expect_rejection(format(
  'select public.delete_training_plan(%L::uuid)', current_setting('tp.plan')));

-- N: the migration adds no Coach write policy or grant on scoring tables.
reset role;
select set_config('request.jwt.claim.sub', current_setting('tp.a'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('tp.a'), 'role', 'authenticated')::text, true);
set local role authenticated;
-- Scoring setup follows the current guarded-write API, not revoked table grants.
select set_config('tp.session', id::text, true)
from public.create_owned_session('Training Plan fixture scoring', date '2026-09-29', 'training');
select set_config('tp.round', round_id::text, true)
from public.create_round_with_ends(current_setting('tp.session')::uuid,
  'Fixture Round', 'Recurve', 70, 122, 'full_face', 1, 1);
select set_config('tp.end', id::text, true) from public.session_ends
where session_round_id = current_setting('tp.round')::uuid;
select public.save_owned_arrow(current_setting('tp.end')::uuid, 1, 9, false, null, null, null);

reset role;
select set_config('request.jwt.claim.sub', current_setting('tp.coach'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('tp.coach'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.sessions where id = current_setting('tp.session')::uuid) <> 1 then
    raise exception 'Fixture Coach cannot read athlete Session';
  end if;
end $$;
select pg_temp.expect_rejection('update public.sessions set arrow_count = 99 where id = current_setting(''tp.session'')::uuid');
select pg_temp.expect_rejection('delete from public.sessions where id = current_setting(''tp.session'')::uuid');
select pg_temp.expect_rejection('update public.arrows set score_points = 10 where session_end_id = current_setting(''tp.end'')::uuid');
select pg_temp.expect_rejection('select public.update_owned_session_arrow_count(current_setting(''tp.session'')::uuid,99)');
select pg_temp.expect_rejection('select public.delete_owned_session(current_setting(''tp.session'')::uuid)');
select pg_temp.expect_rejection('select public.save_owned_arrow(current_setting(''tp.end'')::uuid,1,10,false,null,null,null)');
select pg_temp.expect_rejection(format(
  'insert into public.session_rounds (session_id,round_number,name,division,distance_metres,face_diameter_cm,face_type,planned_ends,arrows_per_end) values (%L::uuid,2,%L,%L,70,122,%L,1,1)',
  current_setting('tp.session'), 'Coach write', 'Recurve', 'full_face'));
select pg_temp.expect_rejection(format(
  'insert into public.session_ends (session_round_id,end_number) values (%L::uuid,2)',
  current_setting('tp.round')));
select pg_temp.expect_rejection(format(
  'insert into public.arrows (session_end_id,arrow_number,score_points) values (%L::uuid,2,9)',
  current_setting('tp.end')));
select pg_temp.expect_rejection('delete from public.session_rounds where id = current_setting(''tp.round'')::uuid');
select pg_temp.expect_rejection('delete from public.arrows where session_end_id = current_setting(''tp.end'')::uuid');
select pg_temp.expect_rejection('select public.delete_owned_round(current_setting(''tp.round'')::uuid,current_setting(''tp.session'')::uuid)');
select pg_temp.expect_rejection('select public.delete_owned_arrow(current_setting(''tp.end'')::uuid,1)');

-- The creating Coach leaves. Current active membership, not created_by, grants access.
select public.leave_organization(current_setting('tp.org')::uuid);
do $$ begin
  if exists (select 1 from public.training_plans where id = current_setting('tp.plan')::uuid)
    or not exists (select 1 from public.organization_members
      where organization_id = current_setting('tp.org')::uuid and user_id = auth.uid()
        and status = 'left' and left_at is not null) then
    raise exception 'Former Head Coach retained plan access or lost membership history';
  end if;
end $$;
select pg_temp.expect_rejection(format(
  'select public.delete_training_plan(%L::uuid)', current_setting('tp.plan')));

-- Another active Head Coach may delete the shared plan; scoring data is untouched.
reset role;
select set_config('request.jwt.claim.sub', current_setting('tp.coach_peer'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('tp.coach_peer'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if not public.delete_training_plan(current_setting('tp.plan')::uuid) then
    raise exception 'Active peer Head Coach could not delete the plan';
  end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.training_plans where id = current_setting('tp.plan')::uuid)
    or exists (select 1 from public.training_plan_days where training_plan_id = current_setting('tp.plan')::uuid)
    or exists (select 1 from public.training_plan_assignments where training_plan_id = current_setting('tp.plan')::uuid)
    or not exists (select 1 from public.sessions where id = current_setting('tp.session')::uuid)
    or not exists (select 1 from public.session_rounds where id = current_setting('tp.round')::uuid)
    or not exists (select 1 from public.session_ends where id = current_setting('tp.end')::uuid)
    or not exists (select 1 from public.arrows where session_end_id = current_setting('tp.end')::uuid) then
    raise exception 'Plan deletion removed scoring data or left plan children';
  end if;
end $$;
reset role;
do $$ begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename in ('sessions','session_rounds','session_ends','arrows')
      and policyname like 'training_plan%'
  ) then
    raise exception 'Training Plan migration modified scoring RLS';
  end if;
end $$;

rollback;
