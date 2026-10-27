-- LOCAL ONLY. Extends reviewed BLE migration without rewriting it or scoring data.
alter table public.live_coaching_sessions add column started_at timestamptz, add column ended_at timestamptz;
alter table public.live_coaching_participants add column last_seen_at timestamptz;
alter table public.live_coaching_hr add column history_consent boolean not null default false,
 add column history_version bigint not null default 0;

create table public.live_coaching_hr_samples (
 live_id uuid not null, athlete_id uuid not null, sample_bucket bigint not null,
 received_at timestamptz not null, expires_at timestamptz not null,
 bpm smallint not null check(bpm between 1 and 300), generation uuid not null, source_id uuid not null,
 primary key(live_id,athlete_id,sample_bucket),
 foreign key(live_id,athlete_id) references public.live_coaching_participants(live_id,athlete_id) on delete cascade,
 check(expires_at=received_at+interval '24 hours')
);
create index live_hr_samples_window on public.live_coaching_hr_samples(live_id,athlete_id,received_at desc);
create index live_hr_samples_expiry on public.live_coaching_hr_samples(expires_at);
alter table public.live_coaching_hr_samples enable row level security;
revoke all on public.live_coaching_hr_samples from public,anon,authenticated,service_role;

-- Observation timestamps only: arrow values/totals remain in the existing scoring system.
create table public.live_coaching_end_activity (
 live_id uuid not null, athlete_id uuid not null,
 end_id uuid not null references public.session_ends(id) on delete cascade,
 round_id uuid not null references public.session_rounds(id) on delete cascade,
 end_number integer not null, last_changed_at timestamptz not null, confirmed_at timestamptz,
 primary key(live_id,athlete_id,end_id),
 foreign key(live_id,athlete_id) references public.live_coaching_participants(live_id,athlete_id) on delete cascade
);
alter table public.live_coaching_end_activity enable row level security;
revoke all on public.live_coaching_end_activity from public,anon,authenticated,service_role;

create function private.live_training_clock() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.state='active' and old.state is distinct from 'active' then new.started_at:=clock_timestamp();end if;
 if new.state in ('completed','cancelled') and old.state not in ('completed','cancelled') then new.ended_at:=clock_timestamp();end if;
 return new;
end;$$;
revoke all on function private.live_training_clock() from public,anon,authenticated,service_role;
create trigger live_training_clock before update of state on public.live_coaching_sessions for each row execute function private.live_training_clock();

create function private.guard_live_hr_history() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  delete from public.live_coaching_hr_samples where live_id=old.live_id and athlete_id=old.athlete_id;return old;
 end if;
 if not new.consent then
  if old.history_consent then new.history_version:=old.history_version+1;end if;
  new.history_consent:=false;
 end if;
 if not new.history_consent then delete from public.live_coaching_hr_samples where live_id=new.live_id and athlete_id=new.athlete_id;end if;
 return new;
end;$$;
revoke all on function private.guard_live_hr_history() from public,anon,authenticated,service_role;
create trigger live_hr_history_guard before update or delete on public.live_coaching_hr for each row execute function private.guard_live_hr_history();

create function private.record_live_hr_history() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.consent and new.history_consent and new.bpm is not null and new.received_at is distinct from old.received_at
 and exists(select 1 from public.live_coaching_sessions where id=new.live_id and state='active') then
  insert into public.live_coaching_hr_samples(live_id,athlete_id,sample_bucket,received_at,expires_at,bpm,generation,source_id)
   values(new.live_id,new.athlete_id,floor(extract(epoch from new.received_at)/10)::bigint,new.received_at,new.received_at+interval '24 hours',new.bpm,new.generation,new.source_id)
   on conflict do nothing;
 end if;
 return null;
end;$$;
revoke all on function private.record_live_hr_history() from public,anon,authenticated,service_role;
create trigger live_hr_record after update on public.live_coaching_hr for each row execute function private.record_live_hr_history();

