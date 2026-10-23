-- LOCAL PREPARATION ONLY. No live application is authorized by this file.
-- Credentials are encrypted by the server before storage. Clients receive status only.
begin;

create table public.garmin_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  garmin_user_id text unique,
  status text not null default 'disconnected'
    check (status in ('disconnected', 'connected', 'reauthorization_required', 'error')),
  token_ciphertext text check (token_ciphertext is null or length(token_ciphertext) between 1 and 65536),
  access_expires_at timestamptz,
  refresh_expires_at timestamptz,
  refresh_after timestamptz,
  connected_at timestamptz,
  authorized_at timestamptz,
  checked_at timestamptz,
  permissions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(permissions) = 'array' and jsonb_array_length(permissions) <= 100
      and octet_length(permissions::text) <= 16384),
  error_code text,
  version uuid not null default pg_catalog.gen_random_uuid(),
  operation text check (operation in ('authorize', 'exchange', 'refresh', 'disconnect')),
  lease_until timestamptz,
  constraint garmin_connection_lease_pair check ((operation is null) = (lease_until is null)),
  constraint garmin_connection_connected_fields check (status <> 'connected' or
    (garmin_user_id is not null and token_ciphertext is not null
      and access_expires_at is not null and refresh_after is not null))
);

create table public.garmin_oauth_transactions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state_hash text not null unique check (state_hash ~ '^[0-9a-f]{64}$'),
  binding_hash text not null check (binding_hash ~ '^[0-9a-f]{64}$'),
  verifier_ciphertext text not null check (length(verifier_ciphertext) between 1 and 4096),
  connection_version uuid not null,
  redirect_uri text not null check (length(redirect_uri) between 1 and 2048),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now()
);

alter table public.garmin_connections enable row level security;
alter table public.garmin_oauth_transactions enable row level security;
revoke all on table public.garmin_connections, public.garmin_oauth_transactions
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.garmin_connections, public.garmin_oauth_transactions
  to service_role;
-- Serialize transaction publication with connection-version changes. A delayed
-- authorization request must never overwrite a newer start after disconnect.
create function private.guard_garmin_oauth_transaction()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.garmin_connections c
  where c.user_id = new.user_id and c.version = new.connection_version
    and c.operation = 'authorize' and c.lease_until > pg_catalog.clock_timestamp()
  for update;
  if not found then
    raise exception 'Stale Garmin authorization.' using errcode = '40001';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_garmin_oauth_transaction() from public, anon, authenticated, service_role;
grant execute on function private.guard_garmin_oauth_transaction() to service_role;
create trigger garmin_oauth_transaction_guard before insert or update
  on public.garmin_oauth_transactions for each row
  execute function private.guard_garmin_oauth_transaction();
-- No client policies or RPCs: only authenticated, server-authorized integration code
-- may use the service client. Every operation must filter by verified user_id.
commit;
