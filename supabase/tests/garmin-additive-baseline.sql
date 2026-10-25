-- DISPOSABLE DATABASE ONLY: synthetic existing application objects, not a copy
-- of production or a replacement for the full application's migration history.
-- Loaded only by test-garmin-sql.mjs inside its newly owned loopback cluster.
insert into auth.users(id,email) values
  ('10000000-0000-4000-8000-000000000001','integrity-owner@example.invalid'),
  ('10000000-0000-4000-8000-000000000002','integrity-other@example.invalid');
create table public.profiles(id uuid primary key references auth.users(id), name text not null);
create table public.sessions(id uuid primary key, user_id uuid not null references auth.users(id), title text not null, arrow_count integer not null);
create table public.session_rounds(id uuid primary key, session_id uuid not null references public.sessions(id), round_number integer not null);
create table public.session_ends(id uuid primary key, round_id uuid not null references public.session_rounds(id), end_number integer not null);
create table public.arrows(id uuid primary key, end_id uuid not null references public.session_ends(id), score integer not null, x double precision, y double precision);
create table public.organizations(id uuid primary key, created_by uuid references auth.users(id), name text not null);
create table public.organization_members(id uuid primary key, organization_id uuid references public.organizations(id), user_id uuid references auth.users(id), status text not null);
create table public.training_plans(id uuid primary key, organization_id uuid references public.organizations(id), title text not null);
create table public.training_plan_days(id uuid primary key, plan_id uuid references public.training_plans(id), date date, arrow_target integer);
create table public.training_plan_assignments(id uuid primary key, plan_id uuid references public.training_plans(id), athlete_user_id uuid references auth.users(id));
create sequence public.integrity_existing_sequence start 17;
select nextval('public.integrity_existing_sequence');
create function private.integrity_existing_title_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.title = '' then raise exception 'Title required' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger integrity_existing_title_guard before insert or update on public.sessions
for each row execute function private.integrity_existing_title_guard();
alter table public.sessions enable row level security;
create policy sessions_select_own on public.sessions for select to authenticated
using (user_id=(select auth.uid()));
create policy sessions_insert_own on public.sessions for insert to authenticated
with check (user_id=(select auth.uid()));
create policy sessions_update_own on public.sessions for update to authenticated
using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy sessions_delete_own on public.sessions for delete to authenticated
using (user_id=(select auth.uid()));
-- Match production's guarded scoring model: ownership RLS does not grant
-- direct Session writes. Existing scoring mutations use privileged RPCs.
revoke all on public.sessions from public,anon,authenticated;
grant select on public.sessions to authenticated;
create view public.integrity_existing_grouping as select count(*) as arrow_count,
  sum(score) as total_score, avg(x) as centre_x, avg(y) as centre_y from public.arrows;
insert into public.profiles values ('10000000-0000-4000-8000-000000000001','Synthetic archer');
insert into public.sessions values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Existing session',150);
insert into public.sessions values ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Other account',25);
insert into public.session_rounds values ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',3);
insert into public.session_ends values ('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',1);
insert into public.arrows values ('50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',10,0.084,0.067);
insert into public.organizations values ('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Existing club');
insert into public.organization_members values ('70000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','active');
insert into public.training_plans values ('80000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','Existing plan');
insert into public.training_plan_days values ('90000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','2026-10-23',100);
insert into public.training_plan_assignments values ('a0000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
