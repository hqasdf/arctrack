> Historical runbook for the initial migration, which is now applied. Do not reapply.
> The Session-only cleanup uses a new forward migration; current behavior is documented
> in notes-feedback-and-image-saving.md.

# Notes and Feedback: isolated production migration runbook

Prepared 22 October 2026. **Preparation only: no production SQL or history writes,
application deployment, native build, or live write tests have been performed.**

## Candidate and target

- Supabase project: `pdwxphgyqbbflnrruobp`; not Arc Track Health Dev.
- File: `supabase/migrations/20261022022012_session_notes_shared_coach_feedback.sql`.
- Version: `20261022022012`; name: `session_notes_shared_coach_feedback`.
- SHA-256: `5AEB5DF920C8F1473D72D9F03E3F5205458564BFB8C44379D47EA3CDE3723DC4`.
- Preserve the file byte-for-byte, including its own BEGIN and terminal COMMIT.
- Do not use generic `supabase db push`, migration repair, reset, or replay older files.

## Read-only production findings

Observed 22 October 2026: target ACTIVE_HEALTHY, region ap-northeast-1,
PostgreSQL 17.6 (platform version 17.6.1.166). Catalog execution role postgres.
Required public/private/auth/extensions/supabase_migrations schemas, referenced
tables, UUID keys, role/status fields, helpers and privileges are compatible.
pgcrypto 1.3 is in extensions; extensions.digest(text,text) exists.

All four proposed tables, six explicitly named indexes and 18 proposed functions
are absent. No candidate history version/name/idempotency key exists. There is no
metadata evidence of partial application. Required existing RLS is enabled;
authenticated/anon do not bypass RLS. postgres has REFERENCES on auth.users.
authenticated has private schema USAGE; anon does not. Existing coach helper and
membership-preserving leave function match the migration's assumptions.

Data API metadata-only probes accepted public and graphql_public; private returned
PGRST106 Invalid schema. This proves private is excluded, not a complete inventory
of every potentially configured schema. No private athlete content was queried.
PostgREST DDL/drop event watchers are enabled.

Production has 16 historical migration rows. Canonical history fingerprint:
`d3cfa8c97edf491140c7fbf838b965e3a9f8fa7f2e37335c904f2514db1416dd`.
Calculate using this exact expression, not a differently formatted JSON digest:

```sql
select encode(extensions.digest(
  coalesce(jsonb_agg(to_jsonb(h) order by version)::text,'[]'),
  'sha256'),'hex')
from supabase_migrations.schema_migrations h;
```

Repeat preflight immediately before execution. If any history changes, stop and
review the difference; do not silently replace the expected fingerprint.

## Preserve historical mismatches

| Name | Local version | Existing production version |
| --- | --- | --- |
| organization_hierarchy | 20260924031957 | 20260924072616 |
| coach_athlete_roster | 20260924080600 | 20260924081628 |
| allow_all_members_to_leave_organization | 20260924132000 | 20260924133550 |
| join_code_organization_model | 20260924160000 | 20260924155552 |
| atomic_round_creation | 20260926010823 | 20260926081514 |
| guarded_scoring_mutations | 20261005010000 | 20261004230822 |
| session_weather_snapshots | 20261016000901 | 20261016130846 |

These seven rows and historical files must remain unchanged. Other nine prior
versions match. No reconciliation is included in this deployment.

## Execution prerequisites and approval gates

1. Explicitly approve this exact migration AND the single new history row below.
2. Verify a successful usable backup/restore point in Supabase Database > Backups,
   recording timestamp, recovery coverage and restoration procedure. Availability
   and PITR have NOT been verified through the available connector. If no suitable
   backup exists, obtain separate approval for an encrypted logical backup; that
   would access private data and is outside this metadata-only preparation.
3. Supply an approved direct/session PostgreSQL connection through a secure local
   mechanism. Verify TLS certificate/CA and project identity. Credentials and direct
   connectivity have NOT been tested. Do not paste passwords in chat or logs.
4. Use one dedicated postgres-role connection, a bounded maintenance window, and
   retain redacted before/after catalog evidence. Avoid transaction-pool routing.
5. Repeat candidate hash, dependency, absence and locked history checks. Stop on
   conflicts, partial artifacts, unexpected grants, or changed prerequisites.

## Exact isolated operations proposed, NOT executed

