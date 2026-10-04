-- Guarded scoring/session mutations. Prepare locally; apply only after database approval.
begin;

-- New guarded operations. Ownership always comes from auth.uid(), never an argument.
create function private.create_owned_session(p_title text, p_session_date date, p_session_type text)
returns table (id uuid, title text, session_date date, session_type text, arrow_count integer)
language plpgsql volatile security definer set search_path = ''
as $$
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
$$;

create function private.update_owned_session_arrow_count(p_session_id uuid, p_arrow_count integer)
returns table (arrow_count integer)
language plpgsql volatile security definer set search_path = ''
as $$
declare v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  if p_arrow_count is null or p_arrow_count < 0 then
    raise exception 'Arrow count must be a non-negative whole number.' using errcode = '22023';
  end if;
  return query
    update public.sessions as s set arrow_count = p_arrow_count
    where s.id = p_session_id and s.user_id = v_user_id returning s.arrow_count;
  if not found then
    raise exception 'The Session is not owned by the signed-in user.' using errcode = '42501';
  end if;
end;
$$;

create function private.delete_owned_session(p_session_id uuid)
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
declare v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  delete from public.sessions s where s.id = p_session_id and s.user_id = v_user_id;
  if not found then
    raise exception 'The Session is not owned by the signed-in user.' using errcode = '42501';
  end if;
  return true;
end;
$$;

create function private.delete_owned_round(p_round_id uuid, p_session_id uuid default null)
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
declare v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  delete from public.session_rounds r using public.sessions s
  where r.id = p_round_id and s.id = r.session_id and s.user_id = v_user_id
    and (p_session_id is null or s.id = p_session_id);
  if not found then
    raise exception 'The Round is not owned by the signed-in user in the supplied Session.' using errcode = '42501';
  end if;
  return true;
end;
$$;

create function private.save_owned_arrow(
  p_session_end_id uuid, p_arrow_number integer, p_score_points integer, p_is_x boolean,
  p_plot_x double precision, p_plot_y double precision, p_face_index integer,
  p_arrow_id uuid default null
)
returns table (
  id uuid, arrow_number smallint, score_points smallint, is_x boolean,
  plot_x double precision, plot_y double precision, face_index smallint
)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_end_number smallint;
  v_planned_ends smallint;
  v_arrows_per_end smallint;
  v_face_type text;
begin
  if v_user_id is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  select e.end_number, r.planned_ends, r.arrows_per_end, r.face_type
    into v_end_number, v_planned_ends, v_arrows_per_end, v_face_type
  from public.session_ends e
  join public.session_rounds r on r.id = e.session_round_id
  join public.sessions s on s.id = r.session_id
  where e.id = p_session_end_id and s.user_id = v_user_id;
  if not found then
    raise exception 'The End is not owned by the signed-in user.' using errcode = '42501';
  end if;
  if v_end_number not between 1 and v_planned_ends
    or p_arrow_number is null or p_arrow_number not between 1 and v_arrows_per_end then
    raise exception 'The Arrow slot is invalid for the planned End.' using errcode = '22023';
  end if;
  if p_score_points is null or p_score_points not between 0 and 10
    or p_is_x is null or (p_is_x and p_score_points <> 10) then
    raise exception 'The Arrow score is invalid.' using errcode = '22023';
  end if;
  -- A finite value in [-2,2] excludes NaN and either infinity in PostgreSQL.
  if (p_plot_x is null) <> (p_plot_y is null)
    or (p_plot_x is not null and not (
      p_plot_x between -2::double precision and 2::double precision
      and p_plot_y between -2::double precision and 2::double precision
    )) then
    raise exception 'The plotted position is invalid.' using errcode = '22023';
  end if;
  if (p_plot_x is null and p_face_index is not null)
    or (v_face_type = 'triple_face' and p_plot_x is not null
      and (p_face_index is null or p_face_index not between 0 and 2))
    or (v_face_type <> 'triple_face' and p_face_index is not null) then
    raise exception 'The target-face position is invalid.' using errcode = '22023';
  end if;

  -- Expo supplies the expected persisted ID when editing. It must still identify
  -- this exact slot; a missing/stale ID must not silently create a replacement.
  if p_arrow_id is not null then
    return query
      update public.arrows as a set
        score_points = p_score_points, is_x = p_is_x,
        plot_x = p_plot_x, plot_y = p_plot_y, face_index = p_face_index
      where a.id = p_arrow_id and a.session_end_id = p_session_end_id
        and a.arrow_number = p_arrow_number
      returning a.id, a.arrow_number, a.score_points, a.is_x, a.plot_x, a.plot_y, a.face_index;
    if not found then
      raise exception 'The saved Arrow does not match this slot.' using errcode = '22023';
    end if;
  else
    -- Preserve the existing unique (session_end_id, arrow_number) slot identity.
    return query
      insert into public.arrows as a (
        session_end_id, arrow_number, score_points, is_x, plot_x, plot_y, face_index
      ) values (
        p_session_end_id, p_arrow_number, p_score_points, p_is_x, p_plot_x, p_plot_y, p_face_index
      )
      on conflict on constraint arrows_number_unique do update set
        score_points = excluded.score_points, is_x = excluded.is_x,
        plot_x = excluded.plot_x, plot_y = excluded.plot_y, face_index = excluded.face_index
      returning a.id, a.arrow_number, a.score_points, a.is_x, a.plot_x, a.plot_y, a.face_index;
  end if;
