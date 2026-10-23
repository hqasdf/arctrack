-- LOCAL ONLY. Requires both Garmin OAuth migrations. No live application authorized.
begin;

create table public.garmin_health_inbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.garmin_connections(user_id) on delete cascade,
  authorized_at timestamptz not null,
  kind text not null check (kind in ('dailies','sleeps','stressDetails','activities','userPermissionsChange','deregistrations')),
  source_id text not null check (length(source_id) between 1 and 256),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb check (payload is null or (jsonb_typeof(payload)='object' and octet_length(payload::text)<=8192)),
  state text not null default 'pending' check (state in ('pending','processed','rejected','conflict')),
  received_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  error_code text check (error_code in ('connection_changed','permission_revoked','ambiguous_update','permission_order_uncertain','invalid_record','out_of_order')),
  unique(user_id,authorized_at,kind,source_id,content_hash)
);
create index garmin_health_inbox_pending on public.garmin_health_inbox(user_id,id) where state='pending';

create table public.garmin_health_records (
  user_id uuid not null references public.garmin_connections(user_id) on delete cascade,
  kind text not null check (kind in ('dailies','sleeps','stressDetails','activities')),
  record_key text not null check (length(record_key) between 1 and 256),
  source_id text not null check (length(source_id) between 1 and 256),
  calendar_date date not null check (calendar_date between '2000-01-01' and '2100-01-01'),
  start_seconds bigint not null check (start_seconds between 946684800 and 4102444800),
  duration_seconds integer not null check (duration_seconds between 0 and 604800),
  metrics jsonb not null check (jsonb_typeof(metrics)='object' and octet_length(metrics::text)<=8192),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  received_sequence bigint not null,
  imported_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(user_id,kind,record_key)
);
create index garmin_health_records_date on public.garmin_health_records(user_id,calendar_date desc);

create table public.garmin_health_sync_state (
  user_id uuid primary key references public.garmin_connections(user_id) on delete cascade,
  state text not null default 'waiting' check (state in ('waiting','received','error','permission_revoked','reconciliation_required')),
  granted_permissions jsonb check (granted_permissions is null or (jsonb_typeof(granted_permissions)='array' and octet_length(granted_permissions::text)<=16384)),
  permission_change_seconds bigint,
  last_received_at timestamptz,
  last_processed_at timestamptz,
  error_code text check (error_code in ('ambiguous_update','invalid_record','permission_revoked','provider_deregistration','permission_order_uncertain'))
);

alter table public.garmin_health_inbox enable row level security;
alter table public.garmin_health_records enable row level security;
alter table public.garmin_health_sync_state enable row level security;
revoke all on public.garmin_health_inbox, public.garmin_health_records, public.garmin_health_sync_state from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.garmin_health_inbox,public.garmin_health_records,public.garmin_health_sync_state to service_role;
revoke all on sequence public.garmin_health_inbox_id_seq from public,anon,authenticated,service_role;
grant usage,select on sequence public.garmin_health_inbox_id_seq to service_role;
grant select on public.garmin_health_records,public.garmin_health_sync_state to authenticated;
create policy garmin_health_records_owner on public.garmin_health_records for select to authenticated using (user_id=(select auth.uid()));
create policy garmin_health_sync_owner on public.garmin_health_sync_state for select to authenticated using (user_id=(select auth.uid()));

-- No client-writable ownership, no connection creation, no access to OAuth secrets.
-- Stage the complete validated delivery atomically before acknowledging its receipt.
create function public.stage_garmin_health_push(p_events jsonb,p_allowed_users uuid[])
returns integer language plpgsql security invoker set search_path='' as $$
declare e jsonb; c public.garmin_connections%rowtype; s public.garmin_health_sync_state%rowtype;
  needed text; count_staged integer:=0; inserted integer;
