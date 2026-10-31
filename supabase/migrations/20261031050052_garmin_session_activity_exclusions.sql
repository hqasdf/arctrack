begin;
create table public.session_garmin_activity_exclusions (
 session_id uuid not null references public.sessions(id) on delete cascade,
 activity_id text not null check(length(activity_id) between 1 and 180),
 user_id uuid not null references public.garmin_connections(user_id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(session_id,activity_id)
);
create index session_garmin_activity_exclusions_owner on public.session_garmin_activity_exclusions(user_id);
alter table public.session_garmin_activity_exclusions enable row level security;
revoke all on public.session_garmin_activity_exclusions from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.session_garmin_activity_exclusions to authenticated;
grant select,delete on public.session_garmin_activity_exclusions to service_role;
create policy session_garmin_exclusions_owner on public.session_garmin_activity_exclusions for all to authenticated
 using(user_id=(select auth.uid()) and exists(select 1 from public.sessions s where s.id=session_id and s.user_id=(select auth.uid())))
 with check(user_id=(select auth.uid()) and exists(select 1 from public.sessions s where s.id=session_id and s.user_id=(select auth.uid())));
create function private.cleanup_garmin_activity_exclusions() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='garmin_connections' then
  if new.status='disconnected' or new.garmin_user_id is distinct from old.garmin_user_id or new.authorized_at is distinct from old.authorized_at then
   delete from public.session_garmin_activity_exclusions where user_id=new.user_id;
  end if;
 elsif new.deleted_at is distinct from old.deleted_at then
  delete from public.session_garmin_activity_exclusions where user_id=new.user_id;
 end if;
 return new;
end; $$;
revoke all on function private.cleanup_garmin_activity_exclusions() from public,anon,authenticated,service_role;
create trigger garmin_exclusions_connection_cleanup after update on public.garmin_connections for each row execute function private.cleanup_garmin_activity_exclusions();
create trigger garmin_exclusions_health_cleanup after update on public.garmin_health_controls for each row execute function private.cleanup_garmin_activity_exclusions();
commit;
