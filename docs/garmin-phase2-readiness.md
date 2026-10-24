# Garmin automatic sync readiness — 24 October 2026

For the current release split, ingress decision and Supabase Cron recommendation,
use [Garmin release readiness](garmin-release-readiness.md). Its NO-GO decision
supersedes the earlier bare-endpoint/scheduler proposals below; do not save or
enable those endpoint URLs.

**Not activated; not a completed real sync.** This phase makes local preparation
and verification changes only. It does not authorize a production migration,
provider configuration save, scheduler, deployment, commit or push.

## Current verified boundary

- Public OAuth source/release: `734afe7b5e952dcf0e3699c74f30b0599afa6704`, production
  deployment `dpl_C4xKaotaTNwsKpeRXbYDw96xvnwq` on the existing website alias.
- The two OAuth migrations exist on `pdwxphgyqbbflnrruobp`. Health migration
  `20261023155612` is absent; none of its three tables exists in production.
- The configured Health cohort is empty, its enable helper returns false, and
  `configuredGarminNotificationVerifier()` returns null. Public OAuth does not
  authorize ingestion. The receiver and worker stay fail-closed.
- API Tools was inspected through the existing authenticated session. All 22
  endpoint URL fields are blank and every endpoint is disabled/not On Hold.
  Daily Health Stats and Activity pillars are Approved and enabled, with zero
  active endpoints. Other pillars remain untouched.
- Endpoint Configuration exposes URL/Enabled/On Hold. API Configuration exposes
  API-pillar toggles. Neither inspected page exposes sender-authentication options.
  The linked Health OpenAPI 3.0.1 definition has no webhook section or security
  scheme, and no revision fields on the inspected daily/sleep/stress schemas.
  This is a limitation of the reviewed evidence, not proof that Garmin offers no
  mechanism elsewhere. See the [draft support request](garmin-notification-security-request.md).

## Migration scope and security

The local unapplied migration was corrected after a disposable regression exposed
revoked measurements remaining inside terminal conflict payloads. Both ordinary
permission removal and conservative same-second permission intersection now erase
affected quarantined health/activity values while preserving the conflict receipt
hash/error metadata. OAuth credentials, deletion fences and revision-selection
rules are unchanged. Pending receipts still undergo permission rechecks during
processing; this correction does not claim a new retention/purge SLA for all work.

The previous migration review hash is superseded. Current local SHA-256:

`BD47CDFBD33EB1DE46A71E9E0B9AC0EEE9E14A91F83D090B78BE9AEEA8746AC4`

Review this exact corrected file before separately authorizing production use.

The existing health migration creates three Garmin tables, their identity sequence,
six indexes including constraint indexes, two owner-SELECT policies, two service-only
security-invoker processing RPCs, and one private cleanup function/trigger on the
existing Garmin connection table. It does not restructure application tables or
replace existing OAuth/deletion guards.

- Inbox: service-only; no ordinary client or coach reads/writes.
- Measurements and safe status: authenticated owner SELECT only, explicit reader
  owner filters, no ordinary writes, no organisation/coach sharing.
- All three ownership FKs reference the existing Garmin connection with delete
  cascade. Existing Auth deletion cascades through that connection.
- Confirmed disconnect cleans records/inbox/status atomically. Pending or failed
  remote cleanup preserves encrypted OAuth recovery evidence and blocks ingestion.
- Worker transitions and measurement changes commit together. Database failure
  leaves receipts pending; a failed durable stage is never acknowledged as success.

Run `scripts/test-garmin-health-sql.mjs` with existing absolute `PG_BIN` and
`PG_DRIVER_MODULE` paths. It accepts no database URL, creates an owned loopback-only
PostgreSQL cluster, checks the data-directory identity before writing, and removes
only that cluster after stopping it. Synthetic Supabase roles/uid are not real
JWT/PostgREST coverage. It compares representative existing rows, columns, grants,
policies and triggers before/after every migration, checks actual RLS/ACLs and
cascades, and exercises concurrent workers and disconnect locking.

## Exact provider endpoint plan — do not save yet

All six categories use the same HTTPS receiver:

`https://archery-website.vercel.app/api/integrations/garmin/health/push`

