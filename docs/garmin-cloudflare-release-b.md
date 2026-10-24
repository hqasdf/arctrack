# Release B Cloudflare hosted validation — 24 October 2026

This is the current continuation of `garmin-phase-b-implementation.md`. Its
local-only validation section is historical: an isolated Cloudflare test Worker
has now been deployed and exercised. Production Release A is unchanged.
Automatic Garmin Health synchronization is NOT live.

## Executed deployment

- Account: the existing user-created Cloudflare account; no new account or upgrade.
- Wrangler: 4.152.0, Node 24.19.0, npm 11.17.0.
- Official browser OAuth completed. Wrangler authentication uses an encrypted
  auth file with its encryption key in Windows Credential Manager. Its pinned
  optional keyring helper was installed outside application dependencies.
- Worker: `arc-track-garmin-ingress-test`.
- Public origin: `https://arc-track-garmin-ingress-test.wonghanqian123456.workers.dev`.
- Latest deployment: `81c018fb-964a-4c6e-b8a3-bb8b2f93aabe`.
- Active version: `5b9671a3-3f8b-4959-b1dc-e169cffa918b` (100%).
- SQLite Durable Object bindings: `LIMITS` / `HostedTestLimits` and
  `TEST_UPSTREAM` / `SyntheticUpstream`.
- Three independently generated test credentials reside in Cloudflare secret
  bindings only: `GARMIN_ENDPOINT_SECRET`, `GARMIN_FORWARD_KEY`, `TEST_CONTROL_KEY`.
  The runner does not save or print their values. Rerunning it rotates test keys.

`wrangler.test.jsonc` deploys the existing ingress through a test-only adapter.
It has no network-forwarding fallback: its target is a `.invalid` URL routed
directly to the synthetic Durable Object. Only the fictional
`synthetic-cloudflare-test` account is accepted there. The test deployment cannot
write measurements to production Vercel or Supabase. Its authenticated control
endpoint and quota-reset method must NEVER be used as the production entry point.
The production `wrangler.jsonc` remains disabled and has workers.dev routing off.

SQLite Durable Objects are supported on Free, unlike legacy KV-backed objects:
https://developers.cloudflare.com/durable-objects/platform/pricing/
No paid resource, custom domain or billing change was requested. The scoped
account token cannot read billing subscriptions (HTTP 403), so Free billing-plan
status was not independently confirmed through that API.

## Hosted results and limits

Final run: **18 assertions passed, zero failed**. It exercised missing/wrong/current
capabilities, malformed and >1 MiB requests, non-synthetic account rejection,
durable duplicate receipts, stripped URL/caller metadata, upstream failure,
redirect refusal, the real shared four-request concurrency limit and the real
30-accepted-delivery/minute quota. The 31st request returned 429. A simulated
upstream timeout returned 503 after 20,478 ms, never a false success.

Initial runs exposed an unsafe immediate-readiness assumption around secret and
deployment cutover. The maintained runner now explicitly deploys changes and
waits for bounded readiness checks. Rotation first disables ingress and verifies
503, uploads the new secret through stdin, deploys and re-enables, then verifies
old=401 and new=200. Final cutover was verified from this location in 1,188 ms.
This does not prove instantaneous global revocation. If revocation cannot be
verified, keep ingress disabled and review deployment state before proceeding.

Cloudflare aggregate sampled metrics at final inspection: 211 Worker requests,
613 subrequests, zero platform errors; CPU p50 2.591 ms, p99 8.277 ms. These include
earlier diagnostic runs and are not the number of test assertions. Startup was
5–7 ms, which is not per-request CPU. The sampled p99 fits the current Free 10 ms
CPU allowance, but is not a worst-case or maximum-payload guarantee. Keep pilot
quotas conservative and monitor actual CPU and account-wide daily use.
https://developers.cloudflare.com/workers/platform/limits/

## Logging findings and residual risk

Both checked-in configurations explicitly disable top-level observability,
logs, invocation logs, traces and Logpush, and attach no Tail consumers. Deployed
API checks confirm Logpush=false and an empty Tail-consumer list. The documented
script-settings endpoint returns observability=null, not explicit individual
booleans; do not misreport that as independent verification of every setting.

A temporary privileged live Tail was created for a random INVALID canary that
was never a credential. The request returned 401; no matching event was observed
within the bounded window. The Tail was successfully deleted. This check is
inconclusive about metadata visibility, not proof of secrecy. Cloudflare documents
that live Tail can expose `event.request.url`, and routine invocation logs can
include the URL. No valid callback credential was tested while Tail was attached.
https://developers.cloudflare.com/workers/observability/logs/real-time-logs/
https://developers.cloudflare.com/workers/observability/logs/workers-logs/

Cloudflare and Garmin necessarily receive the callback URL. Anyone with sufficient
provider/account diagnostic access might see it. Keep account access narrow, avoid
request-path exports/traces, and never paste callback URLs into tickets or docs.
Possession of this bearer URL is not proof of Garmin's cryptographic identity.
Independent forwarding authentication prevents it from appearing in Vercel paths.
Approval of this residual provider-access risk remains a pilot prerequisite.

## Health database and scheduling

Reviewed migration remains byte-for-byte unchanged:
`20261023155612_garmin_health_sync.sql`
SHA-256 `BD47CDFBD33EB1DE46A71E9E0B9AC0EEE9E14A91F83D090B78BE9AEEA8746AC4`.
Disposable PostgreSQL 17.6: **105 assertions passed**, covering existing schema/data
preservation, RLS, ownership, deduplication, lifecycle cleanup, retries, rollback,
concurrent workers, actual HTTP-to-SQL processing and the genuine Health reader.

