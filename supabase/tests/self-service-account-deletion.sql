-- REVIEW ONLY. Run in a disposable database; never on live.
-- Tests the existing FK deletion contract as admin, not an application deletion API.
-- Fresh password/confirmation and the trusted Admin Auth boundary need separate runtime tests.
-- Requires the current guarded scoring, training-plan and operation-budget migrations.
-- All fixture data and the temporary failure trigger are rolled back.
begin;

select set_config('d7.owner', gen_random_uuid()::text, true);
select set_config('d7.other', gen_random_uuid()::text, true);
select set_config('d7.owner_session', gen_random_uuid()::text, true);
select set_config('d7.other_session', gen_random_uuid()::text, true);
insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
select id, 'authenticated', 'authenticated', 'd7-' || id || '@example.invalid', now(), now(), now()
from (values (current_setting('d7.owner')::uuid), (current_setting('d7.other')::uuid)) users(id);
-- Auth session rows are fixture-only admin setup, not a production sign-in path.
insert into auth.sessions (id, user_id)
values (current_setting('d7.owner_session')::uuid, current_setting('d7.owner')::uuid),
       (current_setting('d7.other_session')::uuid, current_setting('d7.other')::uuid);

select set_config('request.jwt.claim.sub', current_setting('d7.owner'), true);
select set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('d7.owner'), 'role', 'authenticated',
  'session_id', current_setting('d7.owner_session'))::text, true);
set local role authenticated;
select set_config('d7.session', created.id::text, true)
from public.create_owned_session('D7 deletion fixture', current_date, 'training') created;
select set_config('d7.round', created.round_id::text, true)
from public.create_round_with_ends(current_setting('d7.session')::uuid,
  'D7 Round', 'Recurve', 70, 122, 'full_face', 1, 6) created;
select set_config('d7.arrow', saved.id::text, true)
from public.session_ends e cross join lateral public.save_owned_arrow(
  e.id, 1, 10, true, 0.01::double precision, 0.02::double precision, null, null) saved
where e.session_round_id = current_setting('d7.round')::uuid and e.end_number = 1;
with created as (
  insert into public.organizations (name, created_by)
  values ('D7 shared organisation', auth.uid())
  returning id
)
select set_config('d7.organization', id::text, true) from created;
reset role;

-- Shared fixture rows are inserted as admin so both athlete/coach FK paths are covered.
insert into public.organization_members (organization_id, user_id, role, status)
values (current_setting('d7.organization')::uuid, current_setting('d7.other')::uuid, 'archer', 'active');
select set_config('d7.plan', gen_random_uuid()::text, true);
insert into public.training_plans
  (id, organization_id, created_by, title, start_date, end_date, weekly_arrow_target, note)
values (current_setting('d7.plan')::uuid, current_setting('d7.organization')::uuid,
  current_setting('d7.owner')::uuid, 'D7 shared plan', current_date, current_date, 60, 'Preserve this note');
insert into public.training_plan_days (training_plan_id, date, arrow_target, coach_note)
values (current_setting('d7.plan')::uuid, current_date, 60, 'Preserve this day');
insert into public.training_plan_assignments (training_plan_id, athlete_user_id, assigned_by)
select current_setting('d7.plan')::uuid, id, current_setting('d7.owner')::uuid
from (values (current_setting('d7.owner')::uuid), (current_setting('d7.other')::uuid)) users(id);

select set_config('request.jwt.claim.sub', current_setting('d7.other'), true);
select set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('d7.other'), 'role', 'authenticated',
  'session_id', current_setting('d7.other_session'))::text, true);
set local role authenticated;
select set_config('d7.other_scoring_session', created.id::text, true)
from public.create_owned_session('D7 other athlete session', current_date, 'training') created;
select set_config('d7.other_round', created.round_id::text, true)
from public.create_round_with_ends(current_setting('d7.other_scoring_session')::uuid,
  'D7 Other Round', 'Recurve', 70, 122, 'full_face', 1, 6) created;
select set_config('d7.other_arrow', saved.id::text, true)
from public.session_ends e cross join lateral public.save_owned_arrow(
  e.id, 1, 9, false, null, null, null, null) saved
where e.session_round_id = current_setting('d7.other_round')::uuid and e.end_number = 1;
reset role;

-- Capture complete relevant tables before failure and unaffected row content before success.
create temporary table d7_before as
select 'users' as kind, to_jsonb(t) as row_data from auth.users t where id in
  (current_setting('d7.owner')::uuid, current_setting('d7.other')::uuid)
