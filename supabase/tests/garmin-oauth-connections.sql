-- DISPOSABLE DATABASE ONLY. Always retain BEGIN / ROLLBACK.
begin;
create function pg_temp.garmin_assert(p_ok boolean, p_label text)
returns void language plpgsql security invoker as $$
begin if p_ok is distinct from true then raise exception 'FAIL: %', p_label; end if; end;
$$;
create function pg_temp.garmin_reject(p_sql text, p_state text)
returns void language plpgsql security invoker as $$
declare v_state text;
begin
  begin execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> p_state then raise exception 'Expected %, got %', p_state, v_state; end if;
    return;
  end;
  raise exception 'Expected rejection: %', p_sql;
end;
$$;
select set_config('garmin.a', gen_random_uuid()::text, true);
select set_config('garmin.b', gen_random_uuid()::text, true);
select set_config('garmin.version', gen_random_uuid()::text, true);
insert into auth.users(id, aud, role, email, email_confirmed_at, created_at, updated_at)
select id, 'authenticated', 'authenticated', 'garmin-' || id || '@example.invalid', now(), now(), now()
from (values(current_setting('garmin.a')::uuid), (current_setting('garmin.b')::uuid)) users(id);

select pg_temp.garmin_assert((select count(*) = 2 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('garmin_connections','garmin_oauth_transactions') and c.relrowsecurity), 'RLS enabled');
select pg_temp.garmin_assert((select count(*) = 0 from pg_policies where schemaname='public'
  and tablename in ('garmin_connections','garmin_oauth_transactions')), 'No client policies');

set local role anon;
select pg_temp.garmin_reject('select * from public.garmin_connections', '42501');
select pg_temp.garmin_reject('select * from public.garmin_oauth_transactions', '42501');
select pg_temp.garmin_reject('insert into public.garmin_oauth_transactions(user_id) values (current_setting(''garmin.a'')::uuid)', '42501');
select pg_temp.garmin_reject('update public.garmin_oauth_transactions set expires_at=now()', '42501');
select pg_temp.garmin_reject('delete from public.garmin_oauth_transactions', '42501');
select pg_temp.garmin_reject('insert into public.garmin_connections(user_id) values (current_setting(''garmin.a'')::uuid)', '42501');
select pg_temp.garmin_reject('update public.garmin_connections set status=''error''', '42501');
select pg_temp.garmin_reject('delete from public.garmin_connections', '42501');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('garmin.a'), true);
select pg_temp.garmin_reject('select * from public.garmin_connections', '42501');
select pg_temp.garmin_reject('select * from public.garmin_oauth_transactions', '42501');
select pg_temp.garmin_reject('insert into public.garmin_oauth_transactions(user_id) values (current_setting(''garmin.a'')::uuid)', '42501');
select pg_temp.garmin_reject('update public.garmin_oauth_transactions set expires_at=now()', '42501');
select pg_temp.garmin_reject('delete from public.garmin_oauth_transactions', '42501');
select pg_temp.garmin_reject('insert into public.garmin_connections(user_id) values (current_setting(''garmin.a'')::uuid)', '42501');
select pg_temp.garmin_reject('update public.garmin_connections set status=''error''', '42501');
select pg_temp.garmin_reject('delete from public.garmin_connections', '42501');
reset role;

set local role service_role;
select pg_temp.garmin_reject('insert into public.garmin_connections(user_id) values (''ffffffff-ffff-4fff-8fff-ffffffffffff''::uuid)', '23503');
insert into public.garmin_connections(user_id, version) values(current_setting('garmin.a')::uuid,current_setting('garmin.version')::uuid);
insert into public.garmin_connections(user_id) values(current_setting('garmin.b')::uuid);
select pg_temp.garmin_assert((select count(*)=2 from public.garmin_connections
  where user_id in(current_setting('garmin.a')::uuid,current_setting('garmin.b')::uuid)), 'Service SELECT/INSERT');
with changed as (update public.garmin_connections set operation='authorize', lease_until=now()+interval '1 minute', version=gen_random_uuid()
  where user_id=current_setting('garmin.a')::uuid and version=current_setting('garmin.version')::uuid returning *)
select pg_temp.garmin_assert((select count(*)=1 from changed), 'Fresh scoped CAS succeeds');
with changed as (update public.garmin_connections set status='error'
  where user_id=current_setting('garmin.a')::uuid and version=current_setting('garmin.version')::uuid returning *)