Use a reviewed Node pg client (or equivalent dedicated PostgreSQL client) with
parameter binding. This is a procedure specification, not an automatically running
deployment script. No new application dependency is required.

Read the original file as bytes, assert the exact SHA-256 above, then decode UTF-8
without rewriting or normalizing it. Retain that exact string as `reviewedSql`.
Run the following through the SAME connection, in order:

```sql
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local idle_in_transaction_session_timeout = '30s';
select pg_try_advisory_xact_lock(20261022, 22012);
-- If false: ROLLBACK and stop.
lock table supabase_migrations.schema_migrations in share row exclusive mode;
```

Under that lock, assert count=16 and the exact canonical history fingerprint;
check the candidate version/name/key are absent; check all four new tables and all
18 new functions/six named indexes are absent; repeat required dependency checks.
Do not pause for interaction with a transaction open. Then execute parameterized:

```sql
insert into supabase_migrations.schema_migrations
  (version, name, statements, idempotency_key)
values ($1, $2, $3::text[], $4);
```

Bind exactly:

```text
$1 = 20261022022012
$2 = session_notes_shared_coach_feedback
$3 = [reviewedSql]   (one text-array element containing the exact original SQL)
$4 = arc-track:20261022022012:sha256:5AEB5DF920C8F1473D72D9F03E3F5205458564BFB8C44379D47EA3CDE3723DC4
```

Immediately call `await client.query(reviewedSql)` on the same connection. The
file's BEGIN produces the expected already-in-transaction warning and does not
start a nested transaction. Its final COMMIT commits BOTH the new history row and
all migration DDL. Do not issue a post-file history insert or automatic retry.
On a definite pre-commit SQL error, issue ROLLBACK and stop. On connection loss or
uncertain commit response, reconnect read-only and reconcile before any action.

Why not apply_migration: the hosted API/connector accepts name/query but no chosen
version; its automatic history recording cannot promise the exact local version.
Do not combine its automatic recording with this manually reviewed history row.
This controlled PostgreSQL procedure intentionally bypasses pending-file discovery.

## Post-commit verification

- Exactly one new version/name/key row; total history 17. Its statements array has
  one element; digest(convert_to(statements[1], 'UTF8'), 'sha256') matches candidate.
- Recalculate the canonical old-history digest excluding version 20261022022012:
  count 16 and the original fingerprint must remain unchanged.
- Verify definitions against the file: four tables, 18 functions, six explicitly
  named indexes, two SELECT policies and two explicit guards/triggers. Primary/
  unique constraints also generate indexes; do not mistake them for conflicts.
- Verify table/function ownership, security modes and empty search paths. Public
  wrappers are invoker functions; privileged implementations are private.
- authenticated has SELECT only on the two public tables, no direct mutations;
  only the intended RPC/helper EXECUTE grants exist. PUBLIC/anon/service_role have
  no grants on new objects. Private ledger/budget have no client table privileges.
  Check effective privileges too, including inherited/default grants.
- Verify public table RLS and exact policy expressions, FK actions, checks, UUID
  uniqueness, immutable context digest, tombstones and atomic budget function.
- Compare pre/post definitions and privileges of existing coach/leave/budget helpers,
  sessions and existing policies. No existing definitions should change.
- Check real PostgREST with safe test identities after separate write-test approval.
  DDL watchers should refresh schema cache; if stale, investigate first. A manual
  `NOTIFY pgrst, 'reload schema'` would be an additional approved operation.

## Security invariants to verify

Notes: owner reads/writes; currently authorized coaches read only. Feedback:
recipient reads; only original author with current exact-organisation active
Head Coach/active Archer relationship reads/edits/deletes as coach. Other coaches
are denied. Author identity comes from auth.uid(), not submitted identity.

Creation uses a request UUID, original normalized full-context/body SHA-256 digest,
request serialization, unique result linkage and deleted-entry tombstones. Current
authorization is required even for replay. Retry/edit does not consume creation
budget; new entries consume per-coach atomic fixed UTC windows: 10/minute,100/hour.
The existing consume_operation_budget(text) helper remains unchanged.

Leaving preserves recipient feedback but removes former-coach access. Session
deletion cascades its notes and nulls retained feedback's session reference.
Organisation deletion nulls feedback organisation; athlete deletion cascades their
feedback/operational metadata; coach deletion nulls author references. An authorized
explicit feedback deletion removes the entry but retains the private retry tombstone.

