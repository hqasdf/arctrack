/**
 * Native disposable PostgreSQL security + independent-connection concurrency tests.
 * Requires separately provisioned PG_BIN and PG_DRIVER_MODULE directories. Never
 * accepts database URLs, reads .env, downloads tooling, or uses an existing server.
 * Supabase auth.uid/users/roles are emulated; real JWT/PostgREST are not tested.
 */
import { access, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join, sep, isAbsolute } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

if (process.argv.length !== 2) throw new Error('No command-line arguments or connection URLs accepted. Set PG_BIN and PG_DRIVER_MODULE only.');
const binaryDirectory = process.env.PG_BIN;
const driverDirectory = process.env.PG_DRIVER_MODULE;
if (!binaryDirectory || !driverDirectory || !isAbsolute(binaryDirectory) || !isAbsolute(driverDirectory)) {
  throw new Error('Set absolute PG_BIN and PG_DRIVER_MODULE paths to separately provisioned local tooling.');
}
const extension = process.platform === 'win32' ? '.exe' : '';
for (const name of ['initdb', 'pg_ctl', 'postgres']) await access(join(binaryDirectory, name + extension));
const { default: pg } = await import(pathToFileURL(join(driverDirectory, 'lib/index.js')).href);
const runFile = promisify(execFile);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporaryRoot = await realpath(tmpdir());
const ownedDirectory = await mkdtemp(join(temporaryRoot, 'arctrack-garmin-pg-owned-'));
const dataDirectory = join(ownedDirectory, 'data');
const serverLog = join(ownedDirectory, 'postgres.log');
const commandOptions = {
  windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
  env: { ...process.env, PATH: `${binaryDirectory}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}` },
};
const binary = name => join(binaryDirectory, name + extension);
const port = await new Promise((accept, reject) => {
  const probe = createServer();
  probe.on('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const result = probe.address().port;
    probe.close(error => error ? reject(error) : accept(result));
  });
});
const configuration = {
  host: '127.0.0.1', port, user: 'postgres', database: 'postgres', password: 'local-trust-only', ssl: false,
  connectionTimeoutMillis: 10000, query_timeout: 20000, application_name: 'arctrack-garmin-security-tests',
};
let owner;
let serverStarted = false;
let attemptedStart = false;
let summary;
let testFailure;
const assert = (condition, label) => {
  if (!condition) throw new Error(`FAIL: ${label}`);
};
const scalar = async sql => Object.values((await owner.query(sql)).rows[0])[0];
// Compare definitions/ACLs and full synthetic rows, not just record counts.
async function integritySnapshot() {
  const tables = (await owner.query(`select c.oid, n.nspname, c.relname from pg_class c
    join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('auth','public','private','extensions')
    and c.relkind='r' and c.relname not in ('garmin_connections','garmin_oauth_transactions') order by c.oid`)).rows;
  const relations = (await owner.query(`select c.oid,c.relname,c.relkind,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,c.relfilenode,
    case when c.relkind='v' then pg_get_viewdef(c.oid,true) end as view_definition
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('auth','public','private','extensions')
    and c.relname not in ('garmin_connections','garmin_oauth_transactions')
    and not exists (select 1 from pg_index i join pg_class t on t.oid=i.indrelid
      where i.indexrelid=c.oid and t.relname in ('garmin_connections','garmin_oauth_transactions'))
    and c.relkind in ('r','v','S','i') order by c.oid`)).rows;
  const definitions = {};
  definitions.schemas = (await owner.query("select oid,nspname,nspowner,nspacl from pg_namespace where nspname in ('auth','public','private','extensions') order by oid")).rows;
  definitions.functions = (await owner.query(`select p.oid,p.proowner,p.proacl,pg_get_functiondef(p.oid) as definition from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('auth','public','private','extensions')
    and not (n.nspname='private' and p.proname in ('guard_garmin_oauth_transaction','guard_garmin_deletion_fence')) order by p.oid`)).rows;
  definitions.defaults = (await owner.query('select * from pg_default_acl order by oid')).rows;
  definitions.roles = (await owner.query('select * from pg_roles order by oid')).rows;
  definitions.types = (await owner.query(`select t.oid,t.typname,t.typtype,t.typowner,t.typacl,t.typrelid,t.typelem
    from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('auth','public','private','extensions')
    and t.typname not in ('garmin_connections','_garmin_connections','garmin_oauth_transactions','_garmin_oauth_transactions') order by t.oid`)).rows;
  definitions.extensions = (await owner.query('select * from pg_extension order by oid')).rows;
  definitions.eventTriggers = (await owner.query('select * from pg_event_trigger order by oid')).rows;
  for (const [key, query] of Object.entries({
    columns: `select a.attrelid,a.attnum,a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) as default_expression
      from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attnum>0 and not a.attisdropped and a.attrelid=any($1::oid[]) order by a.attrelid,a.attnum`,
    constraints: 'select oid,conname,conrelid,confrelid,convalidated,pg_get_constraintdef(oid,true) as definition from pg_constraint where conrelid=any($1::oid[]) order by oid',
    indexes: 'select indexrelid,indrelid,pg_get_indexdef(indexrelid) as definition from pg_index where indrelid=any($1::oid[]) order by indexrelid',
    policies: 'select oid,polname,polrelid,polcmd,polpermissive,polroles,pg_get_expr(polqual,polrelid) as using_expression,pg_get_expr(polwithcheck,polrelid) as check_expression from pg_policy where polrelid=any($1::oid[]) order by oid',
    triggers: `select t.oid,t.tgrelid,t.tgenabled,t.tgisinternal,pg_get_triggerdef(t.oid,true) as definition from pg_trigger t
      where t.tgrelid=any($1::oid[]) and not exists (select 1 from pg_constraint fk join pg_class child on child.oid=fk.conrelid
        where fk.oid=t.tgconstraint and child.relname in ('garmin_connections','garmin_oauth_transactions')) order by t.oid`,
  })) definitions[key] = (await owner.query(query,[tables.map(t=>t.oid)])).rows;
  const data = {};
  for (const table of tables) {
    const identifier = value => `"${value.replaceAll('"','""')}"`;
    data[`${table.nspname}.${table.relname}`] = (await owner.query(`select to_jsonb(t) as row from ${identifier(table.nspname)}.${identifier(table.relname)} t order by to_jsonb(t)::text`)).rows;
  }
  definitions.sequence = (await owner.query('select * from public.integrity_existing_sequence')).rows;
  return { relations, definitions, data };
}
async function assertExistingFunctionality() {
  await owner.query('begin');
  try {
    await owner.query('set local role authenticated');
    await owner.query("select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true)");
    assert(await scalar('select count(*)::int from public.sessions')===1,'Existing RLS still isolates the owner');
    assert((await owner.query("update public.sessions set title='Updated in rollback' where id='20000000-0000-4000-8000-000000000001'")).rowCount===1,'Existing owner UPDATE still works');
    await owner.query('savepoint invalid_title');
    let code;
    try { await owner.query("update public.sessions set title='' where id='20000000-0000-4000-8000-000000000001'"); }
    catch(error) { code=error.code; }
    await owner.query('rollback to savepoint invalid_title');
    assert(code==='23514','Existing validation trigger still rejects an empty title');
    await owner.query('reset role');
    const grouping=(await owner.query('select * from public.integrity_existing_grouping')).rows[0];
    assert(grouping.total_score==='10' && grouping.centre_x===0.084 && grouping.centre_y===0.067,'Existing scoring/grouping view is unchanged');
  } finally { await owner.query('rollback'); }
}
try {
  await runFile(binary('initdb'), ['-D', dataDirectory, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'], commandOptions);
  // The owned cluster's config avoids Windows pg_ctl child quoting differences.
  await writeFile(join(dataDirectory, 'postgresql.auto.conf'), `listen_addresses = '127.0.0.1'\nport = ${port}\nmax_connections = 50\n`, 'utf8');
  attemptedStart = true;
  await runFile(binary('pg_ctl'), ['-D', dataDirectory, '-l', serverLog, '-w', '-t', '20', 'start'], commandOptions);
  serverStarted = true;
  owner = new pg.Client(configuration);
  await owner.connect();
  const binding = (await owner.query("select host(inet_server_addr()) as address,current_setting('listen_addresses') as binding")).rows[0];
  assert(binding.address === '127.0.0.1' && binding.binding === '127.0.0.1', `Connected server listens on loopback only (${JSON.stringify(binding)})`);
  assert(await realpath(await scalar('show data_directory')) === await realpath(dataDirectory), 'Connected server owns exactly this temporary data directory');
  await owner.query(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create role supabase_auth_admin nologin;
    create schema auth;
    create schema extensions;
    create schema private;
    grant usage on schema private to service_role;
    -- Exercise explicit REVOKEs against hosted-style broad default object ACLs.
    alter default privileges in schema public,private grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public,private grant execute on functions to anon,authenticated,service_role;
    create extension pgcrypto with schema extensions;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create table auth.users(id uuid primary key,aud text,role text,email text,
      email_confirmed_at timestamptz,created_at timestamptz,updated_at timestamptz);
    grant usage on schema auth to supabase_auth_admin;
    grant select,delete on table auth.users to supabase_auth_admin;
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
        nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub')::uuid;
    $$;
    grant execute on function auth.uid() to anon,authenticated,service_role;
  `);
  await owner.query(await readFile(join(root, 'supabase/tests/garmin-additive-baseline.sql'), 'utf8'));
  const before = await integritySnapshot();
  await assertExistingFunctionality();
  let reversedOrderCode;
  try { await owner.query(await readFile(join(root, 'supabase/migrations/20261023082837_garmin_account_deletion_fence.sql'), 'utf8')); }
  catch (error) { reversedOrderCode=error.code; }
  await owner.query('rollback');
  assert(reversedOrderCode==='42P01','Reversed migration order fails on the missing Garmin table');
  assert(isDeepStrictEqual(before,await integritySnapshot()),'Rejected reversed order preserves the existing database');
  await owner.query(await readFile(join(root, 'supabase/migrations/20261023074736_garmin_oauth_connections.sql'), 'utf8'));
  assert(isDeepStrictEqual(before,await integritySnapshot()),'Migration one preserves all existing definitions, policies, privileges and representative rows');
  await owner.query(await readFile(join(root, 'supabase/tests/garmin-oauth-connections.sql'), 'utf8'));
  assert(await scalar("select count(*)::int from auth.users where email like 'garmin-%@example.invalid'") === 0, 'Rollback removed fixture users');
  await owner.query(await readFile(join(root, 'supabase/migrations/20261023082837_garmin_account_deletion_fence.sql'), 'utf8'));
  assert(isDeepStrictEqual(before,await integritySnapshot()),'Migration two preserves all existing definitions, policies, privileges and representative rows');
  const authReferenceTriggers=(await owner.query(`select count(*)::int as count from pg_trigger t join pg_constraint fk on fk.oid=t.tgconstraint
    join pg_class child on child.oid=fk.conrelid where t.tgrelid='auth.users'::regclass and t.tgisinternal
    and child.relname in ('garmin_connections','garmin_oauth_transactions')`)).rows[0].count;
  assert(authReferenceTriggers===4,'Only four expected Garmin FK action triggers are added on auth.users');
  await assertExistingFunctionality();
  await owner.query(await readFile(join(root, 'supabase/tests/garmin-account-deletion.sql'), 'utf8'));
  assert(await scalar("select count(*)::int from auth.users where email like 'garmin-%@example.invalid'") === 0, 'Deletion rollback removed fixture users');
  const user = randomUUID(), version = randomUUID();
  await owner.query('insert into auth.users(id) values($1)', [user]);
  await owner.query('insert into public.garmin_connections(user_id,version) values($1,$2)', [user,version]);
  const clients = [new pg.Client(configuration), new pg.Client(configuration)];
  let outcomes;
  try {
    await Promise.all(clients.map(c => c.connect()));
    await Promise.all(clients.map(c => c.query('set role service_role')));
    outcomes = await Promise.all(clients.map(c => c.query(
      "update public.garmin_connections set version=gen_random_uuid(),operation='refresh',lease_until=now()+interval '1 minute' where user_id=$1 and version=$2 returning user_id",
      [user,version])));
    assert(outcomes.reduce((sum,r)=>sum+r.rowCount,0) === 1, 'Exactly one separate-connection CAS succeeds');
  } finally { await Promise.all(clients.map(c=>c.end())); }
  await owner.query("update public.garmin_connections set operation='authorize',lease_until=now()+interval '10 minutes' where user_id=$1",[user]);
  const staleVersion = (await owner.query('select version from public.garmin_connections where user_id=$1',[user])).rows[0].version;
  const a = new pg.Client(configuration), b = new pg.Client(configuration);
  let triggerRace;
  try {
    await Promise.all([a.connect(),b.connect()]);
    await a.query('begin'); await a.query('set local role service_role');
    await a.query("update public.garmin_connections set version=gen_random_uuid(),operation='authorize',lease_until=now()+interval '10 minutes' where user_id=$1",[user]);
    await b.query('set role service_role');
    const pid = (await b.query('select pg_backend_pid() as pid')).rows[0].pid;
    const pending = b.query("insert into public.garmin_oauth_transactions(user_id,state_hash,binding_hash,verifier_ciphertext,connection_version,redirect_uri) values($1,repeat('e',64),repeat('f',64),'encrypted-fixture',$2,'https://example.invalid/callback')",[user,staleVersion])
      .then(()=>({code:null}),error=>({code:error.code}));
    let waiting = false;
    for (let i=0; i<30; i++) {
      waiting = (await owner.query("select wait_event_type='Lock' as waiting from pg_stat_activity where pid=$1",[pid])).rows[0]?.waiting;
      if (waiting) break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert(waiting, 'Stale transaction trigger waits on held connection row lock');
    await a.query('commit');
    triggerRace = await pending;
    assert(triggerRace.code === '40001', 'Concurrent stale transaction rejected after connection version change');
  } finally { await Promise.all([a.end(),b.end()]); }
  // The durable deletion fence and ordinary authorize claim race from the same version.
  await owner.query("update public.garmin_connections set operation=null,lease_until=null,version=gen_random_uuid() where user_id=$1",[user]);
  const claimVersion=(await owner.query('select version from public.garmin_connections where user_id=$1',[user])).rows[0].version;
  const deleteClient=new pg.Client(configuration), startClient=new pg.Client(configuration);
  let deletionRace;
  try {
    await Promise.all([deleteClient.connect(),startClient.connect()]);
    await Promise.all([deleteClient.query('set role service_role'),startClient.query('set role service_role')]);
    const queries=[
      "update public.garmin_connections set operation='delete',lease_until=now()+interval '1 minute',deletion_requested_at=now(),version=gen_random_uuid() where user_id=$1 and version=$2 and operation is null returning operation",
      "update public.garmin_connections set operation='authorize',lease_until=now()+interval '1 minute',version=gen_random_uuid() where user_id=$1 and version=$2 and operation is null and deletion_requested_at is null returning operation"
    ];
    deletionRace=await Promise.all([deleteClient,startClient].map((c,i)=>c.query(queries[i],[user,claimVersion])));
    assert(deletionRace.reduce((sum,r)=>sum+r.rowCount,0)===1,'Exactly one deletion/start operation wins');
    const current=(await owner.query('select operation,deletion_requested_at from public.garmin_connections where user_id=$1',[user])).rows[0];
    assert((current.operation==='delete')===(current.deletion_requested_at!==null),'Winner and deletion fence are consistent');
  } finally { await Promise.all([deleteClient.end(),startClient.end()]); }
  await owner.query('delete from auth.users where id=$1',[user]);
  assert(await scalar('select count(*)::int from public.garmin_connections') === 0, 'No connection test data remains');
  assert(isDeepStrictEqual(before,await integritySnapshot()),'Existing data/definitions remain unchanged after all fixtures and concurrency tests');
  summary = { runtime: await scalar('select version()'), migrationExecuted: true, rollbackFixturePassed: true,
    additiveIntegrity: { existingTables: Object.keys(before.data).length, existingRows: Object.values(before.data).reduce((n,rows)=>n+rows.length,0),
      unchangedAfterEachMigration: true, definitionsPoliciesPrivilegesAndRowsUnchanged: true, existingFunctionalityPassed: true, expectedAuthForeignKeyTriggers: authReferenceTriggers, reversedOrderRejected: reversedOrderCode },
    separateConnectionCasRows: outcomes.map(r=>r.rowCount), staleTransactionRaceSqlstate: triggerRace.code, deletionFenceFixturePassed: true, deletionVsStartRows: deletionRace.map(r=>r.rowCount), noFixtureData: true,
    limits: 'Isolated PostgreSQL/Auth schema roles; no real GoTrue, JWT or PostgREST HTTP validation.' };
} catch (error) {
  testFailure = error;
} finally {
  try { if (owner) await owner.end(); } catch (error) { testFailure ??= error; }
  let stopped = false;
  try {
    if (attemptedStart || serverStarted) {
      // pg_ctl may start its child then time out before returning success. Always
      // inspect/stop the owned cluster after an attempted start, including failures.
      try {
        await runFile(binary('pg_ctl'), ['-D', dataDirectory, '-m', 'fast', '-w', '-t', '20', 'stop'], commandOptions);
      } catch (stopError) {
        // A failed startup may never have created a server. Status exit 3 means
        // "not running"; any other status/error preserves the directory for review.
        try { await runFile(binary('pg_ctl'), ['-D', dataDirectory, 'status'], commandOptions); }
        catch (statusError) {
          if (statusError.code !== 3) throw stopError;
          stopped = true;
        }
      }
      if (!stopped) {
        try { await runFile(binary('pg_ctl'), ['-D', dataDirectory, 'status'], commandOptions); }
        catch (statusError) {
          if (statusError.code !== 3) throw statusError;
          stopped = true;
        }
      }
    } else {
      // Before any start attempt initdb is the only possible child operation.
      stopped = true;
    }
    // Validate the resolved absolute recursive-delete target before removing data.
    const resolvedOwned = await realpath(ownedDirectory);
    if (!stopped || !resolvedOwned.startsWith(`${temporaryRoot}${sep}arctrack-garmin-pg-owned-`)
      || resolve(resolvedOwned, '..') !== temporaryRoot) throw new Error('Refusing cleanup outside the owned stopped temporary cluster.');
    await rm(resolvedOwned, { recursive: true });
    if (summary) summary.ownedClusterStoppedAndRemoved = true;
  } catch (cleanupError) {
    testFailure ??= cleanupError;
    console.error(`Cleanup failed; inspect owned directory ${ownedDirectory}: ${cleanupError.message}`);
  }
}
if (testFailure) {
  console.error(testFailure.message);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(summary, null, 2));
}
