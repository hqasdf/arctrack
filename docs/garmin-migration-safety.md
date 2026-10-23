# Garmin additive-migration safety and controlled application

Prepared 23 October 2026. **Historical audit and procedure; do not rerun.** The
owner subsequently approved both production migrations and chose to proceed
without creating a backup. Both were applied through the connected SQL interface,
verified individually, then recorded under original versions `20261023074736`
and `20261023082837`. All 18 earlier history entries and existing application
data/schema fingerprints remained unchanged. The local psql procedure below was
not used. No website deployment or Garmin authorization accompanied that operation.
See `garmin-disabled-release.md` for the next, separately approved release step.

## Verdict and statement inventory

Additive relative to existing application tables and data. Migration two amends
only Garmin objects created by migration one; it is not literally CREATE-only.
Neither file contains INSERT, UPDATE, DELETE or TRUNCATE against application data,
ALTER of an existing non-Garmin table, DROP TABLE, or changes to existing policies.
The UPDATE/INSERT words in CREATE TRIGGER declare future trigger events, not data
modifications. SELECT ... FOR UPDATE inside the guard runs only on future Garmin
transaction writes, not when the function is created.

`20261023074736_garmin_oauth_connections.sql` statements, in order:

1. BEGIN: start the file's transaction.
2. CREATE TABLE public.garmin_connections: connection metadata, encrypted credential
   field, status, expiry timestamps, permissions, operation/version/lease, checks,
   primary key, unique provider identity and Auth-user FK with ON DELETE CASCADE.
3. CREATE TABLE public.garmin_oauth_transactions: encrypted verifier, hashed state
   and binding, connection version, callback, expiry, checks, primary key, unique
   state hash and Auth-user FK with ON DELETE CASCADE.
4. ALTER TABLE garmin_connections ENABLE ROW LEVEL SECURITY.
5. ALTER TABLE garmin_oauth_transactions ENABLE ROW LEVEL SECURITY.
6. REVOKE all table privileges from PUBLIC, anon, authenticated and service_role,
   on those two new tables only.
7. GRANT SELECT/INSERT/UPDATE/DELETE on those two tables to service_role only.
8. CREATE FUNCTION private.guard_garmin_oauth_transaction(): SECURITY INVOKER,
   empty search_path, qualified Garmin table/clock reference, locked connection
   version and active authorize lease check; rejects stale writes with 40001.
9. REVOKE EXECUTE from PUBLIC, anon, authenticated and service_role for that guard.
10. GRANT EXECUTE on that guard to service_role only.
11. CREATE TRIGGER garmin_oauth_transaction_guard, BEFORE INSERT OR UPDATE on the
    new transaction table, invoking the new guard.
12. COMMIT: commit the first file.

`20261023082837_garmin_account_deletion_fence.sql` statements, in order:

1. BEGIN.
2. ALTER TABLE public.garmin_connections: add nullable deletion_requested_at and
   deregistered_at timestamps, without defaults or backfill.
3. DROP CONSTRAINT garmin_connections_operation_check on that Garmin table only.
4. ADD the replacement operation check, adding 'delete' to the existing values.
5. CREATE FUNCTION private.guard_garmin_deletion_fence(): SECURITY INVOKER, empty
   search_path; preserve a set fence, prohibit ordinary operations after fencing,
   and reject fencing while a non-deletion operation remains in progress.
6. REVOKE EXECUTE from PUBLIC, anon, authenticated and service_role on that guard.
7. GRANT EXECUTE on that guard to service_role only.
8. CREATE TRIGGER garmin_deletion_fence_guard, BEFORE UPDATE on the Garmin
   connection table.
9. CREATE OR REPLACE private.guard_garmin_oauth_transaction(): same guard created
   by migration one, additionally requiring deletion_requested_at IS NULL.
10. REVOKE EXECUTE on that Garmin guard from the same four roles.
11. GRANT EXECUTE on that Garmin guard to service_role only.
12. COMMIT.

PostgreSQL also creates four supporting unique/primary-key indexes, two composite
row types and their array types, constraints/dependencies and internal foreign-key
triggers. The two FKs add **four internal action triggers on auth.users**, plus
their check triggers on the Garmin child tables. This is expected reference
metadata, not an alteration of Auth columns, existing triggers or Auth records.
Deleting an Auth user later cascades to that user's Garmin child rows; deleting
a Garmin row does not delete its Auth parent. FK creation takes locks on the
referenced relation, so additive does not mean zero contention.

## Dependencies and failure boundaries

- Intended project: pdwxphgyqbbflnrruobp. Confirm in the Supabase dashboard and
  connector before every live execution; do not rely on current_database() alone.
