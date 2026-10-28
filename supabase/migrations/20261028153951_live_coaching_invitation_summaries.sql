-- Athlete-owned invitation summaries; no scoring, HR, email or contact fields.
create function private.read_live_coaching_invitations(p_org uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if (select auth.uid()) is null then raise exception 'Sign in required' using errcode='42501';end if;
 return jsonb_build_object('sessions',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id) from (
  select l.id,l.organization_id,l.title,l.training_date,l.state,l.version,l.created_at,
   o.name organization_name,nullif(btrim(profile.display_name),'') coach_name,p.state participation_state
  from public.live_coaching_sessions l
  join public.live_coaching_participants p on p.live_id=l.id and p.athlete_id=(select auth.uid())
  join public.organizations o on o.id=l.organization_id
  left join public.profiles profile on profile.id=l.created_by
  where (p_org is null or l.organization_id=p_org) and l.created_by<>(select auth.uid())
   and private.live_coaching_access(l.id)
  order by l.created_at desc,l.id limit 100
 )x),'[]'::jsonb));
end;$$;
revoke all on function private.read_live_coaching_invitations(uuid) from public,anon,authenticated,service_role;
grant execute on function private.read_live_coaching_invitations(uuid) to authenticated;
create function public.read_live_coaching_invitations(p_org uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
 select private.read_live_coaching_invitations(p_org);
$$;
revoke all on function public.read_live_coaching_invitations(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_live_coaching_invitations(uuid) to authenticated;