begin
  if p_events is null or p_allowed_users is null or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events) not between 1 and 100
    or cardinality(p_allowed_users) not between 1 and 1000 then
    raise exception 'Invalid Garmin delivery.' using errcode='22023';
  end if;
  -- Stable connection lock ordering prevents multi-user deliveries deadlocking each other.
  for e in select value from jsonb_array_elements(p_events) order by value->>'garminUserId' loop
    select * into c from public.garmin_connections where garmin_user_id=e->>'garminUserId' for update;
    if not found or not(c.user_id=any(p_allowed_users)) or c.status<>'connected' or c.deletion_requested_at is not null
      or c.authorized_at is null then continue; end if;
    if c.operation is not null then raise exception 'Garmin connection busy.' using errcode='40001'; end if;
    select * into s from public.garmin_health_sync_state where user_id=c.user_id;
    if s.state='reconciliation_required' then continue; end if;
    needed:=case when e->>'kind'='activities' then 'ACTIVITY_EXPORT' else 'HEALTH_EXPORT' end;
    if e->>'kind' not in ('userPermissionsChange','deregistrations') and not(coalesce(s.granted_permissions,c.permissions) ? needed) then continue; end if;
    insert into public.garmin_health_inbox(user_id,authorized_at,kind,source_id,content_hash,payload)
      values(c.user_id,c.authorized_at,e->>'kind',e->>'sourceId',e->>'hash',e-'garminUserId'-'hash')
      on conflict(user_id,authorized_at,kind,source_id,content_hash) do nothing;
    get diagnostics inserted=row_count;
    count_staged:=count_staged+inserted;
    if inserted>0 then
      insert into public.garmin_health_sync_state(user_id,last_received_at) values(c.user_id,clock_timestamp())
        on conflict(user_id) do update set last_received_at=excluded.last_received_at;
    end if;
  end loop;
  return count_staged;
