-- Local only. Garmin Health API sleep validation defines tentative -> final refinements.
-- All other equal-duration corrections remain quarantined; no arrival-order assumption.
-- Replace only the existing inner processor. Public pause/generation/admission gates stay intact.
begin;
do $$ begin
  if to_regprocedure('private.process_garmin_health_queue_v1(uuid[],integer)') is null then
    raise exception 'Garmin Health controls processor must already exist';
  end if;
end $$;

create or replace function private.process_garmin_health_queue_v1(p_allowed_users uuid[],p_limit integer default 25)
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
          -- A terminal conflict will not be retried. Erase its revoked health
          -- values as well, retaining only receipt metadata for deduplication.
          update public.garmin_health_inbox set payload=null where user_id=c.user_id and state='conflict' and
            ((kind='activities' and not(safe_permissions ? 'ACTIVITY_EXPORT')) or
             (kind in ('dailies','sleeps','stressDetails') and not(safe_permissions ? 'HEALTH_EXPORT')));
          result_state:='conflict'; result_code:='permission_order_uncertain';
        elsif changed=s.permission_change_seconds then
          result_state:='rejected'; result_code:='out_of_order';
        else
          update public.garmin_health_sync_state set granted_permissions=e->'permissions',permission_change_seconds=changed,
            state=case when (e->'permissions' ? 'HEALTH_EXPORT') and (e->'permissions' ? 'ACTIVITY_EXPORT') then case when last_processed_at is null then 'waiting' else 'received' end else 'permission_revoked' end,
            error_code=case when (e->'permissions' ? 'HEALTH_EXPORT') and (e->'permissions' ? 'ACTIVITY_EXPORT') then null else 'permission_revoked' end where user_id=c.user_id;
          delete from public.garmin_health_records where user_id=c.user_id and
            ((kind='activities' and not(e->'permissions' ? 'ACTIVITY_EXPORT')) or (kind<>'activities' and not(e->'permissions' ? 'HEALTH_EXPORT')));
          update public.garmin_health_inbox set payload=null where user_id=c.user_id and state='conflict' and
            ((kind='activities' and not(e->'permissions' ? 'ACTIVITY_EXPORT')) or
             (kind in ('dailies','sleeps','stressDetails') and not(e->'permissions' ? 'HEALTH_EXPORT')));
        end if;
      elsif not(coalesce(s.granted_permissions,c.permissions) ? needed) then
        result_state:='rejected'; result_code:='permission_revoked';
      else
        begin
          select * into old_record from public.garmin_health_records where user_id=c.user_id and kind=q.kind and record_key=e->>'recordKey';
          if found and (old_record.received_sequence>=q.id or old_record.duration_seconds>(e->>'durationInSeconds')::integer
            or (q.kind='sleeps' and old_record.metrics->>'sleepValidation' in ('AUTO_FINAL','ENHANCED_FINAL')
              and e->'values'->>'sleepValidation' in ('AUTO_TENTATIVE','ENHANCED_TENTATIVE'))) then
            result_state:='rejected'; result_code:='out_of_order';
          elsif found and old_record.content_hash<>q.content_hash and old_record.duration_seconds=(e->>'durationInSeconds')::integer
            and not (q.kind='sleeps' and old_record.source_id=q.source_id and old_record.calendar_date=(e->>'calendarDate')::date
              and ((old_record.metrics->>'sleepValidation'='AUTO_TENTATIVE' and e->'values'->>'sleepValidation'='AUTO_FINAL')
                or (old_record.metrics->>'sleepValidation'='ENHANCED_TENTATIVE' and e->'values'->>'sleepValidation'='ENHANCED_FINAL'))
              is true) then
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

revoke all on function private.process_garmin_health_queue_v1(uuid[],integer) from public,anon,authenticated,service_role;
grant execute on function private.process_garmin_health_queue_v1(uuid[],integer) to service_role;
commit;