union all select 'auth_sessions', to_jsonb(t) from auth.sessions t where user_id in
  (current_setting('d7.owner')::uuid, current_setting('d7.other')::uuid)
union all select 'profiles', to_jsonb(t) from public.profiles t where id in
  (current_setting('d7.owner')::uuid, current_setting('d7.other')::uuid)
union all select 'sessions', to_jsonb(t) from public.sessions t where user_id in
  (current_setting('d7.owner')::uuid, current_setting('d7.other')::uuid)
union all select 'rounds', to_jsonb(t) from public.session_rounds t where session_id in
  (current_setting('d7.session')::uuid, current_setting('d7.other_scoring_session')::uuid)
union all select 'ends', to_jsonb(t) from public.session_ends t where session_round_id in
  (current_setting('d7.round')::uuid, current_setting('d7.other_round')::uuid)
union all select 'arrows', to_jsonb(t) from public.arrows t where id in
  (current_setting('d7.arrow')::uuid, current_setting('d7.other_arrow')::uuid)
union all select 'organizations', to_jsonb(t) from public.organizations t
  where id = current_setting('d7.organization')::uuid
union all select 'members', to_jsonb(t) from public.organization_members t
  where organization_id = current_setting('d7.organization')::uuid
union all select 'plans', to_jsonb(t) from public.training_plans t where id = current_setting('d7.plan')::uuid
union all select 'days', to_jsonb(t) from public.training_plan_days t where training_plan_id = current_setting('d7.plan')::uuid
union all select 'assignments', to_jsonb(t) from public.training_plan_assignments t where training_plan_id = current_setting('d7.plan')::uuid
union all select 'budgets', to_jsonb(t) from private.operation_budgets t where user_id in
  (current_setting('d7.owner')::uuid, current_setting('d7.other')::uuid);

-- The retired authenticated RPC must be absent, including any parameterized overload.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.proname = 'delete_own_account') then
    raise exception 'FAIL: retired deletion RPC still exists';
  end if;
end;
$$;
set local role authenticated;
do $$
declare denied boolean := false;
begin
  begin execute 'select public.delete_own_account()';
  exception when undefined_function or insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL: authenticated public legacy RPC call accepted'; end if;
  denied := false;
  begin execute 'select private.delete_own_account()';
  exception when undefined_function or insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL: authenticated private legacy RPC call accepted'; end if;
end;
$$;
reset role;

-- Force a fixture-only failure inside an admin Auth-row deletion; it must stay atomic.
create function pg_temp.d7_reject_delete() returns trigger language plpgsql as $$
begin
  if old.id = current_setting('d7.owner')::uuid then
    raise exception 'D7 deliberate deletion failure' using errcode = 'P0001';
  end if;
  return old;
end;
$$;
create trigger d7_reject_delete before delete on auth.users
for each row execute function pg_temp.d7_reject_delete();
do $$
declare failed boolean := false;
begin
  begin delete from auth.users where id = current_setting('d7.owner')::uuid;
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'D7 deliberate deletion failure' then raise; end if;
    failed := true;
  end;
  if not failed then raise exception 'FAIL: deliberate failure did not propagate'; end if;
end;
$$;
do $$
begin
  if exists (select 1 from pg_temp.d7_before b where case b.kind
    when 'users' then not exists (select 1 from auth.users t where to_jsonb(t) = b.row_data)
    when 'auth_sessions' then not exists (select 1 from auth.sessions t where to_jsonb(t) = b.row_data)
    when 'profiles' then not exists (select 1 from public.profiles t where to_jsonb(t) = b.row_data)
    when 'sessions' then not exists (select 1 from public.sessions t where to_jsonb(t) = b.row_data)
    when 'rounds' then not exists (select 1 from public.session_rounds t where to_jsonb(t) = b.row_data)
    when 'ends' then not exists (select 1 from public.session_ends t where to_jsonb(t) = b.row_data)
    when 'arrows' then not exists (select 1 from public.arrows t where to_jsonb(t) = b.row_data)
    when 'organizations' then not exists (select 1 from public.organizations t where to_jsonb(t) = b.row_data)
    when 'members' then not exists (select 1 from public.organization_members t where to_jsonb(t) = b.row_data)
    when 'plans' then not exists (select 1 from public.training_plans t where to_jsonb(t) = b.row_data)
    when 'days' then not exists (select 1 from public.training_plan_days t where to_jsonb(t) = b.row_data)
    when 'assignments' then not exists (select 1 from public.training_plan_assignments t where to_jsonb(t) = b.row_data)
    when 'budgets' then not exists (select 1 from private.operation_budgets t where to_jsonb(t) = b.row_data)
    else true end) then
    raise exception 'FAIL: rejected deletion changed fixture rows';
  end if;