end;
$$;
revoke all on function public.stage_garmin_health_push(jsonb,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.stage_garmin_health_push(jsonb,uuid[]) to service_role;

-- No external calls or tokens in this worker: each queue transition and record update
-- commits together. A crash/SQL error rolls the transaction back and leaves work pending.
create function public.process_garmin_health_queue(p_allowed_users uuid[],p_limit integer default 25)
returns integer language plpgsql security invoker set search_path='' as $$
declare c public.garmin_connections%rowtype; q public.garmin_health_inbox%rowtype;
  s public.garmin_health_sync_state%rowtype; old_record public.garmin_health_records%rowtype;
  e jsonb; needed text; processed integer:=0; changed bigint; result_state text; result_code text; safe_permissions jsonb;
begin
  if p_allowed_users is null or p_limit is null or cardinality(p_allowed_users) not between 1 and 1000 or p_limit not between 1 and 50 then
    raise exception 'Invalid Garmin worker batch.' using errcode='22023'; end if;
  for c in select gc.* from public.garmin_connections gc where gc.user_id=any(p_allowed_users)
    and exists(select 1 from public.garmin_health_inbox i where i.user_id=gc.user_id and i.state='pending')
    order by gc.user_id for update skip locked loop
    if c.operation is not null then continue; end if;
    for q in select * from public.garmin_health_inbox where user_id=c.user_id and state='pending' order by id for update loop
      if processed>=p_limit then return processed; end if;
      e:=q.payload; result_state:='processed'; result_code:=null;
      select * into s from public.garmin_health_sync_state where user_id=c.user_id;
      needed:=case when q.kind='activities' then 'ACTIVITY_EXPORT' else 'HEALTH_EXPORT' end;
      if c.status<>'connected' or c.deletion_requested_at is not null or c.authorized_at is distinct from q.authorized_at or s.state='reconciliation_required' then
        result_state:='rejected'; result_code:='connection_changed';
      elsif q.kind='deregistrations' then
        -- No provider event timestamp/registration epoch is documented for these.
        -- Quarantine ingestion, do not erase credentials or claim remote cleanup.
        update public.garmin_health_sync_state set state='reconciliation_required',error_code='provider_deregistration' where user_id=c.user_id;
      elsif q.kind='userPermissionsChange' then
        changed:=(e->>'changeTimeInSeconds')::bigint;
        if changed<floor(extract(epoch from c.authorized_at)) or changed<coalesce(s.permission_change_seconds,0) then
          result_state:='rejected'; result_code:='out_of_order';
        elsif changed=floor(extract(epoch from c.authorized_at)) or
          (changed=s.permission_change_seconds and e->'permissions' is distinct from s.granted_permissions) then
          -- Second-resolution timestamps cannot order two conflicting changes, or
          -- a change coincident with authorization. Never restore a permission on
          -- that ambiguity: intersect, remove affected data, pause for verification.
          select coalesce(jsonb_agg(value),'[]'::jsonb) into safe_permissions
            from jsonb_array_elements_text(coalesce(s.granted_permissions,c.permissions))
            where e->'permissions' ? value;
          update public.garmin_health_sync_state set granted_permissions=safe_permissions,
            state='reconciliation_required',error_code='permission_order_uncertain' where user_id=c.user_id;
          delete from public.garmin_health_records where user_id=c.user_id and
            ((kind='activities' and not(safe_permissions ? 'ACTIVITY_EXPORT')) or (kind<>'activities' and not(safe_permissions ? 'HEALTH_EXPORT')));
          result_state:='conflict'; result_code:='permission_order_uncertain';
        elsif changed=s.permission_change_seconds then
          result_state:='rejected'; result_code:='out_of_order';
        else
          update public.garmin_health_sync_state set granted_permissions=e->'permissions',permission_change_seconds=changed,
            state=case when (e->'permissions' ? 'HEALTH_EXPORT') and (e->'permissions' ? 'ACTIVITY_EXPORT') then case when last_processed_at is null then 'waiting' else 'received' end else 'permission_revoked' end,
            error_code=case when (e->'permissions' ? 'HEALTH_EXPORT') and (e->'permissions' ? 'ACTIVITY_EXPORT') then null else 'permission_revoked' end where user_id=c.user_id;
          delete from public.garmin_health_records where user_id=c.user_id and
            ((kind='activities' and not(e->'permissions' ? 'ACTIVITY_EXPORT')) or (kind<>'activities' and not(e->'permissions' ? 'HEALTH_EXPORT')));
        end if;
      elsif not(coalesce(s.granted_permissions,c.permissions) ? needed) then
        result_state:='rejected'; result_code:='permission_revoked';
      else
        begin
          select * into old_record from public.garmin_health_records where user_id=c.user_id and kind=q.kind and record_key=e->>'recordKey';
          if found and (old_record.received_sequence>=q.id or old_record.duration_seconds>(e->>'durationInSeconds')::integer) then
            result_state:='rejected'; result_code:='out_of_order';
          elsif found and old_record.content_hash<>q.content_hash and old_record.duration_seconds=(e->>'durationInSeconds')::integer then
            -- Equal-duration revisions have no documented monotonic provider revision.
            -- Preserve the known record and quarantine ambiguity rather than silently
            -- letting a delayed old notification overwrite it.
            result_state:='conflict'; result_code:='ambiguous_update';
            update public.garmin_health_sync_state set state='error',error_code='ambiguous_update' where user_id=c.user_id;
          else
            insert into public.garmin_health_records(user_id,kind,record_key,source_id,calendar_date,start_seconds,duration_seconds,metrics,content_hash,received_sequence)
              values(c.user_id,q.kind,e->>'recordKey',q.source_id,(e->>'calendarDate')::date,(e->>'startTimeInSeconds')::bigint,
                (e->>'durationInSeconds')::integer,e->'values',q.content_hash,q.id)
              on conflict(user_id,kind,record_key) do update set source_id=excluded.source_id,calendar_date=excluded.calendar_date,
                start_seconds=excluded.start_seconds,duration_seconds=excluded.duration_seconds,metrics=excluded.metrics,
                content_hash=excluded.content_hash,received_sequence=excluded.received_sequence,updated_at=clock_timestamp();
            update public.garmin_health_sync_state set last_processed_at=clock_timestamp(),
              state=case when state in ('error','permission_revoked') then state else 'received' end where user_id=c.user_id;
          end if;
        exception when data_exception or check_violation or not_null_violation then
          result_state:='rejected'; result_code:='invalid_record';
          update public.garmin_health_sync_state set state='error',error_code='invalid_record' where user_id=c.user_id;
        end;
      end if;
      update public.garmin_health_inbox set state=result_state,error_code=result_code,completed_at=clock_timestamp(),
        payload=case when result_state='conflict' then payload else null end where id=q.id;
      processed:=processed+1;
    end loop;
  end loop;
  return processed;
end;
$$;
revoke all on function public.process_garmin_health_queue(uuid[],integer) from public,anon,authenticated,service_role;
grant execute on function public.process_garmin_health_queue(uuid[],integer) to service_role;

-- Extend only Garmin's lifecycle. Preserve the existing fence and OAuth guards.
create function private.cleanup_garmin_health_lifecycle() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.status='disconnected' or (old.garmin_user_id is not null and old.garmin_user_id is distinct from new.garmin_user_id) then
    delete from public.garmin_health_inbox where user_id=new.user_id;
    delete from public.garmin_health_records where user_id=new.user_id;
    delete from public.garmin_health_sync_state where user_id=new.user_id;
  elsif new.authorized_at is distinct from old.authorized_at then
    delete from public.garmin_health_inbox where user_id=new.user_id;
    delete from public.garmin_health_sync_state where user_id=new.user_id;
    delete from public.garmin_health_records where user_id=new.user_id and
      ((kind='activities' and not(new.permissions ? 'ACTIVITY_EXPORT')) or (kind<>'activities' and not(new.permissions ? 'HEALTH_EXPORT')));
  end if;
  return new;
end;
$$;
revoke all on function private.cleanup_garmin_health_lifecycle() from public,anon,authenticated,service_role;
grant execute on function private.cleanup_garmin_health_lifecycle() to service_role;
create trigger garmin_health_lifecycle after update of status,garmin_user_id,authorized_at on public.garmin_connections
  for each row execute function private.cleanup_garmin_health_lifecycle();
commit;
