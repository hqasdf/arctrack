-- Phase 2 LOCAL ONLY. Latest BLE reading only; no Garmin or scoring changes.
create table public.live_coaching_hr (
 live_id uuid not null, athlete_id uuid not null, consent boolean not null default false,
 generation uuid not null default gen_random_uuid(), source_id uuid, sender_id uuid references auth.users(id) on delete set null,
 sequence bigint not null default 0, bpm smallint check(bpm between 1 and 300),
 observed_at timestamptz, received_at timestamptz, consent_at timestamptz,
 primary key(live_id,athlete_id), foreign key(live_id,athlete_id) references public.live_coaching_participants(live_id,athlete_id) on delete cascade,
 check((source_id is null)=(sender_id is null)),
 check(bpm is null or (consent and source_id is not null and received_at is not null))
);
create unique index live_hr_assignment on public.live_coaching_hr(live_id,source_id) where source_id is not null;
alter table public.live_coaching_hr enable row level security;
revoke all on public.live_coaching_hr from public,anon,authenticated,service_role;

create function private.live_hr_command(p_action text,p_live uuid,p_athlete uuid,p_generation uuid,p_source uuid,p_bpm integer,p_sequence bigint,p_observed timestamptz)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='3s' as $$
declare actor uuid:=(select auth.uid()); l public.live_coaching_sessions%rowtype; h public.live_coaching_hr%rowtype; t timestamptz:=clock_timestamp();
begin
 if actor is null then raise exception 'Sign in required' using errcode='42501';end if;
 select * into l from public.live_coaching_sessions where id=p_live for share;
 if not found or l.state not in ('waiting','active') then raise exception 'Live HR unavailable' using errcode='42501';end if;
 perform 1 from public.organization_members where organization_id=l.organization_id and user_id in (actor,p_athlete,l.created_by) and status='active' order by user_id for share;
 if not private.live_coaching_access(l.id) or not exists(select 1 from public.organization_members where organization_id=l.organization_id and user_id=l.created_by and role='head_coach' and status='active')
 or not exists(select 1 from public.organization_members where organization_id=l.organization_id and user_id=p_athlete and role='archer' and status='active')
 or not exists(select 1 from public.live_coaching_participants where live_id=l.id and athlete_id=p_athlete and state='joined') then raise exception 'Live HR access revoked' using errcode='42501';end if;
 if p_action in ('consent','revoke') then
  if actor<>p_athlete then raise exception 'Only athlete can consent' using errcode='42501';end if;
 else
  if actor<>l.created_by or l.state<>'active' then raise exception 'Active session coach required' using errcode='42501';end if;
 end if;
 -- Serialize this athlete only, including first consent and delayed consent/revoke requests.
 perform pg_advisory_xact_lock(hashtextextended('live-hr:'||p_live::text||':'||p_athlete::text,0));
 select * into h from public.live_coaching_hr where live_id=p_live and athlete_id=p_athlete for update;
 if found and p_action in ('consent','revoke') and h.generation is distinct from p_generation then raise exception 'Consent changed; refresh first' using errcode='40001';end if;
 insert into public.live_coaching_hr(live_id,athlete_id) values(p_live,p_athlete) on conflict do nothing;
 select * into h from public.live_coaching_hr where live_id=p_live and athlete_id=p_athlete for update;
 if p_action in ('consent','revoke') then
  update public.live_coaching_hr set consent=p_action='consent',consent_at=case when p_action='consent' then t else null end,
   generation=gen_random_uuid(),source_id=null,sender_id=null,bpm=null,observed_at=null,received_at=null,sequence=0 where live_id=p_live and athlete_id=p_athlete returning * into h;
 elsif p_action='assign' then
  if not h.consent or h.generation is distinct from p_generation or p_source is null then raise exception 'Current athlete consent required' using errcode='42501';end if;
  update public.live_coaching_hr set generation=gen_random_uuid(),source_id=p_source,sender_id=actor,bpm=null,observed_at=null,received_at=null,sequence=0 where live_id=p_live and athlete_id=p_athlete returning * into h;
 elsif p_action in ('sample','disconnect') then
  if not h.consent or h.generation is distinct from p_generation or h.source_id is distinct from p_source or h.sender_id is distinct from actor then raise exception 'Stale or unauthorized sensor' using errcode='42501';end if;
  if p_action='disconnect' then
   update public.live_coaching_hr set generation=gen_random_uuid(),source_id=null,sender_id=null,bpm=null,observed_at=null,received_at=null,sequence=0 where live_id=p_live and athlete_id=p_athlete returning * into h;
  else
   if p_bpm is null or p_bpm not between 1 and 300 or p_sequence is null or p_sequence<=h.sequence or p_sequence>9007199254740991
    or p_observed is null or p_observed<t-interval '15 seconds' or p_observed>t+interval '5 seconds' then raise exception 'Invalid or replayed measurement' using errcode='22023';end if;
   if floor(extract(epoch from h.received_at))>=floor(extract(epoch from t)) or floor(extract(epoch from p_observed))<=floor(extract(epoch from h.observed_at)) then raise exception 'Measurement rate exceeded' using errcode='P0001';end if;
   update public.live_coaching_hr set bpm=p_bpm,sequence=p_sequence,observed_at=p_observed,received_at=t where live_id=p_live and athlete_id=p_athlete returning * into h;
  end if;
 else raise exception 'Unsupported HR action' using errcode='22023';end if;
 return jsonb_build_object('generation',h.generation,'sourceId',h.source_id);
