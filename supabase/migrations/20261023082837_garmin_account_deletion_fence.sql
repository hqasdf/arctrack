-- LOCAL PREPARATION ONLY. Apply after the Garmin OAuth connection migration.
begin;
alter table public.garmin_connections
  add column deletion_requested_at timestamptz,
  add column deregistered_at timestamptz;
alter table public.garmin_connections drop constraint garmin_connections_operation_check;
alter table public.garmin_connections add constraint garmin_connections_operation_check
  check (operation in ('authorize', 'exchange', 'refresh', 'disconnect', 'delete'));

-- A fence is durable across failures and lease expiry. It must not be cleared by
-- stale code; only account deletion removes the row through the existing FK.
create function private.guard_garmin_deletion_fence()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.deletion_requested_at is not null then
    if new.deletion_requested_at is distinct from old.deletion_requested_at
      or (new.operation is not null and new.operation <> 'delete') then
      raise exception 'Garmin account deletion is pending.' using errcode = '40001';
    end if;
  end if;
  if new.deletion_requested_at is not null and old.operation is not null
    and old.operation <> 'delete' then
    raise exception 'Garmin operation must finish before deletion.' using errcode = '40001';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_garmin_deletion_fence() from public, anon, authenticated, service_role;
grant execute on function private.guard_garmin_deletion_fence() to service_role;
create trigger garmin_deletion_fence_guard before update on public.garmin_connections
  for each row execute function private.guard_garmin_deletion_fence();

create or replace function private.guard_garmin_oauth_transaction()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.garmin_connections c
  where c.user_id = new.user_id and c.version = new.connection_version
    and c.operation = 'authorize' and c.lease_until > pg_catalog.clock_timestamp()
    and c.deletion_requested_at is null
  for update;
  if not found then
    raise exception 'Stale Garmin authorization.' using errcode = '40001';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_garmin_oauth_transaction() from public, anon, authenticated, service_role;
grant execute on function private.guard_garmin_oauth_transaction() to service_role;
-- Existing table RLS, service-only grants and Auth-user cascade remain unchanged.
commit;
