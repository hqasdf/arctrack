# Phase B local implementation — 24 October 2026

Local implementation and disposable verification only. No commit, push, deployment,
production migration, Cloudflare provisioning, Vault entry, secret change, Cron job,
Garmin endpoint change, authorization or deregistration is part of this task.
Release A remains deployed at f021ef8ba002fe90f6810bd7fb86d3c0de4a8357.

## Connection-state findings

Read-only production metadata showed one connection with
`reauthorization_required / interrupted_authorization`, no encrypted credentials,
no operation and no deletion fence. This confirms incomplete authorization, not a
healthy linked account. Reconnect is appropriate. The row does not establish why
the earlier cleanup message appeared; no historical audit evidence was available
to reconstruct that transition conclusively. No provider call was made.

A separately reproduced code defect allowed `status()` to refresh credentials on
an error row after an ambiguous disconnect, potentially clearing recovery evidence.
Status now skips refresh for deregistration_failed, deregistration_recovery_required,
revocation_pending and revocation_unconfirmed. Explicit, verified OAuth and existing
administrator recovery remain separate. Tests include expired disconnect leases.

## Ingress implementation and provider selection

`infra/garmin-ingress/worker.mjs` implements an HTTPS Cloudflare Worker adapter:

1. Explicit enabled flag, two different random 256-bit secrets and quota binding
   are mandatory. Disabled/missing configuration returns 503.
2. The private `/garmin/<capability>` path uses constant-time comparison. HTTP,
   query strings and malformed/missing/wrong capabilities are rejected.
3. One globally named Durable Object serializes quota updates transactionally:
   Separate 600-attempt/minute authorities for valid and rejected capabilities,
   so invalid-capability floods cannot consume the valid delivery budget;
   30 authenticated deliveries/minute, four concurrent bodies
   or upstream calls, 45-second crash-recovery slot leases. Each accepted body is
   bounded to 1 MiB, so the delivery budget also caps accepted bytes at 30 MiB/minute.
   These conservative pilot defaults need adjustment if observed Garmin batches
   or retry behavior require it; no region-local Map is used as a distributed limit.
4. Body acquisition has a 10-second limit. Only UTF-8 JSON is forwarded; the existing
   Next receiver performs the authoritative schema/category/100-event validation.
5. Only fresh Content-Type and independent Authorization headers are forwarded to
   the fixed HTTPS `/api/internal/garmin-health/ingest` destination. Incoming URL,
   query, cookies, authorization, referrer and tracing headers are not copied.
   Upstream redirects are never followed. Calls time out after 20 seconds.
6. Garmin receives 200 only after the existing inbox transaction commits. Upstream
   failures/timeouts return failure so delivery can retry. Response bodies do not
   propagate. The receiver retains ownership, authorization-epoch deduplication,
   permission revocation, deletion and payload-erasure checks.

This is capability possession plus Arc Track service authentication, **not a
Garmin signature or cryptographic proof of Garmin identity**. Compromise of the
capability can permit forged payloads; ownership checks do not authenticate Garmin.

Provider evidence: Cloudflare explicitly documents disabling its URL-bearing
invocation logs; Vercel's routine requestPath cannot be scrubbed inside Next.js.
The checked-in Wrangler config disables observability, invocation logs, tracing,
Logpush and Tail consumers; the public workers.dev route and preview URLs are OFF.
Configuration validates against the officially published Wrangler 4.152.0 schema.
No Wrangler dependency was installed and no Worker was deployed.

Cloudflare real-time/Tail access can expose URL and headers even when application
code emits nothing. Account-level HTTP Logpush, WAF/security events, other proxies,
APM and privileged access must be reviewed. Disabling application logs alone is
not sufficient. Provider-internal retention is not established. This is a conditional
provider selection, not a claim that hosted logs have been audited successfully.
Do not enable ingestion until a synthetic canary is absent from all routine log
layers for success, invalid auth, malformed/oversized/rate-limited payloads,
timeouts and upstream errors, and an accountable operator has signed off.

