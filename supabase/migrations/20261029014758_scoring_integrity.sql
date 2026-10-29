-- Additive local preparation. Apply separately before releasing the new writers.
begin;

-- A retained empty-slot revision prevents a delayed old request resurrecting a
-- deleted Arrow. No scores or sensitive payloads are duplicated in this table.
create table private.arrow_slot_revisions (
  session_end_id uuid not null references public.session_ends(id) on delete cascade,
  arrow_number smallint not null check(arrow_number>0),
  revision uuid not null,
  request_hash text,
  primary key(session_end_id,arrow_number)
);
alter table private.arrow_slot_revisions enable row level security;
revoke all on private.arrow_slot_revisions from public,anon,authenticated,service_role;

-- Legacy writes invalidate new clients' snapshots too. Guarded writers below
-- acquire the Round lock before touching any Arrow, in a consistent lock order.
create function private.track_arrow_slot_revision() returns trigger
language plpgsql security definer set search_path='' as $$
declare e uuid; n smallint;
begin
  if tg_op='DELETE' then e:=old.session_end_id;n:=old.arrow_number;
  else e:=new.session_end_id;n:=new.arrow_number;end if;
  -- Parent deletion already removes the fence through its FK cascade.
  if exists(select 1 from public.session_ends where id=e) then
    insert into private.arrow_slot_revisions(session_end_id,arrow_number,revision)
      values(e,n,gen_random_uuid()) on conflict(session_end_id,arrow_number)
      do update set revision=excluded.revision,request_hash=null;
  end if;
  return null;
end $$;
revoke all on function private.track_arrow_slot_revision() from public,anon,authenticated,service_role;
create trigger arrow_slot_revision after insert or update or delete on public.arrows
  for each row execute function private.track_arrow_slot_revision();

create function private.read_owned_arrow_slot(p_end uuid,p_number integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.session_rounds%rowtype; e_number integer; result jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Sign in required.' using errcode='42501';end if;
  select sr.* into r from public.session_rounds sr
    join public.session_ends e on e.session_round_id=sr.id
    join public.sessions s on s.id=sr.session_id
    where e.id=p_end and s.user_id=(select auth.uid()) for update of sr;
  if not found then raise exception 'Owned End unavailable.' using errcode='42501';end if;
  select end_number into e_number from public.session_ends where id=p_end;
  if p_number is null or p_number not between 1 and r.arrows_per_end or e_number>r.planned_ends then
    raise exception 'Invalid Arrow slot.' using errcode='22023';end if;
  -- An untouched slot still belongs to this exact Round configuration. A
  -- pre-configuration request must not score using superseded face/slot settings.
  select jsonb_build_object('revision',coalesce((select revision from private.arrow_slot_revisions where session_end_id=p_end and arrow_number=p_number),
      left(encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),32)::uuid),
    'arrow',(select jsonb_build_object('id',a.id,'arrow_number',a.arrow_number,'score_points',a.score_points,'is_x',a.is_x,'plot_x',a.plot_x,'plot_y',a.plot_y,'face_index',a.face_index)
      from public.arrows a where a.session_end_id=p_end and a.arrow_number=p_number)) into result;
  return result;
end $$;