end;$$;
revoke all on function private.live_hr_command(text,uuid,uuid,uuid,uuid,integer,bigint,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.live_hr_command(text,uuid,uuid,uuid,uuid,integer,bigint,timestamptz) to authenticated;
create function public.live_hr_command(p_action text,p_live uuid,p_athlete uuid,p_generation uuid default null,p_source uuid default null,p_bpm integer default null,p_sequence bigint default null,p_observed timestamptz default null)
returns jsonb language sql security invoker set search_path='' as $$select private.live_hr_command(p_action,p_live,p_athlete,p_generation,p_source,p_bpm,p_sequence,p_observed)$$;
revoke all on function public.live_hr_command(text,uuid,uuid,uuid,uuid,integer,bigint,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.live_hr_command(text,uuid,uuid,uuid,uuid,integer,bigint,timestamptz) to authenticated;

create function private.read_live_hr(p_live uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.live_coaching_sessions%rowtype;
begin
 if not private.live_coaching_access(p_live) then raise exception 'Live access denied' using errcode='42501';end if;
 select * into l from public.live_coaching_sessions where id=p_live;
 if l.state not in ('waiting','active') then return '[]'::jsonb;end if;
 update public.live_coaching_hr set bpm=null,observed_at=null,received_at=null where live_id=p_live and received_at<clock_timestamp()-interval '60 seconds';
 return (select coalesce(jsonb_agg(jsonb_build_object('athleteId',p.athlete_id,'consent',coalesce(h.consent,false),'generation',h.generation,'sourceId',h.source_id,
  'bpm',case when h.consent and h.received_at>clock_timestamp()-interval '10 seconds' then h.bpm else null end,
  'receivedAt',h.received_at)),'[]') from public.live_coaching_participants p
  join public.organization_members m on m.organization_id=l.organization_id and m.user_id=p.athlete_id and m.status='active' and m.role='archer'
  left join public.live_coaching_hr h on h.live_id=p.live_id and h.athlete_id=p.athlete_id
  where p.live_id=p_live and p.state='joined' and ((select auth.uid())=l.created_by or (select auth.uid())=p.athlete_id));
end;$$;
revoke all on function private.read_live_hr(uuid) from public,anon,authenticated,service_role;
grant execute on function private.read_live_hr(uuid) to authenticated;
create function public.read_live_hr(p_live uuid) returns jsonb language sql security invoker set search_path='' as $$select private.read_live_hr(p_live)$$;
revoke all on function public.read_live_hr(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_live_hr(uuid) to authenticated;

create function private.clear_live_hr() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='live_coaching_sessions' then
  if new.state in ('completed','cancelled') then delete from public.live_coaching_hr where live_id=new.id;end if;
 elsif tg_table_name='live_coaching_participants' then
  if new.state<>'joined' then delete from public.live_coaching_hr where live_id=new.live_id and athlete_id=new.athlete_id;end if;
 else
  if tg_op='DELETE' or new.status<>'active' or new.role is distinct from old.role then
   delete from public.live_coaching_hr h using public.live_coaching_sessions l where h.live_id=l.id and l.organization_id=old.organization_id
    and (h.athlete_id=old.user_id or l.created_by=old.user_id);
  end if;
 end if;
 return null;
end;$$;
revoke all on function private.clear_live_hr() from public,anon,authenticated,service_role;
create trigger live_hr_lifecycle after update of state on public.live_coaching_sessions for each row execute function private.clear_live_hr();
create trigger live_hr_participation after update of state on public.live_coaching_participants for each row execute function private.clear_live_hr();
create trigger live_hr_membership after update or delete on public.organization_members for each row execute function private.clear_live_hr();

-- Latest value only. Schedule once/minute before activation; no job is activated here.
create function private.prune_live_coaching_hr() returns integer language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
 update public.live_coaching_hr set bpm=null,observed_at=null,received_at=null where received_at<clock_timestamp()-interval '60 seconds';
 get diagnostics removed=row_count;return removed;
end;$$;
revoke all on function private.prune_live_coaching_hr() from public,anon,authenticated,service_role;
grant execute on function private.prune_live_coaching_hr() to service_role;
create function public.prune_live_coaching_hr() returns integer language sql security invoker set search_path='' as $$select private.prune_live_coaching_hr()$$;
revoke all on function public.prune_live_coaching_hr() from public,anon,authenticated,service_role;
grant execute on function public.prune_live_coaching_hr() to service_role;
