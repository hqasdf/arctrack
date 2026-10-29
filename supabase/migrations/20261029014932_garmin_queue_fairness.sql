-- Filter logically busy owners before the bounded candidate window, and take
-- only one oldest receipt per owner. Apply SKIP LOCKED before the owner limit,
-- so a window of locked connections cannot hide later healthy owners.
-- Do not clear expired OAuth leases: their remote outcome can be uncertain.
begin;
create index garmin_health_inbox_owner_dispatch on public.garmin_health_inbox(user_id,id) where state='pending';
create or replace function public.process_garmin_health_queue(p_limit integer default 25)
returns integer language plpgsql security invoker set search_path='' as $$
declare c public.garmin_connections%rowtype; ctl public.garmin_health_controls%rowtype;
  processed integer:=0; rejected integer;
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'Invalid Garmin worker batch.' using errcode='22023'; end if;
  for c in select gc.* from public.garmin_health_inbox i
      join public.garmin_connections gc on gc.user_id=i.user_id
      join public.garmin_health_controls control on control.user_id=i.user_id
      where i.state='pending' and gc.operation is null
        and i.id=(select first_receipt.id from public.garmin_health_inbox first_receipt
          where first_receipt.user_id=i.user_id and first_receipt.state='pending'
          order by first_receipt.id limit 1)
      order by i.id limit p_limit for update of gc skip locked loop
    exit when processed>=p_limit;
    if c.operation is not null then continue; end if;
    select * into ctl from public.garmin_health_controls where user_id=c.user_id;
    if not found then continue; end if;
    -- Reject only a bounded batch. Consent notifications remain actionable while paused.
    update public.garmin_health_inbox set state='rejected',payload=null,error_code='connection_changed',completed_at=clock_timestamp()
      where id in (select id from public.garmin_health_inbox where user_id=c.user_id and state='pending'
        and (sync_generation<>ctl.generation or (ctl.paused and kind not in ('userPermissionsChange','deregistrations'))
          or c.status<>'connected' or c.deletion_requested_at is not null or c.error_code is not null)
        order by id limit (p_limit-processed) for update);
    get diagnostics rejected=row_count;
    processed:=processed+rejected;
    if processed<p_limit then
      -- Reuse the reviewed permission/revision/deletion processor under the same row lock.
      processed:=processed+private.process_garmin_health_queue_v1(array[c.user_id],p_limit-processed);
    end if;
  end loop;
  return processed;
end;
$$;
revoke all on function public.process_garmin_health_queue(integer) from public,anon,authenticated,service_role;
grant execute on function public.process_garmin_health_queue(integer) to service_role;
commit;
