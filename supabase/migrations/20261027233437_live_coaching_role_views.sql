-- Role-specific reads and independent invitation acceptance.
-- No data backfill or scoring/RLS policy changes.

create or replace function private.live_coaching_command(p_action text,p_id uuid,p_org uuid,p_title text,p_date date,p_athletes uuid[],p_scoring uuid,p_expected bigint)
returns uuid language plpgsql security definer set search_path='' set lock_timeout='3s' as $$
declare actor uuid:=(select auth.uid()); l public.live_coaching_sessions%rowtype; target uuid; coach boolean;
begin
 if actor is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_action='create' then
  perform 1 from public.organization_members where organization_id=p_org and user_id=actor and role='head_coach' and status='active' for share;
  if not found then raise exception 'Coach access required' using errcode='42501';end if;
  if p_athletes is null or cardinality(p_athletes) not between 1 and 32 or cardinality(p_athletes)<>(select count(distinct x) from unnest(p_athletes)x) or p_date is null then raise exception 'Choose 1 to 32 eligible athletes and a date';end if;
  perform 1 from public.organization_members where organization_id=p_org and user_id=any(p_athletes) and role='archer' and status='active' order by user_id for share;
  if (select count(*) from public.organization_members where organization_id=p_org and user_id=any(p_athletes) and role='archer' and status='active')<>cardinality(p_athletes) then raise exception 'Athlete unavailable' using errcode='42501';end if;
  insert into public.live_coaching_sessions(organization_id,created_by,title,training_date) values(p_org,actor,btrim(p_title),p_date) returning * into l;
  insert into public.live_coaching_participants(live_id,athlete_id) select l.id,x from unnest(p_athletes)x;
 else
  select * into l from public.live_coaching_sessions where id=p_id for update;
  if not found then raise exception 'Live session unavailable' using errcode='42501';end if;
  perform 1 from public.organization_members where organization_id=l.organization_id and user_id=actor and status='active' for share;
  if not found or not private.live_coaching_access(l.id) then raise exception 'Live access revoked' using errcode='42501';end if;
  coach:=l.created_by=actor;
  if l.version is distinct from p_expected then raise exception 'Live session changed; reload' using errcode='40001';end if;
  if p_action in ('waiting','start','complete','cancel') then
   if not coach then raise exception 'Coach required' using errcode='42501';end if;
   if p_action='waiting' and l.state='created' then l.state:='waiting';
   elsif p_action='start' and l.state='waiting' and exists(select 1 from public.live_coaching_participants where live_id=l.id and state='joined') then l.state:='active';
   elsif p_action='complete' and l.state='active' then l.state:='completed';
   elsif p_action='cancel' and l.state in ('created','waiting','active') then l.state:='cancelled';
   else raise exception 'Invalid lifecycle transition';end if;
  elsif p_action in ('join','decline','leave','link') then
   if coach or l.state not in ('waiting','active') then raise exception 'Participation unavailable' using errcode='42501';end if;
   if p_action='join' and p_scoring is null then
    if not exists(select 1 from public.live_coaching_participants where live_id=l.id and athlete_id=actor and state in ('invited','declined','left')) then raise exception 'Current invitation required' using errcode='42501';end if;
    update public.live_coaching_participants set state='joined',scoring_session_id=null,updated_at=clock_timestamp() where live_id=l.id and athlete_id=actor;
   elsif p_action in ('join','link') then
    if p_action='join' and not exists(select 1 from public.live_coaching_participants where live_id=l.id and athlete_id=actor and state in ('invited','declined','left')) then raise exception 'Current invitation required' using errcode='42501';end if;
    if p_action='link' and not exists(select 1 from public.live_coaching_participants where live_id=l.id and athlete_id=actor and state='joined') then raise exception 'Join first';end if;
    perform pg_advisory_xact_lock(hashtextextended('live-scoring:'||p_scoring::text,0));
    perform 1 from public.sessions where id=p_scoring and user_id=actor and session_type='training' and session_date=l.training_date for share;
    if not found then raise exception 'Select your own training Session on this date' using errcode='42501';end if;
    if exists(select 1 from public.live_coaching_participants p join public.live_coaching_sessions c on c.id=p.live_id where p.scoring_session_id=p_scoring and p.live_id<>l.id and p.state='joined' and c.state in ('waiting','active')) then raise exception 'Session already linked to another live training';end if;
    update public.live_coaching_participants set state='joined',scoring_session_id=p_scoring,updated_at=clock_timestamp() where live_id=l.id and athlete_id=actor;
   else
    update public.live_coaching_participants set state=case when p_action='decline' then 'declined' else 'left' end,scoring_session_id=null,updated_at=clock_timestamp() where live_id=l.id and athlete_id=actor;
   end if;
  else raise exception 'Unknown Live Coaching action';end if;
  update public.live_coaching_sessions set state=l.state,version=version+1,updated_at=clock_timestamp() where id=l.id;
 end if;
 perform private.emit_live_coaching(l.id);return l.id;
