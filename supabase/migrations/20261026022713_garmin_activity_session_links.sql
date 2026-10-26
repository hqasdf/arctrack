-- LOCAL ONLY: coordinated application release required. No scoring rows or HR samples change.
-- Preserve legacy timestamps as restricted historical evidence; never use them for HR discovery.
create table public.session_garmin_activity_links (
 session_id uuid primary key references public.sessions(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 activity_id text check(length(activity_id) between 1 and 180),
 generation uuid,
 updated_at timestamptz not null default clock_timestamp()
);
create index session_garmin_activity_links_owner on public.session_garmin_activity_links(user_id);
alter table public.session_garmin_activity_links enable row level security;
revoke all on public.session_garmin_activity_links from public,anon,authenticated,service_role;
grant select on public.session_garmin_activity_links to authenticated;
grant select,insert,update,delete on public.session_garmin_activity_links to service_role;
create policy session_garmin_activity_owner on public.session_garmin_activity_links for select to authenticated
 using(user_id=(select auth.uid()) and exists(select 1 from public.sessions s where s.id=session_id and s.user_id=(select auth.uid())));
insert into public.session_garmin_activity_links(session_id,user_id,activity_id,generation,updated_at)
 select w.session_id,w.user_id,w.activity_id,c.generation,w.updated_at
 from public.session_recording_windows w left join public.garmin_health_controls c on c.user_id=w.user_id
 where w.activity_id is not null;

-- Date discovery includes recordings spanning midnight in Singapore, plus an existing explicit link.
-- Each source is restricted to auth.uid() even when called from the narrowly privileged writer below.
create function public.session_garmin_activity_candidates(p_session uuid)
returns table(source_id text,start_seconds bigint,duration_seconds integer,activity_type text,state text,sample_count integer,published boolean)
language sql stable security invoker set search_path='' as $$
 with owner as (select id,session_date from public.sessions where id=p_session and user_id=(select auth.uid())),
 linked as (select activity_id from public.session_garmin_activity_links where session_id=p_session and user_id=(select auth.uid())),
 raw as (
  select d.source_id,d.start_seconds,d.duration_seconds,d.activity_type,d.state,d.sample_count,d.published,0 as priority,d.imported_at as changed
  from public.garmin_hr_datasets d where d.user_id=(select auth.uid()) and d.source='activity'
  union all
  select r.source_id,r.start_seconds,r.duration_seconds,r.metrics->>'activityType','summary_only',0,false,1,r.updated_at
  from public.garmin_health_records r where r.user_id=(select auth.uid()) and r.kind='activities'
 ), eligible as (
  select r.* from raw r,owner o where public.garmin_hr_owner_access('activity')
   and (r.source_id=(select activity_id from linked) or
    (to_timestamp(r.start_seconds)<((o.session_date+1)::timestamp at time zone 'Asia/Singapore')
     and to_timestamp(r.start_seconds+greatest(r.duration_seconds,1))>(o.session_date::timestamp at time zone 'Asia/Singapore')))
 ), canonical as (
  select distinct on(source_id) * from eligible order by source_id,priority,published desc,changed desc,start_seconds,duration_seconds
 ) select source_id,start_seconds,duration_seconds,activity_type,state,sample_count,published from canonical
 order by (source_id=(select activity_id from linked)) desc nulls last,start_seconds desc,source_id limit 50;
$$;
revoke all on function public.session_garmin_activity_candidates(uuid) from public,anon,authenticated,service_role;
grant execute on function public.session_garmin_activity_candidates(uuid) to authenticated;

-- Definer is necessary ONLY to serialize against credential-bearing connection/control rows,
-- without granting clients credential SELECT, scoring UPDATE or direct association writes.
-- Caller and Session ownership are verified before and after waiting. No credentials are returned.
create function public.set_session_garmin_activity(p_session uuid,p_activity text,p_expected timestamptz)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare v_user uuid:=(select auth.uid()); existing public.session_garmin_activity_links%rowtype;
 current_generation uuid;
begin
 if v_user is null or not exists(select 1 from public.sessions where id=p_session and user_id=v_user) then
  raise exception 'Session unavailable' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('arctrack:session-activity:'||p_session::text,0));
 -- Same lock order as ingestion, permission changes and deletion: connection, controls, link.
 perform 1 from public.garmin_connections where user_id=v_user for update;
 select generation into current_generation from public.garmin_health_controls where user_id=v_user for update;
 if not exists(select 1 from public.sessions where id=p_session and user_id=v_user) then
  raise exception 'Session unavailable' using errcode='42501'; end if;
 select * into existing from public.session_garmin_activity_links where session_id=p_session for update;
 if existing.updated_at is distinct from p_expected then raise exception 'Activity link changed; refresh first' using errcode='40001'; end if;
 if p_activity is not null then
  if length(p_activity) not between 1 and 180 or current_generation is null
   or not public.garmin_hr_owner_access('activity')
   or not exists(select 1 from public.session_garmin_activity_candidates(p_session) where source_id=p_activity) then
   raise exception 'An authorized owned Garmin activity is required' using errcode='42501'; end if;
 end if;
 insert into public.session_garmin_activity_links as current_link(session_id,user_id,activity_id,generation,updated_at)
 values(p_session,v_user,p_activity,current_generation,greatest(clock_timestamp(),coalesce(existing.updated_at+interval '1 microsecond','-infinity'::timestamptz)))
 on conflict(session_id) do update set activity_id=excluded.activity_id,generation=excluded.generation,updated_at=excluded.updated_at
 where current_link.updated_at is not distinct from p_expected returning * into existing;
 if not found then raise exception 'Activity link changed; refresh first' using errcode='40001'; end if;
 return to_jsonb(existing)-'user_id'-'generation';
