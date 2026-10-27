-- Configuration memory only. Existing scoring RPCs and scoring data remain unchanged.
create table public.recent_round_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  round_name text not null check (char_length(btrim(round_name)) between 1 and 80),
  division text not null check (division in ('Recurve','Compound','Barebow','Other')),
  distance_metres smallint not null check (distance_metres > 0),
  face_diameter_cm smallint not null check (face_diameter_cm > 0),
  face_type text not null check (face_type in ('full_face','six_ring','triple_face')),
  planned_ends smallint not null check (planned_ends > 0),
  arrows_per_end smallint not null check (arrows_per_end > 0),
  last_used_at timestamptz not null default clock_timestamp(),
  unique (user_id,division,distance_metres,face_diameter_cm,face_type,planned_ends,arrows_per_end)
);
create index recent_round_configs_owner_recency on public.recent_round_configs(user_id,last_used_at desc,id);
alter table public.recent_round_configs enable row level security;
revoke all on public.recent_round_configs from public,anon,authenticated,service_role;
grant select,delete on public.recent_round_configs to authenticated;
create policy recent_round_configs_read_own on public.recent_round_configs for select to authenticated using(user_id=(select auth.uid()));
create policy recent_round_configs_delete_own on public.recent_round_configs for delete to authenticated using(user_id=(select auth.uid()));

create function private.remember_custom_round_config() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); owner_id uuid;
begin
  if actor is null then return new;end if;
  select s.user_id into owner_id from public.sessions s where s.id=new.session_id;
  if owner_id is distinct from actor then return new;end if;
  -- Unmodified built-in presets are already available in Configure Round.
  -- Keep these values aligned with the shared ROUND_PRESETS contract (fixture-tested).
  if new.division='Recurve' and exists(select 1 from (values
    ('18 m indoor',18,40,'full_face',10,3),('30 m practice',30,80,'full_face',6,6),
    ('50 m practice',50,80,'full_face',6,6),('70 m practice',70,122,'full_face',6,6)
  ) p(name,distance,diameter,face,ends,arrows) where
    new.name=p.name and new.distance_metres=p.distance and new.face_diameter_cm=p.diameter
    and new.face_type=p.face and new.planned_ends=p.ends and new.arrows_per_end=p.arrows) then return new;end if;
  perform pg_advisory_xact_lock(hashtextextended('recent-round-config:'||actor::text,0));
  insert into public.recent_round_configs(user_id,round_name,division,distance_metres,face_diameter_cm,face_type,planned_ends,arrows_per_end)
  values(actor,btrim(new.name),new.division,new.distance_metres,new.face_diameter_cm,new.face_type,new.planned_ends,new.arrows_per_end)
  on conflict(user_id,division,distance_metres,face_diameter_cm,face_type,planned_ends,arrows_per_end)
  do update set round_name=excluded.round_name,last_used_at=clock_timestamp();
  delete from public.recent_round_configs where user_id=actor and id in (
    select id from public.recent_round_configs where user_id=actor order by last_used_at desc,id offset 20
  );
  return new;
end;$$;
revoke all on function private.remember_custom_round_config() from public,anon,authenticated,service_role;
create trigger remember_custom_round_config after insert or update of name,division,distance_metres,face_diameter_cm,face_type,planned_ends,arrows_per_end
on public.session_rounds for each row execute function private.remember_custom_round_config();

-- Invoker functions retain owner RLS. Expected actor only guards account switches.
create function public.read_recent_round_configs(p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  if (select auth.uid()) is null or p_actor is distinct from (select auth.uid()) then raise exception 'Account changed' using errcode='42501';end if;
  return (select coalesce(jsonb_agg(to_jsonb(r) order by r.last_used_at desc,r.id),'[]') from public.recent_round_configs r where r.user_id=(select auth.uid()));
end;$$;
revoke all on function public.read_recent_round_configs(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_recent_round_configs(uuid) to authenticated;
create function public.forget_recent_round_config(p_actor uuid,p_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  if (select auth.uid()) is null or p_actor is distinct from (select auth.uid()) then raise exception 'Account changed' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended('recent-round-config:'||p_actor::text,0));
  delete from public.recent_round_configs where id=p_id and user_id=(select auth.uid());
  return true;
end;$$;
revoke all on function public.forget_recent_round_config(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.forget_recent_round_config(uuid,uuid) to authenticated;
