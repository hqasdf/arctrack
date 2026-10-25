# Garmin notification admission — Phase A.2

`admit_garmin_health_push(jsonb)` is a service-only, database-owned admission
boundary. Each result contains `status`, `accepted`, `duplicate`, and `ineligible`
counts. Successful result counts cover the entire normalized batch. A temporary
result has zero committed counts: its PL/pgSQL exception subtransaction rolls back
the whole batch, including earlier receipts and consent-proof updates.

| Result | Meaning | HTTP |
| --- | --- | --- |
| accepted | One or more durable receipts; remaining events are duplicates/final rejections | 200 |
| duplicate | Equivalent durable receipts already exist; no new inserts | 200 |
| ineligible | Confirmed final rejection: unknown/disconnected/restricted account, revoked permission, deliberate pause or replay cutoff | 200 |
| temporary | Expired token, refresh/authorization lease, uncertain account state, reconciliation, missing controls, or bounded lock contention | 503 |
| storage_failure | RPC error or missing/invalid/unaccounted admission result | 503 |

No response contains result counts, identifiers, measurements or database errors.
Only accepted new receipts request opportunistic processing. The existing bounded
scheduled worker remains the durable processing retry path.

Connection locks preserve identity, consent, deletion and generation serialization.
Mixed-user deliveries either complete with every event accounted for or roll back
and return failure. Existing duplicates remain final during token expiry; deletion
and pause protections take precedence. No unauthorized measurements are admitted.
Untimestamped deregistration after a deletion/resume fence retains the existing
durable reconciliation marker rather than claiming that remote cleanup completed.

## Provider delivery limits

The official Health API 2.0 and Activity API 2.0 documents saved during integration
describe a 30-second Push acknowledgement deadline and HTTP 200 success. Their
endpoint-configuration sections describe missed-notification reattempts with
exponential backoff. Their detailed non-200 failure definition appears in the Ping
section. These documents do not establish a precise Push retry schedule or an
unlimited replay guarantee. HTTP 503 explicitly withholds success; this fix does
not promise Garmin will retain every failed notification indefinitely. Seven-day
On Hold retention is a different provider feature. No provider settings are changed.

## Compatible rollout

Apply `20261025003708_garmin_health_admission.sql` before the dependent website.
The existing one-argument integer staging RPC wraps the new result and raises a
retryable error, so the old deployed receiver also returns failure during temporary
conditions. Previously applied migration files, RLS, grants and worker algorithms
are unchanged. Missing new RPC/configuration fails closed in the new adapter.

On application rollback, retain this compatible database migration. Do not drop
receipts, rewrite history, rotate credentials, or reverse lifecycle fences. Inspect
queue age and scheduler health using the existing monitoring runbook.

## Validation

Run `node --experimental-strip-types --test tests/garmin-health.test.mjs
tests/garmin-private-webhook.test.mjs tests/garmin-ingress.test.mjs` and the existing
`node scripts/test-garmin-health-sql.mjs` with its provisioned `PG_BIN` and
`PG_DRIVER_MODULE`. The latter owns a disposable loopback cluster and uses fictional
accounts only. It tests actual trigger/RPC atomicity, real refresh lock contention,
HTTP propagation, owner isolation, deletion, replay and existing scheduled processing.
Run full website tests, typecheck, lint, production build and `git diff --check`.
Synthetic verification is not evidence of a genuine Garmin-originated delivery.
