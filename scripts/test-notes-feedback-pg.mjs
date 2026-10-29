/**
 * Native disposable PostgreSQL security + independent-connection concurrency tests.
 * Requires separately provisioned PG_BIN and PG_DRIVER_MODULE directories. Never
 * accepts database URLs, reads .env, downloads tooling, or uses an existing server.
 * Supabase auth.uid/users/roles are emulated; real JWT/PostgREST are not tested.
 */
import { access, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join, sep, isAbsolute } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';

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
const ownedDirectory = await mkdtemp(join(temporaryRoot, 'arctrack-feedback-pg-owned-'));
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
  connectionTimeoutMillis: 10000, query_timeout: 20000, application_name: 'arctrack-disposable-security-tests',
};
let owner;
let serverStarted = false;
let attemptedStart = false;
let summary;
let testFailure;
let assertions = 0;
const assert = (condition, label) => {
  if (!condition) throw new Error(`FAIL: ${label}`);
  assertions++;
};
const firstRows = result => Array.isArray(result) ? result.flatMap(part => part.rows ?? []) : result.rows;
const scalar = async sql => Object.values((await owner.query(sql)).rows[0])[0];
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const feedbackSql = ({ organization, athlete, request, body = 'Concurrent feedback', session = '00000000-0000-4000-8000-000000000061', kind = 'session' }) => `
  select public.save_coach_feedback(null,${quote(organization)}::uuid,${quote(athlete)}::uuid,
    ${quote(kind)},${session ? `${quote(session)}::uuid` : 'null'},${quote(body)},null,${quote(request)}::uuid) as feedback_id`;

