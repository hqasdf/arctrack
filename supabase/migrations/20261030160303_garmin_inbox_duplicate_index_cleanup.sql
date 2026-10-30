-- Transactional maintenance: a busy inbox causes a bounded failure, never CASCADE.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '15s';
do $cleanup$
declare
  retained record;
  redundant record;
begin
  -- Lock before inspection so concurrent DDL cannot change the checked objects.
  lock table public.garmin_health_inbox in access exclusive mode;
  select i.*, c.relam into retained from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid=i.indexrelid
    where i.indexrelid=to_regclass('public.garmin_health_inbox_pending');
  if not found or retained.indrelid <> 'public.garmin_health_inbox'::regclass
    or not retained.indisvalid or not retained.indisready
    or retained.indisunique or retained.indisprimary or retained.indisexclusion
    or retained.indisreplident
    or retained.indnkeyatts <> 2 or retained.indnatts <> 2
    or retained.indoption::text <> '0 0'
    or pg_get_indexdef(retained.indexrelid,1,true) <> 'user_id'
    or pg_get_indexdef(retained.indexrelid,2,true) <> 'id'
    or pg_get_expr(retained.indpred,retained.indrelid) is distinct from '(state = ''pending''::text)'
    or retained.indexprs is not null
    or retained.relam <> (select oid from pg_catalog.pg_am where amname='btree')
  then raise exception 'Retained Garmin pending index does not match reviewed structure'; end if;

  select i.*, c.relam into redundant from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid=i.indexrelid
    where i.indexrelid=to_regclass('public.garmin_health_inbox_owner_dispatch');
  if not found then return; end if;
  if not redundant.indisvalid or not redundant.indisready
    or redundant.indisunique or redundant.indisprimary or redundant.indisexclusion
    or redundant.indisreplident
    or (redundant.indrelid,redundant.relam,redundant.indnatts,redundant.indnkeyatts,
        redundant.indkey,redundant.indclass,redundant.indcollation,redundant.indoption)
      is distinct from
       (retained.indrelid,retained.relam,retained.indnatts,retained.indnkeyatts,
        retained.indkey,retained.indclass,retained.indcollation,retained.indoption)
    or pg_get_expr(redundant.indpred,redundant.indrelid)
      is distinct from pg_get_expr(retained.indpred,retained.indrelid)
    or redundant.indexprs is not null
    or exists(select 1 from pg_catalog.pg_depend where refobjid=redundant.indexrelid)
    or exists(select 1 from pg_catalog.pg_constraint where conindid=redundant.indexrelid)
  then raise exception 'Garmin owner dispatch index is not an independent equivalent duplicate'; end if;
  drop index public.garmin_health_inbox_owner_dispatch restrict;
end
$cleanup$;
commit;