- Existing auth.users(id uuid primary key), public/private schemas,
  anon/authenticated/service_role roles, service_role USAGE on private and
  pg_catalog.gen_random_uuid() must exist. The migration executor needs CREATE in
  public/private and REFERENCES on auth.users.
- Run the first file before the second. Neither is idempotent. The replacement
  constraint name must match the constraint created by file one.
- No old application migration must be reapplied. Historical local/live version
  differences are not part of this change and must not be repaired by this task.
- Both files must be applied before deploying the Garmin-aware account-deletion
  action, including for users who have never linked Garmin. Password/identity
  verification stays in the application; these files do not change Auth logic.
- Keep new Garmin authorization disabled until the deletion-aware deployment is
  installed and reviewed. After real grants exist, preserve credentials, keys,
  fences and cleanup code. Do not drop the schema or revert to old deletion code.
- Hosted event triggers/default privileges and concurrent activity can differ
  from the disposable environment. Stop on any unexpected grants, policy,
  function, object collision, history entry or migration failure.

## Read-only preflight immediately before execution

Run through the confirmed project connector or a TLS-verified administrator
connection. Do not print connection passwords or read application records.

```sql
select current_user,
  to_regclass('auth.users') as auth_users,
  to_regnamespace('private') as private_schema,
  to_regprocedure('pg_catalog.gen_random_uuid()') as uuid_generator,
  has_schema_privilege(current_user,'public','CREATE') as can_create_public,
  has_schema_privilege(current_user,'private','CREATE') as can_create_private,
  has_table_privilege(current_user,'auth.users','REFERENCES') as can_reference_auth,
  has_schema_privilege('service_role','private','USAGE') as service_private_usage;

select to_regclass('public.garmin_connections') as connections,
  to_regclass('public.garmin_oauth_transactions') as transactions,
  to_regprocedure('private.guard_garmin_oauth_transaction()') as oauth_guard,
  to_regprocedure('private.guard_garmin_deletion_fence()') as deletion_guard;

select version,name from supabase_migrations.schema_migrations order by version;
select evtname,evtevent,evtenabled from pg_event_trigger order by evtname;
select * from pg_default_acl;
```

On a first application all four Garmin object checks and both Garmin history
entries must be absent. If any exists, stop and reconcile the actual state
read-only. Do not use IF NOT EXISTS, overwrite a function, or mark an unexecuted
file applied to bypass a mismatch. Confirm the two file SHA-256 hashes:

```
20261023074736: BE23751C339629253E8C7D0599C527B273F96863A4DED2F09629D1F5B139BB0B
20261023082837: 0D2A34A53E09CEC07567117B6662371C43CD6477A62E7B2C30FDA9C7109A7107
```

## Exact, two-file application commands — AFTER APPROVAL ONLY

These are a manual SQL + normal CLI history-recording procedure, deliberately
not db push or migration up. The CLI repair command records only the specified
new, absent version as applied; it does not execute schema SQL. Do not repair
any historical version. The installed CLI 2.121.0 command help was inspected.

Prerequisites: a reviewed PostgreSQL `psql` client, existing Supabase CLI login,
and privately configured PGPASSFILE plus PGSSLROOTCERT for the intended project.
Do not put credentials in the command, repository or chat. Direct connectivity
must work; if unavailable, separately verify the dashboard's session-pooler host
and username rather than substituting a guessed host or transaction pooler.
The portable PostgreSQL test runner is not the production connection mechanism.

Run from the repository root in PowerShell. Run one numbered step at a time,
inspect the result, and stop at every error; these commands have NOT run live.

```powershell
$env:PGSSLMODE = 'verify-full'
$cli = (Resolve-Path -LiteralPath '.verification/npm-cache/_npx/5ed57a240faae6e6/node_modules/@supabase/cli-windows-x64/bin/supabase.exe').Path
# Ensure PGPASSFILE and PGSSLROOTCERT already point to restricted, approved files.
if (-not $env:PGPASSFILE -or -not $env:PGSSLROOTCERT) { throw 'Secure PostgreSQL connection prerequisites missing.' }

# 1. Approved first migration only. Its own BEGIN/COMMIT is retained.
psql -X --no-password --host=db.pdwxphgyqbbflnrruobp.supabase.co --port=5432 --username=postgres --dbname=postgres --set=ON_ERROR_STOP=1 --file=supabase/migrations/20261023074736_garmin_oauth_connections.sql
if ($LASTEXITCODE -ne 0) { throw 'STOP: first migration failed.' }

# 2. After confirming file one committed and its version is still absent:
& $cli migration repair 20261023074736 --status applied --project-ref pdwxphgyqbbflnrruobp
if ($LASTEXITCODE -ne 0) { throw 'STOP: first migration committed, history recording needs reconciliation; do not rerun SQL.' }

# 3. After first-file object/security/history verification, approve/run file two:
psql -X --no-password --host=db.pdwxphgyqbbflnrruobp.supabase.co --port=5432 --username=postgres --dbname=postgres --set=ON_ERROR_STOP=1 --file=supabase/migrations/20261023082837_garmin_account_deletion_fence.sql
if ($LASTEXITCODE -ne 0) { throw 'STOP: second migration failed; keep code rollout disabled.' }

# 4. After confirming file two committed and its version is still absent:
& $cli migration repair 20261023082837 --status applied --project-ref pdwxphgyqbbflnrruobp
if ($LASTEXITCODE -ne 0) { throw 'STOP: second migration committed, history recording needs reconciliation; do not rerun SQL.' }
```

