-- Additive, owner-authorized keyset discovery. Legacy clients retain their RPC.
create function public.session_garmin_archery_candidates_v2(
 p_session uuid, p_after_start bigint default null, p_after_id text default null)
returns table(source_id text,start_seconds bigint,duration_seconds integer,activity_type text,state text,sample_count integer,published boolean)
language sql stable security invoker set search_path='' as $$
 with owner as (
  select extract(epoch from (session_date::timestamp at time zone 'Asia/Singapore'))::bigint as lower_bound,
   extract(epoch from ((session_date+1)::timestamp at time zone 'Asia/Singapore'))::bigint as upper_bound
  from public.sessions where id=p_session and user_id=(select auth.uid())
   and public.garmin_hr_owner_access('activity')
 ), raw as (
  select d.source_id,d.start_seconds,d.duration_seconds,d.activity_type,d.state,d.sample_count,d.published,0 as priority,d.imported_at as changed
  from public.garmin_hr_datasets d,owner o
  where d.user_id=(select auth.uid()) and d.source='activity' and d.start_seconds>=o.lower_bound and d.start_seconds<o.upper_bound
  union all
  select r.source_id,r.start_seconds,r.duration_seconds,r.metrics->>'activityType','summary_only',0,false,1,r.updated_at
  from public.garmin_health_records r,owner o
  where r.user_id=(select auth.uid()) and r.kind='activities' and r.start_seconds>=o.lower_bound and r.start_seconds<o.upper_bound
 ), canonical as (
  select distinct on(source_id) * from raw order by source_id,priority,published desc,changed desc,start_seconds,duration_seconds
 ) select c.source_id,c.start_seconds,c.duration_seconds,c.activity_type,c.state,c.sample_count,c.published
 from canonical c where upper(btrim(c.activity_type))='ARCHERY'
  and ((p_after_start is null and p_after_id is null) or (p_after_start is not null and p_after_id is not null and (c.start_seconds,c.source_id)>(p_after_start,p_after_id)))
 order by c.start_seconds,c.source_id limit 200;
$$;
revoke all on function public.session_garmin_archery_candidates_v2(uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.session_garmin_archery_candidates_v2(uuid,bigint,text) to authenticated;
