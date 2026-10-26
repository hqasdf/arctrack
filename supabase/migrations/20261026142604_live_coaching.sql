-- Local Phase 1 only. Existing scoring, organisation policies and Health records are unchanged.
create table public.live_coaching_sessions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 created_by uuid not null references auth.users(id) on delete cascade, title text not null check(length(btrim(title)) between 1 and 100),
 training_date date not null, state text not null default 'created' check(state in ('created','waiting','active','completed','cancelled')),
 version bigint not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index live_coaching_organization on public.live_coaching_sessions(organization_id,created_at desc);
create table public.live_coaching_participants (
 live_id uuid not null references public.live_coaching_sessions(id) on delete cascade,
 athlete_id uuid not null references auth.users(id) on delete cascade,
 state text not null default 'invited' check(state in ('invited','joined','declined','left')),
 scoring_session_id uuid references public.sessions(id) on delete set null,
 updated_at timestamptz not null default now(), primary key(live_id,athlete_id),unique(live_id,scoring_session_id)
);
create index live_coaching_athlete on public.live_coaching_participants(athlete_id,live_id);
create index live_coaching_scoring on public.live_coaching_participants(scoring_session_id) where scoring_session_id is not null;
alter table public.live_coaching_sessions enable row level security;
alter table public.live_coaching_participants enable row level security;
revoke all on public.live_coaching_sessions,public.live_coaching_participants from public,anon,authenticated,service_role;

-- Central authority; roles come from database membership, never JWT metadata.
create function private.live_coaching_access(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.live_coaching_sessions l join public.organization_members m on m.organization_id=l.organization_id and m.user_id=(select auth.uid()) and m.status='active'
 where l.id=p_id and ((l.created_by=m.user_id and m.role='head_coach') or (m.role='archer' and exists(select 1 from public.live_coaching_participants p where p.live_id=l.id and p.athlete_id=m.user_id))));
$$;
revoke all on function private.live_coaching_access(uuid) from public,anon,authenticated,service_role;
grant execute on function private.live_coaching_access(uuid) to authenticated;
create function public.live_coaching_access(p_id uuid) returns boolean language sql stable security invoker set search_path='' as $$select private.live_coaching_access(p_id)$$;
revoke all on function public.live_coaching_access(uuid) from public,anon,authenticated,service_role;
grant execute on function public.live_coaching_access(uuid) to authenticated;

-- No sensitive payload or presence claims. Recipient checks run on every emission,
-- so a revoked cached channel receives no subsequent scoring invalidations.
create function private.emit_live_coaching(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare recipient uuid;
begin
 for recipient in
  select m.user_id from public.live_coaching_sessions l join public.organization_members m on m.organization_id=l.organization_id and m.status='active'
  where l.id=p_id and ((m.user_id=l.created_by and m.role='head_coach') or (m.role='archer' and exists(select 1 from public.live_coaching_participants p where p.live_id=l.id and p.athlete_id=m.user_id and p.state in ('invited','joined'))))
 loop
  perform realtime.send('{}'::jsonb,'changed','live-coaching:'||p_id::text||':'||recipient::text,true);
 end loop;
exception when others then
 -- Optional transport must never make an otherwise valid scoring write fail.
 raise log 'Live Coaching invalidation unavailable';
end;$$;
revoke all on function private.emit_live_coaching(uuid) from public,anon,authenticated,service_role;
create function private.live_coaching_topic(p_topic text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.live_coaching_sessions l where
 p_topic='live-coaching:'||l.id::text||':'||(select auth.uid())::text and private.live_coaching_access(l.id));
$$;
revoke all on function private.live_coaching_topic(text) from public,anon,authenticated,service_role;
grant execute on function private.live_coaching_topic(text) to authenticated;
create policy live_coaching_receive on realtime.messages for select to authenticated using(extension='broadcast' and private.live_coaching_topic(realtime.topic()));

create function private.live_coaching_command(p_action text,p_id uuid,p_org uuid,p_title text,p_date date,p_athletes uuid[],p_scoring uuid,p_expected bigint)
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
   if p_action in ('join','link') then
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
revoke all on function private.live_coaching_command(text,uuid,uuid,text,date,uuid[],uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function private.live_coaching_command(text,uuid,uuid,text,date,uuid[],uuid,bigint) to authenticated;
create function public.live_coaching_command(p_action text,p_id uuid default null,p_org uuid default null,p_title text default null,p_date date default null,p_athletes uuid[] default '{}',p_scoring uuid default null,p_expected bigint default null)
returns uuid language sql security invoker set search_path='' as $$select private.live_coaching_command(p_action,p_id,p_org,p_title,p_date,p_athletes,p_scoring,p_expected)$$;
revoke all on function public.live_coaching_command(text,uuid,uuid,text,date,uuid[],uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.live_coaching_command(text,uuid,uuid,text,date,uuid[],uuid,bigint) to authenticated;

create function private.read_live_coaching(p_id uuid,p_org uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); l public.live_coaching_sessions%rowtype; is_coach boolean;
begin
 if actor is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_id is null then
  return jsonb_build_object('sessions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select c.*,o.name organization_name from public.live_coaching_sessions c join public.organizations o on o.id=c.organization_id where (p_org is null or c.organization_id=p_org) and private.live_coaching_access(c.id) order by c.created_at desc limit 100)x),
   'roster',(select coalesce(jsonb_agg(jsonb_build_object('userId',m.user_id,'displayName',coalesce(p.display_name,'Archer'))),'[]') from public.organization_members m left join public.profiles p on p.id=m.user_id where m.organization_id=p_org and m.status='active' and m.role='archer' and exists(select 1 from public.organization_members coach where coach.organization_id=p_org and coach.user_id=actor and coach.role='head_coach' and coach.status='active')));
 end if;
 if not private.live_coaching_access(p_id) then raise exception 'Live access revoked' using errcode='42501';end if;
 select * into l from public.live_coaching_sessions where id=p_id;is_coach:=l.created_by=actor;
 return jsonb_build_object('session',to_jsonb(l),'organizationName',(select name from public.organizations where id=l.organization_id),'coach',is_coach,'viewerId',actor,
 'eligibleSessions',(select coalesce(jsonb_agg(x),'[]') from (select id,title,session_date from public.sessions where user_id=actor and session_type='training' and session_date=l.training_date order by created_at desc limit 100)x),
 'participants',(select coalesce(jsonb_agg(jsonb_build_object('athleteId',p.athlete_id,'displayName',coalesce(profile.display_name,'Archer'),'state',p.state,'scoringSessionId',p.scoring_session_id,
  'scoring',case when p.state='joined' then (select jsonb_build_object('id',s.id,'title',s.title,'session_date',s.session_date,'session_type',s.session_type,'arrow_count',s.arrow_count,'created_at',s.created_at,
   'session_rounds',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'round_number',r.round_number,'name',r.name,'division',r.division,'distance_metres',r.distance_metres,'face_diameter_cm',r.face_diameter_cm,'face_type',r.face_type,'planned_ends',r.planned_ends,'arrows_per_end',r.arrows_per_end,
    'session_ends',(select coalesce(jsonb_agg(jsonb_build_object('end_number',e.end_number,'arrows',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'arrow_number',a.arrow_number,'score_points',a.score_points,'is_x',a.is_x,'plot_x',null,'plot_y',null,'face_index',null)),'[]') from public.arrows a where a.session_end_id=e.id)) order by e.end_number),'[]') from public.session_ends e where e.session_round_id=r.id)) order by r.round_number),'[]') from public.session_rounds r where r.session_id=s.id)) from public.sessions s where s.id=p.scoring_session_id and s.user_id=p.athlete_id) else null end)),'[]')
  from public.live_coaching_participants p join public.organization_members m on m.organization_id=l.organization_id and m.user_id=p.athlete_id and m.status='active' and m.role='archer' left join public.profiles profile on profile.id=p.athlete_id
  where p.live_id=l.id and (is_coach or p.athlete_id=actor)));
