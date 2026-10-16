-- LOCAL PREPARATION ONLY. Apply only after separate database approval.
-- No existing Session/scoring table, function, policy or grant is changed.
begin;

create table public.session_weather_snapshots (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  round_id uuid references public.session_rounds(id) on delete set null,
  provider text not null check (provider = 'open-meteo'),
  observed_at timestamptz not null,
  retrieved_at timestamptz not null default now(),
  temperature_c double precision check (temperature_c between -100 and 70),
  wind_speed_kph double precision check (wind_speed_kph between 0 and 500),
  wind_gust_kph double precision check (wind_gust_kph between 0 and 600),
  wind_direction_degrees double precision check (wind_direction_degrees between 0 and 360),
  humidity_percent double precision check (humidity_percent between 0 and 100),
  condition_code integer check (condition_code between 0 and 99),
  constraint session_weather_observation_unique unique (session_id, provider, observed_at)
);
create index session_weather_snapshots_recent_idx
  on public.session_weather_snapshots (session_id, retrieved_at desc);
create index session_weather_snapshots_round_idx on public.session_weather_snapshots (round_id);
alter table public.session_weather_snapshots enable row level security;
revoke all on table public.session_weather_snapshots from public, anon, authenticated, service_role;
grant select on table public.session_weather_snapshots to authenticated;
create policy session_weather_snapshots_select_owner
  on public.session_weather_snapshots for select to authenticated
  using (exists (select 1 from public.sessions s
    where s.id = session_weather_snapshots.session_id and s.user_id = (select auth.uid())));

-- One coordination row per Session is necessary: uniqueness alone deduplicates saves,
-- but cannot stop two devices paying for the same external fetch before either saves.
-- Short leases avoid an open transaction across the provider HTTP request. No GPS stored.
create table private.session_weather_refresh_state (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  round_id uuid not null references public.session_rounds(id) on delete cascade,
  claim_id uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  checked_at timestamptz
);
create index session_weather_refresh_state_round_idx on private.session_weather_refresh_state (round_id);
alter table private.session_weather_refresh_state enable row level security;
revoke all on table private.session_weather_refresh_state from public, anon, authenticated, service_role;