Official references:
- https://developers.cloudflare.com/workers/observability/logs/workers-logs/
- https://developers.cloudflare.com/workers/observability/logs/tail-workers/
- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- https://developers.cloudflare.com/workers/wrangler/configuration/

## Configuration and rotation

Cloudflare-only secrets: GARMIN_ENDPOINT_SECRET and GARMIN_FORWARD_KEY (independent
64 lowercase hex characters, generated with crypto.randomBytes(32)). Configure
them directly in the provider's secret store; never print the URL or paste keys
into tickets/chat. INGRESS_ENABLED stays false until separately approved.

Vercel server-only variables:
- GARMIN_HEALTH_ENABLED=false by default.
- GARMIN_HEALTH_INGRESS_READY=false until hosted logging and ingress validation.
- GARMIN_HEALTH_INGRESS_KEY: matches Cloudflare GARMIN_FORWARD_KEY, NOT the URL secret.
- GARMIN_HEALTH_TEST_USER_IDS: explicitly approved Supabase UUIDs, max 20. Empty,
  malformed and wildcard values fail closed. This does not restrict public OAuth.
- CRON_SECRET: independent 64-hex worker key, also held in Vault as
  garmin_health_worker_bearer. It must differ from the forward key.

For rotation: separately approve disabling the gateway/master switch and pausing
the Cron job; let in-flight work settle. Replace only the relevant key in both
ends of that hop, configure Garmin's new URL directly if rotating its capability,
verify old credentials fail and new credentials work, then re-enable in controlled
order. Do not retain an undocumented dual-key window. Do not rotate the OAuth
token-encryption key. Existing durable receipts survive transport-key rotation.
If a credential may have appeared in any infrastructure log, restrict access,
rotate it and review the affected delivery window; deduplication alone does not
detect forged changed measurements. Do not delete evidence or user records.

## Database and scheduling

The reviewed Health migration is unchanged:
BD47CDFBD33EB1DE46A71E9E0B9AC0EEE9E14A91F83D090B78BE9AEEA8746AC4.
Its owner-only RLS, service-only writes, lifecycle cleanup and corrected clearing
of revoked quarantined payloads are preserved. The two OAuth migrations are its
dependencies. No production migration was applied.

Supabase read-only inspection: Vault 0.3.1 is installed; pg_cron 1.6.4 and pg_net
0.20.4 are available but not installed. `supabase/ops/garmin-health-cron.sql` is an
explicit, separate administrator operation, not an automatically applied migration.
It refuses a pre-existing pilot job, missing dependencies or client access to
Vault/pg_net queues. It creates an admin-only fixed-target enqueue function, one
minute Cron job and at most 1,000 request-ID/timestamp monitoring rows. Neither
the command nor monitoring rows contain credentials or health payloads.

Each tick obtains the bearer from Vault and enqueues the authenticated existing
worker, processing up to 50 durable receipts. HTTP enqueue is not delivery or
processing success. The pg_net transport queue is not durable; later ticks retry
the durable inbox. Processing failure rolls back, leaving receipts pending.
`supabase/ops/garmin-health-monitor.sql` provides read-only aggregate queue-age,
error/conflict and job/HTTP outcomes. A real alert destination/operator and storage
retention decisions still require approval. pg_net responses are transient, so
monitor them before expiration and alert on missing responses as well as non-200.
The 90-day dashboard reader window is not a storage-retention guarantee.

References:
- https://supabase.com/docs/guides/functions/schedule-functions
- https://supabase.com/docs/guides/database/extensions/pg_net
- https://supabase.com/docs/guides/database/vault

## Dashboard and corrections

The development preview gate, runtime fixture, demo labels and demo type branches
are removed. Synthetic measurements exist only in tests/fixtures and maintained
disposable tests. A legacy preview=demo query does not change the owner reader.
Layout, charts, colors and Light/Dark/System tokens are preserved. While Health
sync is enabled, the visible page refreshes its server data every minute and on
returning to visibility, preserving view/date controls; hidden/disabled pages do
not poll, and unmount clears the timer/listener.