end;$$;
revoke all on function private.read_live_coaching(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.read_live_coaching(uuid,uuid) to authenticated;
create function public.read_live_coaching(p_id uuid default null,p_org uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$select private.read_live_coaching(p_id,p_org)$$;
revoke all on function public.read_live_coaching(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_live_coaching(uuid,uuid) to authenticated;

create function private.live_scoring_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare scoring uuid; item uuid;
begin
 if tg_table_name='arrows' then
  select r.session_id into scoring from public.session_ends e join public.session_rounds r on r.id=e.session_round_id where e.id=case when tg_op='DELETE' then old.session_end_id else new.session_end_id end;
 elsif tg_table_name='session_ends' then select session_id into scoring from public.session_rounds where id=old.session_round_id;
 elsif tg_table_name='session_rounds' then scoring:=case when tg_op='DELETE' then old.session_id else new.session_id end;
 else scoring:=old.id;end if;
 for item in select p.live_id from public.live_coaching_participants p join public.live_coaching_sessions l on l.id=p.live_id where p.scoring_session_id=scoring and p.state='joined' and l.state in ('waiting','active')
 loop perform private.emit_live_coaching(item);end loop;
 return null;
end;$$;
revoke all on function private.live_scoring_changed() from public,anon,authenticated,service_role;
create trigger live_arrow_changed after insert or update or delete on public.arrows for each row execute function private.live_scoring_changed();
-- BEFORE deletion sees the parent identity before FK cascades remove it. Return OLD.
create function private.live_parent_deleted() returns trigger language plpgsql security definer set search_path='' as $$
declare scoring uuid; item uuid;
begin
 if tg_table_name='sessions' then scoring:=old.id;
 elsif tg_table_name='session_rounds' then scoring:=old.session_id;
 else select session_id into scoring from public.session_rounds where id=old.session_round_id;end if;
 for item in select p.live_id from public.live_coaching_participants p join public.live_coaching_sessions l on l.id=p.live_id where p.scoring_session_id=scoring and p.state='joined' and l.state in ('waiting','active') loop perform private.emit_live_coaching(item);end loop;
 return old;
end;$$;
revoke all on function private.live_parent_deleted() from public,anon,authenticated,service_role;
create trigger live_round_changed after insert or update on public.session_rounds for each row execute function private.live_scoring_changed();
create trigger live_round_deleted before delete on public.session_rounds for each row execute function private.live_parent_deleted();
create trigger live_end_deleted before delete on public.session_ends for each row execute function private.live_parent_deleted();
create trigger live_session_deleted before delete on public.sessions for each row execute function private.live_parent_deleted();

create function private.live_membership_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare item uuid;
begin
 for item in select id from public.live_coaching_sessions where organization_id=old.organization_id and state in ('created','waiting','active') loop perform private.emit_live_coaching(item);end loop;
 return null;
end;$$;
revoke all on function private.live_membership_changed() from public,anon,authenticated,service_role;
create trigger live_membership_changed after update or delete on public.organization_members for each row execute function private.live_membership_changed();