create function private.write_owned_arrow_slot(p_end uuid,p_number integer,p_expected uuid,p_request uuid,p_arrow jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; current_revision uuid; fingerprint text; previous_hash text;
begin
  snapshot:=private.read_owned_arrow_slot(p_end,p_number); -- verifies owner and locks Round
  if p_expected is null or p_request is null or p_request='00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Invalid Arrow request.' using errcode='22023';end if;
  fingerprint:=encode(sha256(convert_to(coalesce(p_arrow::text,'null'),'UTF8')),'hex');
  current_revision:=(snapshot->>'revision')::uuid;
  if current_revision=p_request then
    select request_hash into previous_hash from private.arrow_slot_revisions where session_end_id=p_end and arrow_number=p_number;
    if previous_hash is distinct from fingerprint then raise exception 'Arrow request changed.' using errcode='22023';end if;
    return snapshot;
  end if;
  if current_revision<>p_expected then raise exception 'Arrow changed. Reload before editing.' using errcode='40001';end if;
  if p_arrow is null then
    perform private.delete_owned_arrow(p_end,p_number,null);
  else
    if jsonb_typeof(p_arrow)<>'object' or jsonb_typeof(p_arrow->'score_points')<>'number'
      or jsonb_typeof(p_arrow->'is_x')<>'boolean' then raise exception 'Invalid Arrow.' using errcode='22023';end if;
    perform private.save_owned_arrow(p_end,p_number,(p_arrow->>'score_points')::integer,(p_arrow->>'is_x')::boolean,
      (p_arrow->>'plot_x')::double precision,(p_arrow->>'plot_y')::double precision,(p_arrow->>'face_index')::integer,null);
  end if;
  insert into private.arrow_slot_revisions(session_end_id,arrow_number,revision,request_hash)
    values(p_end,p_number,p_request,fingerprint) on conflict(session_end_id,arrow_number)
    do update set revision=excluded.revision,request_hash=excluded.request_hash;
  return private.read_owned_arrow_slot(p_end,p_number);
end $$;

create function public.read_owned_arrow_slot(p_end uuid,p_number integer) returns jsonb
language sql security invoker set search_path='' as $$select private.read_owned_arrow_slot(p_end,p_number)$$;
create function public.write_owned_arrow_slot(p_end uuid,p_number integer,p_expected uuid,p_request uuid,p_arrow jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.write_owned_arrow_slot(p_end,p_number,p_expected,p_request,p_arrow)$$;
revoke all on function private.read_owned_arrow_slot(uuid,integer),public.read_owned_arrow_slot(uuid,integer),
  private.write_owned_arrow_slot(uuid,integer,uuid,uuid,jsonb),public.write_owned_arrow_slot(uuid,integer,uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function private.read_owned_arrow_slot(uuid,integer),public.read_owned_arrow_slot(uuid,integer),
  private.write_owned_arrow_slot(uuid,integer,uuid,uuid,jsonb),public.write_owned_arrow_slot(uuid,integer,uuid,uuid,jsonb) to authenticated;

-- Full setup is distinct from the legacy scored-metadata/End-expansion RPC.
create function private.configure_empty_round(p_round uuid,p_expected jsonb,p_name text,p_division text,
 p_distance integer,p_diameter integer,p_face text,p_ends integer,p_arrows integer)
returns table(round_id uuid,round_number smallint) language plpgsql security definer set search_path='' as $$
declare r public.session_rounds%rowtype; current_settings jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Sign in required.' using errcode='42501';end if;
  select sr.* into r from public.session_rounds sr join public.sessions s on s.id=sr.session_id
    where sr.id=p_round and s.user_id=(select auth.uid()) for update of sr;
  if not found then raise exception 'Owned Round unavailable.' using errcode='42501';end if;
  current_settings:=jsonb_build_object('name',r.name,'division',r.division,'distanceMetres',r.distance_metres,
    'faceDiameterCm',r.face_diameter_cm,'faceType',r.face_type,'ends',r.planned_ends,'arrowsPerEnd',r.arrows_per_end);
  if p_expected is null or current_settings is distinct from p_expected then raise exception 'Round changed. Reload before configuring.' using errcode='40001';end if;
  if exists(select 1 from public.arrows a join public.session_ends e on e.id=a.session_end_id where e.session_round_id=p_round) then
    raise exception 'Round settings cannot change after Arrows are recorded.' using errcode='22023';end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80
    or p_division is null or p_division not in ('Recurve','Compound','Barebow','Other')
    or p_face is null or p_face not in ('full_face','six_ring','triple_face')
    or p_distance is null or p_distance not between 1 and 32767
    or p_diameter is null or p_diameter not between 1 and 32767 then raise exception 'Invalid Round configuration.' using errcode='22023';end if;
  perform private.validate_round_workload(p_ends,p_arrows);
  if not private.consume_operation_budget('round_configuration') then raise exception 'Too many requests. Try again shortly.' using errcode='P0001';end if;
  update public.session_rounds set name=btrim(p_name),division=p_division,distance_metres=p_distance,
    face_diameter_cm=p_diameter,face_type=p_face,planned_ends=p_ends,arrows_per_end=p_arrows where id=p_round;
  update private.arrow_slot_revisions set revision=gen_random_uuid(),request_hash=null
    where session_end_id in (select id from public.session_ends where session_round_id=p_round);
  delete from public.session_ends where session_round_id=p_round and end_number>p_ends;
  insert into public.session_ends(session_round_id,end_number) select p_round,n from generate_series(1,p_ends) n
    on conflict on constraint session_ends_number_unique do nothing;
  return query select r.id,r.round_number;
end $$;
create function public.configure_empty_round(p_round uuid,p_expected jsonb,p_name text,p_division text,
 p_distance integer,p_diameter integer,p_face text,p_ends integer,p_arrows integer)
returns table(round_id uuid,round_number smallint) language sql security invoker set search_path='' as $$
 select * from private.configure_empty_round(p_round,p_expected,p_name,p_division,p_distance,p_diameter,p_face,p_ends,p_arrows)$$;
revoke all on function private.configure_empty_round(uuid,jsonb,text,text,integer,integer,text,integer,integer),
 public.configure_empty_round(uuid,jsonb,text,text,integer,integer,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function private.configure_empty_round(uuid,jsonb,text,text,integer,integer,text,integer,integer),
 public.configure_empty_round(uuid,jsonb,text,text,integer,integer,text,integer,integer) to authenticated;

create or replace function private.save_owned_arrow(
  p_session_end_id uuid, p_arrow_number integer, p_score_points integer, p_is_x boolean,
  p_plot_x double precision, p_plot_y double precision, p_face_index integer,
  p_arrow_id uuid default null
)
returns table (
  id uuid, arrow_number smallint, score_points smallint, is_x boolean,
  plot_x double precision, plot_y double precision, face_index smallint
)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_end_number smallint;
  v_planned_ends smallint;
  v_arrows_per_end smallint;
  v_face_type text;
begin
  if v_user_id is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  select e.end_number, r.planned_ends, r.arrows_per_end, r.face_type
    into v_end_number, v_planned_ends, v_arrows_per_end, v_face_type
  from public.session_ends e
  join public.session_rounds r on r.id = e.session_round_id
  join public.sessions s on s.id = r.session_id
  where e.id = p_session_end_id and s.user_id = v_user_id
  for update of r;
  if not found then
    raise exception 'The End is not owned by the signed-in user.' using errcode = '42501';
  end if;
  if v_end_number not between 1 and v_planned_ends
    or p_arrow_number is null or p_arrow_number not between 1 and v_arrows_per_end then
    raise exception 'The Arrow slot is invalid for the planned End.' using errcode = '22023';
  end if;
  if p_score_points is null or p_score_points not between 0 and 10
    or p_is_x is null or (p_is_x and p_score_points <> 10) then
    raise exception 'The Arrow score is invalid.' using errcode = '22023';
  end if;
  -- A finite value in [-2,2] excludes NaN and either infinity in PostgreSQL.
  if (p_plot_x is null) <> (p_plot_y is null)
    or (p_plot_x is not null and not (
      p_plot_x between -2::double precision and 2::double precision
      and p_plot_y between -2::double precision and 2::double precision
    )) then
    raise exception 'The plotted position is invalid.' using errcode = '22023';
  end if;
  if (p_plot_x is null and p_face_index is not null)
    or (v_face_type = 'triple_face' and p_plot_x is not null
      and (p_face_index is null or p_face_index not between 0 and 2))
    or (v_face_type <> 'triple_face' and p_face_index is not null) then
    raise exception 'The target-face position is invalid.' using errcode = '22023';
  end if;

  -- Expo supplies the expected persisted ID when editing. It must still identify
  -- this exact slot; a missing/stale ID must not silently create a replacement.
  if p_arrow_id is not null then
    return query
      update public.arrows as a set
        score_points = p_score_points, is_x = p_is_x,
        plot_x = p_plot_x, plot_y = p_plot_y, face_index = p_face_index
      where a.id = p_arrow_id and a.session_end_id = p_session_end_id
        and a.arrow_number = p_arrow_number
      returning a.id, a.arrow_number, a.score_points, a.is_x, a.plot_x, a.plot_y, a.face_index;
    if not found then
      raise exception 'The saved Arrow does not match this slot.' using errcode = '22023';
    end if;
  else
    -- Preserve the existing unique (session_end_id, arrow_number) slot identity.
    return query
      insert into public.arrows as a (
        session_end_id, arrow_number, score_points, is_x, plot_x, plot_y, face_index
      ) values (
        p_session_end_id, p_arrow_number, p_score_points, p_is_x, p_plot_x, p_plot_y, p_face_index
      )
      on conflict on constraint arrows_number_unique do update set
        score_points = excluded.score_points, is_x = excluded.is_x,
        plot_x = excluded.plot_x, plot_y = excluded.plot_y, face_index = excluded.face_index
      returning a.id, a.arrow_number, a.score_points, a.is_x, a.plot_x, a.plot_y, a.face_index;
  end if;
end;
$$;

create or replace function private.delete_owned_arrow(
  p_session_end_id uuid, p_arrow_number integer default null, p_arrow_id uuid default null
)
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
declare v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  perform 1 from public.session_ends e
  join public.session_rounds r on r.id = e.session_round_id
  join public.sessions s on s.id = r.session_id
  where e.id = p_session_end_id and s.user_id = v_user_id
  for update of r;
  if not found then
    raise exception 'The End is not owned by the signed-in user.' using errcode = '42501';
  end if;
  if (p_arrow_number is null and p_arrow_id is null)
    or (p_arrow_number is not null and p_arrow_number not between 1 and 32767) then
    raise exception 'The Arrow identity is invalid.' using errcode = '22023';
  end if;
  delete from public.arrows a where a.session_end_id = p_session_end_id
    and (p_arrow_number is null or a.arrow_number = p_arrow_number)
    and (p_arrow_id is null or a.id = p_arrow_id);
  return found;
end;
$$;

commit;