select pg_temp.garmin_assert((select count(*)=0 from changed), 'Stale version cannot overwrite');
select pg_temp.garmin_assert((select status='disconnected' and operation is null from public.garmin_connections
  where user_id=current_setting('garmin.b')::uuid), 'Other account untouched by scoped CAS');
update public.garmin_connections set garmin_user_id='disposable-garmin-provider-account'
where user_id=current_setting('garmin.a')::uuid;
select pg_temp.garmin_reject('update public.garmin_connections set garmin_user_id=''disposable-garmin-provider-account''
  where user_id=current_setting(''garmin.b'')::uuid', '23505');
select pg_temp.garmin_reject('update public.garmin_connections set status=''connected'' where user_id=current_setting(''garmin.a'')::uuid', '23514');
select pg_temp.garmin_reject('update public.garmin_connections set operation=null where user_id=current_setting(''garmin.a'')::uuid', '23514');
insert into public.garmin_oauth_transactions(user_id,state_hash,binding_hash,verifier_ciphertext,connection_version,redirect_uri)
values(current_setting('garmin.a')::uuid,repeat('a',64),repeat('b',64),'encrypted-fixture-only',(select version from public.garmin_connections where user_id=current_setting('garmin.a')::uuid),'https://example.invalid/api/garmin/callback');
with consumed as(delete from public.garmin_oauth_transactions where user_id=current_setting('garmin.a')::uuid
  and state_hash=repeat('a',64) and binding_hash=repeat('b',64) and expires_at>now() returning *)
select pg_temp.garmin_assert((select count(*)=1 from consumed), 'Single-use callback consume');
with consumed as(delete from public.garmin_oauth_transactions where user_id=current_setting('garmin.a')::uuid and state_hash=repeat('a',64) returning *)
select pg_temp.garmin_assert((select count(*)=0 from consumed), 'Callback replay rejected');
insert into public.garmin_oauth_transactions(user_id,state_hash,binding_hash,verifier_ciphertext,connection_version,redirect_uri)
values(current_setting('garmin.a')::uuid,repeat('a',64),repeat('b',64),'encrypted-fixture-only',(select version from public.garmin_connections where user_id=current_setting('garmin.a')::uuid),'https://example.invalid/api/garmin/callback');
select set_config('garmin.old_version',(select version::text from public.garmin_connections where user_id=current_setting('garmin.a')::uuid),true);
update public.garmin_connections set version=gen_random_uuid(),operation=null,lease_until=null where user_id=current_setting('garmin.a')::uuid;
delete from public.garmin_oauth_transactions where user_id=current_setting('garmin.a')::uuid;
update public.garmin_connections set version=gen_random_uuid(),operation='authorize',lease_until=now()+interval '10 minutes' where user_id=current_setting('garmin.a')::uuid;
insert into public.garmin_oauth_transactions(user_id,state_hash,binding_hash,verifier_ciphertext,connection_version,redirect_uri)
select user_id,repeat('c',64),repeat('d',64),'new-encrypted-fixture',version,'https://example.invalid/api/garmin/callback'
from public.garmin_connections where user_id=current_setting('garmin.a')::uuid;
select pg_temp.garmin_reject('insert into public.garmin_oauth_transactions(user_id,state_hash,binding_hash,verifier_ciphertext,connection_version,redirect_uri)
values(current_setting(''garmin.a'')::uuid,repeat(''a'',64),repeat(''b'',64),''old-encrypted-fixture'',current_setting(''garmin.old_version'')::uuid,''https://example.invalid/api/garmin/callback'')
on conflict(user_id) do update set state_hash=excluded.state_hash,connection_version=excluded.connection_version', '40001');
select pg_temp.garmin_assert((select state_hash=repeat('c',64) from public.garmin_oauth_transactions where user_id=current_setting('garmin.a')::uuid), 'Stale start cannot overwrite newer transaction');
delete from public.garmin_connections where user_id=current_setting('garmin.b')::uuid;
select pg_temp.garmin_assert(not exists(select 1 from public.garmin_connections where user_id=current_setting('garmin.b')::uuid), 'Service DELETE');
reset role;
delete from auth.users where id=current_setting('garmin.a')::uuid;
select pg_temp.garmin_assert(not exists(select 1 from public.garmin_connections where user_id=current_setting('garmin.a')::uuid)
  and not exists(select 1 from public.garmin_oauth_transactions where user_id=current_setting('garmin.a')::uuid), 'Auth deletion cascades credentials and attempts');
select 'Garmin SQL assertions passed' as result;
rollback;
