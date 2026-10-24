# Garmin release A and Health pilot B — 24 October 2026

Current local Phase B implementation and activation gates: [garmin-phase-b-implementation.md](garmin-phase-b-implementation.md). The earlier readiness snapshot below is historical where superseded by that report. No Phase B production activation has occurred.

Local preparation only. No commit, push, deployment, production migration,
environment setting, Cron job or Garmin endpoint change is authorized by this file.

## Verified production baseline

- Existing Vercel project: `archery-website`, ID `prj_NqILzPu1e3tzpBH9wK9MrWxsICej`.
- Alias `archery-website.vercel.app`: READY production deployment
  `dpl_C4xKaotaTNwsKpeRXbYDw96xvnwq`, Git `734afe7b5e952dcf0e3699c74f30b0599afa6704`.
- Supabase `pdwxphgyqbbflnrruobp`: ACTIVE_HEALTHY, PostgreSQL 17.6.
  OAuth migrations `20261023074736` and `20261023082837` are recorded; Health
  migration `20261023155612` and its three tables remain absent.
- Vercel reports no configured log drains. The active firewall-config request
  returned 404; no deployed Garmin-specific rate rule is verified by this review.
- No local Sentry/OpenTelemetry instrumentation was found. Platform tracing,
  reverse-proxy logging and Garmin's internal log retention are not established.

## Release A: exact UI overlay

Run `node scripts/prepare-garmin-ui-release.mjs`. This exports the pinned production
commit into a new ignored `.verification/garmin-ui-release-*/source` directory and
overlays exactly these files, with hashes in its adjacent manifest:

```text
src/app/(platform)/health/page.tsx
src/app/(platform)/profile/page.tsx
src/features/garmin/components/garmin-connection-card.tsx
src/features/garmin/components/garmin-connection.module.css
src/features/garmin/http.server.ts
src/features/health/components/health-cards.tsx
src/features/health/components/health-dashboard.tsx
public/garmin-connect.png
tests/garmin.test.mjs
tests/health.test.mjs
docs/garmin-connection-ui.md
```

There is no `.env.local`, `.vercel` configuration, new private route or corrected
Health migration overlay. Existing baseline Health code remains disabled. The
producer does not modify Git's index, create a branch/commit or run Vercel. It
refuses a different HEAD, unexpected overlay paths, symlinks or private config.
The export is source, not a prebuilt deployment artifact and not a deployed site.

The Health header owns Connect -> Garmin consent -> verified callback -> Health.
Server-confirmed status, not a success query, controls the green indicator. Failed
authorization offers retry; revoked/expired authorization offers reconnect.
Permissions, refresh, disconnect and privacy remain in a closed Manage connection
disclosure; Profile retains compact Connected apps. OAuth/deletion security is
unchanged. No connection or Health flag/environment change is required for A.

After separate approval: recheck the production alias/SHA and manifest; validate
the isolated export; link only the EXISTING Vercel project using existing approved
configuration; stage a production-environment deployment without assigning the
live alias (`vercel deploy --prod --skip-domain`); verify it, then separately
approve promotion (`vercel promote <the-reviewed-deployment>`). These are future
commands, not executed steps. Do not deploy the dirty main checkout or the old
main `.next` directory. Preview authentication does not prove real Garmin OAuth;
the registered callback still points to the canonical website. Approve a real
authorization only after canonical deployment. Preserve the old deployment for
rollback, and account for Vercel rollback's auto-assignment behavior.

## Remaining pending work belongs to B, not A

| Group | Pending paths |
| --- | --- |
| Private URL authentication | `src/features/garmin/health/private-push.server.ts`, `src/app/api/integrations/garmin/health/push/[secret]/route.ts`, `tests/garmin-private-webhook.test.mjs`, `.env.example` |
| Health migration and DB tests | `supabase/migrations/20261023155612_garmin_health_sync.sql`, `supabase/tests/garmin-health-sync.sql`, `scripts/test-garmin-health-sql.mjs`, `scripts/garmin-private-webhook-fixture.mjs`, `tests/garmin-health.test.mjs` |
| B documentation | `docs/garmin-health-sync.md`, `docs/garmin-phase2-readiness.md`, `docs/garmin-notification-security-request.md`, `docs/garmin-private-webhook.md` |
| Release preparation only | This document, `scripts/prepare-garmin-ui-release.mjs` and ignored manifests/logs |

