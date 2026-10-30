import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

export async function testIndexCleanup(db, check, pg, configuration) {
  const sql = await readFile(new URL('../supabase/migrations/20261030160303_garmin_inbox_duplicate_index_cleanup.sql', import.meta.url), 'utf8');
  const snapshot = async () => (await db.query(`select
    (select jsonb_agg(to_jsonb(t) order by id) from public.garmin_health_inbox t) receipts,
    (select jsonb_agg(to_jsonb(t) order by user_id) from public.garmin_connections t) connections,
    (select jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proacl) order by p.oid)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and p.proname like '%garmin%') functions,
    (select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p) policies,
    (select jsonb_agg(jsonb_build_array(c.oid,c.relacl,c.relrowsecurity) order by c.oid)
      from pg_class c where c.relname like 'garmin%' and c.relkind='r') grants`)).rows[0];
  const before = await snapshot();
  const blocker = new pg.Client(configuration);
  await blocker.connect();
  try {
    await blocker.query('begin');
    await blocker.query('lock table public.garmin_health_inbox in row exclusive mode');
    const started = Date.now();
    let code;
    try { await db.query(sql); } catch (error) { code = error.code; }
    await db.query('rollback');
    check(code === '55P03', 'Index cleanup times out rather than waiting indefinitely on active writers');
    check(Date.now() - started < 10000, 'DDL lock wait is bounded');
    check((await db.query("select to_regclass('public.garmin_health_inbox_owner_dispatch') is not null ok")).rows[0].ok, 'Timed-out cleanup preserves duplicate and transaction state');
  } finally { await blocker.query('rollback'); await blocker.end(); }
  await db.query(sql);
  check((await db.query("select to_regclass('public.garmin_health_inbox_owner_dispatch') is null ok")).rows[0].ok, 'Cleanup removes only redundant index');
  check((await db.query("select indisvalid and indisready ok from pg_index where indexrelid='public.garmin_health_inbox_pending'::regclass")).rows[0].ok, 'Retained pending index stays valid and ready');
  check(isDeepStrictEqual(before, await snapshot()), 'Pending receipts, OAuth state, function definitions, grants and RLS remain unchanged');
  await db.query(sql);
  check(isDeepStrictEqual(before, await snapshot()), 'Repeated cleanup is harmless');
  const plan = (await db.query("explain (format json) select user_id,id from public.garmin_health_inbox where state='pending' order by user_id,id limit 50")).rows;
  check(JSON.stringify(plan).includes('garmin_health_inbox_pending'), 'Pending-owner dispatch query uses the retained index after cleanup');
  // Drift is rejected even after cleanup: never silently accept a missing retained index.
  await db.query('begin; alter index public.garmin_health_inbox_pending rename to fixture_pending');
  let missing;
  try { await db.query(sql.replace(/^begin;$/m, '').replace(/^commit;$/m, '')); } catch (error) { missing = error.message; }
  await db.query('rollback');
  check(missing?.includes('Retained Garmin'), 'Missing retained index fails closed');
  await db.query('begin; create index garmin_health_inbox_owner_dispatch on public.garmin_health_inbox(id,user_id) where state=\'pending\'');
  let drift;
  try { await db.query(sql.replace(/^begin;$/m, '').replace(/^commit;$/m, '')); } catch (error) { drift = error.message; }
  await db.query('rollback');
  check(drift?.includes('not an independent equivalent'), 'Non-equivalent same-name index is never removed');
  await db.query('set role service_role');
  check(Number.isInteger((await db.query('select public.process_garmin_health_queue(1) n')).rows[0].n), 'Service worker still selects and processes the bounded queue after cleanup');
  await db.query('reset role');
}
