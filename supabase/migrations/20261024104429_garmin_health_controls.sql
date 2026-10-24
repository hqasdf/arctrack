-- LOCAL PREPARATION ONLY. Requires 20261023155612_garmin_health_sync.sql.
-- All ingestion, processing and controls use the existing connection row lock.
begin;

create table public.garmin_health_controls (
  user_id uuid primary key references public.garmin_connections(user_id) on delete cascade,
  generation uuid not null default gen_random_uuid(),
  paused boolean not null default false,
  accept_after timestamptz,
  deleted_at timestamptz,
  changed_at timestamptz not null default clock_timestamp(),
  last_request_id uuid,
  last_action text check(last_action in ('delete','pause','resume'))
);
alter table public.garmin_health_controls enable row level security;
revoke all on public.garmin_health_controls from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.garmin_health_controls to service_role;
grant select on public.garmin_health_controls to authenticated;
insert into public.garmin_health_controls(user_id) select user_id from public.garmin_connections;

-- A narrowly scoped boolean is necessary because clients must never SELECT the
-- credential-bearing connection table. No user-supplied identity, data or SQL.
create function public.garmin_health_owner_access() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.garmin_connections c where c.user_id=(select auth.uid())
    and c.status='connected' and c.garmin_user_id is not null and c.token_ciphertext is not null
    and c.access_expires_at>now() and c.operation is null and c.deletion_requested_at is null and c.error_code is null);
$$;
revoke all on function public.garmin_health_owner_access() from public,anon,authenticated,service_role;
grant execute on function public.garmin_health_owner_access() to authenticated;
alter policy garmin_health_records_owner on public.garmin_health_records
  using (user_id=(select auth.uid()) and (select public.garmin_health_owner_access()));
alter policy garmin_health_sync_owner on public.garmin_health_sync_state
  using (user_id=(select auth.uid()) and (select public.garmin_health_owner_access()));
create policy garmin_health_controls_owner on public.garmin_health_controls for select to authenticated
  using (user_id=(select auth.uid()) and (select public.garmin_health_owner_access()));

-- One statement/snapshot prevents pairing pre-deletion measurements with a
-- post-deletion control row from separate HTTP queries.
create function public.read_garmin_health_dashboard(p_user_id uuid,p_start date,p_end date) returns jsonb
language sql stable security invoker set search_path='' as $$
  select case when p_user_id=(select auth.uid()) and public.garmin_health_owner_access() then jsonb_build_object(
    'records',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from
      (select kind,source_id,record_key,calendar_date,start_seconds,duration_seconds,metrics,imported_at,updated_at
       from public.garmin_health_records where user_id=p_user_id and calendar_date between p_start and p_end
       order by calendar_date desc,updated_at desc limit 10000) r),
    'sync',(select to_jsonb(s)-'user_id' from public.garmin_health_sync_state s where user_id=p_user_id),
    'control',(select jsonb_build_object('generation',generation,'paused',paused,'acceptAfter',accept_after,
      'deletedAt',deleted_at,'changedAt',changed_at) from public.garmin_health_controls where user_id=p_user_id)) else null end;
