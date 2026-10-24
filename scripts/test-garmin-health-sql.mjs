/** Disposable native PostgreSQL only. Never reads .env, URLs or production credentials. */
import { access, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
  result.policies = (await db.query("select * from pg_policies where tablename not like 'garmin%' order by schemaname,tablename,policyname")).rows;
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
  } finally { await blocker.end(); }
  await (await import("./garmin-health-controls-fixture.mjs")).testHealthControlConcurrency(db, pg.Client, configuration, check);
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
