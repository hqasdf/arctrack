-- Delete only the Live Coaching aggregate. Existing FK cascades erase its
-- invitations, HR controls/history and End activity, never athlete scoring data.
create function private.delete_live_coaching(p_id uuid,p_org uuid,p_expected bigint)
returns uuid language plpgsql security definer set search_path='' set lock_timeout='3s' as $$
declare actor uuid:=(select auth.uid()); training public.live_coaching_sessions%rowtype;
begin
 if actor is null or p_id is null or p_org is null then
  raise exception 'Coach context required' using errcode='42501';
 end if;
 -- Same lock order as lifecycle and HR commands: training, then membership.
 select * into training from public.live_coaching_sessions where id=p_id for update;
 perform 1 from public.organization_members where organization_id=p_org and user_id=actor
  and role='head_coach' and status='active' for share;
 if not found then raise exception 'Coach access required' using errcode='42501';end if;
 -- An absent UUID is a successful no-op only after current coach authorization.
 -- No tombstone or historical athlete data is needed for this no-op.
 if training.id is null then return p_id;end if;
 if training.organization_id<>p_org or training.created_by<>actor then
  raise exception 'Training owner required' using errcode='42501';
 end if;
 if training.version is distinct from p_expected then
  raise exception 'Training changed; reload before deleting' using errcode='40001';
 end if;
 -- Broadcast has no data payload and is delivered only after commit. Readers,
 -- HR admission and subscription reauthorization then fail closed for this UUID.
 perform private.emit_live_coaching(training.id);
 delete from public.live_coaching_sessions where id=training.id;
 return p_id;
end;$$;
revoke all on function private.delete_live_coaching(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function private.delete_live_coaching(uuid,uuid,bigint) to authenticated;
create function public.delete_live_coaching(p_id uuid,p_org uuid,p_expected bigint)
returns uuid language sql security invoker set search_path='' as $$
 select private.delete_live_coaching(p_id,p_org,p_expected);
$$;
revoke all on function public.delete_live_coaching(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.delete_live_coaching(uuid,uuid,bigint) to authenticated;