end;
$$;

create function private.delete_owned_arrow(
  p_session_end_id uuid, p_arrow_number integer default null, p_arrow_id uuid default null
)
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
declare v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  perform 1 from public.session_ends e
  join public.session_rounds r on r.id = e.session_round_id
  join public.sessions s on s.id = r.session_id
  where e.id = p_session_end_id and s.user_id = v_user_id;
  if not found then
    raise exception 'The End is not owned by the signed-in user.' using errcode = '42501';
  end if;
  if (p_arrow_number is null and p_arrow_id is null)
    or (p_arrow_number is not null and p_arrow_number not between 1 and 32767) then
    raise exception 'The Arrow identity is invalid.' using errcode = '22023';
  end if;
  delete from public.arrows a where a.session_end_id = p_session_end_id
    and (p_arrow_number is null or a.arrow_number = p_arrow_number)
    and (p_arrow_id is null or a.id = p_arrow_id);
  return found;
end;
$$;

-- Public API wrappers run as the caller; private functions perform guarded writes.
create function public.create_owned_session(p_title text, p_session_date date, p_session_type text)
returns table (id uuid, title text, session_date date, session_type text, arrow_count integer)
language sql volatile security invoker set search_path = ''
as $$ select * from private.create_owned_session(p_title, p_session_date, p_session_type); $$;

create function public.update_owned_session_arrow_count(p_session_id uuid, p_arrow_count integer)
returns table (arrow_count integer)
language sql volatile security invoker set search_path = ''
as $$ select * from private.update_owned_session_arrow_count(p_session_id, p_arrow_count); $$;

create function public.delete_owned_session(p_session_id uuid)
returns boolean language sql volatile security invoker set search_path = ''
as $$ select private.delete_owned_session(p_session_id); $$;

create function public.delete_owned_round(p_round_id uuid, p_session_id uuid default null)
returns boolean language sql volatile security invoker set search_path = ''
as $$ select private.delete_owned_round(p_round_id, p_session_id); $$;