Same-day correction limitation is deliberately retained: changed equal-duration
summaries are quarantined as ambiguous_update rather than silently overwriting
known data. A distinct subsequent day imports normally. Obtain Garmin revision
semantics or approve a reconciliation policy before claiming full automatic
same-day correction support. There is no invented Starter pull API fallback.

## Controlled activation sequence — separate approvals required

1. Have the consenting owner finish genuine Garmin OAuth; confirm server status,
   identity mapping and encrypted credential persistence. Do not treat a success
   query string or local fixture as successful linking.
2. Approve provider/account/region, logging controls, canary checks, pilot limits,
   privacy/retention decisions and accountable operations/alerting. Provision the
   approved ingress and its quota binding with public routing disabled initially.
3. Separately approve/apply only the reviewed Health migration; verify its hash,
   version, RLS and grants, with an approved recovery plan. Do not use broad db push.
4. Separately approve deploying Phase B with master flags OFF. Configure independent
   hop keys and one approved ingestion UUID through provider secret stores.
5. Approve/install Cron/pg_net, verify their queue privileges, create the Vault
   bearer and reviewed scheduler/monitoring objects. Confirm worker auth fails
   without the key and that disabled processing returns 503.
6. Configure the approved HTTPS Garmin endpoint directly in API Tools, after any
   Garmin security review. Do not expose the capability in documentation. Actual
   private-path delivery remains unverified; a saved URL alone proves nothing.
7. Enable only the approved pilot after hosted canary/security checks. Use the
   consenting owner's genuine watch sync/upload. Confirm durable receipt, scheduled
   processing, owner-only measurements and refreshed Health display. Verify a
   second genuine upload; report equal-duration conflicts honestly.
8. Separately authorize destructive/revocation checks. Do not disconnect another
   person's account, delete users or insert artificial production measurements.

## Validation boundary

Local tests cover actual HTTP forwarding, SQL transactions/RLS, owner reader and
dashboard mapping (450 initial steps, 725 via scheduled ingress, 600 next day),
retry after injected processing failure, lost scheduling transport, duplicates,
permission revocation, cross-user isolation, lifecycle deletion, correction conflicts,
auth cleanup evidence and visibility refresh cleanup.

Cron/Vault/pg_net are interface stubs in the disposable PostgreSQL fixture, not
real extension/daemon execution. Durable Object storage is a serialized test
adapter, not Cloudflare-hosted storage. No real TLS delivery, Garmin notification,
Supabase JWT/PostgREST, hosted log canary or physical watch synchronization is
claimed. These remain activation gates, not hidden test skips.

## Final local results

- Full website suite: 424 passed, zero failed/skipped.
- Focused ingress/OAuth/Health/deletion suite: 153 passed, zero failed/skipped.
- Disposable PostgreSQL 17.6: 105 assertions passed, zero failed.
- TypeScript, ESLint, local production build and git diff --check: passed.
- Official published Wrangler 4.152.0 configuration schema: passed.
- 38 generated browser JavaScript assets: no removed Health demo markers or
  ingress secret-configuration identifiers found. This is not a hosted log audit.
- The CSS diff changes notice/token names only; colors and geometry match the
  pre-task version. No new interactive browser visual QA is claimed.
- 17 pre-existing pending files outside the task's 27-file scope retained their
  recorded hashes. The reviewed Health migration hash is unchanged.
- Production remains on Release A. Read-only confirmation: no Health migration
  history entry, Health inbox/records or pilot scheduler table exists there.

Changed-file hashes and check outcomes are recorded locally in the ignored
.verification/garmin-phase-b/implementation-manifest.json artifact. No production
OAuth, notification delivery, migration, scheduler, deployment or secret change
was performed.