SQL application and CLI history recording are separate commits in this manual
procedure. If history recording fails, stop, inspect definitions and history,
and obtain approval for recording the already-completed version only. Never
rerun committed SQL or start the next file to hide a history-recording failure.
Use one operator/maintenance window to avoid concurrent migration executions.
CLI credentials and database passwords must already be available through secure
local tooling; do not pass --password or --db-url with real secrets as arguments.

## Read-only post-application verification

Run after each applicable file, before proceeding to the next stage:

```sql
select version,name from supabase_migrations.schema_migrations
where version in ('20261023074736','20261023082837') order by version;

select c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('garmin_connections','garmin_oauth_transactions');
select * from pg_policies where schemaname='public'
and tablename in ('garmin_connections','garmin_oauth_transactions');
select r.rolname,c.relname,p.privilege,
  has_table_privilege(r.oid,c.oid,p.privilege) as allowed
from pg_roles r cross join pg_class c
cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege)
where r.rolname in ('anon','authenticated','service_role')
and c.oid in ('public.garmin_connections'::regclass,'public.garmin_oauth_transactions'::regclass)
order by r.rolname,c.relname,p.privilege;

select conrelid::regclass,conname,convalidated,pg_get_constraintdef(oid,true)
from pg_constraint where conrelid in
('public.garmin_connections'::regclass,'public.garmin_oauth_transactions'::regclass)
order by conrelid,conname;
select tgrelid::regclass,tgname,tgisinternal,tgenabled,pg_get_triggerdef(oid,true)
from pg_trigger where tgrelid in
('public.garmin_connections'::regclass,'public.garmin_oauth_transactions'::regclass)
or (tgrelid='auth.users'::regclass and tgconstraint in
  (select oid from pg_constraint where conrelid in
    ('public.garmin_connections'::regclass,'public.garmin_oauth_transactions'::regclass)))
order by tgrelid,tgname;
select p.oid::regprocedure,p.prosecdef,p.proconfig,p.proacl,pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='private' and p.proname in
('guard_garmin_oauth_transaction','guard_garmin_deletion_fence');
select count(*) as connections from public.garmin_connections;
select count(*) as transactions from public.garmin_oauth_transactions;
```

Expected: RLS true, no client policies, anon/authenticated effective privileges
false, only service-role DML grants (not TRUNCATE/REFERENCES/TRIGGER), validated
Auth cascade FKs, correct Garmin guard definitions, SECURITY INVOKER with empty
search_path and service-only EXECUTE. After file two, verify both nullable
timestamps and the operation check permitting delete. Before code activation the
two new tables must be empty. Effective privileges can also come from unexpected
role inheritance; inspect ACLs and effective results, not just grants text.
Do not SELECT token_ciphertext or run destructive/rollback fixtures in production.

## Disposable evidence

Run `node scripts/test-garmin-sql.mjs` with the existing absolute PG_BIN and
PG_DRIVER_MODULE paths. It accepts no database URL, reads no environment file,
and creates only a new loopback-bound, owned temporary cluster.

The synthetic baseline contains 11 existing tables and 13 representative rows,
including Auth, profile, Session/Round/End/Arrow coordinates, organisation and
Training Plan data; an existing RLS policy, validation trigger, grouping view
and used sequence are included. This is deliberately not a full production clone.
The runner compares original relation/column/constraint/index definitions,
function definitions, grants, policies, existing triggers, types, roles, schema
and default ACLs, extensions, event triggers, sequence state and full row JSON
after each migration and after the existing rollback/concurrency fixtures.
Only the declared Garmin additions and their expected internal Auth FK triggers
are excluded from the existing-object comparison.

Existing owner reads/writes, other-user isolation, title-validation trigger and
unchanged grouping output are exercised in rollback transactions. This verifies
representative functionality, not every application RPC or hosted Auth service.
No production success guarantee follows from these synthetic tests.
