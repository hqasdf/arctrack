/** Disposable native PostgreSQL only. Never reads .env, URLs or production credentials. */
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify, isDeepStrictEqual } from "node:util";
import { join, resolve, isAbsolute, sep } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { pathToFileURL, fileURLToPath } from "node:url";

if (process.argv.length !== 2) throw new Error("No arguments or database URLs accepted.");
const binaries = process.env.PG_BIN, driver = process.env.PG_DRIVER_MODULE;
if (!binaries || !driver || !isAbsolute(binaries) || !isAbsolute(driver)) throw new Error("Set absolute PG_BIN and PG_DRIVER_MODULE paths to existing local tooling.");
const extension = process.platform === "win32" ? ".exe" : "";
const binary = (name) => join(binaries, name + extension);
for (const name of ["initdb", "pg_ctl", "postgres"]) await access(binary(name));
const { default: pg } = await import(pathToFileURL(join(driver, "lib/index.js")).href);
const execute = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporary = await realpath(tmpdir());
const owned = await mkdtemp(join(temporary, "arctrack-health-pg-owned-"));
const data = join(owned, "data"), log = join(owned, "postgres.log");
const options = { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
  env: { ...process.env, PATH: `${binaries}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}` } };
const port = await new Promise((accept, reject) => {
  const server = createServer(); server.on("error", reject);
  server.listen(0, "127.0.0.1", () => { const chosen = server.address().port; server.close(() => accept(chosen)); });
});
const configuration = { host: "127.0.0.1", port, user: "postgres", database: "postgres", password: "disposable-only", ssl: false, query_timeout: 15000 };
let db, started = false, attempted = false, failure;
const assertions = [];
const check = (condition, label) => { if (!condition) throw new Error(label); assertions.push(label); };
async function snapshot() {
  const tables = ["auth.users", "public.profiles", "public.sessions", "public.session_rounds", "public.session_ends", "public.arrows", "public.organizations", "public.organization_members", "public.training_plans", "public.training_plan_days", "public.training_plan_assignments"];
  const result = {};
  for (const table of tables) result[table] = (await db.query(`select to_jsonb(t) as row from ${table} t order by to_jsonb(t)::text`)).rows;
  result.columns = (await db.query(`select c.oid,a.attname,format_type(a.atttypid,a.atttypmod) as type,a.attnotnull,
    pg_get_expr(d.adbin,d.adrelid) as default_value from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attnum>0
    left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where c.oid=any($1::regclass[]) order by c.oid,a.attnum`, [tables])).rows;
  result.policies = (await db.query("select * from pg_policies where tablename not like 'garmin%' and tablename not in ('session_recording_windows','retired_session_recording_windows','session_garmin_activity_links') order by schemaname,tablename,policyname")).rows;
  result.relations = (await db.query("select oid,relname,relowner,relacl,relrowsecurity,relforcerowsecurity from pg_class where oid=any($1::regclass[]) order by oid", [tables])).rows;
  result.existingTrigger = (await db.query("select pg_get_triggerdef(oid) as definition from pg_trigger where tgname='integrity_existing_title_guard'")).rows;
  return result;
}
try {
  await execute(binary("initdb"), ["-D", data, "-U", "postgres", "--auth=trust", "--no-locale", "--encoding=UTF8"], options);
  await writeFile(join(data, "postgresql.auto.conf"), `listen_addresses = '127.0.0.1'\nport = ${port}\nmax_connections = 20\n`);
  attempted = true;
  await execute(binary("pg_ctl"), ["-D", data, "-l", log, "-w", "-t", "20", "start"], options);
  started = true;
  db = new pg.Client(configuration); await db.connect();
  db.on("notice", (notice) => { if (notice.message.startsWith("PASS: ")) assertions.push(notice.message.slice(6)); });
  check(await realpath((await db.query("show data_directory")).rows[0].data_directory) === await realpath(data), "Connected to the owned disposable cluster");
  check((await db.query("select host(inet_server_addr()) as address,current_setting('listen_addresses') as binding")).rows.every((row) => row.address === "127.0.0.1" && row.binding === "127.0.0.1"), "Database is loopback-only");
  await db.query(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create schema private; grant usage on schema public,auth to anon,authenticated,service_role;
    grant usage on schema private to service_role;
    alter default privileges in schema public,private grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public,private grant execute on functions to anon,authenticated,service_role;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant execute on function auth.uid() to anon,authenticated,service_role;`);
  await db.query(await readFile(join(root, "supabase/tests/garmin-additive-baseline.sql"), "utf8"));
  const before = await snapshot();
  for (const name of ["20261023074736_garmin_oauth_connections.sql", "20261023082837_garmin_account_deletion_fence.sql", "20261023155612_garmin_health_sync.sql"]) {
    const guards = name === "20261023155612_garmin_health_sync.sql" ? (await db.query(`
      select p.oid,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='private' and p.proname in ('guard_garmin_oauth_transaction','guard_garmin_deletion_fence') order by p.oid`)).rows : null;
    const triggers = guards ? (await db.query(`select oid,pg_get_triggerdef(oid) as definition from pg_trigger
      where not tgisinternal and tgname in ('garmin_oauth_transaction_guard','garmin_deletion_fence_guard') order by oid`)).rows : null;
    await db.query(await readFile(join(root, "supabase/migrations", name), "utf8"));
    check(isDeepStrictEqual(before, await snapshot()), `${name} preserves existing rows, columns, grants, RLS, policies and application trigger`);
    if (guards) {
      check(guards.length === 2 && isDeepStrictEqual(guards, (await db.query(`select oid,pg_get_functiondef(oid) as definition
        from pg_proc where oid=any($1::oid[]) order by oid`, [guards.map((row) => row.oid)])).rows), "Health migration preserves both existing OAuth/deletion guard definitions");
      check(triggers.length === 2 && isDeepStrictEqual(triggers, (await db.query(`select oid,pg_get_triggerdef(oid) as definition
        from pg_trigger where oid=any($1::oid[]) order by oid`, [triggers.map((row) => row.oid)])).rows), "Health migration preserves both existing OAuth/deletion guard triggers");
    }
  }
  await db.query(await readFile(join(root, "supabase/tests/garmin-health-sync.sql"), "utf8"));
  check(isDeepStrictEqual(before, await snapshot()), "Fixture rollback preserves the original application data");
  await db.query(await readFile(join(root, "supabase/migrations/20261024104429_garmin_health_controls.sql"), "utf8"));
  check(isDeepStrictEqual(before, await snapshot()), "Health controls preserve unrelated application rows, schemas, policies and grants");
  await db.query(await readFile(join(root, "supabase/tests/garmin-health-controls.sql"), "utf8"));
  await db.query(await readFile(join(root, "supabase/migrations/20261024153040_garmin_health_general_availability.sql"), "utf8"));
  check(isDeepStrictEqual(before, await snapshot()), "General availability preserves unrelated application data and security");
  await db.query(await readFile(join(root, "supabase/tests/garmin-health-general-availability.sql"), "utf8"));
  await db.query(await readFile(join(root, "supabase/migrations/20261025003708_garmin_health_admission.sql"), "utf8"));
  check(isDeepStrictEqual(before, await snapshot()), "Admission migration preserves unrelated application data and security");
  await db.query(await readFile(join(root, "supabase/tests/garmin-health-admission.sql"), "utf8"));
  const previousSleepProcessor = (await db.query("select pg_get_functiondef('private.process_garmin_health_queue_v1(uuid[],integer)'::regprocedure) as definition")).rows[0].definition;
  await db.query(await readFile(join(root, "supabase/migrations/20261025105626_garmin_sleep_finalization.sql"), "utf8"));
  check(isDeepStrictEqual(before, await snapshot()), "Sleep finalization preserves unrelated application data and security");
  await db.query(await readFile(join(root, "supabase/tests/garmin-sleep.sql"), "utf8"));
  await db.query("begin");
  await db.query(previousSleepProcessor);
  check((await db.query("select pg_get_functiondef('private.process_garmin_health_queue_v1(uuid[],integer)'::regprocedure) as definition")).rows[0].definition === previousSleepProcessor,
    "Exact predecessor processor can be restored transactionally without table changes");
  await db.query("rollback"); // Keep the candidate installed for the remaining compatibility tests.
  await db.query(await readFile(join(root, "supabase/migrations/20261025124444_garmin_session_heart_rate.sql"), "utf8"));
  check(isDeepStrictEqual(before, await snapshot()), "Session HR preserves existing scoring, application rows and security");
  await db.query(await readFile(join(root, "supabase/tests/garmin-session-heart-rate.sql"), "utf8"));
  // Historical HR fixtures above verify the applied predecessor; current consumers use only activity links.
  await db.query("alter table public.sessions add column session_date date not null default '2026-10-25'");
  await db.query("insert into public.session_recording_windows(session_id,user_id,started_at,finished_at,activity_id) select id,user_id,'2026-10-25 01:00Z','2026-10-25 02:00Z','historical-preserved-link' from public.sessions order by id limit 1");
  const beforeActivityUpgrade=await snapshot();
  const activityMigration=await readFile(join(root,'supabase/migrations/20261026022713_garmin_activity_session_links.sql'));
  if(process.env.SUPABASE_CLI) {
    if(!isAbsolute(process.env.SUPABASE_CLI))throw Error('SUPABASE_CLI must be an existing absolute path.');
    await access(process.env.SUPABASE_CLI);
    const release=join(owned,'migration-release');
    await mkdir(join(release,'supabase/migrations'),{recursive:true});
    await writeFile(join(release,'supabase/config.toml'),'project_id = "activity-links-disposable"\n');
    await writeFile(join(release,'supabase/migrations/20261026022713_garmin_activity_session_links.sql'),activityMigration);
    const predecessor=async()=>({
      rows:(await db.query('select * from public.session_recording_windows order by session_id')).rows,
      functions:(await db.query("select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname,p.proname) in (('public','set_session_recording_window'),('public','read_session_garmin_hr'),('private','cleanup_garmin_hr_controls'),('private','cleanup_garmin_hr_connection')) order by n.nspname,p.proname")).rows,
    });
    const previous=await predecessor();
    await db.query(`create schema supabase_migrations;
      create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text);
      create function private.reject_activity_history_fixture() returns trigger language plpgsql as $$begin
        if to_regclass('public.session_garmin_activity_links') is null or to_regclass('private.retired_session_recording_windows') is null then raise exception 'Expected migration schema not reached'; end if;
        raise exception 'injected activity history failure'; end;$$;
      create trigger reject_activity_history_fixture before insert on supabase_migrations.schema_migrations for each row execute function private.reject_activity_history_fixture();`);
    const runCLI=()=>execute(process.env.SUPABASE_CLI,['migration','up','--db-url',`postgresql://postgres:disposable-only@127.0.0.1:${port}/postgres?sslmode=disable`,'--workdir',release,'--yes'],{...options,timeout:45000});
    let rejected;try{await runCLI();}catch(error){rejected=error;}
    check(!!rejected&&(String(rejected.stdout)+String(rejected.stderr)).includes('injected activity history failure'),'Actual CLI reaches injected history failure after activity migration SQL');
    check((await db.query("select to_regclass('public.session_garmin_activity_links') is null and to_regclass('private.retired_session_recording_windows') is null safe")).rows[0].safe,'History failure rolls back activity table creation and archive move');
    check(isDeepStrictEqual(previous,await predecessor()),'CLI history failure preserves exact predecessor functions and historical rows');
    check(isDeepStrictEqual(beforeActivityUpgrade,await snapshot()),'CLI history failure preserves unrelated data, schema and privileges');
    check((await db.query('select count(*)::int n from supabase_migrations.schema_migrations')).rows[0].n===0,'CLI history failure records no migration version');
    await db.query('drop trigger reject_activity_history_fixture on supabase_migrations.schema_migrations;drop function private.reject_activity_history_fixture()');
    await runCLI();
    check((await db.query("select version,name from supabase_migrations.schema_migrations")).rows.every(row=>row.version==='20261026022713'&&row.name==='garmin_activity_session_links')&&(await db.query('select count(*)::int n from supabase_migrations.schema_migrations')).rows[0].n===1,'Successful actual CLI application records only the canonical activity-links version');
  } else {
    await db.query('begin');
    await db.query(activityMigration.toString('utf8'));
    await db.query('commit');
  }
  check(isDeepStrictEqual(beforeActivityUpgrade,await snapshot()),'Activity-only migration preserves scoring data, schema, grants and unrelated policies');
  check((await db.query("select count(*)::int n from private.retired_session_recording_windows where activity_id='historical-preserved-link'")).rows[0].n===1,'Historical timestamps and imported association evidence are archived without deletion');
  check((await db.query("select count(*)::int n from public.session_garmin_activity_links where activity_id='historical-preserved-link'")).rows[0].n===1,'Existing explicit activity association survives migration');
  await (await import("./garmin-health-admission-fixture.mjs")).testAdmissionConcurrency(db, pg.Client, configuration, check);
  await (await import("./garmin-private-webhook-fixture.mjs")).testPrivateWebhookDatabase(db, check);
  // Actual independent transactions: processing must not race an in-flight disconnect.
  const blocker = new pg.Client(configuration); await blocker.connect();
  try {
    await db.query(`insert into auth.users values('90000000-0000-4000-8000-000000000001','concurrency@example.invalid');
      insert into public.garmin_connections(user_id,garmin_user_id,status,token_ciphertext,access_expires_at,refresh_after,authorized_at,permissions)
      values('90000000-0000-4000-8000-000000000001','concurrency','connected','synthetic',now()+interval '1 day',now()+interval '1 day',now(),'["HEALTH_EXPORT"]');`);
    await db.query(`select public.stage_garmin_health_push(jsonb_build_array(jsonb_build_object('garminUserId','concurrency','kind','dailies',
      'sourceId','concurrency-summary','hash',repeat('c',64),'recordKey','1792713600','calendarDate','2026-10-23',
      'startTimeInSeconds',1792713600,'durationInSeconds',3600,'values','{"steps":5}'::jsonb)),array['90000000-0000-4000-8000-000000000001']::uuid[]);`);
    await blocker.query("begin");
    await blocker.query("select * from public.garmin_connections where garmin_user_id='concurrency' for update");
    await db.query("set role service_role");
    check((await db.query("select public.process_garmin_health_queue(array['90000000-0000-4000-8000-000000000001']::uuid[],25) as count")).rows[0].count === 0, "Worker does not wait on or process a locked connection");
    await db.query("reset role");
    await blocker.query("rollback");
    const results = await Promise.all([db.query("select public.process_garmin_health_queue(array['90000000-0000-4000-8000-000000000001']::uuid[],25) as count"), blocker.query("select public.process_garmin_health_queue(array['90000000-0000-4000-8000-000000000001']::uuid[],25) as count")]);
    check(results.reduce((sum, result) => sum + result.rows[0].count, 0) === 1, "Concurrent workers process a pending receipt exactly once");
    await db.query(`select public.admit_garmin_hr_push(jsonb_build_array(jsonb_build_object('garminUserId','concurrency','kind','dailies',
      'sourceId','concurrent-daily-hr','hash',repeat('d',64),'recordKey','concurrent-daily-hr','calendarDate','2026-10-25',
      'startTimeInSeconds',1792882800,'durationInSeconds',3600,'values','{}'::jsonb,
      'heartRate',jsonb_build_object('source','daily','revision',repeat('e',64),'part',0,'parts',1,'count',2,
      'samples','[[1792882815,80],[1792882830,90]]'::jsonb))));`);
    await blocker.query('begin');
    await blocker.query("select * from public.garmin_connections where garmin_user_id='concurrency' for update");
    check((await db.query('select public.process_garmin_health_queue(25) as count')).rows[0].count===0,
      'HR processing skips a connection held by a concurrent lifecycle operation');
    await blocker.query('rollback');
    const hrResults=await Promise.all([db.query('select public.process_garmin_health_queue(25) as count'),blocker.query('select public.process_garmin_health_queue(25) as count')]);
    check(hrResults.reduce((sum,result)=>sum+result.rows[0].count,0)===1,'Two independent workers process the same HR receipt exactly once');
    check((await db.query("select count(*)::int n from public.garmin_hr_datasets where source_id='concurrent-daily-hr' and published and sample_count=2")).rows[0].n===1,
      'Concurrent HR processing preserves one complete dataset and its original samples');
  } finally { await blocker.end(); }
  await (await import("./garmin-health-controls-fixture.mjs")).testHealthControlConcurrency(db, pg.Client, configuration, check);
  await (await import("./garmin-session-controls-fixture.mjs")).testSessionControlConcurrency(db, pg.Client, configuration, check);
  console.log(JSON.stringify({ passed: assertions.length, failed: 0, assertions, version: (await db.query("select version()")).rows[0].version,
    limitation: "Synthetic Auth roles/uid; no real JWT, PostgREST, Garmin deliveries or production database." }, null, 2));
} catch (error) { failure = error; }
finally {
  if (db) { try { await db.query("rollback"); } catch {} await db.end(); }
  if (attempted) {
    try { await execute(binary("pg_ctl"), ["-D", data, "-m", "fast", "-w", "-t", "20", "stop"], options); started = false; }
    catch (error) { started = true; failure ??= error; }
  }
  const resolved = resolve(owned);
  if (!started && resolved.startsWith(temporary + sep) && resolved === resolve(owned) && resolved.split(sep).at(-1).startsWith("arctrack-health-pg-owned-")) await rm(resolved, { recursive: true, force: true });
}
if (failure) throw failure;