Production read-only checks: the Health migration, Health inbox/record tables and
pilot monitoring table are absent. Vault 0.3.1 is installed; pg_cron 1.6.4 and
pg_net 0.20.4 are available but not installed. No production changes were made.

`supabase/ops/garmin-health-cron.sql` prepares a one-minute admin-only job that
loads an independent bearer from Vault and invokes the fixed processing endpoint.
Each call processes up to 50 receipts; failed SQL processing remains retryable in
the durable inbox. `garmin-health-monitor.sql` distinguishes enqueue, HTTP and
processing outcomes and exposes aggregate backlog/error information only.
Disposable tests use Cron/Vault/pg_net interface stubs, not an actual extension
scheduler daemon. Real hosted scheduling, alerts and missed-tick monitoring still
need activation and verification.

Do not rollback by dropping tables after collection. Disable ingress/master flags
and unschedule the pilot first, preserve records and encrypted credentials, inspect
receipts and deployment versions, then use a reviewed forward fix. Do not rerun an
already-recorded migration or change unrelated history. Reverting to Release A
after any Garmin user is linked still requires compatible account-deletion cleanup.

## Privacy, real data and corrections

The local policy now describes supported steps, sleep/stages, resting heart rate,
stress, Body Battery and activities; automatic notification processing; owner-only
Health access; permissions, revocation, processors and actual disconnect/deletion
cleanup. It does not promise an invented retention period. The 90-day reader
window is not storage retention. Health/pending-conflict, backup and operational
log retention, the recovery operator and alert destination remain decisions for
the owner. `GARMIN_HEALTH_PRIVACY_READY=false` is now an explicit fail-closed gate.
A compact Health connection notice links to `/privacy#garmin` using existing
Light/Dark/System tokens. No dashboard redesign or mobile edit was made.

The runtime demo branch remains removed; fixtures live only in automated tests.
The existing visible-page minute refresh and return-to-page refresh are tested.
Equal-duration changed same-day summaries remain quarantined as `ambiguous_update`;
known measurements are not overwritten. Later distinct days import normally.
Garmin revision semantics or an approved reconciliation policy are still needed
before claiming automatic correction of every same-day update.

## No-device Garmin verification

The existing Garmin guide and earlier API Tools inspection describe Data Generator
and Summary Resender. A Generator delivery is Garmin-originated synthetic data,
not watch evidence. A Resender replays existing summaries and does not create a
new watch upload. No Garmin tool or live endpoint was changed during this task.
Before using either, obtain a consenting account and approved isolated environment
with its genuine Garmin account mapping. Do not send real IDs into the strictly
fictional-account test adapter or put synthetic measurements into production.
Prepare Dailies, Sleeps, Stress, Activities, User Permissions Change and
Deregistrations. Confirm the exact category names and permitted delivery options
in the authenticated API Tools for this Starter application; no pull API is assumed.

## Coordinated activation — separate approvals required

1. Approve privacy/retention/recovery ownership and the logging risk. Review/publish
   the updated policy with the controlled Phase B website release.
2. Approve only the reviewed Health migration on `pdwxphgyqbbflnrruobp`; recheck hash,
   history and object absence, apply atomically with correct history, verify owner
   RLS/service writes and preservation. Never run broad db push or reset.
3. Approve an isolated website release containing Phase B over production Release A
   `f021ef8ba002fe90f6810bd7fb86d3c0de4a8357`; keep ingestion disabled initially.
4. Separately provision a production ingress using `worker.mjs`, not the test
   adapter. Approve matching independent Cloudflare `GARMIN_FORWARD_KEY` and Vercel
   `GARMIN_HEALTH_INGRESS_KEY`, the callback capability, and a distinct `CRON_SECRET`.
   Never rotate the existing OAuth token-encryption key. Verify remote log settings.
5. Approve Cron/pg_net installation, Vault bearer, the reviewed job and monitoring;
   verify unauthorized/disabled worker failure, then a real scheduled invocation.
6. Confirm a consenting Arc Track test UUID has completed genuine Garmin OAuth.
   Do not confuse a query parameter or a synthetic fixture with a linked account.
7. Approve Garmin HTTPS endpoint configuration for the six categories and provider
   review if required. Enter the capability URL directly in API Tools, never chat.
8. Enable only the approved cohort with `GARMIN_HEALTH_ENABLED=true`,
   `GARMIN_HEALTH_INGRESS_READY=true`, `GARMIN_HEALTH_PRIVACY_READY=true` and the
   explicit UUID list. Test missing/wrong hop credentials and excluded accounts.
9. Verify a genuine notification, durable receipt, scheduled processing, private
   record and real Health display, then a second delivery. Label generated versus
   genuine watch measurements precisely. Check correction conflicts explicitly.
10. Review pilot logs/CPU/backlog/privacy and only then approve wider availability.

These steps have NOT been executed. A disabled production deployment alone does
not complete Release B; completion requires actual verified automatic delivery.

## Final local validation

- Website: 427 passed, zero failed/skipped.
- Focused ingress/OAuth/Health/deletion/privacy: 172 passed, zero failed/skipped
  (a subset of the website suite, not additional independent tests).
- Hosted isolated Worker: 18 passed; disposable PostgreSQL: 105 passed.
- TypeScript, ESLint and local production build: passed.
- Wrangler 4.152.0 dry-run/configuration compilation and actual test deployment: passed.
- No new interactive visual/browser or real Garmin/watch QA is claimed.
- Sanitized logs and deployment metadata are in ignored
  `.verification/cloudflare-release-b/`; no secret values belong in this document.

No commit, push, Vercel deployment, production migration/secret/schedule, Garmin
authorization, endpoint activation, deregistration or production account change
was performed. Existing dirty work remains in place.