end; $$;
revoke all on function public.set_session_garmin_activity(uuid,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.set_session_garmin_activity(uuid,text,timestamptz) to authenticated;

create function public.read_session_garmin_activity(p_session uuid,p_known text default null) returns jsonb
language sql stable security invoker set search_path='' as $$
 with owner as (select id from public.sessions where id=p_session and user_id=(select auth.uid())),
 link as (select l.* from public.session_garmin_activity_links l where session_id=p_session and user_id=(select auth.uid()) and exists(select 1 from owner)),
 candidates as (select * from public.session_garmin_activity_candidates(p_session)),
 recording as (select c.* from candidates c,link l where c.source_id=l.activity_id and
  l.generation=(select generation from public.garmin_health_controls where user_id=(select auth.uid()))),
 chosen as (
  select d.* from public.garmin_hr_datasets d,recording r where d.user_id=(select auth.uid()) and d.published
   and to_timestamp(d.start_seconds)<to_timestamp(r.start_seconds+r.duration_seconds)
   and to_timestamp(d.start_seconds+d.duration_seconds)>to_timestamp(r.start_seconds)
   and ((d.source='activity' and d.source_id=r.source_id and exists(select 1 from public.garmin_hr_chunks c,lateral jsonb_array_elements(c.samples) s where c.dataset_id=d.id and s->>1 is not null))
    or (d.source='daily' and not exists(select 1 from public.garmin_hr_datasets a where a.user_id=(select auth.uid()) and a.source='activity' and a.source_id=r.source_id and a.published
     and exists(select 1 from public.garmin_hr_chunks c,lateral jsonb_array_elements(c.samples) s where c.dataset_id=a.id and s->>1 is not null))))
   order by d.source,d.start_seconds,d.id limit 8
 ), stamp as (select md5(coalesce((select to_jsonb(link)::text from link),'')||
  coalesce((select jsonb_agg(c order by source_id)::text from candidates c),'')||
  coalesce((select jsonb_agg(d.id order by d.id)::text from chosen d),'')||public.garmin_hr_owner_access('activity')::text||
  coalesce((select state||coalesce(error_code,'') from public.garmin_health_sync_state where user_id=(select auth.uid())),'')||
  coalesce((select generation::text||paused::text from public.garmin_health_controls where user_id=(select auth.uid())),'')) as value)
 select case when exists(select 1 from owner) then jsonb_build_object(
  'revision',(select value from stamp),'unchanged',coalesce(p_known=(select value from stamp),false),
  'link',(select to_jsonb(link)-'user_id'-'generation' from link),
  'recording',(select to_jsonb(recording) from recording),'authorized',public.garmin_hr_owner_access('activity'),
  'sync',(select jsonb_build_object('state',state,'error',error_code) from public.garmin_health_sync_state where user_id=(select auth.uid())),
  'paused',(select paused from public.garmin_health_controls where user_id=(select auth.uid())),
  'candidates',(select coalesce(jsonb_agg(c order by start_seconds desc),'[]') from candidates c),
  'datasets',case when p_known=(select value from stamp) then null else
   (select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'source',d.source,'sourceId',d.source_id,'start',d.start_seconds,'duration',d.duration_seconds,
    'samples',(select coalesce(jsonb_agg(j.value order by (j.value->>0)::bigint),'[]') from public.garmin_hr_chunks c,lateral jsonb_array_elements(c.samples) j,recording r
     where c.dataset_id=d.id and (j.value->>0)::bigint between r.start_seconds-case when d.source='activity' then 60 else 15 end and r.start_seconds+r.duration_seconds))),'[]') from chosen d) end)
 else null end;