The backend normalizer/store/reader/worker already exist in the baseline; they
were not rebuilt. Never include ignored environment files or local credentials.

## URL credential exposure: direct Vercel endpoint is a no-go

| Layer | Evidence and decision |
| --- | --- |
| Vercel requests/function invocations | Runtime Logs distinguish route pattern from actual `requestPath`; the latter exposes a secret path even without `console.log`. |
| Function stdout/errors | Current receiver deliberately logs no URL/payload and returns empty failures. This does not redact invocation metadata. Unhandled/library errors must also be checked. |
| Observability/traces/APM | Request paths, trace correlation and HTTP attributes may propagate. No account-level redaction guarantee or complete tracing configuration was verified. |
| Log drains | None configured at inspection; built-in logs still exist. Redaction in a future drain would not erase upstream copies. |
| Reverse proxies/CDNs | Access/error logs and original-URL forwarding can retain the capability. Moving it to a query or rewriting it inside Vercel does not solve first-hop exposure. |
| Garmin tools/provider | The configured URL necessarily contains the capability. Authorized operators can see it; internal provider logging/retention is unknown. Vendor access and retention confirmation is required. |

Source: https://vercel.com/docs/logs/runtime and https://vercel.com/docs/tracing .
No real secret-bearing production request was made to demonstrate a known leak.
The local authenticated factory is preserved; the configured handler explicitly
rejects production use. URL possession remains a bearer capability, not Garmin
identity, signature verification, freshness or payload-origin proof.

### Smallest ingress proposal requiring separate approval

Use one dedicated TLS ingress BEFORE Vercel whose actual platform/access/error/
trace logging policy can be controlled and verified. Do not merely add another
Vercel route or assume a different serverless host hides paths. At that ingress:

1. Authenticate the private path with constant-time comparison before body work.
2. Apply byte/time/concurrency limits and distributed atomic rate limits; never
   use a per-process Map as a Vercel-wide limiter.
3. Strip the private path, query and original-URI/referrer/trace headers. Forward
   only the bounded body and approved headers to a FIXED Vercel internal receiver.
4. Authenticate that downstream hop with a DIFFERENT server-only bearer secret;
   overwrite incoming authorization and reject requests lacking the ingress key.
   This is Arc Track's own service-to-service contract, not a Garmin header.
5. Acknowledge Garmin only after the existing durable inbox commits; do not turn
   downstream timeout/failure into a false 200. Preserve idempotency on retries.

The fixed-path receiver and gateway are proposals, NOT implemented/deployed here.
They still need host selection, log-policy proof and review. A sanitized fake
capability canary must be absent from EVERY routine log layer for successful,
unauthorized, rate-limited, malformed, timeout and failed-upstream requests.
Do not run that canary with a real credential. Verify header redaction too.

### Rate and replay decisions

Vercel WAF fixed-window limits are distributed per region, not globally atomic.
Hobby supports one rate rule with IP/JA4 keys; arbitrary secret-header keys are
not available on that plan. A reviewed path-scoped IP limit can be defense in
depth, but cannot be called a global cap or Garmin sender authentication.
No WAF rule, new dependency or distributed rate store was installed/configured.
See https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting .

The global accepted-request budget, burst/concurrency bounds and inbox/storage
quotas need approved values based on Garmin's batch/retry behavior. Limit/unknown
responses must not enumerate account membership. Existing unknown users are
acknowledged without staging; spoofing an Arc Track UUID never selects ownership.
Exact replays deduplicate within the authorization epoch. A leaked capability
can forge changed summaries or new IDs; deduplication is NOT general anti-replay.
Backfills prevent inventing an arbitrary short timestamp expiry. Keep ingestion
disabled until this risk is explicitly accepted or a documented stronger provider
contract exists. Rotate by disabling ingress, changing the server secret directly,
updating only the approved provider endpoint, validating, then re-enabling. Never
publish URLs in tickets and never silently keep the old key valid.

## Health migration and privacy boundary

