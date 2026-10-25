begin;
-- Timing is deliberately separate: old web/Android scoring inserts remain valid.
create table public.session_recording_windows (
 session_id uuid primary key references public.sessions(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 started_at timestamptz, finished_at timestamptz,
 activity_id text check(length(activity_id) between 1 and 180),
 updated_at timestamptz not null default now(),
 check(finished_at is null or started_at is not null and finished_at>started_at),
 check(finished_at is null or finished_at-started_at<=interval '7 days')
);
alter table public.session_recording_windows enable row level security;
revoke all on public.session_recording_windows from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.session_recording_windows to authenticated,service_role;
create policy session_recording_owner on public.session_recording_windows for all to authenticated
 using(user_id=(select auth.uid()) and exists(select 1 from public.sessions s where s.id=session_id and s.user_id=(select auth.uid())))
 with check(user_id=(select auth.uid()) and exists(select 1 from public.sessions s where s.id=session_id and s.user_id=(select auth.uid())));

create table public.garmin_hr_datasets (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.garmin_connections(user_id) on delete cascade,
 source text not null check(source in ('activity','daily')), source_id text not null check(length(source_id) between 1 and 180),
 revision text not null check(revision ~ '^[a-f0-9]{64}$'),
 authorized_at timestamptz not null, generation uuid not null,
 start_seconds bigint not null, duration_seconds integer not null check(duration_seconds between 0 and 172800),
 activity_type text, part_count integer not null check(part_count between 1 and 289),
 sample_count integer not null check(sample_count between 0 and 86401),
 state text not null default 'receiving' check(state in ('receiving','complete','conflict')),
 published boolean not null default false, imported_at timestamptz not null default now(),
 unique(user_id,source,source_id,revision), unique(id,user_id), check(not published or state='complete')
);
create unique index garmin_hr_published on public.garmin_hr_datasets(user_id,source,source_id) where published;
create index garmin_hr_interval on public.garmin_hr_datasets(user_id,start_seconds) where published;
create table public.garmin_hr_chunks (
 dataset_id uuid not null, user_id uuid not null,
 part integer not null check(part between 0 and 288), samples jsonb not null
 check(jsonb_typeof(samples)='array' and jsonb_array_length(samples)<=300 and octet_length(samples::text)<=12000),
 primary key(dataset_id,part), foreign key(dataset_id,user_id) references public.garmin_hr_datasets(id,user_id) on delete cascade
);
-- Activity API push sends a short ping containing a bearer callbackURL. Keep
-- that URL only as AES-GCM ciphertext in a service-role-only durable pull queue.
create table public.garmin_activity_detail_pulls (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.garmin_connections(user_id) on delete cascade,
 authorized_at timestamptz not null, sync_generation uuid not null,
 garmin_user_id text not null check(length(garmin_user_id) between 1 and 256),
 source_id text not null check(source_id ~ '^activity-pull:[a-f0-9]{64}$'),
 pull_kind text not null check(pull_kind in ('activities','activityDetails')),
 callback_ciphertext text check(callback_ciphertext is null or length(callback_ciphertext)<=16384),
 state text not null default 'pending' check(state in ('pending','processing','retry','completed','rejected')),
 attempts integer not null default 0 check(attempts between 0 and 12),
 next_attempt_at timestamptz not null default clock_timestamp(), lease_until timestamptz, lease_token uuid,
 error_code text check(error_code is null or error_code in ('network_retryable','provider_retryable','provider_rejected','invalid_callback','invalid_response','response_too_large','storage_retryable','authorization_changed')),
 created_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
 unique(user_id,authorized_at,source_id),
 check((state in ('pending','processing','retry'))=(callback_ciphertext is not null)),
 check((state='processing')=(lease_until is not null)),
 check((state='processing')=(lease_token is not null))
);
create index garmin_activity_pulls_due on public.garmin_activity_detail_pulls(next_attempt_at,created_at)
 where state in ('pending','retry','processing');
alter table public.garmin_activity_detail_pulls enable row level security;
revoke all on public.garmin_activity_detail_pulls from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.garmin_activity_detail_pulls to service_role;
alter table public.garmin_hr_datasets enable row level security;
alter table public.garmin_hr_chunks enable row level security;
revoke all on public.garmin_hr_datasets,public.garmin_hr_chunks from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.garmin_hr_datasets,public.garmin_hr_chunks to service_role;
grant select on public.garmin_hr_datasets,public.garmin_hr_chunks to authenticated;
-- Narrow access helper: credential-bearing connection records stay server-only.
create function public.garmin_hr_owner_access(p_source text) returns boolean
language sql stable security definer set search_path='' as $$
 select public.garmin_health_owner_access() and exists(select 1 from public.garmin_connections c
 left join public.garmin_health_sync_state s using(user_id) where c.user_id=(select auth.uid())
 and coalesce(s.granted_permissions,c.permissions) ? case when p_source='activity' then 'ACTIVITY_EXPORT' else 'HEALTH_EXPORT' end
 and s.state is distinct from 'reconciliation_required');
$$;
revoke all on function public.garmin_hr_owner_access(text) from public,anon,authenticated,service_role;
grant execute on function public.garmin_hr_owner_access(text) to authenticated;
create policy garmin_hr_datasets_owner on public.garmin_hr_datasets for select to authenticated
 using(user_id=(select auth.uid()) and public.garmin_hr_owner_access(source));
create policy garmin_hr_chunks_owner on public.garmin_hr_chunks for select to authenticated
 using(user_id=(select auth.uid()) and exists(select 1 from public.garmin_hr_datasets d where d.id=dataset_id and d.published));

-- Called only inside the existing worker's connection lock and permission/generation gates.
create function private.store_garmin_hr_chunk(p_user uuid,p_auth timestamptz,p_generation uuid,e jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare h jsonb:=e->'heartRate'; d public.garmin_hr_datasets%rowtype; old public.garmin_hr_datasets%rowtype;
 v jsonb; t bigint; b integer; actual integer; distinct_times integer;
begin
 if h->>'source' not in ('activity','daily') or (h->>'source'='activity')<>(e->>'kind'='activities')
 or jsonb_typeof(h->'samples')<>'array' or (h->>'part')::integer<0 or (h->>'part')::integer>=(h->>'parts')::integer then
 raise exception 'Invalid HR chunk' using errcode='22023'; end if;
 for v in select value from jsonb_array_elements(h->'samples') loop
  if jsonb_typeof(v)<>'array' or jsonb_array_length(v)<>2 then raise exception 'Invalid HR sample' using errcode='22023'; end if;
  t:=(v->>0)::bigint; b:=(v->>1)::integer;
  if t<(e->>'startTimeInSeconds')::bigint or t>(e->>'startTimeInSeconds')::bigint+(e->>'durationInSeconds')::integer
    or (b is not null and b not between 1 and 300) then raise exception 'Invalid HR sample' using errcode='22023'; end if;
 end loop;
 select * into d from public.garmin_hr_datasets where user_id=p_user and source=h->>'source' and source_id=e->>'sourceId' and revision=h->>'revision';
 if not found then
  if (select count(*) from public.garmin_hr_datasets where user_id=p_user and source=h->>'source' and source_id=e->>'sourceId')>=4 then
   raise exception 'HR revisions require reconciliation' using errcode='22023'; end if;
  insert into public.garmin_hr_datasets(user_id,source,source_id,revision,authorized_at,generation,start_seconds,duration_seconds,activity_type,part_count,sample_count)
  values(p_user,h->>'source',e->>'sourceId',h->>'revision',p_auth,p_generation,(e->>'startTimeInSeconds')::bigint,
   (e->>'durationInSeconds')::integer,h->>'activityType',(h->>'parts')::integer,(h->>'count')::integer) returning * into d;
 end if;
 if d.authorized_at<>p_auth or d.generation<>p_generation or d.part_count<>(h->>'parts')::integer or d.sample_count<>(h->>'count')::integer
  or d.start_seconds<>(e->>'startTimeInSeconds')::bigint or d.duration_seconds<>(e->>'durationInSeconds')::integer then
  raise exception 'Inconsistent HR manifest' using errcode='22023'; end if;
 if exists(select 1 from public.garmin_hr_chunks where dataset_id=d.id and part=(h->>'part')::integer and samples<>h->'samples') then
  raise exception 'Inconsistent HR chunk' using errcode='22023'; end if;
 insert into public.garmin_hr_chunks values(d.id,p_user,(h->>'part')::integer,h->'samples') on conflict do nothing;
 if (select count(*) from public.garmin_hr_chunks where dataset_id=d.id)<>d.part_count then return; end if;
 select count(*),count(distinct (j->>0)::bigint) into actual,distinct_times from public.garmin_hr_chunks c,
 lateral jsonb_array_elements(c.samples) j where c.dataset_id=d.id;
 if actual<>d.sample_count or actual<>distinct_times then raise exception 'Incomplete HR dataset' using errcode='22023'; end if;
 select * into old from public.garmin_hr_datasets where user_id=p_user and source=d.source and source_id=d.source_id and published and id<>d.id;
 if found and (old.start_seconds<>d.start_seconds or old.duration_seconds>d.duration_seconds or exists(
  select value from public.garmin_hr_chunks c,lateral jsonb_array_elements(c.samples) where c.dataset_id=old.id
  except select value from public.garmin_hr_chunks c,lateral jsonb_array_elements(c.samples) where c.dataset_id=d.id)) then
  update public.garmin_hr_datasets set state='conflict' where id=d.id; return;
 end if;
 update public.garmin_hr_datasets set published=false where user_id=p_user and source=d.source and source_id=d.source_id and id<>d.id;
 update public.garmin_hr_datasets set state='complete',published=true where id=d.id;
 -- Only a proven superset replaces an existing recording; ambiguous revisions remain private/quarantined.
 delete from public.garmin_hr_datasets where user_id=p_user and source=d.source and source_id=d.source_id and state='complete' and not published;
end;
$$;
revoke all on function private.store_garmin_hr_chunk(uuid,timestamptz,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.store_garmin_hr_chunk(uuid,timestamptz,uuid,jsonb) to service_role;

create function private.cleanup_garmin_hr_controls() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.generation is distinct from old.generation or new.paused then
  delete from public.garmin_activity_detail_pulls where user_id=new.user_id;
 end if;
 if new.deleted_at is distinct from old.deleted_at then
  delete from public.garmin_hr_datasets where user_id=new.user_id;
  update public.session_recording_windows set activity_id=null where user_id=new.user_id;
 elsif new.generation<>old.generation then
  delete from public.garmin_hr_datasets where user_id=new.user_id and not published;
 end if;
 return new;
end; $$;
create trigger garmin_hr_controls_cleanup after update on public.garmin_health_controls for each row execute function private.cleanup_garmin_hr_controls();
create function private.cleanup_garmin_hr_connection() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.status is distinct from old.status and new.status<>'connected' then
  delete from public.garmin_activity_detail_pulls where user_id=new.user_id;
 end if;
 if new.status='disconnected' or new.garmin_user_id is distinct from old.garmin_user_id or new.authorized_at is distinct from old.authorized_at then
  delete from public.garmin_hr_datasets where user_id=new.user_id;
  update public.session_recording_windows set activity_id=null where user_id=new.user_id;
 else
  if new.permissions is distinct from old.permissions and not(new.permissions ? 'ACTIVITY_EXPORT') then
   delete from public.garmin_activity_detail_pulls where user_id=new.user_id;
  end if;
  delete from public.garmin_hr_datasets where user_id=new.user_id and
   ((source='activity' and not(new.permissions ? 'ACTIVITY_EXPORT')) or (source='daily' and not(new.permissions ? 'HEALTH_EXPORT')));
 end if; return new;
end; $$;
create trigger garmin_hr_connection_cleanup after update of status,garmin_user_id,authorized_at,permissions on public.garmin_connections for each row execute function private.cleanup_garmin_hr_connection();
create function private.cleanup_garmin_hr_permissions() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not(new.granted_permissions ? 'ACTIVITY_EXPORT') then
  delete from public.garmin_activity_detail_pulls where user_id=new.user_id;
 end if;
 delete from public.garmin_hr_datasets where user_id=new.user_id and
 ((source='activity' and not(new.granted_permissions ? 'ACTIVITY_EXPORT')) or (source='daily' and not(new.granted_permissions ? 'HEALTH_EXPORT')));
 return new;
end; $$;
create trigger garmin_hr_permission_cleanup after update of granted_permissions on public.garmin_health_sync_state for each row execute function private.cleanup_garmin_hr_permissions();
revoke all on function private.cleanup_garmin_hr_controls(),private.cleanup_garmin_hr_connection(),private.cleanup_garmin_hr_permissions() from public,anon,authenticated,service_role;
grant execute on function private.cleanup_garmin_hr_controls(),private.cleanup_garmin_hr_connection(),private.cleanup_garmin_hr_permissions() to service_role;

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
      elsif e ? 'activityDetailsPull' then
        begin
          if q.kind<>'activities' or e->>'sourceId' !~ '^activity-pull:[a-f0-9]{64}$'
            or jsonb_typeof(e->'activityDetailsPull')<>'object'
            or e->'activityDetailsPull'->>'kind' not in ('activities','activityDetails')
            or length(e->'activityDetailsPull'->>'callbackCiphertext') not between 1 and 16384
            or e->'activityDetailsPull' ? 'callbackUrl' then raise exception 'Invalid Activity callback receipt' using errcode='22023'; end if;
          insert into public.garmin_activity_detail_pulls(user_id,authorized_at,sync_generation,garmin_user_id,source_id,pull_kind,callback_ciphertext)
          values(c.user_id,q.authorized_at,q.sync_generation,c.garmin_user_id,e->>'sourceId',e->'activityDetailsPull'->>'kind',
            e->'activityDetailsPull'->>'callbackCiphertext') on conflict(user_id,authorized_at,source_id) do nothing;
        exception when data_exception or check_violation or not_null_violation then
          result_state:='rejected'; result_code:='invalid_record';
        end;
      elsif e ? 'heartRate' then
        begin
          perform private.store_garmin_hr_chunk(c.user_id,q.authorized_at,q.sync_generation,e);
          update public.garmin_health_sync_state set last_processed_at=clock_timestamp() where user_id=c.user_id;
        exception when data_exception or check_violation or not_null_violation then
          result_state:='rejected'; result_code:='invalid_record';
        end;
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

-- A full Starter Push can expand to more than 100 bounded HR chunks. Admit
-- every chunk in ONE transaction before acknowledging the provider. If any
-- inner batch is temporarily unavailable, roll back all earlier batches.
create function public.admit_garmin_hr_push(p_events jsonb) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='2s' as $$
declare ordered_events jsonb; batch jsonb; result jsonb; offset_index integer:=0;
 accepted integer:=0; duplicates integer:=0; ineligible integer:=0;
begin
 if p_events is null or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events) not between 1 and 512
  or octet_length(p_events::text)>8388608 then
  raise exception 'Invalid Garmin HR delivery.' using errcode='22023'; end if;
 -- Consistent owner order across inner batches avoids taking cross-user locks
 -- in opposite orders. Preserve provider order within each owner.
 select jsonb_agg(e.value order by c.user_id,e.ordinality) into ordered_events
 from jsonb_array_elements(p_events) with ordinality e(value,ordinality)
 left join public.garmin_connections c on c.garmin_user_id=e.value->>'garminUserId';
 while offset_index<jsonb_array_length(ordered_events) loop
  select jsonb_agg(value order by ordinality) into batch
   from jsonb_array_elements(ordered_events) with ordinality
   where ordinality>offset_index and ordinality<=offset_index+100;
  result:=public.admit_garmin_health_push(batch);
  if result->>'status'='temporary' then
   raise exception 'Garmin HR admission temporarily unavailable.' using errcode='40001'; end if;
  accepted:=accepted+(result->>'accepted')::integer;
  duplicates:=duplicates+(result->>'duplicate')::integer;
  ineligible:=ineligible+(result->>'ineligible')::integer;
  offset_index:=offset_index+100;
 end loop;
 return jsonb_build_object('status',case when accepted>0 then 'accepted' when duplicates>0 then 'duplicate' else 'ineligible' end,
  'accepted',accepted,'duplicate',duplicates,'ineligible',ineligible);
exception when serialization_failure or deadlock_detected or lock_not_available then
 return jsonb_build_object('status','temporary','accepted',0,'duplicate',0,'ineligible',0);
end; $$;
revoke all on function public.admit_garmin_hr_push(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admit_garmin_hr_push(jsonb) to service_role;

-- Claim only a small due batch; service workers never scan/lock every account.
create function public.claim_garmin_activity_detail_pulls(p_limit integer)
returns table(id uuid,user_id uuid,garmin_user_id text,source_id text,pull_kind text,callback_ciphertext text,lease_token uuid)
language plpgsql security invoker set search_path='' set lock_timeout='2s' as $$
declare job record;
begin
 if p_limit is null or p_limit not between 1 and 5 then raise exception 'Invalid Activity pull batch.' using errcode='22023'; end if;
 for job in
  select q.id,q.user_id,q.authorized_at,q.sync_generation,q.garmin_user_id,q.source_id,q.pull_kind,q.callback_ciphertext,q.attempts,
   c.status,c.operation,c.error_code,c.garmin_user_id as current_garmin_user_id,c.authorized_at as current_authorized_at,
   c.permissions as connection_permissions,coalesce(s.granted_permissions,c.permissions) as granted_permissions,
   ctl.paused,ctl.generation as current_generation,s.state as sync_state
  from public.garmin_activity_detail_pulls q
  join public.garmin_connections c using(user_id)
  join public.garmin_health_controls ctl using(user_id)
  left join public.garmin_health_sync_state s using(user_id)
  where q.attempts<12 and q.next_attempt_at<=clock_timestamp()
   and (q.state in ('pending','retry') or q.state='processing' and q.lease_until<=clock_timestamp())
  order by q.next_attempt_at,q.created_at limit p_limit for update of q skip locked
 loop
  if job.status<>'connected' or job.operation is not null or job.error_code is not null
   or job.authorized_at is distinct from job.current_authorized_at or job.garmin_user_id is distinct from job.current_garmin_user_id
   or job.paused or job.sync_generation is distinct from job.current_generation or job.sync_state='reconciliation_required'
   or not(coalesce(job.connection_permissions,'[]'::jsonb) ? 'ACTIVITY_EXPORT')
   or not(coalesce(job.granted_permissions,'[]'::jsonb) ? 'ACTIVITY_EXPORT') then
   update public.garmin_activity_detail_pulls set state='rejected',callback_ciphertext=null,lease_until=null,lease_token=null,
    error_code='authorization_changed',completed_at=clock_timestamp() where garmin_activity_detail_pulls.id=job.id;
  else
   update public.garmin_activity_detail_pulls q set state='processing',attempts=q.attempts+1,lease_until=clock_timestamp()+interval '3 minutes',lease_token=gen_random_uuid(),error_code=null
    where q.id=job.id returning q.* into job;
   return query select job.id,job.user_id,job.garmin_user_id,job.source_id,job.pull_kind,job.callback_ciphertext,job.lease_token;
  end if;
 end loop;
end; $$;
revoke all on function public.claim_garmin_activity_detail_pulls(integer) from public,anon,authenticated,service_role;
grant execute on function public.claim_garmin_activity_detail_pulls(integer) to service_role;

create function public.finish_garmin_activity_detail_pull(p_id uuid,p_lease_token uuid,p_outcome text,p_error_code text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare q public.garmin_activity_detail_pulls%rowtype; c public.garmin_connections%rowtype;
 ctl public.garmin_health_controls%rowtype; s public.garmin_health_sync_state%rowtype;
begin
 if p_id is null or p_lease_token is null or p_outcome is null or p_outcome not in ('complete','retry','reject') or p_error_code is not null and
  p_error_code not in ('network_retryable','provider_retryable','provider_rejected','invalid_callback','invalid_response','response_too_large','storage_retryable','authorization_changed') then
  raise exception 'Invalid Activity pull result.' using errcode='22023'; end if;
 select * into q from public.garmin_activity_detail_pulls where id=p_id for update;
 if not found or q.state<>'processing' or q.lease_token is distinct from p_lease_token or q.lease_until<=clock_timestamp() then return false; end if;
 select * into c from public.garmin_connections where user_id=q.user_id;
 select * into ctl from public.garmin_health_controls where user_id=q.user_id;
 select * into s from public.garmin_health_sync_state where user_id=q.user_id;
 if not found or c.status<>'connected' or c.operation is not null or c.error_code is not null or c.deletion_requested_at is not null
  or c.authorized_at is distinct from q.authorized_at or c.garmin_user_id is distinct from q.garmin_user_id
  or ctl.paused or ctl.generation is distinct from q.sync_generation or s.state='reconciliation_required'
  or not(c.permissions ? 'ACTIVITY_EXPORT') or not(coalesce(s.granted_permissions,c.permissions) ? 'ACTIVITY_EXPORT') then
  update public.garmin_activity_detail_pulls set state='rejected',callback_ciphertext=null,lease_until=null,lease_token=null,
   error_code='authorization_changed',completed_at=clock_timestamp() where id=p_id;
  return false;
 end if;
 if p_outcome='retry' and q.attempts<12 then
  update public.garmin_activity_detail_pulls set state='retry',next_attempt_at=clock_timestamp()+
   make_interval(secs=>least(3600,(15*power(2,least(q.attempts-1,8)))::integer)),lease_until=null,lease_token=null,error_code=p_error_code where id=p_id;
 elsif p_outcome='complete' then
  update public.garmin_activity_detail_pulls set state='completed',callback_ciphertext=null,lease_until=null,lease_token=null,error_code=null,completed_at=clock_timestamp() where id=p_id;
 else
  update public.garmin_activity_detail_pulls set state='rejected',callback_ciphertext=null,lease_until=null,lease_token=null,error_code=coalesce(p_error_code,'provider_rejected'),completed_at=clock_timestamp() where id=p_id;
 end if;
 return true;
end; $$;
revoke all on function public.finish_garmin_activity_detail_pull(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.finish_garmin_activity_detail_pull(uuid,uuid,text,text) to service_role;

revoke all on function private.process_garmin_health_queue_v1(uuid[],integer) from public,anon,authenticated,service_role;
grant execute on function private.process_garmin_health_queue_v1(uuid[],integer) to service_role;

-- Serialize Session HR controls without UPDATE privileges on scoring Sessions.
-- The advisory lock is transaction-scoped; collisions only add serialization.
create function public.set_session_recording_window(p_session uuid,p_action text,p_expected timestamptz,
 p_start timestamptz default null,p_finish timestamptz default null,p_activity text default null) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='2s' as $$
declare w public.session_recording_windows%rowtype; v_user uuid:=(select auth.uid());
begin
 perform 1 from public.sessions where id=p_session and user_id=v_user;
 if not found then raise exception 'Session unavailable' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('arctrack:session-recording:'||p_session::text,0));
 -- A Session may have disappeared while this request waited for another edit.
 perform 1 from public.sessions where id=p_session and user_id=v_user;
 if not found then raise exception 'Session unavailable' using errcode='42501'; end if;
 select * into w from public.session_recording_windows where session_id=p_session;
 if w.updated_at is distinct from p_expected then raise exception 'Session timing changed; refresh first' using errcode='40001'; end if;
 if p_action='start' then
  if w.started_at is not null then raise exception 'Already started' using errcode='22023'; end if;
  w.started_at:=clock_timestamp(); w.finished_at:=null;
 elsif p_action='finish' then
  if w.started_at is null or w.finished_at is not null then raise exception 'Not running' using errcode='22023'; end if;
  w.finished_at:=clock_timestamp();
 elsif p_action='manual' then w.started_at:=p_start; w.finished_at:=p_finish; w.activity_id:=null;
 elsif p_action='unlink' then w.activity_id:=null;
 elsif p_action='link' then
  if w.started_at is null or w.finished_at is null or not public.garmin_hr_owner_access('activity') then
   raise exception 'Confirmed interval and Garmin authorization required' using errcode='42501'; end if;
  if not exists(select 1 from public.garmin_hr_datasets where user_id=v_user and source='activity' and source_id=p_activity
    and to_timestamp(start_seconds)<w.finished_at and to_timestamp(start_seconds+duration_seconds)>w.started_at)
   and not exists(select 1 from public.garmin_health_records where user_id=v_user and kind='activities' and source_id=p_activity
    and to_timestamp(start_seconds)<w.finished_at and to_timestamp(start_seconds+duration_seconds)>w.started_at) then
    raise exception 'Owned overlapping activity required' using errcode='42501'; end if;
  w.activity_id:=p_activity;
 else raise exception 'Invalid timing action' using errcode='22023'; end if;
 if w.started_at not between '2000-01-01'::timestamptz and '2100-01-01'::timestamptz or w.finished_at not between '2000-01-01'::timestamptz and '2100-01-01'::timestamptz then raise exception 'Invalid interval' using errcode='22023'; end if;
 insert into public.session_recording_windows as current_window(session_id,user_id,started_at,finished_at,activity_id,updated_at)
 values(p_session,v_user,w.started_at,w.finished_at,w.activity_id,
  greatest(clock_timestamp(),coalesce(w.updated_at+interval '1 microsecond','-infinity'::timestamptz)))
 on conflict(session_id) do update set started_at=excluded.started_at,finished_at=excluded.finished_at,activity_id=excluded.activity_id,updated_at=excluded.updated_at
 where current_window.updated_at is not distinct from p_expected
 returning * into w;
 if not found then raise exception 'Session timing changed; refresh first' using errcode='40001'; end if;
 return to_jsonb(w)-'user_id';
end; $$;
revoke all on function public.set_session_recording_window(uuid,text,timestamptz,timestamptz,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.set_session_recording_window(uuid,text,timestamptz,timestamptz,timestamptz,text) to authenticated;
-- One snapshot avoids pairing pre-deletion samples with a post-deletion control.
create function public.read_session_garmin_hr(p_session uuid,p_known text default null) returns jsonb
language sql stable security invoker set search_path='' as $$
 with owner as (select id from public.sessions where id=p_session and user_id=(select auth.uid())),
 w as (select * from public.session_recording_windows where session_id=p_session and exists(select 1 from owner)),
 candidates as (
  select source_id,start_seconds,duration_seconds,activity_type,state,sample_count,published from public.garmin_hr_datasets
  where user_id=(select auth.uid()) and source='activity' and exists(select 1 from w where
   to_timestamp(start_seconds)<finished_at and to_timestamp(start_seconds+duration_seconds)>started_at)
  union all
  select r.source_id,r.start_seconds,r.duration_seconds,r.metrics->>'activityType','summary_only',0,false
  from public.garmin_health_records r where r.user_id=(select auth.uid()) and r.kind='activities'
   and public.garmin_hr_owner_access('activity') and not exists(select 1 from public.garmin_hr_datasets d where d.source='activity' and d.source_id=r.source_id)
   and exists(select 1 from w where to_timestamp(r.start_seconds)<finished_at and to_timestamp(r.start_seconds+r.duration_seconds)>started_at)
 ), chosen as (
  select d.* from public.garmin_hr_datasets d,w where d.published and d.user_id=(select auth.uid())
   and to_timestamp(d.start_seconds)<w.finished_at and to_timestamp(d.start_seconds+d.duration_seconds)>w.started_at
   and ((d.source='activity' and d.source_id=w.activity_id and exists(select 1 from public.garmin_hr_chunks hc,lateral jsonb_array_elements(hc.samples) hs where hc.dataset_id=d.id and hs->>1 is not null)) or (d.source='daily' and not exists(
    select 1 from public.garmin_hr_datasets a where a.source='activity' and a.source_id=w.activity_id and a.published and exists(select 1 from public.garmin_hr_chunks hc,lateral jsonb_array_elements(hc.samples) hs where hc.dataset_id=a.id and hs->>1 is not null))))
  order by d.source,d.start_seconds limit 8
 ), stamp as (select md5(coalesce((select to_jsonb(w)::text from w),'')||
  coalesce((select jsonb_agg(c order by source_id,state)::text from candidates c),'')||
  coalesce((select jsonb_agg(d.id order by d.id)::text from chosen d),'')||public.garmin_health_owner_access()::text||coalesce((select state||coalesce(error_code,'') from public.garmin_health_sync_state where user_id=(select auth.uid())), '')||coalesce((select generation::text||paused::text from public.garmin_health_controls where user_id=(select auth.uid())),'')) as value)
 select case when exists(select 1 from owner) then jsonb_build_object(
 'revision',(select value from stamp),'unchanged',coalesce(p_known=(select value from stamp),false),
 'window',(select to_jsonb(w)-'user_id' from w),
 'authorized',public.garmin_health_owner_access(),
 'sync',(select jsonb_build_object('state',state,'error',error_code) from public.garmin_health_sync_state where user_id=(select auth.uid())),
 'paused',(select paused from public.garmin_health_controls where user_id=(select auth.uid())),
 'candidates',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from (select * from candidates order by start_seconds desc limit 25) c),
 'datasets',case when p_known=(select value from stamp) then null else (select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'source',d.source,'sourceId',d.source_id,
  'start',d.start_seconds,'duration',d.duration_seconds,'samples',(select coalesce(jsonb_agg(j.value order by (j.value->>0)::bigint),'[]')
   from public.garmin_hr_chunks c,lateral jsonb_array_elements(c.samples) j,w where c.dataset_id=d.id
    and (j.value->>0)::bigint between extract(epoch from w.started_at)-case when d.source='activity' then 60 else 15 end and extract(epoch from w.finished_at)))),'[]') from chosen d) end)
 else null end;
$$;
revoke all on function public.read_session_garmin_hr(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.read_session_garmin_hr(uuid,text) to authenticated;

commit;