-- Caller identity comes from the backend's verified getUser(), not browser arguments.
-- This helper is not granted to any API role. Every public entry point is service-only.
create function private.require_weather_round(p_user_id uuid, p_round_id uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_session_id uuid; v_eligible boolean;
begin
  select s.id,
    r.distance_metres between 1 and 32767 and r.distance_metres <> 18
    and s.session_date = (pg_catalog.now() at time zone 'Asia/Singapore')::date
    and r.planned_ends > 0 and r.arrows_per_end > 0
    and (select pg_catalog.count(*)
      from public.session_ends e join public.arrows a on a.session_end_id = e.id
      where e.session_round_id = r.id and e.end_number between 1 and r.planned_ends
        and a.arrow_number between 1 and r.arrows_per_end)
      < r.planned_ends::integer * r.arrows_per_end::integer
  into v_session_id, v_eligible
  from public.session_rounds r join public.sessions s on s.id = r.session_id
  join auth.users u on u.id = s.user_id
  where r.id = p_round_id and s.user_id = p_user_id and u.email_confirmed_at is not null;
  if v_session_id is null then
    raise exception 'Weather Session is not owned by the verified user.' using errcode = '42501';
  end if;
  if not coalesce(v_eligible, false) then
    raise exception 'This Round is not eligible for current weather.' using errcode = '22023';
  end if;
  return v_session_id;
end;
$$;
revoke all on function private.require_weather_round(uuid, uuid) from public, anon, authenticated, service_role;

create function private.read_session_weather_refresh(p_user_id uuid, p_session_id uuid)
returns table (next_refresh_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.sessions s join auth.users u on u.id = s.user_id
    where s.id = p_session_id and s.user_id = p_user_id and u.email_confirmed_at is not null) then
    raise exception 'Weather Session is not owned by the verified user.' using errcode = '42501';
  end if;
  return query select greatest(
    (select max(w.retrieved_at) + interval '30 minutes' from public.session_weather_snapshots w where w.session_id = p_session_id),
    (select greatest(st.checked_at + interval '30 minutes', st.next_attempt_at, st.lease_expires_at)
      from private.session_weather_refresh_state st where st.session_id = p_session_id)
  );
end;
$$;

create function private.claim_session_weather_refresh(p_user_id uuid, p_round_id uuid)
returns table (claimed boolean, claim_id uuid, session_id uuid, next_refresh_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
declare v_session_id uuid; v_claim_id uuid := pg_catalog.gen_random_uuid(); v_now timestamptz := pg_catalog.clock_timestamp(); v_due timestamptz;
begin
  v_session_id := private.require_weather_round(p_user_id, p_round_id);
  select r.next_refresh_at into v_due from private.read_session_weather_refresh(p_user_id, v_session_id) r;
  if v_due > v_now then
    return query select false, null::uuid, v_session_id, v_due;
    return;
  end if;
  insert into private.session_weather_refresh_state as st
    (session_id, round_id, claim_id, lease_expires_at, next_attempt_at)
  values (v_session_id, p_round_id, v_claim_id, v_now + interval '90 seconds', v_now)
  on conflict on constraint session_weather_refresh_state_pkey do update
    set round_id = excluded.round_id, claim_id = excluded.claim_id,
      lease_expires_at = excluded.lease_expires_at
    where (st.lease_expires_at is null or st.lease_expires_at <= v_now)
      and st.next_attempt_at <= v_now
      and (st.checked_at is null or st.checked_at + interval '30 minutes' <= v_now);
  if found then
    return query select true, v_claim_id, v_session_id, v_now + interval '90 seconds';
  else
    select r.next_refresh_at into v_due from private.read_session_weather_refresh(p_user_id, v_session_id) r;
    return query select false, null::uuid, v_session_id, v_due;
  end if;
end;
$$;

create function private.save_session_weather_snapshot(
  p_user_id uuid, p_round_id uuid, p_claim_id uuid, p_observed_at timestamptz,
  p_temperature_c double precision, p_wind_speed_kph double precision,
  p_wind_gust_kph double precision, p_wind_direction_degrees double precision,
  p_humidity_percent double precision, p_condition_code integer
)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_session_id uuid; v_now timestamptz := pg_catalog.clock_timestamp();
begin
  v_session_id := private.require_weather_round(p_user_id, p_round_id);
  if p_observed_at is null or not pg_catalog.isfinite(p_observed_at)
    or p_observed_at > v_now + interval '15 minutes' or p_observed_at < v_now - interval '6 hours'
    or (p_temperature_c is not null and not (p_temperature_c between -100 and 70))
    or (p_wind_speed_kph is not null and not (p_wind_speed_kph between 0 and 500))
    or (p_wind_gust_kph is not null and not (p_wind_gust_kph between 0 and 600))
    or (p_wind_direction_degrees is not null and not (p_wind_direction_degrees between 0 and 360))
    or (p_humidity_percent is not null and not (p_humidity_percent between 0 and 100))
    or (p_condition_code is not null and not (p_condition_code between 0 and 99)) then
    raise exception 'Invalid provider weather reading.' using errcode = '22023';
  end if;
  -- The conditional UPDATE locks exactly this Session's lease until insertion commits.
  update private.session_weather_refresh_state st
    set claim_id = null, lease_expires_at = null, checked_at = v_now, next_attempt_at = v_now + interval '30 minutes'
    where st.session_id = v_session_id and st.round_id = p_round_id
      and st.claim_id = p_claim_id and st.lease_expires_at > v_now;
  if not found then
    raise exception 'Weather request is no longer current.' using errcode = '42501';
  end if;
  insert into public.session_weather_snapshots
    (session_id, round_id, provider, observed_at, retrieved_at, temperature_c, wind_speed_kph,
      wind_gust_kph, wind_direction_degrees, humidity_percent, condition_code)
  values (v_session_id, p_round_id, 'open-meteo', p_observed_at, v_now, p_temperature_c,
    p_wind_speed_kph, p_wind_gust_kph, p_wind_direction_degrees, p_humidity_percent, p_condition_code)
  on conflict on constraint session_weather_observation_unique do nothing;
  -- An unchanged observation stays attached to its original Round/timestamps. checked_at
  -- still records a successful provider check, preventing an immediate retry loop.
  return true;
end;
$$;

create function private.release_session_weather_refresh(p_user_id uuid, p_round_id uuid, p_claim_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  update private.session_weather_refresh_state st
    set claim_id = null, lease_expires_at = null, next_attempt_at = pg_catalog.clock_timestamp() + interval '60 seconds'
    where st.round_id = p_round_id and st.claim_id = p_claim_id
      and exists (select 1 from public.sessions s
        where s.id = st.session_id and s.user_id = p_user_id);
end;
$$;

-- Schema lookup only; this grants no access to any existing private table/function.
grant usage on schema private to service_role;

-- Invoker wrappers expose only narrowly guarded server operations to PostgREST.
create function public.read_session_weather_refresh(p_user_id uuid, p_session_id uuid)
returns table (next_refresh_at timestamptz) language sql stable security invoker set search_path = '' as $$
  select * from private.read_session_weather_refresh(p_user_id, p_session_id);
$$;
create function public.claim_session_weather_refresh(p_user_id uuid, p_round_id uuid)
returns table (claimed boolean, claim_id uuid, session_id uuid, next_refresh_at timestamptz)
language sql volatile security invoker set search_path = '' as $$
  select * from private.claim_session_weather_refresh(p_user_id, p_round_id);
$$;
create function public.save_session_weather_snapshot(
  p_user_id uuid, p_round_id uuid, p_claim_id uuid, p_observed_at timestamptz,
  p_temperature_c double precision, p_wind_speed_kph double precision,
  p_wind_gust_kph double precision, p_wind_direction_degrees double precision,
  p_humidity_percent double precision, p_condition_code integer
)
returns boolean language sql volatile security invoker set search_path = '' as $$
  select private.save_session_weather_snapshot(p_user_id, p_round_id, p_claim_id, p_observed_at,
    p_temperature_c, p_wind_speed_kph, p_wind_gust_kph, p_wind_direction_degrees, p_humidity_percent, p_condition_code);
$$;
create function public.release_session_weather_refresh(p_user_id uuid, p_round_id uuid, p_claim_id uuid)
returns void language sql volatile security invoker set search_path = '' as $$
  select private.release_session_weather_refresh(p_user_id, p_round_id, p_claim_id);
$$;

-- No browser/Expo identity may call these or forge provider data, even for its own Session.
revoke all on function private.read_session_weather_refresh(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.read_session_weather_refresh(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.read_session_weather_refresh(uuid, uuid) to service_role;
grant execute on function public.read_session_weather_refresh(uuid, uuid) to service_role;
revoke all on function private.claim_session_weather_refresh(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.claim_session_weather_refresh(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.claim_session_weather_refresh(uuid, uuid) to service_role;
grant execute on function public.claim_session_weather_refresh(uuid, uuid) to service_role;
revoke all on function private.save_session_weather_snapshot(uuid, uuid, uuid, timestamptz, double precision, double precision, double precision, double precision, double precision, integer) from public, anon, authenticated, service_role;
revoke all on function public.save_session_weather_snapshot(uuid, uuid, uuid, timestamptz, double precision, double precision, double precision, double precision, double precision, integer) from public, anon, authenticated, service_role;
grant execute on function private.save_session_weather_snapshot(uuid, uuid, uuid, timestamptz, double precision, double precision, double precision, double precision, double precision, integer) to service_role;
grant execute on function public.save_session_weather_snapshot(uuid, uuid, uuid, timestamptz, double precision, double precision, double precision, double precision, double precision, integer) to service_role;
revoke all on function private.release_session_weather_refresh(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.release_session_weather_refresh(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.release_session_weather_refresh(uuid, uuid, uuid) to service_role;
grant execute on function public.release_session_weather_refresh(uuid, uuid, uuid) to service_role;

commit;
