-- Forward-only Session Feedback simplification. Applied predecessor stays unchanged.
-- Only the separately approved obsolete entry and its linked request may be removed.
begin;
lock table public.coach_feedback, private.coach_feedback_creation_requests in access exclusive mode;
do $cleanup$
declare obsolete_count bigint; request_count bigint;
begin
  select count(*) into obsolete_count from public.coach_feedback where kind = 'general';
  select count(*) into request_count from private.coach_feedback_creation_requests r
    join public.coach_feedback f on f.id=r.feedback_id where f.kind='general';
  if obsolete_count > 1 or request_count > 1 then
    raise exception 'Unexpected obsolete feedback data; explicit review required.';
  end if;
  if exists(select 1 from public.coach_feedback where kind not in ('session','general')) then
    raise exception 'Unexpected feedback kind; review required.';
  end if;
  if (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and p.proname='save_coach_feedback') <> 2
    or (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and p.proname='read_coach_feedback') <> 2
    or (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and p.proname='delete_coach_feedback') <> 2 then
    raise exception 'Unexpected feedback RPC overload; review required.';
  end if;
end $cleanup$;
-- Narrowly scoped cleanup: no notes, Session Feedback, tombstones or budgets deleted.
delete from private.coach_feedback_creation_requests r using public.coach_feedback f
  where r.feedback_id=f.id and f.kind='general';
delete from public.coach_feedback where kind='general';
alter table public.coach_feedback drop constraint coach_feedback_kind_check;
alter table public.coach_feedback drop constraint coach_feedback_kind_session_valid;
alter table public.coach_feedback add constraint coach_feedback_kind_check check (kind='session');
-- session_id deliberately remains nullable for ON DELETE SET NULL history.

create or replace function private.guard_coach_feedback_context()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.organization_id is null or new.author_user_id is null
      or new.kind is distinct from 'session' or new.session_id is null then
      raise exception 'Feedback requires its original context.' using errcode = '22023';
    end if;
  else
    if new.id <> old.id or new.athlete_user_id <> old.athlete_user_id
      or new.kind <> old.kind or new.created_at <> old.created_at
      or (new.organization_id is distinct from old.organization_id and not
        (new.organization_id is null and not exists(select 1 from public.organizations o where o.id = old.organization_id)))
      or (new.author_user_id is distinct from old.author_user_id and not
        (new.author_user_id is null and not exists(select 1 from auth.users u where u.id = old.author_user_id)))
      or (new.session_id is distinct from old.session_id and not
        (new.session_id is null and not exists(select 1 from public.sessions s where s.id = old.session_id))) then
      raise exception 'Feedback context cannot be changed.' using errcode = '22023';
    end if;
  end if;
  if new.session_id is not null and not exists (
    select 1 from public.sessions s where s.id = new.session_id and s.user_id = new.athlete_user_id
  ) then raise exception 'Session must belong to the feedback recipient.' using errcode = '22023'; end if;
  return new;
end;
$$;

create or replace function private.save_coach_feedback(
  p_feedback_id uuid, p_organization_id uuid, p_athlete_user_id uuid,
  p_kind text, p_session_id uuid, p_body text, p_expected_updated_at timestamptz default null,
  p_creation_request_id uuid default null
)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_existing public.coach_feedback; v_request private.coach_feedback_creation_requests;
  v_id uuid; v_body text; v_digest bytea; v_now timestamptz;