$$;
revoke all on function public.read_session_garmin_activity(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.read_session_garmin_activity(uuid,text) to authenticated;

-- Replace only the two existing lifecycle consumers of the retired table.
create or replace function private.cleanup_garmin_hr_controls() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.generation is distinct from old.generation or new.paused then delete from public.garmin_activity_detail_pulls where user_id=new.user_id; end if;
 if new.deleted_at is distinct from old.deleted_at then
  delete from public.garmin_hr_datasets where user_id=new.user_id;
  delete from public.session_garmin_activity_links where user_id=new.user_id;
  update private.retired_session_recording_windows set activity_id=null where user_id=new.user_id;
 elsif new.generation<>old.generation then delete from public.garmin_hr_datasets where user_id=new.user_id and not published; end if;
 return new;
end; $$;
create or replace function private.cleanup_garmin_hr_connection() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.status is distinct from old.status and new.status<>'connected' then delete from public.garmin_activity_detail_pulls where user_id=new.user_id; end if;
 if new.status='disconnected' or new.garmin_user_id is distinct from old.garmin_user_id or new.authorized_at is distinct from old.authorized_at then
  delete from public.garmin_hr_datasets where user_id=new.user_id;
  delete from public.session_garmin_activity_links where user_id=new.user_id;
  update private.retired_session_recording_windows set activity_id=null where user_id=new.user_id;
 else
  if new.permissions is distinct from old.permissions and not(new.permissions ? 'ACTIVITY_EXPORT') then delete from public.garmin_activity_detail_pulls where user_id=new.user_id; end if;
  delete from public.garmin_hr_datasets where user_id=new.user_id and ((source='activity' and not(new.permissions ? 'ACTIVITY_EXPORT')) or (source='daily' and not(new.permissions ? 'HEALTH_EXPORT')));
 end if; return new;
end; $$;

-- No timer implementation remains exposed. Historical data is NOT deleted.
drop function public.set_session_recording_window(uuid,text,timestamptz,timestamptz,timestamptz,text);
drop function public.read_session_garmin_hr(uuid,text);
revoke all on public.session_recording_windows from public,anon,authenticated,service_role;
drop policy session_recording_owner on public.session_recording_windows;
alter table public.session_recording_windows set schema private;
alter table private.session_recording_windows rename to retired_session_recording_windows;
comment on table private.retired_session_recording_windows is 'Restricted historical timing archive. Not an application dependency. Destructive removal requires separate authorization.';

-- Preserve the previous cleanup behavior for imported IDs in the archive, without exposing timestamps.
grant select(user_id),update(activity_id) on private.retired_session_recording_windows to service_role;