end;
$$;
drop trigger d7_reject_delete on auth.users;

delete from auth.users where id = current_setting('d7.owner')::uuid;
-- Synthetic stale claims test table RLS after the owner's membership is removed.
-- This is not evidence of JWT revocation or an executed Admin Auth HTTP request.
select set_config('request.jwt.claim.sub', current_setting('d7.owner'), true);
select set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('d7.owner'), 'role', 'authenticated',
  'session_id', current_setting('d7.owner_session'))::text, true);
set local role authenticated;
do $$
begin
  if exists (select 1 from public.training_plans where id = current_setting('d7.plan')::uuid)
    or exists (select 1 from public.sessions where id = current_setting('d7.other_scoring_session')::uuid)
    or exists (select 1 from public.organizations where id = current_setting('d7.organization')::uuid) then
    raise exception 'FAIL: deleted Head Coach retained shared data access';
  end if;
end;
$$;
reset role;
do $$
begin
  if exists (select 1 from auth.users where id = current_setting('d7.owner')::uuid)
    or exists (select 1 from auth.sessions where user_id = current_setting('d7.owner')::uuid)
    or exists (select 1 from public.profiles where id = current_setting('d7.owner')::uuid)
    or exists (select 1 from public.sessions where user_id = current_setting('d7.owner')::uuid)
    or exists (select 1 from public.session_rounds where id = current_setting('d7.round')::uuid)
    or exists (select 1 from public.session_ends where session_round_id = current_setting('d7.round')::uuid)
    or exists (select 1 from public.arrows where id = current_setting('d7.arrow')::uuid)
    or exists (select 1 from public.organization_members where user_id = current_setting('d7.owner')::uuid)
    or exists (select 1 from public.training_plan_assignments where athlete_user_id = current_setting('d7.owner')::uuid)
    or exists (select 1 from private.operation_budgets where user_id = current_setting('d7.owner')::uuid) then
    raise exception 'FAIL: deleted account left dependent rows';
  end if;
  if not exists (select 1 from public.organizations t join pg_temp.d7_before b
      on b.kind = 'organizations' and to_jsonb(t) = jsonb_set(b.row_data, '{created_by}', 'null'::jsonb))
    or not exists (select 1 from public.training_plans t join pg_temp.d7_before b
      on b.kind = 'plans' and to_jsonb(t) = jsonb_set(b.row_data, '{created_by}', 'null'::jsonb))
    or not exists (select 1 from public.training_plan_assignments t join pg_temp.d7_before b
      on b.kind = 'assignments' and b.row_data->>'athlete_user_id' = current_setting('d7.other')
      and to_jsonb(t) = jsonb_set(b.row_data, '{assigned_by}', 'null'::jsonb)) then
    raise exception 'FAIL: shared organization, plan or assignment preservation';
  end if;
  if exists (select 1 from pg_temp.d7_before b where case
    when b.kind = 'days' then not exists (select 1 from public.training_plan_days t where to_jsonb(t) = b.row_data)
    when b.kind = 'users' and b.row_data->>'id' = current_setting('d7.other') then not exists (select 1 from auth.users t where to_jsonb(t) = b.row_data)
    when b.kind = 'auth_sessions' and b.row_data->>'user_id' = current_setting('d7.other') then not exists (select 1 from auth.sessions t where to_jsonb(t) = b.row_data)
    when b.kind = 'profiles' and b.row_data->>'id' = current_setting('d7.other') then not exists (select 1 from public.profiles t where to_jsonb(t) = b.row_data)
    when b.kind = 'sessions' and b.row_data->>'user_id' = current_setting('d7.other') then not exists (select 1 from public.sessions t where to_jsonb(t) = b.row_data)
    when b.kind = 'rounds' and b.row_data->>'id' = current_setting('d7.other_round') then not exists (select 1 from public.session_rounds t where to_jsonb(t) = b.row_data)
    when b.kind = 'ends' and b.row_data->>'session_round_id' = current_setting('d7.other_round') then not exists (select 1 from public.session_ends t where to_jsonb(t) = b.row_data)
    when b.kind = 'arrows' and b.row_data->>'id' = current_setting('d7.other_arrow') then not exists (select 1 from public.arrows t where to_jsonb(t) = b.row_data)
    when b.kind = 'members' and b.row_data->>'user_id' = current_setting('d7.other') then not exists (select 1 from public.organization_members t where to_jsonb(t) = b.row_data)
    when b.kind = 'budgets' and b.row_data->>'user_id' = current_setting('d7.other') then not exists (select 1 from private.operation_budgets t where to_jsonb(t) = b.row_data)
    else false end)
    or not exists (select 1 from public.arrows where id = current_setting('d7.other_arrow')::uuid) then
    raise exception 'FAIL: other athlete or shared days changed';
  end if;
