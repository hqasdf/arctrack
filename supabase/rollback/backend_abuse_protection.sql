-- ROLLBACK ONLY: separately reviewed/approved operator action.
-- Exact pre-change private function definitions read from main on 2026-10-05.
-- No public wrapper, policy, grant, scoring row, or Auth configuration changes.
begin;

CREATE OR REPLACE FUNCTION private.create_owned_session(p_title text, p_session_date date, p_session_type text)
 RETURNS TABLE(id uuid, title text, session_date date, session_type text, arrow_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_title text := coalesce(nullif(pg_catalog.btrim(p_title), ''), 'Practice session');
begin
  if v_user_id is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  if pg_catalog.char_length(v_title) > 80
    or p_session_date is null or not pg_catalog.isfinite(p_session_date)
    or p_session_type is null or p_session_type not in ('training', 'competition') then
    raise exception 'Invalid Session input.' using errcode = '22023';
  end if;
  return query
    insert into public.sessions as s (user_id, title, session_date, session_type)
    values (v_user_id, v_title, p_session_date, p_session_type)
    returning s.id, s.title, s.session_date, s.session_type, s.arrow_count;
end;
$function$;

CREATE OR REPLACE FUNCTION private.create_round_with_ends(p_session_id uuid, p_name text, p_division text, p_distance_metres integer, p_face_diameter_cm integer, p_face_type text, p_planned_ends integer, p_arrows_per_end integer)
 RETURNS TABLE(round_id uuid, round_number smallint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_name text := pg_catalog.btrim(p_name);
  v_round_id uuid;
  v_round_number integer;
begin
  if v_user_id is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;

  perform 1
  from public.sessions s
  where s.id = p_session_id and s.user_id = v_user_id
  for update;
  if not found then
    raise exception 'The Session is not owned by the signed-in user.' using errcode = '42501';
  end if;

  if v_name is null or pg_catalog.char_length(v_name) not between 1 and 80
    or p_division is null or p_division not in ('Recurve', 'Compound', 'Barebow', 'Other')
    or p_face_type is null or p_face_type not in ('full_face', 'six_ring', 'triple_face')
    or p_distance_metres is null or p_distance_metres not between 1 and 32767
    or p_face_diameter_cm is null or p_face_diameter_cm not between 1 and 32767
    or p_planned_ends is null or p_planned_ends not between 1 and 32767
    or p_arrows_per_end is null or p_arrows_per_end not between 1 and 32767 then
    raise exception 'Invalid Round configuration.' using errcode = '22023';
  end if;

  select coalesce(pg_catalog.max(r.round_number), 0) + 1
  into v_round_number
  from public.session_rounds r
  where r.session_id = p_session_id;

  if v_round_number > 32767 then
    raise exception 'This Session has reached its Round number limit.' using errcode = '22023';
  end if;

  insert into public.session_rounds (
    session_id, round_number, name, division, distance_metres,
    face_diameter_cm, face_type, planned_ends, arrows_per_end
  ) values (
    p_session_id, v_round_number, v_name, p_division, p_distance_metres,
    p_face_diameter_cm, p_face_type, p_planned_ends, p_arrows_per_end
  ) returning id into v_round_id;

  insert into public.session_ends (session_round_id, end_number)
  select v_round_id, generated.end_number
  from pg_catalog.generate_series(1, p_planned_ends) as generated(end_number);

  return query select v_round_id, v_round_number::smallint;
end;
$function$;

CREATE OR REPLACE FUNCTION private.update_owned_round_settings(p_round_id uuid, p_name text, p_division text, p_distance_metres integer, p_face_diameter_cm integer, p_planned_ends integer)
 RETURNS TABLE(round_id uuid, planned_ends smallint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_name text := pg_catalog.btrim(p_name);
  v_previous_ends smallint;
begin
  if v_user_id is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;

  -- The Round row serializes simultaneous configuration changes to this Round.
  -- Owner verification is explicit because this function uses SECURITY DEFINER.
  select r.planned_ends into v_previous_ends
  from public.session_rounds r
  join public.sessions s on s.id = r.session_id
  where r.id = p_round_id and s.user_id = v_user_id
  for update of r;
  if not found then
    raise exception 'The Round is not owned by the signed-in user.' using errcode = '42501';
  end if;

  if v_name is null or pg_catalog.char_length(v_name) not between 1 and 80
    or p_division is null or p_division not in ('Recurve', 'Compound', 'Barebow', 'Other')
    or p_distance_metres is null or p_distance_metres not between 1 and 32767
    or p_face_diameter_cm is null or p_face_diameter_cm not between 1 and 32767
    or p_planned_ends is null or p_planned_ends not between v_previous_ends and 32767 then
    raise exception 'Invalid Round settings or planned-End decrease.' using errcode = '22023';
  end if;

  update public.session_rounds r
  set name = v_name, division = p_division,
      distance_metres = p_distance_metres,
      face_diameter_cm = p_face_diameter_cm,
      planned_ends = p_planned_ends
  where r.id = p_round_id;

  insert into public.session_ends (session_round_id, end_number)
  select p_round_id, generated.end_number
  from pg_catalog.generate_series(v_previous_ends + 1, p_planned_ends) as generated(end_number);

  return query select p_round_id, p_planned_ends::smallint;
end;
$function$;

CREATE OR REPLACE FUNCTION private.save_training_plan(p_plan_id uuid, p_organization_id uuid, p_title text, p_start_date date, p_end_date date, p_weekly_arrow_target integer, p_note text, p_days jsonb, p_athlete_user_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null or not private.is_active_head_coach(p_organization_id) then
    raise exception 'Only an active Head Coach may manage this Training Plan.' using errcode = '42501';
  end if;
  if p_title is null or pg_catalog.char_length(p_title) not between 1 and 120
    or p_title <> pg_catalog.btrim(p_title)
    or p_start_date is null or p_end_date is null or p_start_date > p_end_date
    or (p_weekly_arrow_target is not null and p_weekly_arrow_target <= 0)
    or (p_note is not null and pg_catalog.char_length(p_note) > 2000) then
    raise exception 'Invalid Training Plan details.' using errcode = '22023';
  end if;
  if p_days is null or pg_catalog.jsonb_typeof(p_days) <> 'array'
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_days) as item(value)
      where pg_catalog.jsonb_typeof(item.value) <> 'object') then
    raise exception 'Training Plan days must be an array of objects.' using errcode = '22023';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_to_recordset(p_days)
      as d(date date, arrow_target integer, scored_round_target integer, coach_note text)
    where d.date is null or d.date < p_start_date or d.date > p_end_date
      or (d.arrow_target is not null and d.arrow_target <= 0)
      or (d.scored_round_target is not null and d.scored_round_target <= 0)
      or (d.coach_note is not null and pg_catalog.char_length(d.coach_note) > 2000)
  ) then
    raise exception 'Invalid Training Plan day.' using errcode = '22023';
  end if;
  if p_athlete_user_ids is null or pg_catalog.cardinality(p_athlete_user_ids) = 0
    or (select count(distinct candidate.id)
      from pg_catalog.unnest(p_athlete_user_ids) as candidate(id))
        <> pg_catalog.cardinality(p_athlete_user_ids) then
    raise exception 'Select distinct active Archers.' using errcode = '22023';
  end if;
  if exists (
    select 1 from pg_catalog.unnest(p_athlete_user_ids) as candidate(id)
    where not exists (
      select 1 from public.organization_members m
      where m.organization_id = p_organization_id
        and m.user_id = candidate.id
        and m.role = 'archer' and m.status = 'active'
    )
  ) then
    raise exception 'Every assignee must be an active Archer in this organisation.' using errcode = '42501';
  end if;

  if p_plan_id is null then
    insert into public.training_plans
      (organization_id, created_by, title, start_date, end_date, weekly_arrow_target, note)
    values (p_organization_id, v_user_id, p_title, p_start_date, p_end_date,
      p_weekly_arrow_target, p_note)
    returning id into v_id;
  else
    update public.training_plans p set title = p_title, start_date = p_start_date,
      end_date = p_end_date, weekly_arrow_target = p_weekly_arrow_target,
      note = p_note, updated_at = pg_catalog.now()
    where p.id = p_plan_id and p.organization_id = p_organization_id
    returning p.id into v_id;
    if v_id is null then
      raise exception 'Training Plan not found in this organisation.' using errcode = '42501';
    end if;
  end if;

  delete from public.training_plan_days existing
  where existing.training_plan_id = v_id and not exists (
    select 1 from pg_catalog.jsonb_to_recordset(p_days) as d(date date)
    where d.date = existing.date
  );
  insert into public.training_plan_days
    (training_plan_id, date, arrow_target, scored_round_target, coach_note)
  select v_id, d.date, d.arrow_target, d.scored_round_target, d.coach_note
  from pg_catalog.jsonb_to_recordset(p_days)
    as d(date date, arrow_target integer, scored_round_target integer, coach_note text)
  on conflict (training_plan_id, date) do update set
    arrow_target = excluded.arrow_target,
    scored_round_target = excluded.scored_round_target,
    coach_note = excluded.coach_note,
    updated_at = pg_catalog.now();

  delete from public.training_plan_assignments existing
  where existing.training_plan_id = v_id
    and not (existing.athlete_user_id = any(p_athlete_user_ids));
  insert into public.training_plan_assignments
    (training_plan_id, athlete_user_id, assigned_by)
  select v_id, candidate.id, v_user_id
  from pg_catalog.unnest(p_athlete_user_ids) as candidate(id)
  on conflict (training_plan_id, athlete_user_id) do nothing;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.regenerate_organization_join_code(p_organization_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_code text; v_previous_code text;
begin
  if (select auth.uid()) is null or not private.is_active_head_coach(p_organization_id) then
    raise exception 'Only an active Head Coach may regenerate this join code.' using errcode = '42501';
  end if;
  select join_code into v_previous_code from public.organizations
    where id = p_organization_id for update;
  loop
    v_code := private.new_organization_join_code();
    exit when v_code <> v_previous_code and not exists (
      select 1 from public.organizations where join_code = v_code);
  end loop;
  update public.organizations set join_code = v_code where id = p_organization_id;
  return v_code;
end;
$function$;

CREATE OR REPLACE FUNCTION private.join_organization_by_code(p_code text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_organization_id uuid; v_joined_user_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  select id into v_organization_id from public.organizations
    where join_code = upper(btrim(p_code));
  if v_organization_id is null then
    raise exception 'Invalid join code.' using errcode = '22023';
  end if;
  insert into public.organization_members (organization_id, user_id, role, status)
    values (v_organization_id, (select auth.uid()), 'archer', 'active')
    on conflict (organization_id, user_id) do update
      set role = 'archer', status = 'active', joined_at = now(), left_at = null
      where public.organization_members.status = 'left'
    returning user_id into v_joined_user_id;
  return case when v_joined_user_id is null then 'already_member' else 'joined' end;
end;
$function$;
drop function private.validate_round_workload(integer, integer);
drop function private.consume_operation_budget(text);
drop table private.operation_budgets;
commit;

