-- PROPOSAL ONLY. Run only in a disposable database after coach_workspace_v3_future.sql is approved.
-- All temporary Auth and application rows roll back.
begin;

create function pg_temp.expect_rejection(statement text) returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'Expected rejection was not raised';
exception when others then
  if sqlerrm = 'Expected rejection was not raised' then raise; end if;
end;
$$;

select set_config('v3.coach', gen_random_uuid()::text, true);
select set_config('v3.other_coach', gen_random_uuid()::text, true);
select set_config('v3.archer', gen_random_uuid()::text, true);
select set_config('v3.session', gen_random_uuid()::text, true);
select set_config('v3.review', gen_random_uuid()::text, true);
select set_config('v3.note', gen_random_uuid()::text, true);
select set_config('v3.view', gen_random_uuid()::text, true);
insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
select id, 'authenticated', 'authenticated', 'v3-' || id || '@example.invalid', now(), now(), now()
from (values (current_setting('v3.coach')::uuid), (current_setting('v3.other_coach')::uuid), (current_setting('v3.archer')::uuid)) fixture(id);

select set_config('request.jwt.claim.sub', current_setting('v3.coach'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v3.coach'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare v_id uuid; begin
  insert into public.organizations (name, created_by) values ('V3 fixture', auth.uid()) returning id into v_id;
  perform set_config('v3.org', v_id::text, true);
end $$;
reset role;
select set_config('v3.code', join_code, true) from public.organizations where id = current_setting('v3.org')::uuid;
insert into public.organization_members (organization_id, user_id, role, status)
values (current_setting('v3.org')::uuid, current_setting('v3.archer')::uuid, 'archer', 'active');

select set_config('request.jwt.claim.sub', current_setting('v3.archer'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v3.archer'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.sessions (id, user_id, title, session_date)
values (current_setting('v3.session')::uuid, auth.uid(), 'V3 owner Session', current_date);
do $$ begin
  if private.coach_can_access_session(current_setting('v3.org')::uuid, current_setting('v3.session')::uuid) then
    raise exception 'Archer was accepted as Coach';
  end if;
end $$;
select pg_temp.expect_rejection(format('insert into public.coach_session_reviews (organization_id, session_id, reviewed_by) values (%L, %L, %L)',
  current_setting('v3.org'), current_setting('v3.session'), current_setting('v3.archer')));

reset role;
select set_config('request.jwt.claim.sub', current_setting('v3.coach'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v3.coach'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if not private.coach_can_access_session(current_setting('v3.org')::uuid, current_setting('v3.session')::uuid) then
    raise exception 'Active Coach cannot access active Archer Session';
  end if;
end $$;
insert into public.coach_session_reviews (id, organization_id, session_id, reviewed_by)
values (current_setting('v3.review')::uuid, current_setting('v3.org')::uuid, current_setting('v3.session')::uuid, auth.uid());
insert into public.coach_notes (id, organization_id, session_id, author_id, body)
values (current_setting('v3.note')::uuid, current_setting('v3.org')::uuid, current_setting('v3.session')::uuid, auth.uid(), 'Fixture note');
insert into public.coach_saved_views (id, organization_id, coach_user_id, name, filters)
values (current_setting('v3.view')::uuid, current_setting('v3.org')::uuid, auth.uid(), 'Fixture view', '{"period":"30"}');
do $$ begin
  if (select count(*) from public.coach_session_reviews where id = current_setting('v3.review')::uuid) <> 1
    or (select count(*) from public.coach_notes where id = current_setting('v3.note')::uuid) <> 1
    or (select count(*) from public.coach_saved_views where id = current_setting('v3.view')::uuid) <> 1 then
    raise exception 'Coach workflow rows were not readable by the active Coach';
  end if;
end $$;
select pg_temp.expect_rejection(format('update public.coach_session_reviews set reviewed_by = %L where id = %L',
  current_setting('v3.other_coach'), current_setting('v3.review')));

reset role;
select set_config('request.jwt.claim.sub', current_setting('v3.other_coach'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v3.other_coach'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.coach_session_reviews where id = current_setting('v3.review')::uuid)
    or exists (select 1 from public.coach_notes where id = current_setting('v3.note')::uuid)
    or exists (select 1 from public.coach_saved_views where id = current_setting('v3.view')::uuid) then
    raise exception 'Nonmember Coach read another organisation workflow row';
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', current_setting('v3.archer'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v3.archer'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.coach_session_reviews where id = current_setting('v3.review')::uuid)
    or exists (select 1 from public.coach_notes where id = current_setting('v3.note')::uuid) then
    raise exception 'Archer read Coach workflow data';
  end if;
  if not public.leave_organization(current_setting('v3.org')::uuid) then raise exception 'Archer could not leave'; end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', current_setting('v3.coach'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v3.coach'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.coach_session_reviews where id = current_setting('v3.review')::uuid)
    or exists (select 1 from public.coach_notes where id = current_setting('v3.note')::uuid) then
    raise exception 'Coach kept review/notes access after Archer left';
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', current_setting('v3.archer'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v3.archer'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if public.join_organization_by_code(current_setting('v3.code')) <> 'joined' then raise exception 'Archer could not rejoin'; end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', current_setting('v3.coach'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v3.coach'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if not exists (select 1 from public.coach_session_reviews where id = current_setting('v3.review')::uuid) then
    raise exception 'Coach access did not return after Archer rejoined';
  end if;
end $$;
reset role;
rollback;
