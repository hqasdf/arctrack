-- LOCAL PREPARATION ONLY. Requires separate approval before any remote application.
-- No existing scoring/auth/profile policy or function is changed.
begin;

-- Same edge whitespace as ECMAScript String.trim used by website/Expo validators.
-- PostgreSQL char_length counts Unicode codepoints, matching shared validation limits.
create function private.trim_coaching_text(p_text text)
returns text language sql immutable security invoker set search_path = '' as $$
  select pg_catalog.btrim(p_text, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;

create function private.valid_session_technique_tags(p_tags text[])
returns boolean language sql immutable security invoker set search_path = '' as $$
  select p_tags is not null
    and pg_catalog.cardinality(p_tags) <= 8
    and (pg_catalog.cardinality(p_tags) = 0 or pg_catalog.array_ndims(p_tags) = 1)
    and not exists (select 1 from pg_catalog.unnest(p_tags) t(tag)
      where tag is null or pg_catalog.char_length(tag) not between 1 and 40
        or tag <> private.trim_coaching_text(tag))
    and (select pg_catalog.count(*) = pg_catalog.count(distinct tag)
      from pg_catalog.unnest(p_tags) t(tag));
$$;

create table public.session_notes (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  body text not null check (pg_catalog.char_length(body) between 1 and 4000
    and body = private.trim_coaching_text(body)),
  technique_tags text[] not null default '{}'::text[]
    check (private.valid_session_technique_tags(technique_tags)),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint session_notes_timestamps_valid check (updated_at >= created_at)
);

create table public.coach_feedback (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  athlete_user_id uuid not null references auth.users(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('general', 'session')),
  session_id uuid references public.sessions(id) on delete set null,
  body text not null check (pg_catalog.char_length(body) between 1 and 4000
    and body = private.trim_coaching_text(body)),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  -- A null Session on session-kind feedback records a deleted Session, never general feedback.
  constraint coach_feedback_kind_session_valid check (kind = 'session' or session_id is null),
  constraint coach_feedback_timestamps_valid check (updated_at >= created_at)
);
create index coach_feedback_athlete_history_idx
  on public.coach_feedback (athlete_user_id, created_at desc, id desc);
create index coach_feedback_author_organization_idx
  on public.coach_feedback (author_user_id, organization_id, created_at desc, id desc);
create index coach_feedback_organization_idx on public.coach_feedback (organization_id);
create index coach_feedback_session_idx on public.coach_feedback (session_id);

alter table public.session_notes enable row level security;
alter table public.coach_feedback enable row level security;
revoke all on table public.session_notes, public.coach_feedback from public, anon, authenticated, service_role;
grant select on table public.session_notes, public.coach_feedback to authenticated;

-- Deliberately exact-organization, unlike the existing cross-organization Session read helper.
create function private.can_author_coach_feedback(p_organization_id uuid, p_athlete_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.organization_members c
    join public.organization_members a on a.organization_id = c.organization_id
    where c.organization_id = p_organization_id and c.user_id = (select auth.uid())
      and c.role = 'head_coach' and c.status = 'active'
      and a.user_id = p_athlete_user_id and a.role = 'archer' and a.status = 'active'
  );
$$;

create policy session_notes_select_owner_or_current_coach on public.session_notes
for select to authenticated using (exists (
  select 1 from public.sessions s where s.id = session_notes.session_id
    and (s.user_id = (select auth.uid()) or private.can_current_head_coach_read_archer(s.user_id))
));
create policy coach_feedback_select_recipient_or_original_author on public.coach_feedback
for select to authenticated using (
  athlete_user_id = (select auth.uid())
  or (author_user_id = (select auth.uid())
    and private.can_author_coach_feedback(organization_id, athlete_user_id))
);

-- Protect context even against future accidental broad write grants. Referential SET NULL
-- is allowed only after the referenced record has actually disappeared.
create function private.guard_coach_feedback_context()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.organization_id is null or new.author_user_id is null
      or (new.kind = 'session' and new.session_id is null) then
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
create trigger coach_feedback_guard_context before insert or update on public.coach_feedback
for each row execute function private.guard_coach_feedback_context();

-- Operational retry metadata contains no feedback text. A deleted entry leaves its
-- request tombstone so a delayed retry cannot recreate it. Athlete-account deletion
-- removes this metadata; coach deletion clears attribution without losing history.
create table private.coach_feedback_creation_requests (
  request_id uuid primary key,
  author_user_id uuid references auth.users(id) on delete set null,
  athlete_user_id uuid not null references auth.users(id) on delete cascade,
  payload_sha256 bytea not null check (pg_catalog.octet_length(payload_sha256) = 32),
  feedback_id uuid unique references public.coach_feedback(id) on delete set null,
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);
create index coach_feedback_creation_requests_author_idx
  on private.coach_feedback_creation_requests(author_user_id);
create index coach_feedback_creation_requests_athlete_idx
  on private.coach_feedback_creation_requests(athlete_user_id);
alter table private.coach_feedback_creation_requests enable row level security;
revoke all on table private.coach_feedback_creation_requests from public, anon, authenticated, service_role;

create function private.coach_feedback_creation_digest(p_organization_id uuid, p_athlete_user_id uuid,
  p_author_user_id uuid, p_kind text, p_session_id uuid, p_body text)
returns bytea language sql immutable security invoker set search_path = '' as $$
  select extensions.digest(pg_catalog.jsonb_build_object(
    'version', 1, 'organization_id', p_organization_id, 'athlete_user_id', p_athlete_user_id,
    'author_user_id', p_author_user_id, 'kind', p_kind, 'session_id', p_session_id,
    'body', private.trim_coaching_text(p_body))::text, 'sha256');
$$;

create function private.guard_coach_feedback_creation_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if not exists(select 1 from public.coach_feedback f where f.id = new.feedback_id
      and f.author_user_id = new.author_user_id and f.athlete_user_id = new.athlete_user_id
      and new.payload_sha256 = private.coach_feedback_creation_digest(f.organization_id,
        f.athlete_user_id, f.author_user_id, f.kind, f.session_id, f.body)) then
      raise exception 'Invalid feedback creation identity.' using errcode = '22023';
    end if;
  elsif new.request_id is distinct from old.request_id
    or new.athlete_user_id is distinct from old.athlete_user_id
    or new.payload_sha256 is distinct from old.payload_sha256
    or new.created_at is distinct from old.created_at
    or (new.author_user_id is distinct from old.author_user_id and not
      (new.author_user_id is null and not exists(select 1 from auth.users u where u.id = old.author_user_id)))
    or (new.feedback_id is distinct from old.feedback_id and not
      (new.feedback_id is null and not exists(select 1 from public.coach_feedback f where f.id = old.feedback_id))) then
    raise exception 'Feedback creation identity cannot be changed.' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger coach_feedback_creation_request_guard before insert or update on private.coach_feedback_creation_requests
for each row execute function private.guard_coach_feedback_creation_request();

create function private.save_session_notes(
  p_session_id uuid, p_body text, p_technique_tags text[], p_expected_updated_at timestamptz default null
)
returns setof public.session_notes language plpgsql volatile security definer set search_path = '' as $$
declare v_existing public.session_notes; v_body text; v_tags text[]; v_now timestamptz;
begin
  if (select auth.uid()) is null then raise exception 'Sign in required.' using errcode = '42501'; end if;
  -- Lock the parent, including the no-note-yet case, so concurrent CREATEs cannot overwrite.
  perform 1 from public.sessions s where s.id = p_session_id and s.user_id = (select auth.uid()) for update;
  if not found then raise exception 'Session notes are not available.' using errcode = '42501'; end if;
  v_body := private.trim_coaching_text(p_body);
  select coalesce(pg_catalog.array_agg(t.tag order by t.first_position), '{}'::text[]) into v_tags
  from (select private.trim_coaching_text(u.tag) tag,
      pg_catalog.min(u.position) first_position
    from pg_catalog.unnest(p_technique_tags) with ordinality u(tag, position)
    group by private.trim_coaching_text(u.tag)) t;
  if v_body is null or pg_catalog.char_length(v_body) not between 1 and 4000
    or p_technique_tags is null or pg_catalog.cardinality(p_technique_tags) > 8
    or (pg_catalog.cardinality(p_technique_tags) > 0 and pg_catalog.array_ndims(p_technique_tags) <> 1)
    or not private.valid_session_technique_tags(v_tags) then
    raise exception 'Use a note of 1-4000 characters and up to eight tags of 1-40 characters.' using errcode = '22023';
  end if;
  select n.* into v_existing from public.session_notes n where n.session_id = p_session_id;
  if (found and (p_expected_updated_at is null or v_existing.updated_at <> p_expected_updated_at))
    or (not found and p_expected_updated_at is not null) then
    raise exception 'Session notes changed. Reload before saving.' using errcode = '40001';
  end if;
  v_now := greatest(pg_catalog.clock_timestamp(), v_existing.updated_at + interval '1 microsecond');
  if v_existing.session_id is null then
    return query insert into public.session_notes(session_id, body, technique_tags, created_at, updated_at)
      values(p_session_id, v_body, v_tags, v_now, v_now) returning *;
  else
    return query update public.session_notes n set body = v_body, technique_tags = v_tags, updated_at = v_now
      where n.session_id = p_session_id returning n.*;
  end if;
end;
$$;

create function private.delete_session_notes(p_session_id uuid, p_expected_updated_at timestamptz)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Sign in required.' using errcode = '42501'; end if;
  perform 1 from public.sessions s where s.id = p_session_id and s.user_id = (select auth.uid()) for update;
  if not found then raise exception 'Session notes are not available.' using errcode = '42501'; end if;
  delete from public.session_notes n where n.session_id = p_session_id and n.updated_at = p_expected_updated_at;
  if not found then raise exception 'Session notes changed. Reload before deleting.' using errcode = '40001'; end if;
  return true;
end;
$$;

-- Lock both memberships during mutations; concurrent revocation waits until this statement
-- finishes, and a revocation that already committed prevents the write.
create function private.require_feedback_relationship(p_organization_id uuid, p_athlete_user_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Sign in required.' using errcode = '42501'; end if;
  perform 1 from public.organization_members c
    join public.organization_members a on a.organization_id = c.organization_id
    where c.organization_id = p_organization_id and c.user_id = (select auth.uid())
      and c.role = 'head_coach' and c.status = 'active'
      and a.user_id = p_athlete_user_id and a.role = 'archer' and a.status = 'active'
    for share of c, a;
  if not found then raise exception 'Current coaching authorization is required.' using errcode = '42501'; end if;
end;
$$;

-- Separate from the existing multi-operation budget: no existing operation, quota,
-- constraint or helper changes. Human-written feedback allows 10 creates/minute and
-- 100/hour per authenticated author across all their organizations/athletes. These
-- fixed UTC windows permit boundary bursts, matching existing Arc Track conventions.
-- Replays and edits bypass this helper; all newly inserted feedback is charged once.
create table private.coach_feedback_creation_budgets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  minute_start timestamptz not null,
  minute_count integer not null check (minute_count between 1 and 10),
  hour_start timestamptz not null,
  hour_count integer not null check (hour_count between 1 and 100)
);
alter table private.coach_feedback_creation_budgets enable row level security;
revoke all on table private.coach_feedback_creation_budgets from public, anon, authenticated, service_role;

-- Invoker helper has no API grants: only the guarded definer can mutate its state.
-- The atomic UPSERT serializes different creation keys for the same auth.uid().
create function private.consume_coach_feedback_creation_budget()
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_user_id uuid := (select auth.uid());
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_minute timestamptz;
  v_hour timestamptz;
begin
  if v_user_id is null then raise exception 'Sign in required.' using errcode = '42501'; end if;
  v_minute := pg_catalog.date_trunc('minute', v_now, 'UTC');
  v_hour := pg_catalog.date_trunc('hour', v_now, 'UTC');
  insert into private.coach_feedback_creation_budgets as b
    (user_id, minute_start, minute_count, hour_start, hour_count)
    values(v_user_id, v_minute, 1, v_hour, 1)
  on conflict (user_id) do update set
    -- A waiting transaction must never move an already newer window backwards.
    minute_start = greatest(b.minute_start, excluded.minute_start),
    minute_count = case when b.minute_start >= excluded.minute_start then b.minute_count + 1 else 1 end,
    hour_start = greatest(b.hour_start, excluded.hour_start),
    hour_count = case when b.hour_start >= excluded.hour_start then b.hour_count + 1 else 1 end
  where (b.minute_start < excluded.minute_start or b.minute_count < 10)
    and (b.hour_start < excluded.hour_start or b.hour_count < 100);
  return found;
end;
$$;

create function private.save_coach_feedback(
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
    or p_kind is null or p_kind not in ('general', 'session') or (p_kind = 'general' and p_session_id is not null) then
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
    if p_kind = 'session' then
      perform 1 from public.sessions s where s.id = p_session_id and s.user_id = p_athlete_user_id for share;
      if not found then raise exception 'Session must belong to the feedback recipient.' using errcode = '22023'; end if;
    end if;
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

create function private.delete_coach_feedback(p_feedback_id uuid, p_expected_updated_at timestamptz)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_existing public.coach_feedback;
begin
  select f.* into v_existing from public.coach_feedback f where f.id = p_feedback_id for update;
  if not found or (select auth.uid()) is null or v_existing.author_user_id is distinct from (select auth.uid()) then
    raise exception 'Feedback is not available.' using errcode = '42501';
  end if;
  perform private.require_feedback_relationship(v_existing.organization_id, v_existing.athlete_user_id);
  if p_expected_updated_at is null or p_expected_updated_at <> v_existing.updated_at then
    raise exception 'Feedback changed. Reload before deleting.' using errcode = '40001';
  end if;
  delete from public.coach_feedback f where f.id = p_feedback_id;
  return true;
end;
$$;

-- Only this scoped reader may resolve another profile's display name. No profile grant
-- or policy is broadened. Names are looked up only for feedback this caller can read.
create function private.read_coach_feedback(
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
  if p_limit is null or p_limit not between 1 and 100 or (p_kind is not null and p_kind not in ('general', 'session'))
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
      and (p_kind is null or f.kind = p_kind)
      and (p_before_created_at is null or (f.created_at, f.id) < (p_before_created_at, p_before_id))
    order by f.created_at desc, f.id desc limit p_limit;
end;
$$;

create function public.save_session_notes(p_session_id uuid, p_body text, p_technique_tags text[], p_expected_updated_at timestamptz default null)
returns setof public.session_notes language sql volatile security invoker set search_path = '' as $$
  select * from private.save_session_notes(p_session_id, p_body, p_technique_tags, p_expected_updated_at);
$$;
create function public.delete_session_notes(p_session_id uuid, p_expected_updated_at timestamptz)
returns boolean language sql volatile security invoker set search_path = '' as $$
  select private.delete_session_notes(p_session_id, p_expected_updated_at);
$$;
create function public.save_coach_feedback(p_feedback_id uuid, p_organization_id uuid, p_athlete_user_id uuid,
  p_kind text, p_session_id uuid, p_body text, p_expected_updated_at timestamptz default null,
  p_creation_request_id uuid default null)
returns uuid language sql volatile security invoker set search_path = '' as $$
  select private.save_coach_feedback(p_feedback_id, p_organization_id, p_athlete_user_id,
    p_kind, p_session_id, p_body, p_expected_updated_at, p_creation_request_id);
$$;
create function public.delete_coach_feedback(p_feedback_id uuid, p_expected_updated_at timestamptz)
returns boolean language sql volatile security invoker set search_path = '' as $$
  select private.delete_coach_feedback(p_feedback_id, p_expected_updated_at);
$$;
create function public.read_coach_feedback(p_athlete_user_id uuid default null, p_organization_id uuid default null,
  p_session_id uuid default null, p_kind text default null, p_before_created_at timestamptz default null,
  p_before_id uuid default null, p_limit integer default 25)
returns table(id uuid, organization_id uuid, athlete_user_id uuid, author_user_id uuid,
  kind text, session_id uuid, body text, created_at timestamptz, updated_at timestamptz,
  author_display_name text, can_edit boolean)
language sql stable security invoker set search_path = '' as $$
  select * from private.read_coach_feedback(p_athlete_user_id, p_organization_id, p_session_id,
    p_kind, p_before_created_at, p_before_id, p_limit);
$$;

-- Explicit grants, including private implementations used by invoker wrappers.
revoke all on function private.trim_coaching_text(text) from public, anon, authenticated, service_role;
revoke all on function private.valid_session_technique_tags(text[]) from public, anon, authenticated, service_role;
revoke all on function private.guard_coach_feedback_context() from public, anon, authenticated, service_role;
revoke all on function private.coach_feedback_creation_digest(uuid, uuid, uuid, text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.guard_coach_feedback_creation_request() from public, anon, authenticated, service_role;
revoke all on function private.require_feedback_relationship(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.consume_coach_feedback_creation_budget() from public, anon, authenticated, service_role;
revoke all on function private.can_author_coach_feedback(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.can_author_coach_feedback(uuid, uuid) to authenticated;

revoke all on function private.save_session_notes(uuid, text, text[], timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.save_session_notes(uuid, text, text[], timestamptz) from public, anon, authenticated, service_role;
grant execute on function private.save_session_notes(uuid, text, text[], timestamptz), public.save_session_notes(uuid, text, text[], timestamptz) to authenticated;
revoke all on function private.delete_session_notes(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.delete_session_notes(uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function private.delete_session_notes(uuid, timestamptz), public.delete_session_notes(uuid, timestamptz) to authenticated;
revoke all on function private.save_coach_feedback(uuid, uuid, uuid, text, uuid, text, timestamptz, uuid) from public, anon, authenticated, service_role;
revoke all on function public.save_coach_feedback(uuid, uuid, uuid, text, uuid, text, timestamptz, uuid) from public, anon, authenticated, service_role;
grant execute on function private.save_coach_feedback(uuid, uuid, uuid, text, uuid, text, timestamptz, uuid), public.save_coach_feedback(uuid, uuid, uuid, text, uuid, text, timestamptz, uuid) to authenticated;
revoke all on function private.delete_coach_feedback(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.delete_coach_feedback(uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function private.delete_coach_feedback(uuid, timestamptz), public.delete_coach_feedback(uuid, timestamptz) to authenticated;
revoke all on function private.read_coach_feedback(uuid, uuid, uuid, text, timestamptz, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.read_coach_feedback(uuid, uuid, uuid, text, timestamptz, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function private.read_coach_feedback(uuid, uuid, uuid, text, timestamptz, uuid, integer), public.read_coach_feedback(uuid, uuid, uuid, text, timestamptz, uuid, integer) to authenticated;

commit;