$$;
revoke all on function public.read_garmin_health_dashboard(uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function public.read_garmin_health_dashboard(uuid,date,date) to authenticated;

create function private.guard_garmin_health_controls() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  insert into public.garmin_health_controls(user_id) values(new.user_id) on conflict do nothing;
  if tg_op='UPDATE' and (new.status='disconnected' or
    (old.garmin_user_id is not null and old.garmin_user_id is distinct from new.garmin_user_id)) then
    update public.garmin_health_controls set paused=true,generation=gen_random_uuid(),accept_after=clock_timestamp(),
      deleted_at=clock_timestamp(),changed_at=clock_timestamp(),last_request_id=null,last_action=null where user_id=new.user_id;
  end if;
  if tg_op='UPDATE' and new.permissions is distinct from old.permissions then
    delete from public.garmin_health_records where user_id=new.user_id and
      ((kind='activities' and not(new.permissions ? 'ACTIVITY_EXPORT')) or (kind<>'activities' and not(new.permissions ? 'HEALTH_EXPORT')));
    delete from public.garmin_health_inbox where user_id=new.user_id and
      ((kind='activities' and not(new.permissions ? 'ACTIVITY_EXPORT')) or (kind in ('dailies','sleeps','stressDetails') and not(new.permissions ? 'HEALTH_EXPORT')));
    update public.garmin_health_sync_state set granted_permissions=new.permissions,
      state=case when new.permissions ? 'HEALTH_EXPORT' and new.permissions ? 'ACTIVITY_EXPORT' then state else 'permission_revoked' end,
      error_code=case when new.permissions ? 'HEALTH_EXPORT' and new.permissions ? 'ACTIVITY_EXPORT' then error_code else 'permission_revoked' end where user_id=new.user_id;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_garmin_health_controls() from public,anon,authenticated,service_role;
grant execute on function private.guard_garmin_health_controls() to service_role;
create trigger garmin_health_controls_lifecycle after insert or update of status,garmin_user_id,permissions on public.garmin_connections
  for each row execute function private.guard_garmin_health_controls();

alter table public.garmin_health_inbox add column sync_generation uuid;
update public.garmin_health_inbox i set sync_generation=c.generation from public.garmin_health_controls c where c.user_id=i.user_id;
alter table public.garmin_health_inbox alter column sync_generation set not null;

create function private.guard_garmin_health_receipt() returns trigger
language plpgsql security invoker set search_path='' as $$
declare c public.garmin_connections%rowtype; ctl public.garmin_health_controls%rowtype; event_seconds bigint;
begin
  select * into c from public.garmin_connections where user_id=new.user_id for update;
  select * into ctl from public.garmin_health_controls where user_id=new.user_id;
  if not found or (ctl.paused and new.kind not in ('userPermissionsChange','deregistrations')) or c.status<>'connected' or c.operation is not null or c.deletion_requested_at is not null
    or c.error_code is not null or c.token_ciphertext is null or c.access_expires_at is null or c.access_expires_at<=clock_timestamp() then return null; end if;
  if new.kind in ('userPermissionsChange','deregistrations') then
    -- Invalidate a provider-verification proof even if its consent notification
    -- has arrived but the scheduled worker has not processed it yet.
    update public.garmin_connections set version=gen_random_uuid(),checked_at=null where user_id=new.user_id;
  end if;
  if new.kind='deregistrations' and (ctl.paused or ctl.accept_after is not null) then
    insert into public.garmin_health_sync_state(user_id,state,error_code) values(new.user_id,'reconciliation_required','provider_deregistration')
      on conflict(user_id) do update set state='reconciliation_required',error_code='provider_deregistration';
    return null;
  end if;
  if ctl.accept_after is not null then
    -- Receipt time is not provenance. Reject an entire summary spanning the
    -- cutoff. Untimestamped deregistration events require provider verification.
    event_seconds:=case when new.kind='userPermissionsChange' then (new.payload->>'changeTimeInSeconds')::bigint
      when new.kind='deregistrations' then null else (new.payload->>'startTimeInSeconds')::bigint end;
    if event_seconds is null or event_seconds<=floor(extract(epoch from ctl.accept_after))
      or event_seconds>floor(extract(epoch from clock_timestamp())) then return null; end if;
  end if;
  new.sync_generation:=ctl.generation;
  return new;
end;
$$;
revoke all on function private.guard_garmin_health_receipt() from public,anon,authenticated,service_role;
grant execute on function private.guard_garmin_health_receipt() to service_role;
create trigger garmin_health_receipt_guard before insert on public.garmin_health_inbox
  for each row execute function private.guard_garmin_health_receipt();

-- Retain the reviewed worker unchanged behind a small generation gate.
alter function public.process_garmin_health_queue(uuid[],integer) rename to process_garmin_health_queue_v1;
alter function public.process_garmin_health_queue_v1(uuid[],integer) set schema private;
create function public.process_garmin_health_queue(p_allowed_users uuid[],p_limit integer default 25)
returns integer language plpgsql security invoker set search_path='' as $$
declare c public.garmin_connections%rowtype; ctl public.garmin_health_controls%rowtype; eligible uuid[]:='{}';
begin
  if p_allowed_users is null or p_limit is null or cardinality(p_allowed_users) not between 1 and 1000 or p_limit not between 1 and 50 then
    raise exception 'Invalid Garmin worker batch.' using errcode='22023'; end if;
  for c in select gc.* from public.garmin_connections gc where gc.user_id=any(p_allowed_users)
    and exists(select 1 from public.garmin_health_inbox i where i.user_id=gc.user_id and i.state='pending')
    order by gc.user_id for update skip locked loop
    select * into ctl from public.garmin_health_controls where user_id=c.user_id;
    if not found or c.operation is not null then continue; end if;
    update public.garmin_health_inbox set state='rejected',payload=null,error_code='connection_changed',completed_at=clock_timestamp()
      where user_id=c.user_id and state='pending' and (sync_generation<>ctl.generation or
        (ctl.paused and kind not in ('userPermissionsChange','deregistrations')));
    -- Consent metadata may still remove revoked data while paused. Measurement
    -- receipts cannot be admitted or processed through this exception.
    eligible:=array_append(eligible,c.user_id);
  end loop;
  if cardinality(eligible)=0 then return 0; end if;
  return private.process_garmin_health_queue_v1(eligible,p_limit);
end;
$$;
revoke all on function public.process_garmin_health_queue(uuid[],integer) from public,anon,authenticated,service_role;
grant execute on function public.process_garmin_health_queue(uuid[],integer) to service_role;

create function public.control_garmin_health(p_user_id uuid,p_action text,p_generation uuid,p_request_id uuid,
  p_connection_version uuid default null,p_authorized_at timestamptz default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.garmin_connections%rowtype; ctl public.garmin_health_controls%rowtype;
begin
  if p_user_id is null or p_action is null or p_action not in ('delete','pause','resume') or p_generation is null or p_request_id is null then
    raise exception 'Invalid health control.' using errcode='22023'; end if;
  select * into c from public.garmin_connections where user_id=p_user_id for update;
  if not found then raise exception 'Garmin connection unavailable.' using errcode='40001'; end if;
  select * into ctl from public.garmin_health_controls where user_id=p_user_id;
  if not found then raise exception 'Health controls unavailable.' using errcode='40001'; end if;
  if ctl.last_request_id=p_request_id and ctl.last_action=p_action then
    return jsonb_build_object('paused',ctl.paused,'generation',ctl.generation,'acceptAfter',ctl.accept_after,'deletedAt',ctl.deleted_at,'changedAt',ctl.changed_at);
  end if;
  if ctl.generation<>p_generation or c.operation is not null or c.deletion_requested_at is not null then
    raise exception 'Health control changed. Refresh and retry.' using errcode='40001'; end if;
  if p_action='resume' and (not ctl.paused or p_connection_version is null or c.version<>p_connection_version or p_authorized_at is null
    or c.authorized_at is distinct from p_authorized_at or c.status<>'connected' or c.error_code is not null
    or c.token_ciphertext is null or c.access_expires_at is null or c.access_expires_at<=clock_timestamp()
    or not(c.permissions ? 'HEALTH_EXPORT' and c.permissions ? 'ACTIVITY_EXPORT')
    or exists(select 1 from public.garmin_health_inbox where user_id=p_user_id and state='pending' and kind in ('userPermissionsChange','deregistrations'))) then
    raise exception 'Verified Garmin authorization required.' using errcode='40001'; end if;
  -- Atomic: either the fence and all cleanup commit together, or neither does.
  -- Retrying uses the request receipt; a late earlier request cannot undo Resume.
  update public.garmin_health_controls set paused=p_action<>'resume',generation=gen_random_uuid(),accept_after=clock_timestamp(),
    changed_at=clock_timestamp(),deleted_at=case when p_action='delete' then clock_timestamp() else deleted_at end,
    last_request_id=p_request_id,last_action=p_action where user_id=p_user_id returning * into ctl;
  delete from public.garmin_health_inbox where user_id=p_user_id and
    (p_action<>'pause' or state<>'pending' or kind not in ('userPermissionsChange','deregistrations'));
  if p_action='pause' then
    -- Do not discard already-delivered consent changes while retaining records.
    update public.garmin_health_inbox set sync_generation=ctl.generation where user_id=p_user_id and state='pending';
  end if;
  if p_action='delete' then
    delete from public.garmin_health_records where user_id=p_user_id;
    delete from public.garmin_health_sync_state where user_id=p_user_id;
  elsif p_action='resume' then
    insert into public.garmin_health_sync_state(user_id) values(p_user_id) on conflict do nothing;
    update public.garmin_health_sync_state set granted_permissions=c.permissions,permission_change_seconds=null,
      state=case when last_processed_at is null then 'waiting' else 'received' end,error_code=null,last_received_at=null where user_id=p_user_id;
  end if;
  return jsonb_build_object('paused',ctl.paused,'generation',ctl.generation,'acceptAfter',ctl.accept_after,'deletedAt',ctl.deleted_at,'changedAt',ctl.changed_at);
end;
$$;
revoke all on function public.control_garmin_health(uuid,text,uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.control_garmin_health(uuid,text,uuid,uuid,uuid,timestamptz) to service_role;
commit;
