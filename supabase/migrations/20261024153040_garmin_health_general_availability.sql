-- General availability: account eligibility belongs to the database, not an application UUID list.
-- Existing signatures remain for rolling-deployment compatibility; new callers use no user list.
begin;
create function public.stage_garmin_health_push(p_events jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare e jsonb; c public.garmin_connections%rowtype; s public.garmin_health_sync_state%rowtype;
  needed text; count_staged integer:=0; inserted integer;
begin
  if p_events is null or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events) not between 1 and 100 then
    raise exception 'Invalid Garmin delivery.' using errcode='22023';
  end if;
  -- Stable connection lock ordering prevents multi-user deliveries deadlocking each other.
  for e in select value from jsonb_array_elements(p_events) order by (select gc.user_id from public.garmin_connections gc where gc.garmin_user_id=value->>'garminUserId') loop
    select * into c from public.garmin_connections where garmin_user_id=e->>'garminUserId' for update;
    if not found or c.status<>'connected' or c.deletion_requested_at is not null
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
revoke all on function public.stage_garmin_health_push(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stage_garmin_health_push(jsonb) to service_role;


-- Bound both the candidate scan and connection locks; never enumerate all accounts.
create index garmin_health_inbox_dispatch on public.garmin_health_inbox(id) include(user_id) where state='pending';
create function public.process_garmin_health_queue(p_limit integer default 25)
returns integer language plpgsql security invoker set search_path='' as $$
declare c public.garmin_connections%rowtype; ctl public.garmin_health_controls%rowtype;
  processed integer:=0; rejected integer;
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'Invalid Garmin worker batch.' using errcode='22023'; end if;
  for c in select gc.* from public.garmin_connections gc join
    (select distinct user_id from (select user_id from public.garmin_health_inbox
       where state='pending' order by id limit p_limit*4) receipts) pending using(user_id)
    order by gc.user_id limit p_limit for update of gc skip locked loop
    exit when processed>=p_limit;
    if c.operation is not null then continue; end if;
    select * into ctl from public.garmin_health_controls where user_id=c.user_id;
    if not found then continue; end if;
    -- Reject only a bounded batch. Consent notifications remain actionable while paused.
    update public.garmin_health_inbox set state='rejected',payload=null,error_code='connection_changed',completed_at=clock_timestamp()
      where id in (select id from public.garmin_health_inbox where user_id=c.user_id and state='pending'
        and (sync_generation<>ctl.generation or (ctl.paused and kind not in ('userPermissionsChange','deregistrations'))
          or c.status<>'connected' or c.deletion_requested_at is not null or c.error_code is not null)
        order by id limit (p_limit-processed) for update);
    get diagnostics rejected=row_count;
    processed:=processed+rejected;
    if processed<p_limit then
      -- Reuse the reviewed permission/revision/deletion processor under the same row lock.
      processed:=processed+private.process_garmin_health_queue_v1(array[c.user_id],p_limit-processed);
    end if;
  end loop;
  return processed;
end;
$$;
revoke all on function public.process_garmin_health_queue(integer) from public,anon,authenticated,service_role;
grant execute on function public.process_garmin_health_queue(integer) to service_role;

-- Refresh only a small indexed due set, outside queue-processing transactions.
create index garmin_connections_health_refresh on public.garmin_connections(refresh_after,user_id)
  where status='connected' and operation is null and deletion_requested_at is null and error_code is null;
create function public.garmin_health_refresh_candidates(p_limit integer default 3) returns setof uuid
language plpgsql security invoker set search_path='' as $$
begin
  if p_limit is null or p_limit not between 1 and 3 then raise exception 'Invalid Garmin refresh batch.' using errcode='22023'; end if;
  return query select c.user_id from public.garmin_connections c join public.garmin_health_controls ctl using(user_id)
    where c.status='connected' and c.operation is null and c.deletion_requested_at is null and c.error_code is null
      and c.token_ciphertext is not null and c.refresh_after<=clock_timestamp() and not ctl.paused
      and (c.permissions ? 'HEALTH_EXPORT' or c.permissions ? 'ACTIVITY_EXPORT')
    order by c.refresh_after,c.user_id limit p_limit;
end;
$$;
revoke all on function public.garmin_health_refresh_candidates(integer) from public,anon,authenticated,service_role;
grant execute on function public.garmin_health_refresh_candidates(integer) to service_role;

commit;