Reviewed SHA-256 of `20261023155612_garmin_health_sync.sql`:
`BD47CDFBD33EB1DE46A71E9E0B9AC0EEE9E14A91F83D090B78BE9AEEA8746AC4`.
It remains unapplied and unchanged by this task. It depends on the two existing
OAuth migrations and private/Auth schemas. It creates the three Health tables,
their constraints/indexes/owner SELECT policies/service-only write grants, two
service-only invoker RPCs and Garmin lifecycle cleanup function/trigger. It does
not replace existing OAuth/deletion guards or restructure archery tables.

Processed/rejected normalized payloads are erased; permission removal also clears
revoked quarantined health values. Pending/conflict payloads remain private health
data, not harmless operational logs. Successful disconnect/Auth deletion cascades
cleanup; pending remote deregistration retains recovery evidence and blocks work.
Owner filtering and RLS protect reads; no coach/AI consumer is added.

Known limitation proven by HTTP + SQL regression: a changed equal-duration daily
is quarantined as `ambiguous_update` and leaves the known measurement intact.
A subsequent DISTINCT day's upload imports normally. Do not claim a second
same-day correction updates automatically. Obtain Garmin revision/canonical-data
guidance or approve an explicit reconciliation policy before full pilot acceptance.
No unsupported Starter pull API or silent last-arrival-wins policy is invented.

Still required: accountable operator, real alert channel, retention/quotas for
records/inbox/conflicts and infrastructure logs/backups, and privacy wording aligned
to those decisions. The 90-day reader window is NOT a storage-retention policy.
No backup or production recovery capability was created or assumed by this task.

## Supabase Cron recommendation — available, not installed

Live inspection: `pg_cron` 1.6.4 and `pg_net` 0.20.4 are AVAILABLE and preloaded but
NOT installed; `cron.job` and `net._http_response` do not exist. Vault 0.3.1 is
installed; anon/authenticated cannot SELECT `vault.decrypted_secrets`.

After separate approval, prefer Supabase Cron invoking the existing authenticated
HTTP worker every minute for the small pilot. Keep credentials in Vault and the
matching Vercel server environment, never a URL, literal job command or publishable
key. Verify pg_net queue/header privileges after installation: transient request
headers necessarily contain the bearer secret even if its source was Vault.
Do not grant client roles queue or decrypted-secret reads.

Illustrative FUTURE job body (do not execute now):

```sql
select cron.schedule('arctrack-garmin-health-pilot', '* * * * *', $$
  select net.http_get(
    url := 'https://archery-website.vercel.app/api/internal/garmin-health/process',
    headers := jsonb_build_object('Authorization', 'Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets
       where name = 'garmin_health_worker_bearer')),
    timeout_milliseconds := 30000
  );
$$);
```

Creating the extension, Vault entry and job needs explicit approval. Check for an
existing job name first: scheduling the same name can overwrite a job. Do not call
the processing RPC directly from an unrestricted postgres Cron job, which would
skip the application's master-switch/cohort/authentication boundary.
The current configured worker ALSO remains blocked by the null verifier and empty
cohort. Approved ingress readiness must be wired explicitly before activation;
setting a flag or scheduling the above SQL alone cannot complete the pilot.

Cron enqueue success is not HTTP success. Monitor both `cron.job_run_details` and
the actual `net._http_response` status/error plus durable queue age/count and
`last_processed_at`. Responses are normally retained only six hours; pg_net's
unlogged transport queue can be lost on crash. Subsequent ticks retry durable
inbox work; do not depend on pg_net as the durable measurement queue. The worker
handles at most 50 receipts, skips locked connections and returns 503 on failure;
transaction rollback preserves pending work. Alert on persistent failures, pending
age/capacity and conflicts without logging measurements or credentials. No operator
notification or monitoring automation is configured yet.

Sources: https://supabase.com/docs/guides/cron,
https://supabase.com/docs/guides/functions/schedule-functions,
https://supabase.com/docs/guides/database/extensions/pg_net,
https://supabase.com/docs/guides/database/vault .

## Controlled real-Garmin test, after the separate approvals

1. Release A: deploy/verify the reviewed UI separately; approve one genuine Garmin
   account and its authenticated Arc Track owner for consent. Check the actual
   callback result and safe status, not merely the redirect or query string.