end;$$;

create or replace function private.read_live_coaching(p_id uuid,p_org uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); l public.live_coaching_sessions%rowtype; is_coach boolean;
begin
 if actor is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_org is not null and not exists(select 1 from public.organization_members where organization_id=p_org and user_id=actor and role='head_coach' and status='active') then raise exception 'Coach context required' using errcode='42501';end if;
 if p_id is null then
  return jsonb_build_object('sessions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select c.*,o.name organization_name from public.live_coaching_sessions c join public.organizations o on o.id=c.organization_id where ((p_org is not null and c.organization_id=p_org) or (p_org is null and c.created_by<>actor)) and private.live_coaching_access(c.id) order by c.created_at desc limit 100)x),
   'roster',(select coalesce(jsonb_agg(jsonb_build_object('userId',m.user_id,'displayName',coalesce(p.display_name,'Archer'))),'[]') from public.organization_members m left join public.profiles p on p.id=m.user_id where m.organization_id=p_org and m.status='active' and m.role='archer' and exists(select 1 from public.organization_members coach where coach.organization_id=p_org and coach.user_id=actor and coach.role='head_coach' and coach.status='active')));
 end if;
 if not private.live_coaching_access(p_id) then raise exception 'Live access revoked' using errcode='42501';end if;
 select * into l from public.live_coaching_sessions where id=p_id;
 if (p_org is not null and (l.organization_id<>p_org or l.created_by<>actor)) or (p_org is null and l.created_by=actor) then raise exception 'Use the authorised organisation coach context' using errcode='42501';end if;
 is_coach:=p_org is not null and l.created_by=actor;
 return jsonb_build_object('session',to_jsonb(l),'organizationName',(select name from public.organizations where id=l.organization_id),'coach',is_coach,'viewerId',actor,
 'eligibleSessions',(select coalesce(jsonb_agg(x),'[]') from (select id,title,session_date from public.sessions where user_id=actor and session_type='training' and session_date=l.training_date order by created_at desc limit 100)x),
 'participants',(select coalesce(jsonb_agg(jsonb_build_object('athleteId',p.athlete_id,'displayName',coalesce(profile.display_name,'Archer'),'state',p.state,'scoringSessionId',case when p.state='joined' then p.scoring_session_id else null end,
  'scoring',case when p.state='joined' then (select jsonb_build_object('id',s.id,'title',s.title,'session_date',s.session_date,'session_type',s.session_type,'arrow_count',s.arrow_count,'created_at',s.created_at,
   'session_rounds',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'round_number',r.round_number,'name',r.name,'division',r.division,'distance_metres',r.distance_metres,'face_diameter_cm',r.face_diameter_cm,'face_type',r.face_type,'planned_ends',r.planned_ends,'arrows_per_end',r.arrows_per_end,
    'session_ends',(select coalesce(jsonb_agg(jsonb_build_object('end_number',e.end_number,'arrows',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'arrow_number',a.arrow_number,'score_points',a.score_points,'is_x',a.is_x,'plot_x',null,'plot_y',null,'face_index',null)),'[]') from public.arrows a where a.session_end_id=e.id)) order by e.end_number),'[]') from public.session_ends e where e.session_round_id=r.id)) order by r.round_number),'[]') from public.session_rounds r where r.session_id=s.id)) from public.sessions s where s.id=p.scoring_session_id and s.user_id=p.athlete_id) else null end)),'[]')
  from public.live_coaching_participants p join public.organization_members m on m.organization_id=l.organization_id and m.user_id=p.athlete_id and m.status='active' and m.role='archer' left join public.profiles profile on profile.id=p.athlete_id
  where p.live_id=l.id and (is_coach or p.athlete_id=actor)));
