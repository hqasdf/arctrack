-- DISPOSABLE DATABASE ONLY. Requires both local Garmin migrations.
-- Keep all synthetic data inside BEGIN / ROLLBACK.
begin;
create function pg_temp.garmin_delete_assert(p_ok boolean, p_label text)
returns void language plpgsql security invoker as $$
begin if p_ok is distinct from true then raise exception 'FAIL: %', p_label; end if; end;
$$;
create function pg_temp.garmin_delete_reject(p_sql text, p_state text)
returns void language plpgsql security invoker as $$
declare v_state text;
begin
  begin execute p_sql;
  exception when others then
    get stacked diagnostics v_state=returned_sqlstate;
    if v_state <> p_state then raise exception 'Expected %, got %',p_state,v_state; end if;
    return;
  end;
  raise exception 'Expected rejection: %',p_sql;
end;
$$;
select set_config('garmin.delete_user',gen_random_uuid()::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
values(current_setting('garmin.delete_user')::uuid,'authenticated','authenticated','garmin-delete-fixture@example.invalid',now(),now(),now());
set local role service_role;
insert into public.garmin_connections(user_id,garmin_user_id,status,token_ciphertext,access_expires_at,refresh_after)
values(current_setting('garmin.delete_user')::uuid,'delete-fixture-garmin','connected','original-encrypted-credentials',now()+interval '1 hour',now()+interval '30 minutes');
-- No fence can invalidate a normal in-flight operation, even an expired one.
update public.garmin_connections set operation='refresh',lease_until=now()-interval '1 second'
where user_id=current_setting('garmin.delete_user')::uuid;
select pg_temp.garmin_delete_reject('update public.garmin_connections set operation=''delete'',deletion_requested_at=now(),lease_until=now()+interval ''1 minute'' where user_id=current_setting(''garmin.delete_user'')::uuid','40001');
select pg_temp.garmin_delete_assert((select deletion_requested_at is null and token_ciphertext='original-encrypted-credentials'
  from public.garmin_connections where user_id=current_setting('garmin.delete_user')::uuid),'Busy delete leaves credentials/fence unchanged');
update public.garmin_connections set operation=null,lease_until=null where user_id=current_setting('garmin.delete_user')::uuid;
update public.garmin_connections set operation='delete',lease_until=now()+interval '1 minute',deletion_requested_at=now(),version=gen_random_uuid()
where user_id=current_setting('garmin.delete_user')::uuid and operation is null;
select set_config('garmin.delete_version',(select version::text from public.garmin_connections where user_id=current_setting('garmin.delete_user')::uuid),true);
-- Rotated credentials are checkpointed without giving up the deletion lease/version.
update public.garmin_connections set token_ciphertext='rotated-encrypted-credentials',access_expires_at=now()+interval '1 hour',refresh_after=now()+interval '30 minutes'
where user_id=current_setting('garmin.delete_user')::uuid and version=current_setting('garmin.delete_version')::uuid;
select pg_temp.garmin_delete_assert((select token_ciphertext='rotated-encrypted-credentials' and version=current_setting('garmin.delete_version')::uuid and operation='delete'
  from public.garmin_connections where user_id=current_setting('garmin.delete_user')::uuid),'Rotation checkpoint retains fence/version/lease');
select pg_temp.garmin_delete_reject('update public.garmin_connections set deletion_requested_at=null where user_id=current_setting(''garmin.delete_user'')::uuid','40001');
select pg_temp.garmin_delete_reject('update public.garmin_connections set deletion_requested_at=now()+interval ''1 second'' where user_id=current_setting(''garmin.delete_user'')::uuid','40001');
update public.garmin_connections set lease_until=now()-interval '1 second' where user_id=current_setting('garmin.delete_user')::uuid;
select pg_temp.garmin_delete_reject('update public.garmin_connections set operation=''authorize'',lease_until=now()+interval ''1 minute'' where user_id=current_setting(''garmin.delete_user'')::uuid','40001');
select pg_temp.garmin_delete_reject('insert into public.garmin_oauth_transactions(user_id,state_hash,binding_hash,verifier_ciphertext,connection_version,redirect_uri)
values(current_setting(''garmin.delete_user'')::uuid,repeat(''a'',64),repeat(''b'',64),''encrypted'',current_setting(''garmin.delete_version'')::uuid,''https://example.invalid/callback'')','40001');
-- Retry only the deletion operation after lease expiration; preserve credentials.
update public.garmin_connections set operation='delete',lease_until=now()+interval '1 minute',version=gen_random_uuid()
where user_id=current_setting('garmin.delete_user')::uuid and operation='delete' and lease_until<now();
select pg_temp.garmin_delete_assert((select deletion_requested_at is not null and token_ciphertext='rotated-encrypted-credentials'
  from public.garmin_connections where user_id=current_setting('garmin.delete_user')::uuid),'Retry retains credentials');
-- A confirmed remote result is durably recorded before the Auth cascade.
update public.garmin_connections set status='disconnected',token_ciphertext=null,access_expires_at=null,refresh_expires_at=null,refresh_after=null,
  garmin_user_id=null,permissions='[]',operation=null,lease_until=null,deregistered_at=now()
where user_id=current_setting('garmin.delete_user')::uuid;
select pg_temp.garmin_delete_assert((select deregistered_at is not null and deletion_requested_at is not null and token_ciphertext is null
  from public.garmin_connections where user_id=current_setting('garmin.delete_user')::uuid),'Terminal receipt survives before Auth deletion');
reset role;
set local role authenticated;
select pg_temp.garmin_delete_reject('select deletion_requested_at,deregistered_at from public.garmin_connections','42501');
select pg_temp.garmin_delete_reject('update public.garmin_connections set deletion_requested_at=null','42501');
reset role;
select pg_temp.garmin_delete_assert(not has_function_privilege('authenticated','private.guard_garmin_deletion_fence()','execute'),'No authenticated helper execute');
set local role anon;
select pg_temp.garmin_delete_reject('select * from public.garmin_connections','42501');
reset role;
delete from auth.users where id=current_setting('garmin.delete_user')::uuid;
select pg_temp.garmin_delete_assert(not exists(select 1 from public.garmin_connections where user_id=current_setting('garmin.delete_user')::uuid),'Auth cascade removes terminal receipt');
select 'Garmin deletion fence assertions passed' as result;
rollback;