begin
  if p_feedback_id is not null then
    select f.* into v_existing from public.coach_feedback f where f.id = p_feedback_id for update;
    if not found or v_existing.author_user_id is distinct from (select auth.uid()) then
      raise exception 'Feedback is not available.' using errcode = '42501';
    end if;
    perform private.require_feedback_relationship(v_existing.organization_id, v_existing.athlete_user_id);
    if p_organization_id is distinct from v_existing.organization_id
      or p_athlete_user_id is distinct from v_existing.athlete_user_id
      or p_kind is distinct from v_existing.kind or p_session_id is distinct from v_existing.session_id then
      raise exception 'Feedback context cannot be changed.' using errcode = '22023';
    end if;
    if p_expected_updated_at is null or p_expected_updated_at <> v_existing.updated_at then
      raise exception 'Feedback changed. Reload before saving.' using errcode = '40001';
    end if;
    if p_creation_request_id is not null and not exists(select 1 from private.coach_feedback_creation_requests r
      where r.feedback_id = v_existing.id and r.request_id = p_creation_request_id) then
      raise exception 'Feedback creation identity cannot be changed.' using errcode = '22023';
    end if;
  else
    -- Authorization precedes both the key lookup and any replay response.
    perform private.require_feedback_relationship(p_organization_id, p_athlete_user_id);
    if p_expected_updated_at is not null then raise exception 'New feedback cannot have an edit version.' using errcode = '40001'; end if;
    if p_creation_request_id is null then
      raise exception 'A creation request identifier is required for new feedback.' using errcode = '22023';
    end if;
  end if;
  v_body := private.trim_coaching_text(p_body);
  if v_body is null or pg_catalog.char_length(v_body) not between 1 and 4000
    or p_kind is distinct from 'session' then
    raise exception 'Use valid feedback context and a body of 1-4000 characters.' using errcode = '22023';
  end if;
  v_now := greatest(pg_catalog.clock_timestamp(), v_existing.updated_at + interval '1 microsecond');
  if p_feedback_id is null then
    v_digest := private.coach_feedback_creation_digest(p_organization_id, p_athlete_user_id,
      (select auth.uid()), p_kind, p_session_id, v_body);
    -- Transaction-scoped UUID-keyed serialization handles absent-row races. A hash
    -- collision only serializes unrelated requests; the UUID PRIMARY KEY is
    -- authoritative. No unique-violation detail can expose another feedback record.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_creation_request_id::text, 0));
    select r.* into v_request from private.coach_feedback_creation_requests r
      where r.request_id = p_creation_request_id for update;
    if found then
      if v_request.author_user_id is distinct from (select auth.uid())
        or v_request.athlete_user_id is distinct from p_athlete_user_id
        or v_request.payload_sha256 is distinct from v_digest or v_request.feedback_id is null then
        raise exception 'This feedback request conflicts with an earlier submission. Refresh feedback and start a new entry.' using errcode = '22023';
      end if;
      return v_request.feedback_id;
    end if;
      perform 1 from public.sessions s where s.id = p_session_id and s.user_id = p_athlete_user_id for share;
      if not found then raise exception 'Session must belong to the feedback recipient.' using errcode = '22023'; end if;
    if not private.consume_coach_feedback_creation_budget() then
      raise exception 'Too many feedback entries. Try again shortly.' using errcode = 'P0001';
    end if;
    insert into public.coach_feedback(organization_id, athlete_user_id, author_user_id, kind, session_id, body, created_at, updated_at)
      values(p_organization_id, p_athlete_user_id,
        (select auth.uid()), p_kind, p_session_id, v_body, v_now, v_now) returning id into v_id;
    insert into private.coach_feedback_creation_requests(request_id, author_user_id, athlete_user_id, payload_sha256, feedback_id)
      values(p_creation_request_id, (select auth.uid()), p_athlete_user_id, v_digest, v_id);
  else
    update public.coach_feedback f set body = v_body, updated_at = v_now where f.id = p_feedback_id returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function private.read_coach_feedback(
  p_athlete_user_id uuid default null, p_organization_id uuid default null,
  p_session_id uuid default null, p_kind text default null,
  p_before_created_at timestamptz default null, p_before_id uuid default null, p_limit integer default 25
)
returns table(id uuid, organization_id uuid, athlete_user_id uuid, author_user_id uuid,
  kind text, session_id uuid, body text, created_at timestamptz, updated_at timestamptz,
  author_display_name text, can_edit boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Sign in required.' using errcode = '42501'; end if;
  if p_limit is null or p_limit not between 1 and 100 or (p_kind is not null and p_kind <> 'session')
    or ((p_before_created_at is null) <> (p_before_id is null)) then
    raise exception 'Invalid feedback history filter.' using errcode = '22023';
  end if;
  return query
    select f.id, f.organization_id, f.athlete_user_id, f.author_user_id, f.kind, f.session_id,
      f.body, f.created_at, f.updated_at,
      case when f.author_user_id is null then 'Former coach' else coalesce(p.display_name, 'Coach') end,
      coalesce(f.author_user_id = (select auth.uid()) and private.can_author_coach_feedback(f.organization_id, f.athlete_user_id), false)
    from public.coach_feedback f left join public.profiles p on p.id = f.author_user_id
    where (f.athlete_user_id = (select auth.uid()) or (f.author_user_id = (select auth.uid())
        and private.can_author_coach_feedback(f.organization_id, f.athlete_user_id)))
      and (p_athlete_user_id is null or f.athlete_user_id = p_athlete_user_id)
      and (p_organization_id is null or f.organization_id = p_organization_id)
      and (p_session_id is null or f.session_id = p_session_id)
      and f.kind = 'session'
      and (p_before_created_at is null or (f.created_at, f.id) < (p_before_created_at, p_before_id))
    order by f.created_at desc, f.id desc limit p_limit;
end;
$$;

commit;