create function private.set_live_hr_history(p_live uuid,p_enabled boolean,p_generation uuid,p_expected bigint) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='3s' as $$
declare actor uuid:=(select auth.uid()); l public.live_coaching_sessions%rowtype; h public.live_coaching_hr%rowtype;
begin
 select * into l from public.live_coaching_sessions where id=p_live for share;
 if actor is null or not found or not private.live_coaching_access(p_live) then raise exception 'Access denied' using errcode='42501';end if;
 perform 1 from public.organization_members where organization_id=l.organization_id and user_id in(actor,l.created_by) and status='active' order by user_id for share;
 if not exists(select 1 from public.live_coaching_participants where live_id=p_live and athlete_id=actor and state='joined') then raise exception 'Athlete consent required' using errcode='42501';end if;
 select * into h from public.live_coaching_hr where live_id=p_live and athlete_id=actor for update;
 if not found then
  if not p_enabled then return jsonb_build_object('historyConsent',false,'historyVersion',0);end if;
  raise exception 'Live sharing consent required' using errcode='42501';
 end if;
 if h.generation is distinct from p_generation or h.history_version is distinct from p_expected then raise exception 'Consent changed; refresh first' using errcode='40001';end if;
 if p_enabled and (not h.consent or l.state not in ('waiting','active') or not exists(select 1 from public.organization_members where organization_id=l.organization_id and user_id=l.created_by and status='active' and role='head_coach')) then raise exception 'Active consent required' using errcode='42501';end if;
 update public.live_coaching_hr set history_consent=p_enabled,history_version=history_version+1 where live_id=p_live and athlete_id=actor returning * into h;
 return jsonb_build_object('historyConsent',h.history_consent,'historyVersion',h.history_version);