2. Confirm owner mapping and encrypted credential persistence using booleans/
   safe metadata in restricted tools, without exposing ciphertext or tokens.
   Reload Health and verify the confirmed connection survives.
3. Approve the ingress/logging/rate/replay/correction/retention decisions. Validate
   an isolated test environment first, with no synthetic records in production.
4. Separately approve the EXACT Health migration, then verify RLS/grants/lifecycle
   guards. Approve scheduler installation, credentials, monitoring and the small
   Health ingestion cohort. OAuth remains public; do not restore its old allowlist.
5. API Tools Endpoint Configuration supports full-path HTTPS URL fields (observed
   example `https://example.com/path`), but private-path delivery remains unproven.
   Starter uses PUSH, not an assumed enterprise PING/PULL mode. A new ingress domain
   may need Garmin's endpoint security review. Enter the URL directly in the
   approved provider UI; never chat or documentation. Save/enable only separately
   approved categories: dailies, sleeps, stressDetails, activities, permissions and
   deregistrations. No endpoint was changed during preparation.
6. Garmin's official guide/UI offers Data Generator and Summary Resender. Generator
   output is synthetic and belongs only in the isolated environment. Resending
   existing real summaries tests redelivery, not a new device upload. No tool was
   invoked here. No documented independent validation-only button is assumed.
7. For real acceptance, sync the designated watch to Garmin Connect or upload a
   genuine supported activity, with the owner's consent. Confirm ingress auth,
   bounded validation, downstream authentication and durable receipt BEFORE 200.
8. Confirm the authenticated worker processes that receipt; check owner-only
   records and real measurement/units/freshness through the existing Health reader.
   Missing values stay unavailable; no fixture is substituted.
9. Verify a second user cannot read the records. Make a second genuine upload and
   verify backend changes and Health on a normal read/navigation/reload. The open
   dashboard has no realtime/polling subscription; do not claim instant live chart
   refresh. A correction conflict is a failed automatic-update acceptance, not a
   successful sync. Resolve it under the reviewed policy before proceeding.
10. Permission revocation, disconnect and account deletion need their own explicit
    consent. Observe sanitized outcomes and recovery evidence without deleting or
    editing production records as a testing shortcut.

## Real-data-only decision

The current Phase B instruction explicitly requires removal. The local runtime demo fixture, preview gate and labels have been removed; synthetic fixtures now exist only in automated tests. The approved dashboard layout and theme are preserved.

## Approval order and verdict

A: ready for review of the isolated export, then separate staging/promotion
approval. No migration or Health configuration change is part of A.

B: NO-GO for production ingestion. Approve the proposed ingress design and operator
privacy/correction decisions first; then implementation/isolated verification;
then separate migration, scheduler/secret, deployment and provider activation
approvals; finally genuine OAuth/delivery tests. No real Garmin OAuth, delivery,
disconnect or account deletion was performed by this readiness task.

## Executed validation

- Isolated 11-file Release A export: 395 website tests, TypeScript, ESLint and
  production build passed. No production environment file was copied into it.
- Main checkout: 405 website tests; 139 focused Garmin/Health/OAuth/deletion/private
  webhook tests; TypeScript, ESLint and production build passed, with no test skips.
- Owned disposable PostgreSQL 17.6: 78 assertions, zero failures. Added missing
  worker-auth, real HTTP second-day import and same-window conflict checks.
- Eight private-webhook tests include forced-enabled production denial and key
  rotation. Existing 1 MiB/100-event limits, ownership, RLS, duplicate, permission,
  deletion, rollback and concurrent-worker tests remain passing.
- `git diff --check` passed. The existing local private capability was absent from
  48 generated browser assets; no environment configuration was changed.
- The local UI files were unchanged from the preceding Light/Dark/System desktop/
  mobile visual review. No new authenticated live-browser OAuth validation or
  genuine Garmin delivery is claimed. Local disposable transport/SQL bridges do
  not establish real Supabase JWT/PostgREST or provider compatibility.
- Ignored source export, hashes, pending-file classification and logs are under
  `.verification/garmin-release-readiness` and the adjacent release export.
