-- PROPOSAL ONLY. Do not apply without separate approval and runtime fixture review.
-- These tables belong to Coach workflow; athlete scoring tables remain unchanged.
begin;

create function private.coach_can_access_session(p_organization_id uuid, p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.sessions s
    join public.organization_members athlete
      on athlete.user_id = s.user_id and athlete.organization_id = p_organization_id
      and athlete.role = 'archer' and athlete.status = 'active'
    join public.organization_members coach
      on coach.organization_id = p_organization_id
      and coach.user_id = (select auth.uid())
      and coach.role = 'head_coach' and coach.status = 'active'
    where s.id = p_session_id
  );
$$;
revoke all on function private.coach_can_access_session(uuid, uuid) from public, anon, authenticated;
grant execute on function private.coach_can_access_session(uuid, uuid) to authenticated;

-- Organisation-wide review state. A Session can have one current review mark per organisation.
create table public.coach_session_reviews (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint coach_session_reviews_org_session_unique unique (organization_id, session_id)
);
create index coach_session_reviews_org_reviewed_idx on public.coach_session_reviews (organization_id, reviewed_at desc);
alter table public.coach_session_reviews enable row level security;
revoke all on public.coach_session_reviews from public, anon, authenticated;
grant select, insert, update, delete on public.coach_session_reviews to authenticated;
create policy coach_session_reviews_select on public.coach_session_reviews for select to authenticated
  using (private.coach_can_access_session(organization_id, session_id));
create policy coach_session_reviews_insert on public.coach_session_reviews for insert to authenticated
  with check (reviewed_by = (select auth.uid()) and private.coach_can_access_session(organization_id, session_id));
create policy coach_session_reviews_update on public.coach_session_reviews for update to authenticated
  using (private.coach_can_access_session(organization_id, session_id))
  with check (reviewed_by = (select auth.uid()) and private.coach_can_access_session(organization_id, session_id));
create policy coach_session_reviews_delete on public.coach_session_reviews for delete to authenticated
  using (private.coach_can_access_session(organization_id, session_id));

-- Session-level Coach notes; no athlete score mutation and no Archer read policy.
create table public.coach_notes (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index coach_notes_session_created_idx on public.coach_notes (organization_id, session_id, created_at desc);
alter table public.coach_notes enable row level security;
revoke all on public.coach_notes from public, anon, authenticated;
grant select, insert, update, delete on public.coach_notes to authenticated;
create policy coach_notes_select on public.coach_notes for select to authenticated
  using (private.coach_can_access_session(organization_id, session_id));
create policy coach_notes_insert on public.coach_notes for insert to authenticated
  with check (author_id = (select auth.uid()) and private.coach_can_access_session(organization_id, session_id));
create policy coach_notes_update on public.coach_notes for update to authenticated
  using (author_id = (select auth.uid()) and private.coach_can_access_session(organization_id, session_id))
  with check (author_id = (select auth.uid()) and private.coach_can_access_session(organization_id, session_id));
create policy coach_notes_delete on public.coach_notes for delete to authenticated
  using (author_id = (select auth.uid()) and private.coach_can_access_session(organization_id, session_id));

-- Private per-Coach filter presets; no public or other-Coach SELECT policy.
create table public.coach_saved_views (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  coach_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  filters jsonb not null check (jsonb_typeof(filters) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_saved_views_owner_name_unique unique (organization_id, coach_user_id, name)
);
create index coach_saved_views_owner_created_idx on public.coach_saved_views (coach_user_id, organization_id, created_at desc);
alter table public.coach_saved_views enable row level security;
revoke all on public.coach_saved_views from public, anon, authenticated;
grant select, insert, update, delete on public.coach_saved_views to authenticated;
create policy coach_saved_views_select on public.coach_saved_views for select to authenticated
  using (coach_user_id = (select auth.uid()) and private.is_active_head_coach(organization_id));
create policy coach_saved_views_insert on public.coach_saved_views for insert to authenticated
  with check (coach_user_id = (select auth.uid()) and private.is_active_head_coach(organization_id));
create policy coach_saved_views_update on public.coach_saved_views for update to authenticated
  using (coach_user_id = (select auth.uid()) and private.is_active_head_coach(organization_id))
  with check (coach_user_id = (select auth.uid()) and private.is_active_head_coach(organization_id));
create policy coach_saved_views_delete on public.coach_saved_views for delete to authenticated
  using (coach_user_id = (select auth.uid()) and private.is_active_head_coach(organization_id));

commit;
