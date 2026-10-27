import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ROUND_PRESETS } from '../packages/core/src/round-presets.ts';

export async function testRecentRoundConfigs(db, pg, connection) {
  let passed = 0;
  const check = (value, message) => { assert.ok(value, message); passed++; };
  const a = randomUUID(), b = randomUUID(), sa = randomUUID(), sb = randomUUID();
  const config = { name: 'Custom round', division: 'Barebow', distance: 25, diameter: 80, face: 'full_face', ends: 9, arrows: 4 };
  const admin = async (sql, args = []) => { await db.query('reset role'); return db.query(sql, args); };
  const user = async (who, sql, args = []) => { await db.query('set role authenticated'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who]); return db.query(sql, args); };
  const read = async who => (await user(who, 'select public.read_recent_round_configs($1) value', [who])).rows[0].value;
  const create = async (who, session, c = config) => (await user(who, 'select * from public.create_round_with_ends($1,$2,$3,$4,$5,$6,$7,$8)', [session, c.name, c.division, c.distance, c.diameter, c.face, c.ends, c.arrows])).rows[0];
  const deny = async (work, code, message) => { let error; try { await work(); } catch (e) { error = e; } check(error && (!code || error.code === code), message); };
  const countBefore = (await admin('select count(*)::int n from public.sessions')).rows[0].n;
  await admin('insert into auth.users(id,email) values($1,$2),($3,$4)', [a, 'recent-a@example.invalid', b, 'recent-b@example.invalid']);
  await admin("insert into public.sessions(id,user_id,title,session_date,session_type) values($1,$2,'Recent fixture',current_date,'training'),($3,$4,'Other recent fixture',current_date,'training')", [sa, a, sb, b]);
  check((await read(a)).length === 0, 'No drafts or historical backfill');
  for (const p of ROUND_PRESETS) await create(a, sa, { name: p.name, division: 'Recurve', distance: p.distanceMetres, diameter: p.faceDiameterCm, face: p.faceType, ends: p.defaultEnds, arrows: p.defaultArrowsPerEnd });
  check((await read(a)).length === 0, 'Exact shared built-in presets need no duplicate history');
  const round = await create(a, sa);
  let rows = await read(a), first = rows[0];
  check(rows.length === 1 && first.planned_ends === 9 && first.arrows_per_end === 4, '9 × 4 means 9 Ends and 4 Arrows per End');
  check(first.round_name === config.name && first.division === config.division && first.distance_metres === 25 && first.face_diameter_cm === 80 && first.face_type === 'full_face', 'All seven configuration fields stored');
  check(!('session_id' in first) && !('round_id' in first) && !('scores' in first), 'No historic scoring payload in memory');
  check((await read(b)).length === 0, 'Second account cannot read first account history');
  check((await user(b, 'select * from public.recent_round_configs')).rowCount === 0, 'Owner RLS also protects direct reads');
  await deny(() => user(b, 'select public.read_recent_round_configs($1)', [a]), '42501', 'Stale/forged expected actor denied');
  await deny(() => create(b, sa), '42501', 'Round ownership cannot be overridden');
  await create(a, sa, { ...config, ends: 6, arrows: 12 });
  check((await read(a))[0].planned_ends === 6 && (await read(a))[0].arrows_per_end === 12, 'Different configuration appears most recently used');
  await create(a, sa, { ...config, name: 'Renamed custom round' });
  rows = await read(a);
  check(rows.length === 2 && rows[0].id === first.id && rows[0].round_name === 'Renamed custom round', 'Equivalent geometry deduplicates, restores latest name and moves to front');
  await create(a, sa, { ...config, ends: 3, arrows: 10, face: 'triple_face', diameter: 40 });
  check((await read(a))[0].face_type === 'triple_face', 'Target type and diameter distinguish configurations');
  const beforeInvalid = JSON.stringify(await read(a));
  for (const patch of [{ ends: 0 }, { arrows: 0 }, { ends: 121 }, { face: 'invalid' }, { name: '' }]) await deny(() => create(a, sa, { ...config, ...patch }), '22023', 'Invalid confirmation cannot be remembered');
  check(JSON.stringify(await read(a)) === beforeInvalid, 'Failed creation does not reorder or insert history');
  await admin("create function private.fixture_recent_fail() returns trigger language plpgsql as $$begin if new.end_number=2 then raise exception 'fixture failure after Round insertion';end if;return new;end;$$;create trigger fixture_recent_fail before insert on public.session_ends for each row execute function private.fixture_recent_fail()");
  const beforeRounds = (await admin('select count(*)::int n from public.session_rounds where session_id=$1', [sa])).rows[0].n;
  await deny(() => create(a, sa, { ...config, distance: 31 }), 'P0001', 'Failure after Round insert propagates');
  check(JSON.stringify(await read(a)) === beforeInvalid, 'After-insert memory rolls back when planned End creation fails');
  check((await admin('select count(*)::int n from public.session_rounds where session_id=$1', [sa])).rows[0].n === beforeRounds, 'Existing atomic creation also rolls back Round');
  await admin('drop trigger fixture_recent_fail on public.session_ends;drop function private.fixture_recent_fail()');
  await user(a, 'select * from public.update_owned_round_settings($1,$2,$3,$4,$5,$6)', [round.round_id, 'Updated empty round', 'Compound', 30, 40, 10]);
  rows = await read(a);
  check(rows[0].division === 'Compound' && rows[0].planned_ends === 10 && rows[0].arrows_per_end === 4, 'Existing restricted settings update remembers final persisted complete configuration');
  const again = rows[0];
  await create(a, sa, { ...config, distance: 26 });
  await user(a, 'select * from public.update_owned_round_settings($1,$2,$3,$4,$5,$6)', [round.round_id, 'Updated empty round', 'Compound', 30, 40, 10]);
  check((await read(a))[0].id === again.id, 'Reconfirming identical settings refreshes last use');
  await user(b, 'select public.forget_recent_round_config($1,$2)', [b, first.id]);
  check((await read(a)).some(r => r.id === first.id), 'Other account removal cannot affect owner');
  await user(a, 'select public.forget_recent_round_config($1,$2)', [a, first.id]);
  check(!(await read(a)).some(r => r.id === first.id), 'Owner can remove unwanted remembered configuration');
  await user(a, 'select public.forget_recent_round_config($1,$2)', [a, first.id]);
  check((await admin('select count(*)::int n from public.session_rounds where session_id=$1', [sa])).rows[0].n > 0, 'Idempotent removal never deletes actual Rounds');
  await deny(() => user(a, 'update public.recent_round_configs set planned_ends=100'), '42501', 'Clients cannot forge stored settings');
  await deny(() => user(a, 'insert into public.recent_round_configs select * from public.recent_round_configs'), '42501', 'Clients cannot manually save drafts');
  await admin('set role anon');
  await deny(() => db.query('select * from public.recent_round_configs'), '42501', 'Anonymous table read denied');
  await deny(() => db.query('select public.read_recent_round_configs($1)', [a]), '42501', 'Anonymous RPC denied');
  // Advance only the disposable rate-budget fixture between synthetic minute windows.
  for (let i = 0; i < 24; i++) {
    await admin("delete from private.operation_budgets where user_id=$1 and operation='round_configuration'", [a]);
    await create(a, sa, { ...config, distance: 100 + i, ends: 1 });
  }
  rows = await read(a);
  check(rows.length === 20 && rows[0].distance_metres === 123, 'History is bounded at 20 and newest comes first');
  check(!rows.some(r => r.distance_metres === 100), 'Least recent entries evicted');
  await admin("delete from private.operation_budgets where user_id=$1 and operation='round_configuration'", [a]);
  const clients = Array.from({ length: 4 }, () => new pg.Client(connection));
  try {
    await Promise.all(clients.map(c => c.connect()));
    await Promise.all(clients.map(async c => {
      await c.query('begin'); await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claim.sub',$1,true)", [a]);
      await c.query('select * from public.create_round_with_ends($1,$2,$3,$4,$5,$6,$7,$8)', [sa, config.name, config.division, 150, config.diameter, config.face, config.ends, config.arrows]); await c.query('commit');
    }));
  } finally { await Promise.all(clients.map(c => c.end())); }
  rows = await read(a);
  check(rows.length === 20 && rows.filter(r => r.distance_metres === 150).length === 1, 'Concurrent confirmations deduplicate and preserve bound');
  // Independent client/session reads the same account storage used by both transports.
  const peer = new pg.Client(connection);
  try { await peer.connect(); await peer.query('set role authenticated'); await peer.query("select set_config('request.jwt.claim.sub',$1,false)", [a]); check(JSON.stringify((await peer.query('select public.read_recent_round_configs($1) value', [a])).rows[0].value) === JSON.stringify(rows), 'Independent device connection sees identical data/order'); } finally { await peer.end(); }
  check(!(await admin("select has_table_privilege('service_role','public.recent_round_configs','insert') allowed")).rows[0].allowed, 'No new service-role write privilege');
  check(!(await admin("select has_function_privilege('authenticated','private.remember_custom_round_config()','execute') allowed")).rows[0].allowed, 'Privileged trigger cannot be called by clients');
  check((await admin("select relrowsecurity from pg_class where oid='public.recent_round_configs'::regclass")).rows[0].relrowsecurity, 'RLS enabled');
  await admin('delete from auth.users where id=any($1::uuid[])', [[a, b]]);
  check((await admin('select count(*)::int n from public.recent_round_configs where user_id=$1', [a])).rows[0].n === 0, 'Account deletion cleans recent settings');
  check((await admin('select count(*)::int n from public.sessions')).rows[0].n === countBefore, 'Existing Sessions preserved');
  return { passed, failed: 0, concurrentConfirmations: 4, historyLimit: 20 };
}