| Actual API Tools label | UI field | JSON root key | Existing mapping |
| --- | --- | --- | --- |
| HEALTH - Dailies | `dailiesUrl` | `dailies` | Resting bpm, steps, average stress, all-day active seconds |
| HEALTH - Sleeps | `sleepsUrl` | `sleeps` | Total sleep and available stages in seconds |
| HEALTH - Stress | `stressDetailsUrl` | `stressDetails` | Latest actual Body Battery sample and its time |
| ACTIVITY - Activities | `activitiesUrl` | `activities` | Discrete activity identity, start, duration, optional distance/bpm |
| COMMON - User Permissions Change | `userPermissionsChangeUrl` | `userPermissionsChange` | Permission overlay, category cleanup, conservative timestamp reconciliation |
| COMMON - Deregistrations | `deregistrationsUrl` | `deregistrations` | Pause for connection reconciliation; preserve cleanup credentials |

Starter is PUSH-only according to Start Guide 2.0; the inspected UI has no mode
selector. Do not invent a PING/PUSH dropdown. Do not configure the OAuth callback
as a delivery URL. Leave all other categories off, including Activity Details,
Activity Files/GPS, MoveIQ and manually updated activities for this first six-category
release. The normalizer can handle manual activity updates, but that is not approval
to enable another provider category. Confirm provider domain security review first.

## Scheduling and capacity — decision required

The existing Vercel UI identifies the account as **Hobby**. The team API was not
authorized, so this plan was verified in the UI rather than inferred from a failed
API call. Current [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)
allow Hobby jobs only once per day, with execution somewhere within the scheduled
hour. Pro/Enterprise support minute-level schedules. No upgrade is authorized here.
The Cron Jobs screen shows the platform cron feature enabled but only the setup
instructions, with no configured job entries. No Garmin schedule was added or enabled.

The current worker accepts `GET /api/internal/garmin-health/process` with the existing
server-only `CRON_SECRET` bearer contract and processes at most 50 receipts per
invocation. HTTP failures are non-success responses. Its route duration is 25 s.
The receiver's opportunistic `after()` batch handles up to 25; it is not a guaranteed
retry scheduler. A 100-record delivery can therefore leave 75 receipts pending even
after that opportunistic batch succeeds. One daily recovery invocation has capacity
for only 50 receipts/day; it is not a minute-level recovery guarantee.

Before activation, approve one of:

1. An existing trusted external scheduler invoking the same authenticated GET at an
   agreed interval, with retry/alerting and restricted secret storage.
2. A separately approved hosting-plan change and native Vercel cron schedule.
3. Explicit acceptance of daily, imprecise recovery and a demonstrated workload/
   backlog bound that fits it. Do not describe this option as near-real-time recovery.

