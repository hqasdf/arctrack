# Garmin Health controls

Local feature branch implementation. Production migrations, webhooks, environment
changes, scheduling and release deployment require separate authorization.

## Behavior and privacy

- The server verifies Garmin status before fetching measurements. Disconnected or
  invalid authorization shows Connect/Reconnect; uncertain status hides data
  without deleting it. Visibility return and token expiry invalidate the old view
  until a new server response verifies access. Navigation stays available.
- The existing Overview, Trends, Activities, date filters, charts and refresh use
  imported records only. Connection is not evidence of measurement delivery.
- Confirmed **Delete Health Data** atomically removes imported records, all inbox
  rows/payloads and measurement sync state. OAuth is unchanged. A minimal owner,
  generation, pause/cutoff, deletion timestamp and latest action receipt remain.
- **Pause Health Sync** keeps measurements, purges measurement receipts/conflicts
  and persists a pause. Pending consent metadata is preserved solely for revocation
  cleanup. No measurements are admitted or processed while paused.
- **Resume Health Sync** rechecks Garmin identity and both HEALTH_EXPORT and
  ACTIVITY_EXPORT permissions under the existing OAuth lease. Master/privacy/
  ingress readiness and the pilot cohort must pass. The database checks the
  connection version, authorization epoch and expected control generation, rejects
  pending consent changes, and starts a new generation. Success permits future
  records; it does not announce new measurements.
- Confirmed disconnect retains existing remote deregistration and local lifecycle
  cleanup. It erases imported records, queue and measurement sync status, while
  retaining a minimal paused replay fence across reconnection. Resume is explicit.
  Successful account deletion cascades the fence. Failed remote cleanup preserves
  encrypted evidence and does not report successful disconnection.

## Concurrency and replay

Admission, worker processing and controls serialize on the existing connection
row. Deletion establishes its fence before cleanup in one transaction: another
worker either finishes before cleanup, skips the locked row, or waits and sees the
committed pause. Failure rolls back both fence and cleanup and reports no success.
No provider network call occurs inside the database transaction.

Expected generations and request UUIDs make retries idempotent and prevent late
older requests from undoing Resume. The UI blocks duplicate taps synchronously and
masks previous measurements after confirmed deletion. One authenticated SQL
snapshot reads records, pause and sync state together. Consent notifications
immediately invalidate pending verification proofs. The existing worker remains
unchanged behind a generation gate; stale receipts are scrubbed.

Garmin's supported notifications do not establish a delivery generation. After
Resume, measurement start must be strictly later than the cutoff second and no
later than the server's current second. Old history cannot replay by changing its
summary ID. Entire daily/sleep summaries spanning the cutoff are excluded, even
if they contain newer values. Clock skew may delay imports. Untimestamped
deregistration after a cutoff causes reconciliation, not credential erasure or
presumed current deregistration. Equal-duration corrections retain the existing
quarantine behavior. No automatic history backfill or provider-level replay
guarantee is claimed. Compromised ingress credentials forging event timestamps
are outside this cutoff guarantee; existing ingress authentication remains required.

## Schema and deployment boundary

Required order after separate approval:

1. Existing OAuth migrations (already recorded in production).
2. `20261023155612_garmin_health_sync.sql`, unchanged SHA-256
   `BD47CDFBD33EB1DE46A71E9E0B9AC0EEE9E14A91F83D090B78BE9AEEA8746AC4`.
3. `20261024104429_garmin_health_controls.sql`, generated with the installed CLI's
   `supabase migration new garmin_health_controls` command.

The additive migration adds controls, inbox generations, Garmin guards, a
service-only mutation RPC and an owner snapshot reader; it updates only Garmin
SELECT policies. The original worker moves into the private schema without body
changes. No historical migration is rewritten; the seven old timestamp
discrepancies remain separate. Never run a broad production database push.