create function public.save_owned_arrow(
  p_session_end_id uuid, p_arrow_number integer, p_score_points integer, p_is_x boolean,
  p_plot_x double precision, p_plot_y double precision, p_face_index integer,
  p_arrow_id uuid default null
)
returns table (
  id uuid, arrow_number smallint, score_points smallint, is_x boolean,
  plot_x double precision, plot_y double precision, face_index smallint
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.save_owned_arrow(
    p_session_end_id, p_arrow_number, p_score_points, p_is_x,
    p_plot_x, p_plot_y, p_face_index, p_arrow_id
  );
$$;

create function public.delete_owned_arrow(
  p_session_end_id uuid, p_arrow_number integer default null, p_arrow_id uuid default null
)
returns boolean language sql volatile security invoker set search_path = ''
as $$ select private.delete_owned_arrow(p_session_end_id, p_arrow_number, p_arrow_id); $$;

-- EXECUTE grants: explicitly remove PUBLIC/anonymous defaults before granting authenticated.
revoke all on function private.create_owned_session(text, date, text) from public, anon, authenticated;
revoke all on function public.create_owned_session(text, date, text) from public, anon, authenticated;
grant execute on function private.create_owned_session(text, date, text) to authenticated;
grant execute on function public.create_owned_session(text, date, text) to authenticated;

revoke all on function private.update_owned_session_arrow_count(uuid, integer) from public, anon, authenticated;
revoke all on function public.update_owned_session_arrow_count(uuid, integer) from public, anon, authenticated;
grant execute on function private.update_owned_session_arrow_count(uuid, integer) to authenticated;
grant execute on function public.update_owned_session_arrow_count(uuid, integer) to authenticated;

revoke all on function private.delete_owned_session(uuid) from public, anon, authenticated;
revoke all on function public.delete_owned_session(uuid) from public, anon, authenticated;
grant execute on function private.delete_owned_session(uuid) to authenticated;
grant execute on function public.delete_owned_session(uuid) to authenticated;

revoke all on function private.delete_owned_round(uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_owned_round(uuid, uuid) from public, anon, authenticated;
grant execute on function private.delete_owned_round(uuid, uuid) to authenticated;
grant execute on function public.delete_owned_round(uuid, uuid) to authenticated;

revoke all on function private.save_owned_arrow(uuid, integer, integer, boolean, double precision, double precision, integer, uuid) from public, anon, authenticated;
revoke all on function public.save_owned_arrow(uuid, integer, integer, boolean, double precision, double precision, integer, uuid) from public, anon, authenticated;
grant execute on function private.save_owned_arrow(uuid, integer, integer, boolean, double precision, double precision, integer, uuid) to authenticated;
grant execute on function public.save_owned_arrow(uuid, integer, integer, boolean, double precision, double precision, integer, uuid) to authenticated;

revoke all on function private.delete_owned_arrow(uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.delete_owned_arrow(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function private.delete_owned_arrow(uuid, integer, uuid) to authenticated;
grant execute on function public.delete_owned_arrow(uuid, integer, uuid) to authenticated;

-- Revoke direct mutations only after their replacements exist. SELECT and all
-- RLS policies stay unchanged. Revoke column grants independently of table grants.
revoke insert, update, delete on table public.sessions, public.session_rounds,
  public.session_ends, public.arrows from public, anon, authenticated;
revoke insert (id, user_id, title, session_date, created_at, arrow_count, session_type),
  update (id, user_id, title, session_date, created_at, arrow_count, session_type)
  on table public.sessions from public, anon, authenticated;
revoke insert (id, session_id, round_number, name, division, distance_metres,
  face_diameter_cm, face_type, planned_ends, arrows_per_end, created_at),
  update (id, session_id, round_number, name, division, distance_metres,
  face_diameter_cm, face_type, planned_ends, arrows_per_end, created_at)
  on table public.session_rounds from public, anon, authenticated;
revoke insert (id, session_round_id, end_number, created_at),
  update (id, session_round_id, end_number, created_at)
  on table public.session_ends from public, anon, authenticated;
revoke insert (id, session_end_id, arrow_number, score_points, is_x, plot_x, plot_y, face_index, created_at),
  update (id, session_end_id, arrow_number, score_points, is_x, plot_x, plot_y, face_index, created_at)
  on table public.arrows from public, anon, authenticated;

commit;
