/**
 * Disposable, in-memory PostgreSQL test. Never reads project .env / connection URLs.
 * Install @electric-sql/pglite separately from the app; set PGLITE_MODULE to its
 * package directory. All migration text is applied unchanged. Supabase Auth is
 * represented only by the roles, auth.users columns and auth.uid() used by SQL;
 * this does not test GoTrue, JWT verification, PostgREST or parallel connections.
 */
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const packageDirectory = process.env.PGLITE_MODULE;
if (!packageDirectory) throw new Error('Set PGLITE_MODULE to a separately installed @electric-sql/pglite package directory.');
const { PGlite } = await import(pathToFileURL(join(packageDirectory, 'dist/index.js')).href);
const { pgcrypto } = await import(pathToFileURL(join(packageDirectory, 'dist/contrib/pgcrypto.js')).href);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const db = new PGlite({ extensions: { pgcrypto } });
try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create role supabase_auth_admin nologin;
    create schema auth;
    create schema extensions;
    create extension pgcrypto with schema extensions;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create table auth.users (
      id uuid primary key, aud text, role text, email text,
      email_confirmed_at timestamptz, created_at timestamptz, updated_at timestamptz
    );
    grant usage on schema auth to supabase_auth_admin;
    grant select, delete on table auth.users to supabase_auth_admin;
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
    $$;
    grant execute on function auth.uid() to anon, authenticated, service_role;
  `);
  const migrations = (await readdir(join(root, 'supabase/migrations'))).filter(name => name.endsWith('.sql')).sort();
  let existingBudgetBefore;
  const existingBudgetDefinition = async () => (await db.query(`
    select pg_get_functiondef('private.consume_operation_budget(text)'::regprocedure) as function_definition,
      (select pg_get_constraintdef(oid) from pg_constraint
        where conrelid='private.operation_budgets'::regclass and conname='operation_budgets_operation_check') as operation_constraint
  `)).rows[0];
  for (const migration of migrations) {
    try {
      if (migration === '20261022022012_session_notes_shared_coach_feedback.sql') existingBudgetBefore = await existingBudgetDefinition();
      await db.exec(await readFile(join(root, 'supabase/migrations', migration), 'utf8'));
    } catch (error) {
      throw new Error(`Migration failed: ${migration}: ${error.message}`, { cause: error });
    }
  }
  const existingBudgetUnchanged = JSON.stringify(existingBudgetBefore) === JSON.stringify(await existingBudgetDefinition());
  if (!existingBudgetBefore || !existingBudgetUnchanged) throw new Error('Notes migration changed the existing operation budget definition or supported operations.');
  const results = await db.exec(await readFile(join(root, 'supabase/tests/session-notes-coach-feedback.sql'), 'utf8'));
  const assertionResult = results.find(result => result.rows?.[0]?.passed_assertions !== undefined);
  if (!assertionResult) throw new Error('Fixture did not return its assertion count.');
  const version = await db.query('select version() as version');
  const residual = await db.query("select count(*)::int as rows from auth.users where email like 'notes-%@example.invalid'");
  if (residual.rows[0].rows !== 0) throw new Error('Rollback did not remove fixture users.');
  console.log(JSON.stringify({
    passed: assertionResult.rows[0].passed_assertions, failed: 0,
    migrations: migrations.length, rollbackVerified: true,
    existingOperationBudgetUnchanged: existingBudgetUnchanged,
    runtime: version.rows[0].version,
    limitations: 'Emulated Supabase auth schema; no GoTrue/JWT verification/PostgREST or concurrent connections.'
  }, null, 2));
} catch (error) {
  console.error(error.message);
  if (error.cause?.detail) console.error(error.cause.detail);
  if (error.where) console.error(error.where);
  process.exitCode = 1;
} finally {
  await db.close();
}