## Failure and recovery

- Lock timeout/contention: transaction rollback, inspect blockers read-only; never
  kill unrelated sessions automatically. Reschedule after review.
- DDL failure before COMMIT: entire history insert and new schema roll back.
- Lost connection/uncertain COMMIT: fresh metadata query. Matching complete schema
  plus matching history means applied; do not rerun. Neither means not committed;
  require review before retry. Any mismatch/partial artifact means STOP.
- Post-commit application issue: pause new feature rollout, preserve data and
  existing app service, investigate a forward correction. Do not drop tables or
  erase history after users may have written data. Restore only with explicit
  approval and an assessed impact on unrelated production data.

## Real Auth/PostgREST test plan (not run live)

Use separately approved test accounts and isolated records: Athlete A, Coach A,
Coach B (another legitimately authorized Head Coach), unrelated Athlete B. Use
normal authenticated clients, never service-role clients to prove RLS.

1. Athlete A creates a test Session and note; reload preserves it. Coach A reads
   but cannot mutate it. Anonymous and unrelated Athlete B cannot read or write.
2. Coach A creates feedback; Athlete A reads it. Coach B cannot read/edit/delete
   Coach A's entry despite being Head Coach in the same organisation.
3. Web and Expo display the SAME IDs/content/revisions. Simulate a lost response
   and retry with the SAME key/payload; concurrent retries yield one ID/entry and
   one charge. Changed payload/context rejects; stale edits reject.
4. Delete a test feedback entry then replay its key: no resurrection. Confirm
   retention after deleting only the test Session and after approved membership
   revocation; former coach cannot read or replay, recipient keeps feedback.
5. Use a dedicated test coach for 10/minute and100/hour boundary checks; retries,
   edits, rejected contexts do not charge. Keep quota testing separate from normal
   tester activity and other operation budgets. No stress test on real athletes.
6. Confirm existing scoring save/read on the disposable test Session remains
   correct. Verify public wrapper error handling through real JWT/PostgREST.
7. Record explicit cleanup authorization. Delete ONLY identified test records via
   normal guarded paths; do not mass-delete production data or private tombstones.

The maintained supabase/tests/session-notes-coach-feedback.sql fixture is intended
for disposable databases, not production. Its prior SQL-role tests do not replace
real Auth/JWT/PostgREST integration or physical-device QA.

## Application release dependencies

Database first, then separately approved web/mobile rollout. This migration is
additive; existing production application functions remain unchanged. It introduces
no new web environment variables or service-role browser/mobile client. Existing
Supabase URL/public-key/authentication configuration is reused.

Expo needs the updated JS implementation, not merely the database. Notes/feedback
and retry corrections introduce no native dependency or biometric change. The
separate Save to Device feature uses expo-media-library and its config plugin;
shipping that feature to installed binaries requires a future compatible native
build. Do not treat an old installed binary as supporting new native modules.
No native/EAS build, website deployment or store submission is authorized here.

## Validation evidence and approval status

During this preparation: disposable PostgreSQL17.6 exact-file/history-wrapper proof,
20 assertions passed,0 failed, including late-failure rollback, existing-version/key
gates and concurrent apply-once. Owned cluster stopped and removed. Expected nested
BEGIN warnings observed; production PostgREST watchers not emulated.

Prior implementation validation (not rerun for this documentation-only task):
PostgreSQL17.6 fixture142 assertions plus24 concurrency/harness assertions passed;
PGlite142 passed; web248/mobile485/core106 passed; all typechecks and web build
passed. Full mobile lint had10 pre-existing errors,0 warnings; changed-file lint
passed. Consult docs/notes-feedback-and-image-saving.md for scope and limitations.

Prepared procedure is ready for separate approval. Execution remains gated on
verified recovery readiness and a secure verified direct/session connection.
Required separate approvals: migration+single history insert; backup creation if
needed; live test-account/record writes and cleanup; application deployment; any
native build/store release. None is implied by this preparation.

References: PostgreSQL17 BEGIN semantics https://www.postgresql.org/docs/17/sql-begin.html ;
timeouts https://www.postgresql.org/docs/17/runtime-config-client.html ;
Supabase migration API https://supabase.com/docs/reference/api/v1-apply-a-migration ;
backup documentation https://supabase.com/docs/guides/platform/backups .
