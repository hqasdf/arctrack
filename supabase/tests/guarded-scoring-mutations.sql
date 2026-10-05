-- Disposable/non-production database only. Requires the guarded mutation migration.
-- All fixture data and test helpers roll back; do not run against production.
begin;

create function pg_temp.expect_sqlstate(p_sql text, p_state text, p_message text default null)
returns void language plpgsql security invoker as $$
declare v_state text; v_message text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    if v_state <> p_state or (p_message is not null and v_message <> p_message) then
      raise exception 'FAIL: expected % / %, got % / % for %',
        p_state, p_message, v_state, v_message, p_sql;
    end if;
    return;
  end;
  raise exception 'FAIL: expected SQLSTATE % for %', p_state, p_sql;
end;
$$;

select set_config('guard.owner', gen_random_uuid()::text, true);
select set_config('guard.other', gen_random_uuid()::text, true);
select set_config('guard.coach', gen_random_uuid()::text, true);
insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
select id, 'authenticated', 'authenticated', 'guarded-' || id || '@example.invalid', now(), now(), now()
from (values
  (current_setting('guard.owner')::uuid),
  (current_setting('guard.other')::uuid),
  (current_setting('guard.coach')::uuid)
) users(id);

-- Current model: active Coach and active Archer share an organisation.
do $$
declare v_org uuid;
begin
  insert into public.organizations (name, created_by)
  values ('Guarded mutation fixture', current_setting('guard.coach')::uuid)
  returning id into v_org;
  perform set_config('guard.org', v_org::text, true);
  insert into public.organization_members (organization_id, user_id, role, status)
  values (v_org, current_setting('guard.owner')::uuid, 'archer', 'active'),
    (v_org, current_setting('guard.other')::uuid, 'archer', 'active');
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('guard.owner'), true);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('guard.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

-- Owner creation never accepts a user_id. Blank title retains its existing default.
do $$
declare v_session uuid; v_round uuid; v_end uuid; v_arrow uuid; v_again uuid;
begin
  select id into v_session from public.create_owned_session(' ', current_date, 'training');
  perform set_config('guard.session', v_session::text, true);
  if not exists (select 1 from public.sessions where id = v_session
    and user_id = auth.uid() and title = 'Practice session' and arrow_count = 0) then
    raise exception 'FAIL: owner Session creation/defaults';
  end if;
  perform public.update_owned_session_arrow_count(v_session, 200);
  if (select arrow_count from public.sessions where id = v_session) <> 200 then
    raise exception 'FAIL: Session arrow_count semantics changed';
  end if;
  select round_id into v_round from public.create_round_with_ends(
    v_session, 'Full face', 'Recurve', 70, 122, 'full_face', 2, 6);
  perform set_config('guard.round', v_round::text, true);
  if (select count(*) from public.session_ends where session_round_id = v_round) <> 2 then
    raise exception 'FAIL: existing atomic Round RPC does not work after revocation';
  end if;
  perform public.update_owned_round_settings(v_round, 'Full face', 'Recurve', 70, 122, 3);
  if (select count(*) from public.session_ends where session_round_id = v_round) <> 3 then
    raise exception 'FAIL: existing settings RPC does not append planned Ends';
  end if;
  select id into v_end from public.session_ends where session_round_id = v_round and end_number = 1;
  perform set_config('guard.end', v_end::text, true);
  select id into v_arrow from public.save_owned_arrow(v_end, 1, 10, true, 0.084, 0.067, null);
  perform set_config('guard.arrow', v_arrow::text, true);
  select id into v_again from public.save_owned_arrow(v_end, 1, 9, false, 0.084, 0.067, null);
  if v_again <> v_arrow or (select count(*) from public.arrows where session_end_id = v_end and arrow_number = 1) <> 1 then
    raise exception 'FAIL: slot upsert changed Arrow identity or duplicated the slot';
  end if;
  perform public.save_owned_arrow(v_end, 1, 10, false, 0.084, 0.067, null, v_arrow);
  if not exists (select 1 from public.arrows where id = v_arrow and score_points = 10
    and not is_x and plot_x = 0.084 and plot_y = 0.067) then
    raise exception 'FAIL: correction changed coordinates or score';
  end if;
  perform public.save_owned_arrow(v_end, 1, 8, false, 0.31, 0.02, null, v_arrow);
  perform public.save_owned_arrow(v_end, 1, 8, false, null, null, null, v_arrow);
  if not exists (select 1 from public.arrows where id = v_arrow and plot_x is null and plot_y is null) then
    raise exception 'FAIL: clear marker';
  end if;
  if not public.delete_owned_arrow(v_end, null, v_arrow) then raise exception 'FAIL: delete saved Arrow'; end if;
  if public.delete_owned_arrow(v_end, 1) then raise exception 'FAIL: missing owned slot should return false'; end if;
  select id into v_arrow from public.save_owned_arrow(v_end, 1, 0, false, 1.4, 0.2, null);
  perform set_config('guard.arrow', v_arrow::text, true);
  if not exists (select 1 from public.arrows where id = v_arrow and score_points = 0 and plot_x = 1.4) then
    raise exception 'FAIL: miss plotting/re-entry';
  end if;
end;
$$;

-- Every direct table mutation is denied, including the former arrow_count column grant.
select pg_temp.expect_sqlstate($q$insert into public.sessions (user_id,title,session_date) values (auth.uid(),'Denied',current_date)$q$, '42501');
select pg_temp.expect_sqlstate($q$update public.sessions set arrow_count=1 where id=current_setting('guard.session')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$delete from public.sessions where id=current_setting('guard.session')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$insert into public.session_rounds (session_id,round_number,name,division,distance_metres,face_diameter_cm,face_type,planned_ends,arrows_per_end) values (current_setting('guard.session')::uuid,99,'Denied','Recurve',70,122,'full_face',1,6)$q$, '42501');
select pg_temp.expect_sqlstate($q$update public.session_rounds set name='Denied' where id=current_setting('guard.round')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$delete from public.session_rounds where id=current_setting('guard.round')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$insert into public.session_ends (session_round_id,end_number) values (current_setting('guard.round')::uuid,99)$q$, '42501');
select pg_temp.expect_sqlstate($q$update public.session_ends set end_number=2 where id=current_setting('guard.end')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$delete from public.session_ends where id=current_setting('guard.end')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$insert into public.arrows (session_end_id,arrow_number,score_points) values (current_setting('guard.end')::uuid,2,9)$q$, '42501');
select pg_temp.expect_sqlstate($q$update public.arrows set score_points=9 where id=current_setting('guard.arrow')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$delete from public.arrows where id=current_setting('guard.arrow')::uuid$q$, '42501');

-- Explicit validation errors; unrelated errors must fail this fixture.
select pg_temp.expect_sqlstate($q$select public.create_owned_session(repeat('a',81),current_date,'training')$q$, '22023', 'Invalid Session input.');
select pg_temp.expect_sqlstate($q$select public.create_owned_session('Valid',current_date,'invalid')$q$, '22023', 'Invalid Session input.');
select pg_temp.expect_sqlstate($q$select public.create_owned_session('Valid',null,'training')$q$, '22023', 'Invalid Session input.');
select pg_temp.expect_sqlstate($q$select public.create_owned_session('Valid','infinity'::date,'training')$q$, '22023', 'Invalid Session input.');
select pg_temp.expect_sqlstate($q$select public.update_owned_session_arrow_count(current_setting('guard.session')::uuid,-1)$q$, '22023', 'Arrow count must be a non-negative whole number.');
select pg_temp.expect_sqlstate($q$select public.update_owned_session_arrow_count(current_setting('guard.session')::uuid,null)$q$, '22023', 'Arrow count must be a non-negative whole number.');
select pg_temp.expect_sqlstate($q$select public.save_owned_arrow(current_setting('guard.end')::uuid,0,9,false,null,null,null,null)$q$, '22023', 'The Arrow slot is invalid for the planned End.');
select pg_temp.expect_sqlstate($q$select public.save_owned_arrow(current_setting('guard.end')::uuid,7,9,false,null,null,null,null)$q$, '22023', 'The Arrow slot is invalid for the planned End.');
select pg_temp.expect_sqlstate($q$select public.save_owned_arrow(current_setting('guard.end')::uuid,2,-1,false,null,null,null,null)$q$, '22023', 'The Arrow score is invalid.');
select pg_temp.expect_sqlstate($q$select public.save_owned_arrow(current_setting('guard.end')::uuid,2,11,false,null,null,null,null)$q$, '22023', 'The Arrow score is invalid.');
select pg_temp.expect_sqlstate($q$select public.save_owned_arrow(current_setting('guard.end')::uuid,2,9,true,null,null,null,null)$q$, '22023', 'The Arrow score is invalid.');
select pg_temp.expect_sqlstate($q$select public.save_owned_arrow(current_setting('guard.end')::uuid,2,9,null,null,null,null,null)$q$, '22023', 'The Arrow score is invalid.');
select pg_temp.expect_sqlstate($q$select public.save_owned_arrow(current_setting('guard.end')::uuid,2,9,false,0.1,null,null,null)$q$, '22023', 'The plotted position is invalid.');
select pg_temp.expect_sqlstate($q$select public.save_owned_arrow(current_setting('guard.end')::uuid,2,9,false,'NaN'::double precision,0,null,null)$q$, '22023', 'The plotted position is invalid.');
select pg_temp.expect_sqlstate($q$select public.save_owned_arrow(current_setting('guard.end')::uuid,2,9,false,'Infinity'::double precision,0,null,null)$q$, '22023', 'The plotted position is invalid.');
select pg_temp.expect_sqlstate($q$select public.save_owned_arrow(current_setting('guard.end')::uuid,2,9,false,0,'-Infinity'::double precision,null,null)$q$, '22023', 'The plotted position is invalid.');
select pg_temp.expect_sqlstate($q$select public.save_owned_arrow(current_setting('guard.end')::uuid,2,9,false,2.01,0,null,null)$q$, '22023', 'The plotted position is invalid.');
select pg_temp.expect_sqlstate($q$select public.save_owned_arrow(current_setting('guard.end')::uuid,2,9,false,null,null,0,null)$q$, '22023', 'The target-face position is invalid.');
select pg_temp.expect_sqlstate($q$select public.save_owned_arrow(current_setting('guard.end')::uuid,2,9,false,0,0,0,null)$q$, '22023', 'The target-face position is invalid.');
select pg_temp.expect_sqlstate($q$select public.save_owned_arrow(current_setting('guard.end')::uuid,2,9,false,0,0,null,current_setting('guard.arrow')::uuid)$q$, '22023', 'The saved Arrow does not match this slot.');

do $$ begin
  if exists (select 1 from public.arrows where session_end_id=current_setting('guard.end')::uuid and arrow_number=2)
    or not exists (select 1 from public.arrows where id=current_setting('guard.arrow')::uuid
      and score_points=0 and plot_x=1.4 and plot_y=0.2) then
    raise exception 'FAIL: rejected saves changed confirmed data';
  end if;
  if public.delete_owned_arrow(current_setting('guard.end')::uuid,2,current_setting('guard.arrow')::uuid) then
    raise exception 'FAIL: conflicting delete identities removed another slot';
  end if;
end; $$;

-- Six-ring/triple-face plotting and exact permitted coordinate extremes.
do $$
declare v_round uuid; v_end uuid;
begin
  select round_id into v_round from public.create_round_with_ends(
    current_setting('guard.session')::uuid,'Six ring','Compound',50,80,'six_ring',1,6);
  select id into v_end from public.session_ends where session_round_id=v_round and end_number=1;
  perform public.save_owned_arrow(v_end,1,0,false,-2,2,null);
  select round_id into v_round from public.create_round_with_ends(
    current_setting('guard.session')::uuid,'Triple','Recurve',18,40,'triple_face',1,6);
  select id into v_end from public.session_ends where session_round_id=v_round and end_number=1;
  perform set_config('guard.triple_end',v_end::text,true);
  perform public.save_owned_arrow(v_end,1,10,true,0.05,0,0);
  perform public.save_owned_arrow(v_end,2,9,false,0.15,0,1);
  perform public.save_owned_arrow(v_end,3,8,false,0.25,0,2);
end;
$$;
select pg_temp.expect_sqlstate($q$select public.save_owned_arrow(current_setting('guard.triple_end')::uuid,4,9,false,0,0,null)$q$, '22023', 'The target-face position is invalid.');
select pg_temp.expect_sqlstate($q$select public.save_owned_arrow(current_setting('guard.triple_end')::uuid,4,9,false,0,0,3)$q$, '22023', 'The target-face position is invalid.');

reset role;
-- Deliberately malformed legacy End proves parent planned-End validation independently.
insert into public.session_ends (session_round_id,end_number)
values (current_setting('guard.round')::uuid,99) returning set_config('guard.invalid_end',id::text,true);
select set_config('request.jwt.claim.sub', current_setting('guard.owner'), true);
set local role authenticated;
select pg_temp.expect_sqlstate($q$select public.save_owned_arrow(current_setting('guard.invalid_end')::uuid,1,9,false,null,null,null)$q$, '22023', 'The Arrow slot is invalid for the planned End.');

-- Another Archer and a legitimate read-authorised Coach must both fail owner writes.
reset role;
select set_config('request.jwt.claim.sub', current_setting('guard.other'), true);
select set_config('request.jwt.claims', json_build_object('sub',current_setting('guard.other'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.sessions where id=current_setting('guard.session')::uuid)
    or exists (select 1 from public.arrows where id=current_setting('guard.arrow')::uuid) then
    raise exception 'FAIL: another Archer read owner data';
  end if;
end; $$;
select pg_temp.expect_sqlstate($q$select public.save_owned_arrow(current_setting('guard.end')::uuid,1,9,false,null,null,null)$q$, '42501', 'The End is not owned by the signed-in user.');
select pg_temp.expect_sqlstate($q$select public.delete_owned_arrow(current_setting('guard.end')::uuid,1)$q$, '42501', 'The End is not owned by the signed-in user.');
select pg_temp.expect_sqlstate($q$select public.delete_owned_round(current_setting('guard.round')::uuid)$q$, '42501', 'The Round is not owned by the signed-in user in the supplied Session.');
select pg_temp.expect_sqlstate($q$select public.delete_owned_session(current_setting('guard.session')::uuid)$q$, '42501', 'The Session is not owned by the signed-in user.');
select pg_temp.expect_sqlstate($q$select public.update_owned_session_arrow_count(current_setting('guard.session')::uuid,100)$q$, '42501', 'The Session is not owned by the signed-in user.');
select pg_temp.expect_sqlstate($q$select public.create_round_with_ends(current_setting('guard.session')::uuid,'Denied','Recurve',70,122,'full_face',1,6)$q$, '42501', 'The Session is not owned by the signed-in user.');
select pg_temp.expect_sqlstate($q$insert into public.sessions (user_id,title,session_date) values (auth.uid(),'Denied',current_date)$q$, '42501');
select pg_temp.expect_sqlstate($q$update public.sessions set arrow_count=1 where id=current_setting('guard.session')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$delete from public.sessions where id=current_setting('guard.session')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$insert into public.session_rounds (session_id,round_number,name,division,distance_metres,face_diameter_cm,face_type,planned_ends,arrows_per_end) values (current_setting('guard.session')::uuid,99,'Denied','Recurve',70,122,'full_face',1,6)$q$, '42501');
select pg_temp.expect_sqlstate($q$update public.session_rounds set name='Denied' where id=current_setting('guard.round')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$delete from public.session_rounds where id=current_setting('guard.round')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$insert into public.session_ends (session_round_id,end_number) values (current_setting('guard.round')::uuid,99)$q$, '42501');
select pg_temp.expect_sqlstate($q$update public.session_ends set end_number=2 where id=current_setting('guard.end')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$delete from public.session_ends where id=current_setting('guard.end')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$insert into public.arrows (session_end_id,arrow_number,score_points) values (current_setting('guard.end')::uuid,2,9)$q$, '42501');
select pg_temp.expect_sqlstate($q$update public.arrows set score_points=9 where id=current_setting('guard.arrow')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$delete from public.arrows where id=current_setting('guard.arrow')::uuid$q$, '42501');
reset role;
select set_config('request.jwt.claim.sub', current_setting('guard.coach'), true);
select set_config('request.jwt.claims', json_build_object('sub',current_setting('guard.coach'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if not exists (select 1 from public.sessions where id=current_setting('guard.session')::uuid)
    or not exists (select 1 from public.session_rounds where id=current_setting('guard.round')::uuid)
    or not exists (select 1 from public.session_ends where id=current_setting('guard.end')::uuid)
    or not exists (select 1 from public.arrows where id=current_setting('guard.arrow')::uuid) then
    raise exception 'FAIL: legitimate Coach hierarchy read regressed';
  end if;
end; $$;
select pg_temp.expect_sqlstate($q$select public.save_owned_arrow(current_setting('guard.end')::uuid,1,9,false,null,null,null)$q$, '42501', 'The End is not owned by the signed-in user.');
select pg_temp.expect_sqlstate($q$select public.delete_owned_arrow(current_setting('guard.end')::uuid,1)$q$, '42501', 'The End is not owned by the signed-in user.');
select pg_temp.expect_sqlstate($q$select public.delete_owned_round(current_setting('guard.round')::uuid)$q$, '42501', 'The Round is not owned by the signed-in user in the supplied Session.');
select pg_temp.expect_sqlstate($q$select public.delete_owned_session(current_setting('guard.session')::uuid)$q$, '42501', 'The Session is not owned by the signed-in user.');
select pg_temp.expect_sqlstate($q$select public.update_owned_session_arrow_count(current_setting('guard.session')::uuid,100)$q$, '42501', 'The Session is not owned by the signed-in user.');
select pg_temp.expect_sqlstate($q$select public.create_round_with_ends(current_setting('guard.session')::uuid,'Denied','Recurve',70,122,'full_face',1,6)$q$, '42501', 'The Session is not owned by the signed-in user.');
select pg_temp.expect_sqlstate($q$insert into public.sessions (user_id,title,session_date) values (auth.uid(),'Denied',current_date)$q$, '42501');
select pg_temp.expect_sqlstate($q$update public.sessions set arrow_count=1 where id=current_setting('guard.session')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$delete from public.sessions where id=current_setting('guard.session')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$insert into public.session_rounds (session_id,round_number,name,division,distance_metres,face_diameter_cm,face_type,planned_ends,arrows_per_end) values (current_setting('guard.session')::uuid,99,'Denied','Recurve',70,122,'full_face',1,6)$q$, '42501');
select pg_temp.expect_sqlstate($q$update public.session_rounds set name='Denied' where id=current_setting('guard.round')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$delete from public.session_rounds where id=current_setting('guard.round')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$insert into public.session_ends (session_round_id,end_number) values (current_setting('guard.round')::uuid,99)$q$, '42501');
select pg_temp.expect_sqlstate($q$update public.session_ends set end_number=2 where id=current_setting('guard.end')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$delete from public.session_ends where id=current_setting('guard.end')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$insert into public.arrows (session_end_id,arrow_number,score_points) values (current_setting('guard.end')::uuid,2,9)$q$, '42501');
select pg_temp.expect_sqlstate($q$update public.arrows set score_points=9 where id=current_setting('guard.arrow')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$delete from public.arrows where id=current_setting('guard.arrow')::uuid$q$, '42501');
reset role;

-- Every client role must lack all direct mutations, including any column-level grant.
do $$
declare v_table text; v_role text; v_privilege text; v_function record;
begin
  foreach v_role in array array['authenticated','anon'] loop
    foreach v_table in array array['sessions','session_rounds','session_ends','arrows'] loop
      foreach v_privilege in array array['INSERT','UPDATE','DELETE'] loop
        if has_table_privilege(v_role,'public.'||v_table,v_privilege) then
          raise exception 'FAIL: direct % still granted on % to %',v_privilege,v_table,v_role;
        end if;
      end loop;
      if has_any_column_privilege(v_role,'public.'||v_table,'INSERT')
        or has_any_column_privilege(v_role,'public.'||v_table,'UPDATE') then
        raise exception 'FAIL: column mutation still granted on % to %',v_table,v_role;
      end if;
    end loop;
  end loop;
  for v_function in select p.oid,p.proname,n.nspname
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.proname in (
      'create_owned_session','update_owned_session_arrow_count','delete_owned_session',
      'delete_owned_round','save_owned_arrow','delete_owned_arrow') loop
    if has_function_privilege('anon',v_function.oid,'EXECUTE')
      or not has_function_privilege('authenticated',v_function.oid,'EXECUTE')
      or exists (select 1 from aclexplode(coalesce((select proacl from pg_proc where oid=v_function.oid),
        acldefault('f',(select proowner from pg_proc where oid=v_function.oid)))) a
        where a.grantee=0 and a.privilege_type='EXECUTE') then
      raise exception 'FAIL: incorrect RPC EXECUTE grants for %.%',v_function.nspname,v_function.proname;
    end if;
  end loop;
end;
$$;

select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select pg_temp.expect_sqlstate($q$select * from public.sessions$q$,'42501');
select pg_temp.expect_sqlstate($q$insert into public.sessions (user_id,title,session_date) values (auth.uid(),'Denied',current_date)$q$, '42501');
select pg_temp.expect_sqlstate($q$update public.sessions set arrow_count=1 where id=current_setting('guard.session')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$delete from public.sessions where id=current_setting('guard.session')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$select * from public.session_rounds$q$,'42501');
select pg_temp.expect_sqlstate($q$insert into public.session_rounds (session_id,round_number,name,division,distance_metres,face_diameter_cm,face_type,planned_ends,arrows_per_end) values (current_setting('guard.session')::uuid,99,'Denied','Recurve',70,122,'full_face',1,6)$q$, '42501');
select pg_temp.expect_sqlstate($q$update public.session_rounds set name='Denied' where id=current_setting('guard.round')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$delete from public.session_rounds where id=current_setting('guard.round')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$select * from public.session_ends$q$,'42501');
select pg_temp.expect_sqlstate($q$insert into public.session_ends (session_round_id,end_number) values (current_setting('guard.round')::uuid,99)$q$, '42501');
select pg_temp.expect_sqlstate($q$update public.session_ends set end_number=2 where id=current_setting('guard.end')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$delete from public.session_ends where id=current_setting('guard.end')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$select * from public.arrows$q$,'42501');
select pg_temp.expect_sqlstate($q$insert into public.arrows (session_end_id,arrow_number,score_points) values (current_setting('guard.end')::uuid,2,9)$q$, '42501');
select pg_temp.expect_sqlstate($q$update public.arrows set score_points=9 where id=current_setting('guard.arrow')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$delete from public.arrows where id=current_setting('guard.arrow')::uuid$q$, '42501');
select pg_temp.expect_sqlstate($q$select public.create_owned_session('Denied',current_date,'training')$q$,'42501');
select pg_temp.expect_sqlstate($q$select public.update_owned_session_arrow_count(current_setting('guard.session')::uuid,1)$q$,'42501');
select pg_temp.expect_sqlstate($q$select public.delete_owned_session(current_setting('guard.session')::uuid)$q$,'42501');
select pg_temp.expect_sqlstate($q$select public.delete_owned_round(current_setting('guard.round')::uuid)$q$,'42501');
select pg_temp.expect_sqlstate($q$select public.save_owned_arrow(current_setting('guard.end')::uuid,1,9,false,null,null,null)$q$,'42501');
select pg_temp.expect_sqlstate($q$select public.delete_owned_arrow(current_setting('guard.end')::uuid,1)$q$,'42501');

reset role;
-- The function itself rejects a missing user, independently of anonymous EXECUTE denial.
set local role authenticated;
select pg_temp.expect_sqlstate($q$select public.create_owned_session('Denied',current_date,'training')$q$,'42501','Sign in is required.');
reset role;

select set_config('request.jwt.claim.sub',current_setting('guard.owner'),true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('guard.owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare v_round uuid; v_end uuid; v_arrow uuid; v_session uuid; v_deleted boolean;
begin
  select round_id into v_round from public.create_round_with_ends(
    current_setting('guard.session')::uuid,'Cascade Round','Other',18,40,'full_face',1,6);
  select id into v_end from public.session_ends where session_round_id=v_round;
  select id into v_arrow from public.save_owned_arrow(v_end,1,9,false,null,null,null);
  -- Complete the mutation before querying its cascades in a fresh statement.
  v_deleted := public.delete_owned_round(v_round,current_setting('guard.session')::uuid);
  if not v_deleted
    or exists (select 1 from public.session_ends where id=v_end)
    or exists (select 1 from public.arrows where id=v_arrow)
    or not exists (select 1 from public.session_rounds where id=current_setting('guard.round')::uuid) then
    raise exception 'FAIL: Round cascade or sibling preservation';
  end if;
  select id into v_session from public.create_owned_session('Competition',current_date,'competition');
  if not exists(select 1 from public.sessions where id=v_session and session_type='competition') then
    raise exception 'FAIL: Competition creation';
  end if;
  perform public.delete_owned_session(v_session);
  v_deleted := public.delete_owned_session(current_setting('guard.session')::uuid);
  if not v_deleted
    or exists(select 1 from public.session_rounds where id=current_setting('guard.round')::uuid)
    or exists(select 1 from public.session_ends where id=current_setting('guard.end')::uuid)
    or exists(select 1 from public.arrows where id=current_setting('guard.arrow')::uuid) then
    raise exception 'FAIL: Session cascade';
  end if;
end;
$$;
reset role;
rollback;
