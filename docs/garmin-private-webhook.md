# Private callback URL proof of concept

The application-defined `/api/integrations/garmin/health/push/[secret]` route
authenticates possession of a private callback URL. It does **not** cryptographically
identify Garmin or authenticate the body independently of TLS. No Garmin signature
or undocumented provider header is assumed.

`GARMIN_HEALTH_WEBHOOK_SECRET` is server-only: 32 random bytes encoded as 64 lowercase
hexadecimal characters. Never put the value or complete URL in source control,
client props, screenshots, documentation, issue trackers or diagnostic output.
Generate with Node's `crypto.randomBytes(32)` and write directly to protected server
environment configuration. Do not print it. Local `.env.local` must stay ignored.
`GARMIN_HEALTH_ENABLED`, the reviewed ingestion cohort and worker readiness are
unchanged. Production remains disabled, even with a configured URL secret.
`CRON_SECRET` is a separate worker credential, never the webhook capability.
The configured secret-path handler now also explicitly returns 503 in production,
even if the flag, cohort and key are configured. Its authenticated factory remains
available for disposable local tests. This does not conceal a path already sent
to Vercel: never probe a production URL with a real capability.

Missing/incorrect capabilities are rejected before body processing or database
client creation. Existing 1 MiB/100-summary bounds, normalization, ownership,
durable staging, duplicate prevention, permission checks, deletion fences and
worker retry behavior remain intact. The original `/push` route retains its
unconfigured verifier and cannot inherit this capability or bypass authentication.

## Leakage and rotation

The receiver does not log URLs, payloads or credentials and returns empty errors
with no-store/no-referrer headers. This cannot prevent the hosting platform,
reverse proxy, request tracing, browser history or Garmin's configuration tools
from retaining the URL. Verify access-log/APM redaction and provider access controls
before activation. Existing code has request/batch limits, but no distributed
Garmin-specific request-rate limiter; review edge rate controls before public use.
A leaked URL allows forged, schema-valid deliveries for known linked Garmin IDs.
Deduplication prevents identical repeats, not malicious new payloads.

Vercel explicitly documents actual `requestPath` metadata, separately from the
dynamic route pattern: https://vercel.com/docs/logs/runtime . An application
no-logging policy or middleware rewrite cannot remove upstream request metadata.
The direct Vercel private-path approach is not approved for the Health pilot.
See [release and pilot readiness](garmin-release-readiness.md) for the proposed
pre-Vercel ingress boundary and remaining review requirements.

For suspected compromise: disable ingestion first; generate a fresh secret directly
in server configuration; separately approve updating the provider endpoint; verify
a controlled delivery; then re-enable only the approved cohort. The old secret
must stop working. No dual-secret grace period is implemented. Expect queued
provider retries during rotation. Do not delete inbox receipts to rotate a secret.

## Garmin compatibility and controlled verification

API Tools Endpoint Configuration presents full notification URLs. On 24 October
2026 its 22 URL fields were blank; inspected fields were text inputs with the
placeholder `https://example.com/path` and no HTML pattern/maximum-length rule.
No value was entered or saved. Available official
Health/Activity specifications do not establish a special rule for a private path
segment or a sender signature. Field syntax alone is not proof of real delivery.
No live endpoint has been saved or enabled for this proof of concept.

After separate approval of deployment, migration, ingress-log controls and ingestion
activation: enter the private HTTPS URL directly in API Tools (never chat), enable
only the approved summary types/test account, then use Summary Resender or a
documented delivery tool for that designated account. Confirm the actual HTTP
response, durable receipt, processed private record and owner-only Health read.
Do not mistake a saved URL or endpoint-validation success for successful ingestion.
No synthetic measurements may enter production during local verification.

## Local verification

`tests/garmin-private-webhook.test.mjs` covers the private gate, early rejection,
unchanged limits, disabled configuration and original-route denial.
`scripts/test-garmin-health-sql.mjs` additionally runs the maintained
`garmin-private-webhook-fixture.mjs` against its own disposable PostgreSQL cluster:
real loopback HTTP, unchanged normalizer/store, durable SQL inbox, authenticated
worker, actual owner reader and dashboard mapping. A synthetic 450-step daily is
returned to its owner and hidden from a different authenticated role. Duplicate
and unknown-user deliveries add no records. Local SQL bridges emulate the
Supabase client interface; this does not validate hosted JWT/PostgREST or Garmin
delivery. Secrets for this fixture are ephemeral server environment values.
