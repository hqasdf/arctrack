-- One STABLE statement snapshot for history, nested scoring and authorization.
-- Scalar JSON avoids PostgREST's row cap. Explicit budgets reject, never truncate.
-- Existing RPCs, tables, RLS and write permissions remain unchanged.
create function public.read_complete_session_history_v1(
 p_actor uuid, p_owner uuid default null, p_organization uuid default null,
 p_session uuid default null, p_type text default null, p_details boolean default true)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare owners uuid[]; result jsonb; session_count integer;
begin
 if p_actor is null or p_actor is distinct from (select auth.uid()) then
  raise exception 'Session history authorization changed' using errcode='42501';
 end if;
 if p_details is null or (p_type is not null and p_type not in ('training','competition')) then
  raise exception 'Invalid history request' using errcode='22023';
 end if;
 if p_organization is null then
  if p_owner is not null and p_owner<>p_actor then raise exception 'Session history unavailable' using errcode='42501'; end if;
  owners:=array[p_actor];
 else
  -- Existing STABLE, explicitly authorized roster helper; no new definer access.
  select coalesce(array_agg(r.user_id),'{}'::uuid[]) into owners from public.read_coach_athlete_roster(p_organization) r;
  if p_owner is not null then
   if not p_owner=any(owners) then raise exception 'Athlete history unavailable' using errcode='42501'; end if;
   owners:=array[p_owner];
  end if;
 end if;
 -- Reject an oversize Session set before constructing its nested JSON. All
 -- SELECTs in this STABLE function use the calling statement's same snapshot.
 select count(*) into session_count from (
  select id from public.sessions where user_id=any(owners) and (p_session is null or id=p_session) and (p_type is null or session_type=p_type) limit 10001
 ) bounded;
 if session_count>10000 then raise exception 'Complete Session history exceeds the safe read budget; no partial history returned' using errcode='54000'; end if;
 with sessions as materialized (
  select id,user_id,title,session_date,session_type,arrow_count,created_at
  from public.sessions where user_id=any(owners) and (p_session is null or id=p_session) and (p_type is null or session_type=p_type)
  order by session_date desc,created_at desc,id desc limit 10001
 ), rounds as materialized (
  select r.* from public.session_rounds r join sessions s on s.id=r.session_id where p_details limit 100001
 ), ends as materialized (
  select e.* from public.session_ends e join rounds r on r.id=e.session_round_id limit 500001
 ), arrows as materialized (
  select a.* from public.arrows a join ends e on e.id=a.session_end_id limit 1000001
 ), arrow_groups as (
  select session_end_id,jsonb_agg(jsonb_build_object('id',id,'arrow_number',arrow_number,'score_points',score_points,'is_x',is_x,
   'plot_x',plot_x,'plot_y',plot_y,'face_index',face_index) order by arrow_number,id) items from arrows group by session_end_id
 ), end_groups as (
  select e.session_round_id,jsonb_agg(jsonb_build_object('id',e.id,'end_number',e.end_number,'arrows',coalesce(a.items,'[]'::jsonb)) order by e.end_number,e.id) items
  from ends e left join arrow_groups a on a.session_end_id=e.id group by e.session_round_id
 ), round_groups as (
  select r.session_id,jsonb_agg(jsonb_build_object('id',r.id,'round_number',r.round_number,'name',r.name,'division',r.division,
   'distance_metres',r.distance_metres,'face_diameter_cm',r.face_diameter_cm,'face_type',r.face_type,'planned_ends',r.planned_ends,
   'arrows_per_end',r.arrows_per_end,'session_ends',coalesce(e.items,'[]'::jsonb)) order by r.round_number,r.id) items
  from rounds r left join end_groups e on e.session_round_id=r.id group by r.session_id
 ) select jsonb_build_object('version',1,'complete',true,'details',p_details,'owners',to_jsonb(owners),
  'counts',jsonb_build_object('sessions',(select count(*) from sessions),'rounds',(select count(*) from rounds),'ends',(select count(*) from ends),'arrows',(select count(*) from arrows)),
  'items',coalesce(jsonb_agg(to_jsonb(s)||case when p_details then jsonb_build_object('session_rounds',coalesce(r.items,'[]'::jsonb)) else '{}'::jsonb end
   order by s.session_date desc,s.created_at desc,s.id desc),'[]'::jsonb)) into result
 from sessions s left join round_groups r on r.session_id=s.id;
 if (result#>>'{counts,sessions}')::integer>10000 or (result#>>'{counts,rounds}')::integer>100000
  or (result#>>'{counts,ends}')::integer>500000 or (result#>>'{counts,arrows}')::integer>1000000
  or octet_length(result::text)>67108864 then
  raise exception 'Complete Session history exceeds the safe read budget; no partial history returned' using errcode='54000';
 end if;
 return result;
end;$$;
revoke all on function public.read_complete_session_history_v1(uuid,uuid,uuid,uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.read_complete_session_history_v1(uuid,uuid,uuid,uuid,text,boolean) to authenticated;