Clients cannot mutate controls, read the inbox or access OAuth secrets. One
narrowly scoped SECURITY DEFINER helper returns only a boolean for auth.uid(),
uses an empty search path and grants EXECUTE only to authenticated. This checks
the credential table without exposing it. All other new functions use SECURITY
INVOKER. The mutation route checks the verified owner, existing same-origin
policy, bounded JSON and explicit confirmation. Submitted IDs never choose owners.

No new environment variables are needed. Health-disabled reads avoid Health-table
queries, so missing production migrations do not break ordinary pages. Delete/
Pause backend cleanup works independently of provider availability or ingestion
activation. Resume does not. UI controls appear when the enabled Health reader
returns the control row.

## Tests and activation

Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and
`git diff --check`. Run `node scripts/test-garmin-health-sql.mjs` and
`node scripts/test-garmin-sql.mjs` with the existing absolute PG_BIN and
PG_DRIVER_MODULE paths. These runners accept no database URLs and use owned,
temporary, loopback-only clusters with synthetic records and automatic cleanup.
The Health suite tests the original migration before the controls migration,
schema/data integrity, owner RLS, HTTP ingestion, scheduling and independent-client
control/worker races. Local ingress security tests remain in `npm test`.

Production still requires separately reviewed migrations/deployment, privacy and
retention approval, existing ingress/pilot/scheduler configuration and a genuine
consenting Garmin delivery. Test arrival, Delete, blocked redelivery, explicit
Resume and a newly started post-cutoff measurement using that account. Confirm
mobile/desktop Light/Dark/System and native dialog focus/Escape. Local fixtures do
not prove genuine Garmin delivery, hosted JWT/PostgREST, physical-device layout,
or infrastructure backup/log retention.

## Local verification on 24 October 2026

- Full website suite: 443 passed, 0 failed, 0 skipped.
- Disposable Health PostgreSQL suite: 147 assertions passed, 0 failed.
- Existing OAuth/deletion PostgreSQL runner: passed; 11 representative application
  tables and 13 rows unchanged, lease/CAS and account-deletion races passed, owned
  cluster stopped and removed.
- TypeScript, repository ESLint, production build and diff whitespace checks pass.
  The first restricted build encountered Windows EPERM creating generated Next.js
  files; the same source passed with normal local filesystem access.
- Isolated rendered-component preview: Connect, Paused and Stored states at 375,
  430, 768 and 1440 px in Light/Dark (24 cases), no horizontal overflow. Sync
  controls measured 48 px tall. Phone dialog fit, initially focused Cancel, and
  Escape closed it and returned focus to Delete Health Data. These were synthetic
  static visual fixtures, not authenticated React hydration or real Garmin tests.
- No production migration, environment change, remote credential operation,
  genuine Garmin delivery, push, deployment or scheduler activation was performed.

## Changed files

```text
docs/garmin-health-controls.md
docs/garmin-health-sync.md
docs/health-dashboard.md
scripts/garmin-health-controls-fixture.mjs
scripts/garmin-private-webhook-fixture.mjs
scripts/test-garmin-health-sql.mjs
src/app/api/integrations/garmin/health/control/route.ts
src/app/privacy/page.tsx
src/features/garmin/components/garmin-connection-card.tsx
src/features/garmin/health/controls.server.ts
src/features/garmin/health/read.server.ts
src/features/garmin/health/types.ts
src/features/garmin/http.server.ts
src/features/garmin/service.server.ts
src/features/health/components/health-cards.tsx
src/features/health/components/health-dashboard.tsx
src/features/health/components/health-sync-controls.tsx
src/features/health/components/health.module.css
src/features/health/read.server.ts
src/features/health/types.ts
supabase/migrations/20261024104429_garmin_health_controls.sql
supabase/tests/garmin-health-controls.sql
tests/garmin-health-controls.test.mjs
tests/garmin-health.test.mjs
tests/garmin.test.mjs
tests/health-theme.test.mjs
tests/health.test.mjs
tests/privacy-policy.test.mjs
```
