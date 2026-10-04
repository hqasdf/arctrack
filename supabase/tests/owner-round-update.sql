-- Disposable database only. Requires owner-round-update and guarded-scoring-mutations migrations.
-- All fixture data and the simulated failure trigger roll back.
begin;

select set_config('d6.owner', gen_random_uuid()::text, true);
select set_config('d6.other', gen_random_uuid()::text, true);
select set_config('d6.coach', gen_random_uuid()::text, true);
insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
select id, 'authenticated', 'authenticated', 'd6-' || id || '@example.invalid', now(), now(), now()
from (values (current_setting('d6.owner')::uuid), (current_setting('d6.other')::uuid),
  (current_setting('d6.coach')::uuid)) users(id);

select set_config('request.jwt.claim.sub', current_setting('d6.owner'), true);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('d6.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

select set_config('d6.session', created.id::text, true)
from public.create_owned_session('D6 Round update fixture', current_date, 'training') created;

select set_config('d6.round', created.round_id::text, true)
from public.create_round_with_ends(
  current_setting('d6.session')::uuid, 'Initial', 'Recurve',
  70, 122, 'triple_face', 2, 6
) created;

-- Metadata and planned Ends update atomically; numbering and layout stay fixed.
select * from public.update_owned_round_settings(
  current_setting('d6.round')::uuid, '  Revised  ', 'Compound', 50, 80, 4
);
do $$
begin
  if not exists (
    select 1 from public.session_rounds
    where id = current_setting('d6.round')::uuid and name = 'Revised'
      and division = 'Compound' and distance_metres = 50 and face_diameter_cm = 80
      and planned_ends = 4 and face_type = 'triple_face' and arrows_per_end = 6
      and round_number = 1
  ) then raise exception 'FAIL: owner Round metadata update incorrect'; end if;
  if (select array_agg(end_number order by end_number) from public.session_ends
      where session_round_id = current_setting('d6.round')::uuid)
    is distinct from array[1,2,3,4]::smallint[] then
    raise exception 'FAIL: planned Ends were not appended exactly';
  end if;
end;
$$;

select public.save_owned_arrow(id, 1, 9, false, 0.2, 0.1, 1) from public.session_ends
where session_round_id = current_setting('d6.round')::uuid and end_number = 1;

select * from public.update_owned_round_settings(
  current_setting('d6.round')::uuid, 'Scored metadata', 'Recurve', 70, 122, 5
);
do $$
begin
  if (select count(*) from public.session_ends
      where session_round_id = current_setting('d6.round')::uuid and end_number between 1 and 4) <> 4
    then raise exception 'FAIL: existing Ends changed'; end if;
  if not exists (select 1 from public.arrows a join public.session_ends e on e.id = a.session_end_id
    where e.session_round_id = current_setting('d6.round')::uuid
      and a.score_points = 9 and a.is_x = false and a.plot_x = 0.2 and a.plot_y = 0.1
      and a.face_index = 1)
    then raise exception 'FAIL: saved Arrow data changed'; end if;
  if (select count(*) from public.session_ends where session_round_id = current_setting('d6.round')::uuid) <> 5
    then raise exception 'FAIL: End increase did not preserve and append Ends'; end if;
end;
$$;

-- The same organisation grants coach reads, but never ownership-based writes.
reset role;
do $$
declare v_organization_id uuid;
begin
  insert into public.organizations (name, created_by)
  values ('D6 Round update coach fixture', current_setting('d6.coach')::uuid)
  returning id into v_organization_id;
  perform set_config('d6.organization', v_organization_id::text, true);
end;
$$;
insert into public.organization_members (organization_id, user_id, role, status)
values (current_setting('d6.organization')::uuid, current_setting('d6.owner')::uuid, 'archer', 'active');

select set_config('request.jwt.claim.sub', current_setting('d6.coach'), true);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('d6.coach'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if not exists (select 1 from public.sessions where id = current_setting('d6.session')::uuid)
    or not exists (select 1 from public.session_rounds where id = current_setting('d6.round')::uuid)
    then raise exception 'FAIL: coach cannot read athlete Round'; end if;
  begin
    perform public.update_owned_round_settings(current_setting('d6.round')::uuid,
      'Coach edit', 'Recurve', 70, 122, 6);
    raise exception 'FAIL: coach updated athlete Round';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', current_setting('d6.owner'), true);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('d6.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
begin
  begin
    perform public.update_owned_round_settings(current_setting('d6.round')::uuid,
      'Shrunk', 'Recurve', 70, 122, 1);
    raise exception 'FAIL: planned-End decrease was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.update_owned_round_settings(current_setting('d6.round')::uuid,
      'Bad division', 'Invalid', 70, 122, 5);
    raise exception 'FAIL: invalid division was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.update_owned_round_settings(current_setting('d6.round')::uuid,
      ' ', 'Recurve', 70, 122, 5);
    raise exception 'FAIL: blank name was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.update_owned_round_settings(current_setting('d6.round')::uuid,
      'Zero distance', 'Recurve', 0, 122, 5);
    raise exception 'FAIL: zero distance was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.update_owned_round_settings(current_setting('d6.round')::uuid,
      'Zero face', 'Recurve', 70, 0, 5);
    raise exception 'FAIL: zero diameter was accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

-- Force the append to fail and verify the metadata UPDATE rolls back with it.
reset role;
create function pg_temp.d6_reject_end() returns trigger language plpgsql as $$
begin
  if new.session_round_id = current_setting('d6.round')::uuid then
    raise exception 'D6 forced End failure' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger d6_reject_end before insert on public.session_ends
for each row execute function pg_temp.d6_reject_end();
set local role authenticated;
do $$
declare v_failed boolean := false;
begin
  begin
    perform public.update_owned_round_settings(current_setting('d6.round')::uuid,
      'Should roll back', 'Compound', 30, 40, 6);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: forced End insert did not fail'; end if;
  if not exists (select 1 from public.session_rounds
      where id = current_setting('d6.round')::uuid and name = 'Scored metadata'
        and division = 'Recurve' and distance_metres = 70
        and face_diameter_cm = 122 and planned_ends = 5)
    or exists (select 1 from public.session_ends
      where session_round_id = current_setting('d6.round')::uuid and end_number = 6)
    then raise exception 'FAIL: failed append left partial Round data'; end if;
end;
$$;
reset role;
drop trigger d6_reject_end on public.session_ends;
drop function pg_temp.d6_reject_end();
set local role authenticated;

select set_config('request.jwt.claim.sub', current_setting('d6.other'), true);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('d6.other'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform public.update_owned_round_settings(current_setting('d6.round')::uuid,
      'Stolen', 'Recurve', 70, 122, 5);
    raise exception 'FAIL: non-owner updated Round';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);
set local role anon;
do $$
begin
  begin
    perform public.update_owned_round_settings(current_setting('d6.round')::uuid,
      'Anonymous', 'Recurve', 70, 122, 5);
    raise exception 'FAIL: anonymous execution succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;

rollback;
