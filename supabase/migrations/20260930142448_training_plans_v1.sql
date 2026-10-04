-- REVIEW PROPOSAL ONLY. Do not apply until separately approved.
begin;

create table public.training_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  title text not null check (char_length(title) between 1 and 120 and title = btrim(title)),
  start_date date not null,
  end_date date not null,
  weekly_arrow_target integer check (weekly_arrow_target > 0),
  note text check (note is null or char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_plans_dates_valid check (start_date <= end_date)
);
create index training_plans_org_dates_idx
  on public.training_plans (organization_id, start_date desc);

create table public.training_plan_days (
  id uuid primary key default gen_random_uuid(),
  training_plan_id uuid not null references public.training_plans(id) on delete cascade,
  date date not null,
  arrow_target integer check (arrow_target > 0),
  scored_round_target integer check (scored_round_target > 0),
  coach_note text check (coach_note is null or char_length(coach_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_plan_days_unique_date unique (training_plan_id, date)
);

create table public.training_plan_assignments (
  training_plan_id uuid not null references public.training_plans(id) on delete cascade,
  athlete_user_id uuid not null references auth.users(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id) on delete set null,
  primary key (training_plan_id, athlete_user_id)
);
create index training_plan_assignments_athlete_idx
  on public.training_plan_assignments (athlete_user_id, training_plan_id);

alter table public.training_plans enable row level security;
alter table public.training_plan_days enable row level security;
alter table public.training_plan_assignments enable row level security;
revoke all on table public.training_plans, public.training_plan_days,
  public.training_plan_assignments from public, anon, authenticated;
grant select on table public.training_plans, public.training_plan_days,
  public.training_plan_assignments to authenticated;

-- These private helpers avoid recursive plan/assignment RLS checks. Their owner
-- must be the migration owner with access to the underlying tables.
create function private.can_read_training_plan(p_plan_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.training_plans p
    join public.organization_members m
      on m.organization_id = p.organization_id
      and m.user_id = (select auth.uid()) and m.status = 'active'
    where p.id = p_plan_id and (
      m.role = 'head_coach'
      or (m.role = 'archer' and exists (
        select 1 from public.training_plan_assignments a
        where a.training_plan_id = p.id and a.athlete_user_id = m.user_id
      ))
    )
  );
$$;
create function private.can_manage_training_plan(p_plan_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.training_plans p
    join public.organization_members m
      on m.organization_id = p.organization_id
      and m.user_id = (select auth.uid())
      and m.role = 'head_coach' and m.status = 'active'
    where p.id = p_plan_id
  );
$$;
revoke all on function private.can_read_training_plan(uuid),
  private.can_manage_training_plan(uuid) from public, anon, authenticated;
grant execute on function private.can_read_training_plan(uuid),
  private.can_manage_training_plan(uuid) to authenticated;

create policy training_plans_select_allowed on public.training_plans
for select to authenticated using (private.can_read_training_plan(id));
create policy training_plan_days_select_allowed on public.training_plan_days
for select to authenticated using (private.can_read_training_plan(training_plan_id));
create policy training_plan_assignments_select_allowed on public.training_plan_assignments
for select to authenticated using (
  private.can_manage_training_plan(training_plan_id)
  or (athlete_user_id = (select auth.uid())
    and private.can_read_training_plan(training_plan_id))
);

-- A child date cannot escape its parent plan. The write RPC also validates
-- dates before changing rows; this trigger protects privileged direct writes.
create function private.training_plan_day_in_range()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_start date; v_end date;
begin
  select p.start_date, p.end_date into v_start, v_end
  from public.training_plans p where p.id = new.training_plan_id;
  if v_start is not null and (new.date < v_start or new.date > v_end) then
    raise exception 'Training Plan day is outside the plan date range.' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.training_plan_day_in_range()
  from public, anon, authenticated;
create trigger training_plan_days_check_range
before insert or update on public.training_plan_days
for each row execute function private.training_plan_day_in_range();

-- One transaction writes the definition, its days, and all assignments.
-- Passing NULL for p_plan_id creates a plan; an existing id edits it.
create function private.save_training_plan(
  p_plan_id uuid, p_organization_id uuid, p_title text,
  p_start_date date, p_end_date date, p_weekly_arrow_target integer,
  p_note text, p_days jsonb, p_athlete_user_ids uuid[]
)
returns uuid language plpgsql security definer set search_path = '' as $$
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
$$;
revoke all on function private.save_training_plan(uuid, uuid, text, date, date,
  integer, text, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function private.save_training_plan(uuid, uuid, text, date, date,
  integer, text, jsonb, uuid[]) to authenticated;

create function public.save_training_plan(
  p_plan_id uuid, p_organization_id uuid, p_title text,
  p_start_date date, p_end_date date, p_weekly_arrow_target integer,
  p_note text, p_days jsonb, p_athlete_user_ids uuid[]
)
returns uuid language sql security invoker set search_path = '' as $$
  select private.save_training_plan(p_plan_id, p_organization_id, p_title,
    p_start_date, p_end_date, p_weekly_arrow_target, p_note, p_days, p_athlete_user_ids);
$$;
revoke all on function public.save_training_plan(uuid, uuid, text, date, date,
  integer, text, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.save_training_plan(uuid, uuid, text, date, date,
  integer, text, jsonb, uuid[]) to authenticated;

create function private.delete_training_plan(p_plan_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.can_manage_training_plan(p_plan_id) then
    raise exception 'Only an active Head Coach may delete this Training Plan.' using errcode = '42501';
  end if;
  delete from public.training_plans where id = p_plan_id;
  return found;
end;
$$;
revoke all on function private.delete_training_plan(uuid) from public, anon, authenticated;
grant execute on function private.delete_training_plan(uuid) to authenticated;
create function public.delete_training_plan(p_plan_id uuid)
returns boolean language sql security invoker set search_path = '' as $$
  select private.delete_training_plan(p_plan_id);
$$;
revoke all on function public.delete_training_plan(uuid) from public, anon, authenticated;
grant execute on function public.delete_training_plan(uuid) to authenticated;

commit;