end;$$;
revoke all on function private.set_live_hr_history(uuid,boolean,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function private.set_live_hr_history(uuid,boolean,uuid,bigint) to authenticated;
create function public.set_live_hr_history(p_live uuid,p_enabled boolean,p_generation uuid,p_expected bigint) returns jsonb language sql security invoker set search_path='' as $$select private.set_live_hr_history(p_live,p_enabled,p_generation,p_expected)$$;
revoke all on function public.set_live_hr_history(uuid,boolean,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.set_live_hr_history(uuid,boolean,uuid,bigint) to authenticated;

-- Completion stops live ingress but retains separately authorized review data until expiry.
create or replace function private.clear_live_hr() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='live_coaching_sessions' then
  if new.state='completed' then
   delete from public.live_coaching_hr where live_id=new.id and not history_consent;
   update public.live_coaching_hr set source_id=null,sender_id=null,bpm=null,observed_at=null,received_at=null,sequence=0,generation=gen_random_uuid() where live_id=new.id;
  elsif new.state='cancelled' then delete from public.live_coaching_hr where live_id=new.id;end if;
 elsif tg_table_name='live_coaching_participants' then
  if new.state<>'joined' then delete from public.live_coaching_hr where live_id=new.live_id and athlete_id=new.athlete_id;end if;
  if new.state<>'joined' or new.scoring_session_id is distinct from old.scoring_session_id then
   delete from public.live_coaching_end_activity where live_id=new.live_id and athlete_id=new.athlete_id;
  end if;
 else
  if tg_op='DELETE' or new.status<>'active' or new.role is distinct from old.role then
   delete from public.live_coaching_hr h using public.live_coaching_sessions l where h.live_id=l.id and l.organization_id=old.organization_id and(h.athlete_id=old.user_id or l.created_by=old.user_id);
   delete from public.live_coaching_end_activity a using public.live_coaching_sessions l where a.live_id=l.id and l.organization_id=old.organization_id and(a.athlete_id=old.user_id or l.created_by=old.user_id);
  end if;
 end if;return null;
end;$$;

create function private.observe_live_end_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare e record; p record; complete boolean; t timestamptz:=clock_timestamp();
begin
 select se.id,se.end_number,r.id round_id,r.session_id,r.arrows_per_end into e from public.session_ends se join public.session_rounds r on r.id=se.session_round_id where se.id=case when tg_op='DELETE' then old.session_end_id else new.session_end_id end;
 if not found then return null;end if;
 select count(*)=e.arrows_per_end into complete from public.arrows where session_end_id=e.id;
 for p in select cp.live_id,cp.athlete_id from public.live_coaching_participants cp join public.live_coaching_sessions l on l.id=cp.live_id where cp.scoring_session_id=e.session_id and cp.state='joined' and l.state in ('waiting','active') loop
  insert into public.live_coaching_end_activity values(p.live_id,p.athlete_id,e.id,e.round_id,e.end_number,t,case when complete then t else null end)
   on conflict(live_id,athlete_id,end_id) do update set last_changed_at=excluded.last_changed_at,confirmed_at=excluded.confirmed_at;
 end loop;return null;
end;$$;
revoke all on function private.observe_live_end_activity() from public,anon,authenticated,service_role;
create trigger live_end_activity after insert or update or delete on public.arrows for each row execute function private.observe_live_end_activity();

create function private.touch_live_presence(p_live uuid,p_scoring uuid) returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); n integer;
begin
 if actor is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_scoring is not null and not exists(select 1 from public.sessions where id=p_scoring and user_id=actor) then raise exception 'Owned Session required' using errcode='42501';end if;
 if p_live is null and p_scoring is null then raise exception 'Choose a live session' using errcode='22023';end if;
 update public.live_coaching_participants p set last_seen_at=clock_timestamp() from public.live_coaching_sessions l
 where l.id=p.live_id and l.state in ('waiting','active') and p.athlete_id=actor and p.state='joined'
 and(p_live is null or p.live_id=p_live) and(p_scoring is null or p.scoring_session_id=p_scoring)
 and private.live_coaching_access(l.id) and(p.last_seen_at is null or p.last_seen_at<clock_timestamp()-interval '10 seconds');
 get diagnostics n=row_count;return n;
end;$$;
revoke all on function private.touch_live_presence(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.touch_live_presence(uuid,uuid) to authenticated;
create function public.touch_live_presence(p_live uuid default null,p_scoring uuid default null) returns integer language sql security invoker set search_path='' as $$select private.touch_live_presence(p_live,p_scoring)$$;
revoke all on function public.touch_live_presence(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.touch_live_presence(uuid,uuid) to authenticated;

create function private.read_live_monitor(p_live uuid,p_window integer,p_history boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.live_coaching_sessions%rowtype; actor uuid:=(select auth.uid()); timeline jsonb:=null; upper_time timestamptz;
begin
 if not private.live_coaching_access(p_live) then raise exception 'Access denied' using errcode='42501';end if;
 if p_window is null or p_window not in (300,900,1800,86400) then raise exception 'Invalid interval' using errcode='22023';end if;
 select * into l from public.live_coaching_sessions where id=p_live;upper_time:=coalesce(l.ended_at,clock_timestamp());
 if p_history then
  with eligible as (
   select s.* from public.live_coaching_hr_samples s join public.live_coaching_hr h using(live_id,athlete_id)
   join public.organization_members m on m.organization_id=l.organization_id and m.user_id=s.athlete_id and m.role='archer' and m.status='active'
   where s.live_id=p_live and h.consent and h.history_consent and s.expires_at>clock_timestamp() and s.received_at between upper_time-make_interval(secs=>p_window) and upper_time
   and(actor=l.created_by or s.athlete_id=actor)
  ), lagged as (
   select *,lag(received_at) over w prev_time,lag(generation) over w prev_gen from eligible window w as(partition by athlete_id order by received_at)
  ), segmented as (
   select *,sum(case when prev_time is null or received_at-prev_time>interval '20 seconds' or generation is distinct from prev_gen then 1 else 0 end) over(partition by athlete_id order by received_at) segment from lagged
  ), bucketed as (
   select *,row_number() over(partition by athlete_id,segment,floor(extract(epoch from received_at)/greatest(10,p_window/180)) order by received_at desc) bucket_rank from segmented
  ), bounded as (
   select *,row_number() over(partition by athlete_id order by received_at desc) display_rank from bucketed where bucket_rank=1
  ), stats as (
   select athlete_id,count(*) count,min(bpm) minimum,max(bpm) maximum,round(avg(bpm),1) average from eligible group by athlete_id
  ) select coalesce(jsonb_agg(jsonb_build_object('athleteId',t.athlete_id,'count',t.count,'minimum',t.minimum,'maximum',t.maximum,'average',t.average,
   'points',(select coalesce(jsonb_agg(jsonb_build_object('at',b.received_at,'bpm',b.bpm,'segment',b.segment) order by b.received_at),'[]') from bounded b where b.athlete_id=t.athlete_id and b.display_rank<=240))),'[]') into timeline from stats t;
 end if;
 return jsonb_build_object('history',timeline,'readings',(select coalesce(jsonb_agg(jsonb_build_object('athleteId',p.athlete_id,'consent',coalesce(h.consent,false),'generation',h.generation,'sourceId',h.source_id,
  'historyConsent',coalesce(h.history_consent,false),'historyVersion',coalesce(h.history_version,0),
  'bpm',case when l.state='active' and h.consent and h.received_at>clock_timestamp()-interval '10 seconds' then h.bpm else null end,'receivedAt',h.received_at,
  'lastSeenAt',p.last_seen_at)),'[]') from public.live_coaching_participants p join public.organization_members m on m.organization_id=l.organization_id and m.user_id=p.athlete_id and m.status='active' and m.role='archer' left join public.live_coaching_hr h on h.live_id=p.live_id and h.athlete_id=p.athlete_id where p.live_id=p_live and p.state='joined' and(actor=l.created_by or p.athlete_id=actor)),
  'endActivity',(select coalesce(jsonb_agg(jsonb_build_object('athleteId',a.athlete_id,'roundId',a.round_id,'end',a.end_number,'changedAt',a.last_changed_at,'confirmedAt',a.confirmed_at)),'[]') from public.live_coaching_end_activity a join public.organization_members m on m.organization_id=l.organization_id and m.user_id=a.athlete_id and m.status='active' and m.role='archer' where a.live_id=p_live and exists(select 1 from public.live_coaching_participants p join public.session_rounds r on r.session_id=p.scoring_session_id where p.live_id=a.live_id and p.athlete_id=a.athlete_id and p.state='joined' and r.id=a.round_id) and(actor=l.created_by or a.athlete_id=actor)));
end;$$;
revoke all on function private.read_live_monitor(uuid,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function private.read_live_monitor(uuid,integer,boolean) to authenticated;
create function public.read_live_monitor(p_live uuid,p_window integer default 900,p_history boolean default false) returns jsonb language sql security invoker set search_path='' as $$select private.read_live_monitor(p_live,p_window,p_history)$$;
revoke all on function public.read_live_monitor(uuid,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.read_live_monitor(uuid,integer,boolean) to authenticated;

create or replace function private.prune_live_coaching_hr() returns integer language plpgsql security definer set search_path='' as $$
declare n integer; total integer:=0;
begin
 update public.live_coaching_hr set bpm=null,observed_at=null,received_at=null where received_at<clock_timestamp()-interval '60 seconds';get diagnostics n=row_count;total:=total+n;
 delete from public.live_coaching_hr_samples where expires_at<=clock_timestamp();get diagnostics n=row_count;total:=total+n;
 delete from public.live_coaching_hr h using public.live_coaching_sessions l where h.live_id=l.id and l.state in ('completed','cancelled') and l.ended_at<clock_timestamp()-interval '24 hours';get diagnostics n=row_count;
 return total+n;
end;$$;
