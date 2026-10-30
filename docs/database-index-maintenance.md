# Garmin inbox duplicate-index cleanup

Local maintenance migration: `20261030160303_garmin_inbox_duplicate_index_cleanup.sql`.
It has **not** been applied to production by this task.

Read-only metadata from project `pdwxphgyqbbflnrruobp` confirmed 37 applied migrations and these independent indexes:

| Property | Retained `garmin_health_inbox_pending` | Removed `garmin_health_inbox_owner_dispatch` |
| --- | --- | --- |
| Table | `public.garmin_health_inbox` | Same |
| Method / uniqueness | btree / nonunique | Same |
| Keys / ordering | `user_id, id`, ascending, default null ordering | Same |
| Predicate | `state = 'pending'::text` | Same |
| Opclasses / collations | `10065 3124` / `0 0` | Same |
| Valid / ready | true / true | true / true |
| Constraints / dependent objects | 0 / 0 | 0 / 0 |
| Scans in current statistics window | 13 | 0 |

Statistics reset timestamp: `2026-08-25T20:41:21.766501Z`. Usage is supporting evidence, not the reason for declaring equivalence. These statistics can change.
The read-only production EXPLAIN for a bounded pending-owner dispatch query selected the separate `garmin_health_inbox_dispatch` index. No ANALYZE or timing benchmark was run against production. The disposable test verifies a `(user_id,id)` pending query uses the retained index after cleanup. Worker fairness, leases and receipt selection SQL are unchanged.

## Locking and execution

PostgreSQL cannot run `DROP INDEX CONCURRENTLY` inside a transaction block. This small cleanup instead uses a regular transactional drop, `lock_timeout = '2s'`, `statement_timeout = '15s'`, and `RESTRICT` without CASCADE. It first obtains the table lock, then inspects catalog definitions under that lock to avoid a concurrent-DDL inspection race. It refuses a missing, invalid or unexpected retained index, a structurally different duplicate, or a dependent/constraint-backed duplicate.

An ACCESS EXCLUSIVE table lock briefly blocks reads and writes; a queued lock can also delay requests while waiting, up to the lock timeout. **This is not a zero-downtime claim.** Schedule a quiet window for the separately approved production application. If a writer holds a conflicting lock, the migration fails and must be reviewed before retrying. Do not remove the timeouts or run a broad `supabase db push` to force progress.

Successful repeat execution validates the retained index and returns harmlessly if the duplicate is already absent. Migration-history recording still belongs to the established version-preserving migration workflow: never rerun SQL merely to fix a history entry, edit prior history or rewrite the queue-fairness migration.

Before future application, recheck the exact target, history, both complete index definitions and dependencies. Apply only this reviewed version through the existing migration-aware procedure. Afterward verify the new history version, valid retained index, absent duplicate, unchanged function/grant/RLS definitions and ongoing scheduler results. No schema application is authorized by this document.

## Local verification

The existing disposable Garmin PostgreSQL runner includes `garmin-index-cleanup-fixture.mjs`: active-writer timeout and rollback, successful drop, retained-index validity and query plan, receipt/OAuth/function/grant/policy snapshots, repeat execution, missing-retained rejection, structural-drift rejection, and service-worker execution after cleanup. It uses synthetic local data only. The general PostgreSQL runner applies the full chronological migration set. These checks do not guarantee future production lock availability or query-plan choices.

Official locking reference: [PostgreSQL DROP INDEX](https://www.postgresql.org/docs/17/sql-dropindex.html).