end;
$$;

-- The existing FK contract also removes an active Archer's account-owned rows.
delete from auth.users where id = current_setting('d7.other')::uuid;
do $$
begin
  if exists (select 1 from auth.users where id = current_setting('d7.other')::uuid)
    or exists (select 1 from auth.sessions where user_id = current_setting('d7.other')::uuid)
    or exists (select 1 from public.profiles where id = current_setting('d7.other')::uuid)
    or exists (select 1 from public.sessions where user_id = current_setting('d7.other')::uuid)
    or exists (select 1 from public.session_rounds where id = current_setting('d7.other_round')::uuid)
    or exists (select 1 from public.session_ends where session_round_id = current_setting('d7.other_round')::uuid)
    or exists (select 1 from public.arrows where id = current_setting('d7.other_arrow')::uuid)
    or exists (select 1 from public.organization_members where user_id = current_setting('d7.other')::uuid)
    or exists (select 1 from public.training_plan_assignments where athlete_user_id = current_setting('d7.other')::uuid)
    or exists (select 1 from private.operation_budgets where user_id = current_setting('d7.other')::uuid) then
    raise exception 'FAIL: Archer deletion left dependent rows';
  end if;
  if not exists (select 1 from public.organizations t join pg_temp.d7_before b
      on b.kind = 'organizations' and to_jsonb(t) = jsonb_set(b.row_data, '{created_by}', 'null'::jsonb))
    or not exists (select 1 from public.training_plans t join pg_temp.d7_before b
      on b.kind = 'plans' and to_jsonb(t) = jsonb_set(b.row_data, '{created_by}', 'null'::jsonb))
    or exists (select 1 from pg_temp.d7_before b where b.kind = 'days'
      and not exists (select 1 from public.training_plan_days t where to_jsonb(t) = b.row_data)) then
    raise exception 'FAIL: Archer deletion changed shared data';
  end if;
end;
$$;

-- The existing FK contract also removes a former member without active membership.
select set_config('d7.former', gen_random_uuid()::text, true);
select set_config('d7.former_session', gen_random_uuid()::text, true);
insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
values (current_setting('d7.former')::uuid, 'authenticated', 'authenticated',
  'd7-' || current_setting('d7.former') || '@example.invalid', now(), now(), now());
insert into auth.sessions (id, user_id)
values (current_setting('d7.former_session')::uuid, current_setting('d7.former')::uuid);
insert into public.organization_members (organization_id, user_id, role, status, left_at)
values (current_setting('d7.organization')::uuid, current_setting('d7.former')::uuid,
  'archer', 'left', now());
delete from auth.users where id = current_setting('d7.former')::uuid;
do $$
begin
  if exists (select 1 from auth.users where id = current_setting('d7.former')::uuid)
    or exists (select 1 from auth.sessions where user_id = current_setting('d7.former')::uuid)
    or exists (select 1 from public.profiles where id = current_setting('d7.former')::uuid)
    or exists (select 1 from public.organization_members where user_id = current_setting('d7.former')::uuid) then
    raise exception 'FAIL: former member deletion left dependent rows';
  end if;
  if not exists (select 1 from public.organizations t join pg_temp.d7_before b
      on b.kind = 'organizations' and to_jsonb(t) = jsonb_set(b.row_data, '{created_by}', 'null'::jsonb))
    or not exists (select 1 from public.training_plans t join pg_temp.d7_before b
      on b.kind = 'plans' and to_jsonb(t) = jsonb_set(b.row_data, '{created_by}', 'null'::jsonb))
    or exists (select 1 from pg_temp.d7_before b where b.kind = 'days'
      and not exists (select 1 from public.training_plan_days t where to_jsonb(t) = b.row_data)) then
    raise exception 'FAIL: former member deletion changed shared data';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
set local role anon;
do $$
declare denied boolean := false;
begin
  begin execute 'select public.delete_own_account()';
  exception when undefined_function or insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL: anonymous public legacy RPC call accepted'; end if;
  denied := false;
  begin execute 'select private.delete_own_account()';
  exception when undefined_function or insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL: anonymous private legacy RPC call accepted'; end if;
end;
$$;
reset role;
rollback;