// All workers establish real independent connections before a shared JS gate opens.
// Each query runs in its own transaction; even an error is rolled back and disconnected.
async function race(calls) {
  const clients = calls.map(() => new pg.Client(configuration));
  try {
    await Promise.all(clients.map(client => client.connect()));
    return await Promise.all(calls.map(async (call, index) => {
      const client = clients[index];
      try {
        await client.query('begin');
        await client.query('set local role authenticated');
        await client.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)",
          [call.coach, JSON.stringify({ sub: call.coach, role: 'authenticated' })]);
        const result = await client.query(feedbackSql(call));
        // Keep successful mutations open briefly to exercise advisory/row-lock waiters.
        if (call.hold) await client.query('select pg_sleep(0.05)');
        await client.query('commit');
        return { ok: true, id: result.rows[0].feedback_id };
      } catch (error) {
        await client.query('rollback');
        return { ok: false, code: error.code, message: error.message };
      }
    }));
  } finally {
    await Promise.all(clients.map(client => client.end()));
  }
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
    create schema realtime;
    grant usage on schema realtime to authenticated;
    create table realtime.messages(extension text,topic text,payload jsonb);
    alter table realtime.messages enable row level security;
    grant select on realtime.messages to authenticated;
    create table private.fixture_live_broadcasts(topic text,payload jsonb,event text);
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
    create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language plpgsql as $$begin
      insert into private.fixture_live_broadcasts values(topic,payload,event);
      perform pg_notify('fixture_live_changes',jsonb_build_object('topic',topic)::text);
    end;$$;
  `);
  const migrations = (await readdir(join(root, 'supabase/migrations'))).filter(name => name.endsWith('.sql')).sort();
  const budgetDefinition = async () => (await owner.query(`select
    pg_get_functiondef('private.consume_operation_budget(text)'::regprocedure) as function_definition,
    (select pg_get_constraintdef(oid) from pg_constraint where conrelid='private.operation_budgets'::regclass
      and conname='operation_budgets_operation_check') as operation_constraint`)).rows[0];
  let budgetBefore;
  for (const migration of migrations) {
    if (migration === '20261022022012_session_notes_shared_coach_feedback.sql') budgetBefore = await budgetDefinition();
    const sql = await readFile(join(root, 'supabase/migrations', migration), 'utf8');
    if (migration.endsWith('_remove_general_coach_feedback.sql')) {
      // Disposable old-schema data proves bounded cleanup and Session retention.
      await owner.query(`insert into auth.users(id,email) values
        ('00000000-0000-4000-8000-000000000071','cleanup-coach@example.invalid'),
        ('00000000-0000-4000-8000-000000000072','cleanup-athlete@example.invalid');
        insert into public.organizations(id,name,created_by) values('00000000-0000-4000-8000-000000000073','Cleanup proof','00000000-0000-4000-8000-000000000071');
        insert into public.sessions(id,user_id,title,session_date,session_type) values('00000000-0000-4000-8000-000000000074','00000000-0000-4000-8000-000000000072','Preserve Session',current_date,'training');
        insert into public.session_notes(session_id,body) values('00000000-0000-4000-8000-000000000074','Preserve note');
        insert into public.coach_feedback(id,organization_id,athlete_user_id,author_user_id,kind,session_id,body) values
        ('00000000-0000-4000-8000-000000000075','00000000-0000-4000-8000-000000000073','00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000071','general',null,'Obsolete proof'),
        ('00000000-0000-4000-8000-000000000076','00000000-0000-4000-8000-000000000073','00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000071','session','00000000-0000-4000-8000-000000000074','Preserve feedback'),
        ('00000000-0000-4000-8000-000000000078','00000000-0000-4000-8000-000000000073','00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000071','general',null,'Unexpected second obsolete');
        insert into private.coach_feedback_creation_requests(request_id,author_user_id,athlete_user_id,payload_sha256,feedback_id)
        select '00000000-0000-4000-8000-000000000077',author_user_id,athlete_user_id,private.coach_feedback_creation_digest(organization_id,athlete_user_id,author_user_id,kind,session_id,body),id from public.coach_feedback where id='00000000-0000-4000-8000-000000000075';`);
      let rejected = false;
      try { await owner.query(sql); } catch { rejected = true; await owner.query('rollback'); }
      assert(rejected, 'Cleanup rejects unexpected second obsolete record');
      assert(await scalar("select count(*)::int from public.coach_feedback where kind='general'") === 2, 'Rejected cleanup rolls back without deletion');
      await owner.query("delete from public.coach_feedback where id='00000000-0000-4000-8000-000000000078'");
      await owner.query(sql);
      assert(await scalar("select count(*)::int from public.coach_feedback where kind='general'") === 0, 'Approved obsolete feedback removed');
      assert(await scalar("select count(*)::int from private.coach_feedback_creation_requests where request_id='00000000-0000-4000-8000-000000000077'") === 0, 'Only obsolete linked ledger removed');
      assert(await scalar("select body='Preserve note' from public.session_notes where session_id='00000000-0000-4000-8000-000000000074'"), 'Cleanup preserves athlete note');
      assert(await scalar("select body='Preserve feedback' and kind='session' from public.coach_feedback where id='00000000-0000-4000-8000-000000000076'"), 'Cleanup preserves Session feedback');
      await owner.query("delete from auth.users where id in ('00000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000072'); delete from public.organizations where id='00000000-0000-4000-8000-000000000073'");
    } else await owner.query(sql);
  }
  assert(budgetBefore && JSON.stringify(budgetBefore) === JSON.stringify(await budgetDefinition()), 'Existing shared operation budget is unchanged');
  const fixtureResults = await owner.query(await readFile(join(root, 'supabase/tests/session-notes-coach-feedback.sql'), 'utf8'));
  const fixtureCount = firstRows(fixtureResults).find(row => row.passed_assertions !== undefined)?.passed_assertions;
  assert(Number.isInteger(fixtureCount) && fixtureCount > 0, 'Rollback fixture returned its assertion count');
  assert(await scalar("select count(*)::int from auth.users where email like 'notes-%@example.invalid'") === 0, 'SQL fixture rolled back its users');

  const coachA = randomUUID();
  const coachB = randomUUID();
  const athlete = randomUUID();
  const organization = randomUUID();
  await owner.query(`insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
    select id,'authenticated','authenticated','race-'||id||'@example.invalid',now(),now(),now()
    from unnest(array[${quote(coachA)}::uuid,${quote(coachB)}::uuid,${quote(athlete)}::uuid]) id;
    insert into public.organizations(id,name,created_by) values(${quote(organization)},'Concurrency fixture',${quote(coachA)});
    insert into public.organization_members(organization_id,user_id,role,status) values
      (${quote(organization)},${quote(coachB)},'head_coach','active'),
      (${quote(organization)},${quote(athlete)},'archer','active');`);

  await owner.query(`insert into public.sessions(id,user_id,title,session_date,session_type) values('00000000-0000-4000-8000-000000000061',${quote(athlete)},'Concurrency Session',current_date,'training')`);

  const request = randomUUID();
  const sameKeyCall = { coach: coachA, organization, athlete, request, body: 'Shared-key race fixture', hold: true };
  const sameKeyResults = await race(Array.from({ length: 8 }, () => sameKeyCall));
  assert(sameKeyResults.every(result => result.ok), 'All eight simultaneous identical creates return success');
  const originalId = sameKeyResults[0].id;
  assert(sameKeyResults.every(result => result.id === originalId), 'Same-key waiters all return the original UUID');
  assert(await scalar(`select count(*)::int from public.coach_feedback where id=${quote(originalId)}`) === 1, 'Same-key race creates one row');
  assert(await scalar(`select count(*)::int from private.coach_feedback_creation_requests where request_id=${quote(request)}`) === 1, 'Same-key race creates one ledger record');
  assert(await scalar(`select minute_count=1 and hour_count=1 from private.coach_feedback_creation_budgets where user_id=${quote(coachA)}`), 'Same-key race charges one creation');

  // Seed a real primer creation for B, then pin windows ahead to prevent UTC-boundary
  // flakiness and exercise the existing newer-window safeguard while requests wait.
  const primer = await race([{ coach: coachB, organization, athlete, request: randomUUID(), body: 'Budget primer fixture' }]);
  assert(primer[0].ok, 'Second coach can create independently');
  await owner.query(`update private.coach_feedback_creation_budgets set
    minute_start=date_trunc('minute',clock_timestamp(),'UTC')+interval '1 minute',
    hour_start=date_trunc('hour',clock_timestamp(),'UTC')+interval '1 hour' where user_id=${quote(coachB)}`);
  const burst = await race(Array.from({ length: 20 }, () => ({ coach: coachB, organization, athlete, request: randomUUID(), hold: true })));
  const burstSuccess = burst.filter(result => result.ok).length;
  const burstDenied = burst.filter(result => !result.ok).length;
  assert(burstSuccess === 9 && burstDenied === 11, 'Concurrent distinct-key burst respects 10/minute including its primer');
  assert(burst.filter(result => !result.ok).every(result => result.code === 'P0001' && result.message === 'Too many feedback entries. Try again shortly.'), 'Burst rejections use safe budget error');
  assert(await scalar(`select minute_count=10 and hour_count=10 from private.coach_feedback_creation_budgets where user_id=${quote(coachB)}`), 'Concurrent distinct keys do not overshoot counters');
  assert(await scalar(`select count(*)::int from public.coach_feedback where author_user_id=${quote(coachB)}`) === 10, 'Only ten B feedback rows exist');
  assert(await scalar(`select minute_count=1 and hour_count=1 from private.coach_feedback_creation_budgets where user_id=${quote(coachA)}`), 'B exhaustion does not charge A');

  await owner.query(`update private.coach_feedback_creation_budgets set minute_count=1,hour_count=99,
    minute_start=date_trunc('minute',clock_timestamp(),'UTC')+interval '1 minute',
    hour_start=date_trunc('hour',clock_timestamp(),'UTC')+interval '1 hour' where user_id=${quote(coachA)}`);
  const hourRace = await race(Array.from({ length: 5 }, () => ({ coach: coachA, organization, athlete, request: randomUUID(), hold: true })));
  assert(hourRace.filter(result => result.ok).length === 1 && hourRace.filter(result => !result.ok).length === 4, 'Concurrent requests cannot overshoot remaining hourly allowance');
  assert(hourRace.filter(result => !result.ok).every(result => result.code === 'P0001'), 'Hour-race rejections are budget errors');
  assert(await scalar(`select minute_count=2 and hour_count=100 from private.coach_feedback_creation_budgets where user_id=${quote(coachA)}`), 'Hourly counter stops at 100');
  const replayAtLimit = await race([sameKeyCall]);
  assert(replayAtLimit[0].ok && replayAtLimit[0].id === originalId, 'Successful key replays after concurrent quota exhaustion');
  assert(await scalar(`select hour_count=100 from private.coach_feedback_creation_budgets where user_id=${quote(coachA)}`), 'Quota-exhausted replay is uncharged');
  const crossAuthor = await race([{ ...sameKeyCall, coach: coachB }]);
  assert(!crossAuthor[0].ok && crossAuthor[0].code === '22023'
    && crossAuthor[0].message === 'This feedback request conflicts with an earlier submission. Refresh feedback and start a new entry.', 'Other author cannot obtain original result using its key');
  await owner.query(`update public.organization_members set status='left',left_at=now()
    where organization_id=${quote(organization)} and user_id=${quote(coachA)}`);
  const revokedReplay = await race([sameKeyCall]);
  assert(!revokedReplay[0].ok && revokedReplay[0].code === '42501', 'Replay after committed relationship revocation is denied');
  assert(await scalar(`select hour_count=100 from private.coach_feedback_creation_budgets where user_id=${quote(coachA)}`), 'Revoked replay does not charge budget');

  const managementResults = await (await import('./live-coaching-management-fixture.mjs')).testLiveManagement(owner, pg, configuration);
  const roleResults = await (await import('./live-coaching-role-fixture.mjs')).testLiveRoles(owner);
  const liveResults = await (await import('./live-coaching-fixture.mjs')).testLiveCoaching(owner, pg, configuration);
  const liveHrResults = await (await import('./live-coaching-hr-fixture.mjs')).testLiveHeartRate(owner, pg, configuration);
  const monitorResults = await (await import('./live-coaching-monitor-fixture.mjs')).testLiveMonitor(owner, pg, configuration);
  const hzResults = await (await import('./live-coaching-1hz-fixture.mjs')).testLiveHr1Hz(owner);
  const recentResults = await (await import('./recent-round-configs-fixture.mjs')).testRecentRoundConfigs(owner, pg, configuration);
  const integrityResults = await (await import('./scoring-integrity-fixture.mjs')).testScoringIntegrity(owner,pg,configuration);
  summary = {
    scoringIntegrityAssertions: integrityResults,
    recentRoundConfigs: recentResults,
    liveHr1Hz: hzResults,
    liveMonitorAssertions: monitorResults,
    liveHeartRateAssertions: liveHrResults,
    liveCoachingRoleAssertions: roleResults,
    liveCoachingManagementAssertions: managementResults,
    liveCoachingAssertions: liveResults,
    runtime: await scalar('select version()'), migrations: migrations.length,
    sqlFixtureAssertions: fixtureCount, concurrencyAndHarnessAssertions: assertions, failed: 0,
    sameKey: { attempts: 8, returnedSameId: 8, feedbackRows: 1, charges: 1 },
    minuteBudget: { primer: 1, concurrentAttempts: 20, concurrentAccepted: burstSuccess, concurrentRejected: burstDenied, totalAccepted: 10 },
    hourBudget: { remainingAllowance: 1, concurrentAttempts: 5, accepted: 1, rejected: 4, finalCount: 100 },
    existingOperationBudgetUnchanged: true, fixtureRollbackVerified: true,
    hostedStyleBroadDefaultPrivilegesExercised: true,
    limitations: 'Supabase auth schema/roles emulated; no GoTrue, real JWT verification or PostgREST. UTC counters pinned in disposable fixtures for deterministic races.',
  };
  if (process.env.LIVE_COACHING_DEMO === 'true') await (await import('./live-coaching-demo.mjs')).runLiveDemo(owner, pg, configuration);
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
    if (!stopped || !resolvedOwned.startsWith(`${temporaryRoot}${sep}arctrack-feedback-pg-owned-`)
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