Do not add a cron declaration to live `vercel.json` now. Vercel cron sends
`Authorization: Bearer <CRON_SECRET>` automatically; this is scheduler authentication,
not proof that a Garmin notification came from Garmin. See
[Vercel's cron management documentation](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

## Monitoring, conflicts and retention — operator decisions required

Define an accountable operator and an actual notification channel before activation.
No monitoring/alert service was configured by this phase. Observe scheduler failure
status/duration and persistent queue health. Run only aggregates in restricted tools:

```sql
select state, kind, count(*) as receipts, min(received_at) as oldest_received_at
from public.garmin_health_inbox
group by state, kind order by state, kind;

select error_code, count(*) as affected_connections
from public.garmin_health_sync_state
where error_code is not null group by error_code order by error_code;
```

Do not log/export IDs, payloads, measurements, tokens, callback codes or encrypted
credentials. Set approved alert thresholds for oldest pending age, repeated worker
failures, growing conflicts and capacity saturation. Counts alone do not prove that
the correct measurements reached the UI.

Known exact duplicates are ignored. Shorter/out-of-order windows cannot replace
larger saved windows. Equal-duration changed records remain quarantined: Garmin
documents legitimate corrections, but not an unambiguous monotonic revision in the
reviewed material. This can block a second same-day daily update (daily windows may
both be 86400 s). An actual automatic-update acceptance test cannot pass by ignoring
this restriction. Resolve the provider contract or approve a documented reconciliation
policy; do not substitute arrival order silently or invent a historical pull API.

Processed/rejected normalized payloads are erased; receipt metadata remains.
Pending/conflict payloads are private, minimal health information, not harmless logs.
The 90-day dashboard read window is **not** a 90-day storage-retention policy.
There is no age-based purge, quota or automated conflict-resolution job. Approve
retention/quotas for measurements, receipt metadata and unresolved work, including
actual hosting backup/log retention and the published privacy wording.

For recovery: inspect safe aggregate state first; use a restricted case identifier
outside public logs if individual investigation is necessary. Preserve the deletion
fence and encrypted OAuth credentials. Retry transient processing through the existing
worker only after the cause is fixed. Do not reinsert payloads, rewrite receipts,
clear lifecycle fences or choose a conflict winner without an audited operator
decision and current connection/permission/version checks. Permission ambiguity
requires authoritative reconciliation; ordinary users receive no bypass endpoint.

## Controlled first-real-sync sequence

1. Obtain the documented sender/delivery/correction/lifecycle contract; implement
   only that verifier and add positive, negative, replay and tamper tests locally.
2. Approve the scheduler/capacity, retention and recovery decisions above. Establish
   monitoring and a verified privacy-policy update if its actual commitments change.
3. Separately approve the exact reviewed health migration; verify its final hash,
   OAuth migration dependencies, live absence and grants, then apply only that file.
4. Separately approve deployment with health still disabled. Verify expected tables,
   API security, existing OAuth/account deletion, and unchanged dashboard appearance.
5. Choose a consenting Arc Track/Garmin test account. Perform real OAuth explicitly,
   verify safe connection ownership and actual HEALTH_EXPORT/ACTIVITY_EXPORT grants.
   Do not paste health records or credentials into chat or AI services.
6. Approve the controlled ingestion cohort/enable change, scheduler and verified
   sender configuration. Verify unauthorized receipts still fail, then separately
   approve saving only the six provider endpoints above. Leave unsupported types off.
7. Trigger a normal Garmin Connect upload. Record a sanitized receipt reference,
   authenticated delivery result, durable inbox commit, worker outcome and owner-only
   database/Health UI result. Distinguish an API Tools generator test from real data.
8. Verify another Arc Track account cannot read those records. Confirm missing values
   stay unavailable, stages/units are correct, activities remain separate from scoring
   Sessions and no coach/AI consumer receives data.
9. Perform another real upload and verify the approved correction policy updates
   measurements automatically without refresh tricks or silent conflict loss.
10. Exercise permission removal, disconnect or account deletion only with separate
    consent for those operations. Never run destructive fixtures against production.

No real OAuth consent or Garmin delivery was performed in this readiness phase.
Phase 2 remains incomplete until actual measurements and subsequent automatic
updates reach the correct user's dashboard through the verified production flow.

## Local verification results

- Original disposable fixture: 46 passed. The new permission-retention assertion
  then failed with `Revoking health permission erases quarantined measurement
  payloads`, proving the issue before the migration correction.
- Corrected disposable PostgreSQL 17.6 suite: **59 assertions passed**, zero failures.
  This includes actual role/RLS checks, FK cascades, old-schema/data preservation,
  old OAuth/deletion guard preservation, ordinary/ambiguous permission cleanup,
  transaction rollback and independent concurrent workers.
- Focused Garmin/Health suites: **126 tests passed**. Full website suite:
  **392 passed**, zero failures/skips. TypeScript, repository ESLint and production
  build pass. Added synthetic input-to-dashboard coverage for every requested
  metric/history field and a worker-failure redaction/status regression.
- Live unauthenticated checks still return 503 for both health push and worker,
  and the missing-transaction OAuth callback returns its safe 303 Profile notice.
  Production Connect remains true. No production migration, provider save, cron
  activation, OAuth consent, health delivery, account deletion or deregistration ran.
- Modified only the unapplied migration, disposable fixtures/runner, Health
  regression tests and Garmin readiness documentation. No website UI/theme,
  scoring, OAuth implementation, Coach Workspace or Android source changed.
