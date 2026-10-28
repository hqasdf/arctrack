-- Read-only target coordinates through the existing joined/linked athlete boundary.
-- Preserves the exact organisation, membership, ownership and execution checks.
-- No new objects, grants, policies or scoring writes. Existing function ACL is retained.
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
    'session_ends',(select coalesce(jsonb_agg(jsonb_build_object('end_number',e.end_number,'arrows',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'arrow_number',a.arrow_number,'score_points',a.score_points,'is_x',a.is_x,'plot_x',a.plot_x,'plot_y',a.plot_y,'face_index',a.face_index)),'[]') from public.arrows a where a.session_end_id=e.id)) order by e.end_number),'[]') from public.session_ends e where e.session_round_id=r.id)) order by r.round_number),'[]') from public.session_rounds r where r.session_id=s.id)) from public.sessions s where s.id=p.scoring_session_id and s.user_id=p.athlete_id) else null end)),'[]')
  from public.live_coaching_participants p join public.organization_members m on m.organization_id=l.organization_id and m.user_id=p.athlete_id and m.status='active' and m.role='archer' left join public.profiles profile on profile.id=p.athlete_id
  where p.live_id=l.id and (is_coach or p.athlete_id=actor)));
end;$$;

