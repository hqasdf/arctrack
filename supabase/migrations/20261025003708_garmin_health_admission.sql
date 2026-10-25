-- Explicit, atomic admission. Existing integer RPC remains rolling-deploy compatible.
begin;

create or replace function private.guard_garmin_health_receipt() returns trigger
language plpgsql security invoker set search_path='' as $$
declare c public.garmin_connections%rowtype; ctl public.garmin_health_controls%rowtype; event_seconds bigint;
begin
  select * into c from public.garmin_connections where user_id=new.user_id for update;
  if not found or c.status in ('disconnected','reauthorization_required') or c.deletion_requested_at is not null
    or c.operation in ('disconnect','delete') then return null; end if;
  select * into ctl from public.garmin_health_controls where user_id=new.user_id;
  if not found then raise exception 'Garmin admission temporarily unavailable.' using errcode='40001'; end if;
  if ctl.paused and new.kind not in ('userPermissionsChange','deregistrations') then return null; end if;
  if ctl.accept_after is not null and new.kind<>'deregistrations' then
    event_seconds:=case when new.kind='userPermissionsChange' then (new.payload->>'changeTimeInSeconds')::bigint
      else (new.payload->>'startTimeInSeconds')::bigint end;
    if event_seconds is null or event_seconds<=floor(extract(epoch from ctl.accept_after))
      or event_seconds>floor(extract(epoch from clock_timestamp())) then return null; end if;
  end if;
  if c.status<>'connected' or c.operation is not null or c.error_code is not null or c.token_ciphertext is null
    or c.access_expires_at is null or c.access_expires_at<=clock_timestamp() then
    raise exception 'Garmin admission temporarily unavailable.' using errcode='40001';
  end if;
  if new.kind in ('userPermissionsChange','deregistrations') then
    update public.garmin_connections set version=gen_random_uuid(),checked_at=null where user_id=new.user_id;
  end if;
  if new.kind='deregistrations' and (ctl.paused or ctl.accept_after is not null) then
    insert into public.garmin_health_sync_state(user_id,state,error_code) values(new.user_id,'reconciliation_required','provider_deregistration')
      on conflict(user_id) do update set state='reconciliation_required',error_code='provider_deregistration';
    return null;
  end if;
  new.sync_generation:=ctl.generation;
  return new;
end;
$$;

create function public.admit_garmin_health_push(p_events jsonb) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='2s' as $$
declare e jsonb; c public.garmin_connections%rowtype; s public.garmin_health_sync_state%rowtype;
  ctl public.garmin_health_controls%rowtype;
  needed text; accepted integer:=0; duplicates integer:=0; ineligible integer:=0; inserted integer; event_seconds bigint;
begin
  if p_events is null or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events) not between 1 and 100 then
    raise exception 'Invalid Garmin delivery.' using errcode='22023'; end if;
  -- The exception block is a subtransaction: ANY retryable event rolls back the
  -- ENTIRE mixed batch, including earlier inserts and consent-proof changes.
  for e in select value from jsonb_array_elements(p_events) order by
    (select gc.user_id from public.garmin_connections gc where gc.garmin_user_id=value->>'garminUserId') loop
    select * into c from public.garmin_connections where garmin_user_id=e->>'garminUserId' for update;
    if not found or c.status in ('disconnected','reauthorization_required') or c.deletion_requested_at is not null
      or c.operation in ('disconnect','delete') then ineligible:=ineligible+1; continue; end if;
    select * into ctl from public.garmin_health_controls where user_id=c.user_id;
    if not found then raise exception 'Garmin admission temporarily unavailable.' using errcode='40001'; end if;
    if ctl.paused and e->>'kind' not in ('userPermissionsChange','deregistrations') then
      ineligible:=ineligible+1; continue; end if;
    select * into s from public.garmin_health_sync_state where user_id=c.user_id;
    needed:=case when e->>'kind'='activities' then 'ACTIVITY_EXPORT' else 'HEALTH_EXPORT' end;
    if e->>'kind' not in ('userPermissionsChange','deregistrations') and not(coalesce(s.granted_permissions,c.permissions) ? needed) then
      ineligible:=ineligible+1; continue; end if;
    -- A durable equivalent receipt is already handled, even during token expiry.
    if exists(select 1 from public.garmin_health_inbox where user_id=c.user_id and authorized_at=c.authorized_at
      and kind=e->>'kind' and source_id=e->>'sourceId' and content_hash=e->>'hash') then
      duplicates:=duplicates+1; continue; end if;
    if c.authorized_at is null or s.state='reconciliation_required' then
      raise exception 'Garmin admission temporarily unavailable.' using errcode='40001'; end if;
    insert into public.garmin_health_inbox(user_id,authorized_at,kind,source_id,content_hash,payload)
      values(c.user_id,c.authorized_at,e->>'kind',e->>'sourceId',e->>'hash',e-'garminUserId'-'hash')
      on conflict(user_id,authorized_at,kind,source_id,content_hash) do nothing;
    get diagnostics inserted=row_count;
    if inserted=0 then
      event_seconds:=case when e->>'kind'='userPermissionsChange' then (e->>'changeTimeInSeconds')::bigint
        when e->>'kind'='deregistrations' then null else (e->>'startTimeInSeconds')::bigint end;
      if ctl.accept_after is not null and e->>'kind'<>'deregistrations' and
        (event_seconds is null or event_seconds<=floor(extract(epoch from ctl.accept_after))
        or event_seconds>floor(extract(epoch from clock_timestamp()))) then
        ineligible:=ineligible+1;
      elsif e->>'kind'='deregistrations' and (ctl.paused or ctl.accept_after is not null)
        and exists(select 1 from public.garmin_health_sync_state where user_id=c.user_id and state='reconciliation_required') then
        ineligible:=ineligible+1;
      else
        -- An unexplained zero is NOT evidence of successful/final handling.
        raise exception 'Garmin admission temporarily unavailable.' using errcode='40001';
      end if;
      continue;
    end if;
    accepted:=accepted+1;
    insert into public.garmin_health_sync_state(user_id,last_received_at) values(c.user_id,clock_timestamp())
      on conflict(user_id) do update set last_received_at=excluded.last_received_at;
  end loop;
  return jsonb_build_object('status',case when accepted>0 then 'accepted' when duplicates>0 then 'duplicate' else 'ineligible' end,
    'accepted',accepted,'duplicate',duplicates,'ineligible',ineligible);
exception when serialization_failure or deadlock_detected or lock_not_available then
  return jsonb_build_object('status','temporary','accepted',0,'duplicate',0,'ineligible',0);
end;
$$;
revoke all on function public.admit_garmin_health_push(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admit_garmin_health_push(jsonb) to service_role;

-- Old deployed receivers must also fail rather than ACK a temporary rejection.
create or replace function public.stage_garmin_health_push(p_events jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  result:=public.admit_garmin_health_push(p_events);
  if result->>'status'='temporary' then
    raise exception 'Garmin admission temporarily unavailable.' using errcode='40001'; end if;
  return (result->>'accepted')::integer;
end;
$$;
revoke all on function public.stage_garmin_health_push(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stage_garmin_health_push(jsonb) to service_role;
commit;