end;$$;

create or replace function private.live_hr_snapshot(p_live uuid,p_window integer,p_history boolean,p_before timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.live_coaching_sessions%rowtype; actor uuid:=(select auth.uid()); timeline jsonb:=null; upper_time timestamptz;
begin
 if not private.live_coaching_access(p_live) then raise exception 'Access denied' using errcode='42501';end if;
 if p_window is null or p_window not in (60,300,900,1800,10800,86400) then raise exception 'Invalid interval' using errcode='22023';end if;
 select * into l from public.live_coaching_sessions where id=p_live;upper_time:=coalesce(l.ended_at,clock_timestamp());
 if p_before is not null then
  if p_before>upper_time or p_before<clock_timestamp()-interval '24 hours' then raise exception 'Invalid history boundary' using errcode='22023';end if;
  upper_time:=p_before;
 end if;
 if p_history then
  with eligible as (
   select s.* from public.live_coaching_hr_samples s join public.live_coaching_hr h using(live_id,athlete_id)
   join public.organization_members m on m.organization_id=l.organization_id and m.user_id=s.athlete_id and m.role='archer' and m.status='active'
   where s.live_id=p_live and h.consent and h.history_consent and s.expires_at>clock_timestamp() and s.received_at between upper_time-make_interval(secs=>p_window) and upper_time
   and(actor=l.created_by or s.athlete_id=actor)
  ), lagged as (
   select *,lag(received_at) over w prev_time,lag(generation) over w prev_gen from eligible window w as(partition by athlete_id order by received_at)
  ), segmented as (
   select *,sum(case when prev_time is null or received_at-prev_time>interval '3 seconds' or generation is distinct from prev_gen then 1 else 0 end) over(partition by athlete_id order by received_at) segment from lagged
  ), bucketed as (
   select *,row_number() over w first_rank,row_number() over(partition by athlete_id,floor(extract(epoch from received_at)/greatest(1,p_window/180)) order by received_at desc) last_rank,
    row_number() over(partition by athlete_id,floor(extract(epoch from received_at)/greatest(1,p_window/180)) order by bpm,received_at) low_rank,
    row_number() over(partition by athlete_id,floor(extract(epoch from received_at)/greatest(1,p_window/180)) order by bpm desc,received_at) high_rank
   from segmented window w as(partition by athlete_id,floor(extract(epoch from received_at)/greatest(1,p_window/180)) order by received_at)
  ), bounded as materialized (
   select * from bucketed where first_rank=1 or last_rank=1 or low_rank=1 or high_rank=1
  ), stats as (
   select athlete_id,count(*) count,min(bpm) minimum,max(bpm) maximum,round(avg(bpm),1) average from eligible group by athlete_id
  ) select coalesce(jsonb_agg(jsonb_build_object('athleteId',t.athlete_id,'count',t.count,'minimum',t.minimum,'maximum',t.maximum,'average',t.average,
   'points',(select coalesce(jsonb_agg(jsonb_build_object('at',b.received_at,'observedAt',b.observed_at,'bpm',b.bpm,'segment',b.segment) order by b.received_at),'[]') from bounded b where b.athlete_id=t.athlete_id))),'[]') into timeline from stats t;
 end if;
 return jsonb_build_object('history',timeline,'readings',(select coalesce(jsonb_agg(jsonb_build_object('athleteId',p.athlete_id,'consent',coalesce(h.consent,false),'generation',h.generation,'sourceId',h.source_id,
  'historyConsent',coalesce(h.history_consent,false),'historyVersion',coalesce(h.history_version,0),
  'bpm',case when l.state='active' and h.consent and h.received_at>clock_timestamp()-interval '10 seconds' then h.bpm else null end,'receivedAt',h.received_at,
  'lastSeenAt',p.last_seen_at)),'[]') from public.live_coaching_participants p join public.organization_members m on m.organization_id=l.organization_id and m.user_id=p.athlete_id and m.status='active' and m.role='archer' left join public.live_coaching_hr h on h.live_id=p.live_id and h.athlete_id=p.athlete_id where p.live_id=p_live and p.state='joined' and(actor=l.created_by or p.athlete_id=actor)),
  'endActivity',(select coalesce(jsonb_agg(jsonb_build_object('athleteId',a.athlete_id,'roundId',a.round_id,'end',a.end_number,'changedAt',a.last_changed_at,'confirmedAt',a.confirmed_at)),'[]') from public.live_coaching_end_activity a join public.organization_members m on m.organization_id=l.organization_id and m.user_id=a.athlete_id and m.status='active' and m.role='archer' where a.live_id=p_live and exists(select 1 from public.live_coaching_participants p join public.session_rounds r on r.session_id=p.scoring_session_id where p.live_id=a.live_id and p.athlete_id=a.athlete_id and p.state='joined' and r.id=a.round_id) and(actor=l.created_by or a.athlete_id=actor)));
end;$$;
revoke all on function private.live_hr_snapshot(uuid,integer,boolean,timestamptz) from public,anon,authenticated,service_role;

create or replace function private.read_live_monitor(p_live uuid,p_window integer,p_history boolean,p_before timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());
begin
 if actor is null or not exists(select 1 from public.live_coaching_sessions l join public.organization_members m on m.organization_id=l.organization_id and m.user_id=actor and m.status='active' where l.id=p_live and l.created_by=actor and m.role='head_coach') then raise exception 'Live role access denied' using errcode='42501';end if;
 return private.live_hr_snapshot(p_live,p_window,p_history,p_before);
end;$$;
revoke all on function private.read_live_monitor(uuid,integer,boolean,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.read_live_monitor(uuid,integer,boolean,timestamptz) to authenticated;

create or replace function private.read_live_athlete_hr(p_live uuid,p_window integer,p_history boolean,p_before timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());
begin
 if actor is null or not exists(select 1 from public.live_coaching_sessions l join public.organization_members m on m.organization_id=l.organization_id and m.user_id=actor and m.status='active' where l.id=p_live and l.created_by<>actor and m.role='archer' and exists(select 1 from public.live_coaching_participants p where p.live_id=l.id and p.athlete_id=actor and p.state='joined')) then raise exception 'Live role access denied' using errcode='42501';end if;
 return private.live_hr_snapshot(p_live,p_window,p_history,p_before);
end;$$;
revoke all on function private.read_live_athlete_hr(uuid,integer,boolean,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.read_live_athlete_hr(uuid,integer,boolean,timestamptz) to authenticated;
create function public.read_live_athlete_hr(p_live uuid,p_window integer default 900,p_history boolean default false,p_before timestamptz default null) returns jsonb language sql security invoker set search_path='' as $$select private.read_live_athlete_hr(p_live,p_window,p_history,p_before)$$;
revoke all on function public.read_live_athlete_hr(uuid,integer,boolean,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.read_live_athlete_hr(uuid,integer,boolean,timestamptz) to authenticated;

-- Lightweight role-aware access probe for EventSource; never serializes scoring or HR.
create function private.live_coaching_view_access(p_id uuid,p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.live_coaching_access(p_id) and exists(select 1 from public.live_coaching_sessions l where l.id=p_id and
 ((p_org is not null and l.organization_id=p_org and l.created_by=(select auth.uid())) or (p_org is null and l.created_by<>(select auth.uid()))));
$$;
revoke all on function private.live_coaching_view_access(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.live_coaching_view_access(uuid,uuid) to authenticated;
create function public.live_coaching_view_access(p_id uuid,p_org uuid default null) returns boolean language sql stable security invoker set search_path='' as $$select private.live_coaching_view_access(p_id,p_org)$$;
revoke all on function public.live_coaching_view_access(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.live_coaching_view_access(uuid,uuid) to authenticated;
