# Garmin Health / Activity sync foundation — local, disabled

This is **not an activated or live-verified integration**. No production migration,
endpoint configuration, environment change, real Garmin authorization or provider
delivery was performed. Existing OAuth, token encryption and deletion-fence code
remain unchanged. The white Health dashboard layout and stylesheet are preserved.

## Verified provider evidence

Reviewed the official documents linked from the approved developer account's
[Documentation page](https://developerportal.garmin.com/developer-programs/programs-docs):

- Garmin Connect Developer Program Start Guide 2.0, revision 15 October 2026,
  §§2.1–2.4: Starter is push-only, no historical access; endpoint configuration is
  in API Tools; new domains can require a security review.
- Health API 2.0, §§3–6: HTTPS JSON POST delivery, top-level summary arrays,
  `userId` mapping, summary fields, calendar-date meaning, units and updates.
- Activity API 2.0, §§3–6: discrete activities, ordinary and manually updated
  summaries; activity values must not be added to all-day activity totals.
- OAuth2.0 PKCE 2.0, §§5–9: stable provider user identifiers, deregistration and
  `userPermissionsChange` notifications, `HEALTH_EXPORT` / `ACTIVITY_EXPORT` grants.

Original provider documents and extraction evidence are in ignored
`.verification/garmin-sync/` (Health PDF was downloaded to Downloads). They are not
application assets or files to publish with the repository. Do not commit the
confidential specifications or real credentials/payloads.

### Contract blockers — do not bypass

1. **Notification authentication is not specified in the four reviewed PDFs.** The
   OAuth guide mentions user/client identifiers in notifications but does not name
   an authenticated request header or signature algorithm. A public client ID,
   claimed provider user ID, random URL path or invented shared header is not proof
   of origin. API Tools requires a separate client-ID/secret sign-in; its endpoint
   security settings have not been inspected. `configuredGarminNotificationVerifier`
   deliberately returns null. Both configured HTTP handlers return 503, even if
   someone changes the feature flag. Obtain the actual documented verification
   contract from API Tools/Garmin, then implement and test that one verifier.
2. **Acknowledgment:** both API specs require HTTP 200 within 30 seconds before
   processing. This design performs bounded receipt validation and durable inbox
   staging before 200, then domain processing afterward. Confirm with Garmin that
   durable receipt staging meets its contract before activation. No 200 is returned
   on a failed database stage. Notification failure/backoff and On Hold are
   described; do not invent an exact push retry schedule or unlimited retention.
   The seven-day On Hold guarantee is distinct from failed-delivery queue policy.
3. **Revision ordering:** health updates share a start time/type and have equal or
   greater monitoring duration. Equal-duration corrected records are legitimate,
   but there is no documented monotonic revision timestamp/number. An unseen late
   old record cannot be reliably distinguished from a correction. Longer windows
   replace shorter ones; known exact duplicates are ignored; equal-duration changes
   with different content are quarantined. Automatic application of those changes
   needs a documented ordering guarantee or an explicitly approved reconciliation
   policy. No unsupported historical pull is attempted to resolve them.
4. **Deregistrations have no documented event time/registration epoch.** They pause
   health ingestion for connection reconciliation, without deleting credentials or
   claiming remote deregistration succeeded. Obtain a safe reconciliation contract
   before implementing automatic lifecycle completion. Existing operator-controlled
   cleanup recovery remains authoritative; do not clear a deletion fence or erase
   tokens based on an ambiguous notice.
5. **Durable scheduling:** `after()` is an opportunistic latency improvement, not a
   durable job service. An approved scheduler must invoke the internal worker and
   monitor persistent pending/conflict rows. No cron configuration was deployed or
   enabled. Confirm provider packet sizes fit the 1 MiB / 100-record receipt limits.

## Implemented local flow

Verified provider request → bounded JSON validation → minimal normalized fields →
atomic `stage_garmin_health_push` → durable inbox → HTTP 200 → after-response worker
or authenticated scheduled retry → atomic record/status/receipt transition →
request-authenticated owner reader → unchanged Health dashboard interfaces.

Only the first arrow's production verifier remains deliberately unwired. Tests use
an explicitly mocked verifier; they are not evidence of actual Garmin origin
verification. There is no polling, backfill, callbackURL fetching or GPS ingestion.

Endpoints prepared:

- `POST /api/integrations/garmin/health/push` — one endpoint for the supported push
  types. Node runtime, 25-second handler duration, JSON only, bounded streamed body,
  sanitized empty responses, no raw request/error logging.
- `GET /api/internal/garmin-health/process` — server scheduler only, constant-time
  bearer-secret comparison, no browser session authorization, up to 50 receipts per
  invocation. Failures leave uncommitted work pending for a later invocation.

Unsupported summary types are rejected; do not enable them in API Tools. Supported
input types are dailies, sleeps, stressDetails, activities,
manuallyUpdatedActivities, userPermissionsChange and deregistrations.

## Data and units

- Dailies: resting heart rate (bpm), steps, average stress (`-1` becomes null), and
  active time (seconds, displayed as minutes). Never sum overlapping daily records.
- Sleeps: total duration and available light/deep/REM/awake seconds. Unknown stages
  remain null. If known stages do not cover the full sleep duration, the existing
  chart shows total duration with stages unavailable instead of stretching them.
- Stress details: latest valid `timeOffsetBodyBatteryValues` sample and actual
  sample timestamp. Daily charged/drained amounts are not a Body Battery level.
- Activities: source identity, type, UTC start, duration seconds, optional average
  bpm and metres. Display converts to minutes/km; no scoring Sessions are imported
  or counted as Garmin activities. Numeric activity IDs in the official JSON
  example and string IDs in its field table are both supported without unsafe
  numeric coercion. Manual updates reconcile by activity ID where supplied.
- Garmin daily `calendarDate` is preserved. Activity calendar filtering/display
  follows Arc Track's existing Asia/Singapore convention. Source offsets are
  validated, not misrepresented as an IANA timezone.
- Raw GPS, device names, heart-rate/stress time series and unused fields are
  discarded. No provider tokens enter the inbox or dashboard DTOs.

## Local migration and security

Prepared `supabase/migrations/20261023155612_garmin_health_sync.sql`, created by the
existing Supabase CLI. Apply only after the two existing Garmin OAuth migrations,
and only with separate production approval. It adds:

1. `garmin_health_inbox`: service-only durable receipt/processing ledger.
2. `garmin_health_records`: minimal measurement snapshots with owner-only SELECT.
3. `garmin_health_sync_state`: owner-readable safe import status/permission overlay.
4. Two service-only, security-invoker RPCs and one private lifecycle trigger.

All new tables have RLS. Ordinary authenticated users can SELECT only their own
records/status via `auth.uid()` and cannot mutate them, access the inbox or call
processing RPCs. Anonymous access is denied. There is no organisation/coach policy.
The reader also filters the verified owner UUID explicitly and uses the existing
request-authenticated Supabase client, not service authority. It reads a bounded
90-calendar-day window, with a 10,000-row limit; missing older coverage does not
enable an unsupported trend range.

Staging maps the provider ID through the existing unique Garmin connection. It
does not accept an Arc Track owner ID from the request. Both staging and processing
check the server allowlist, connected state, operation/deletion fence and relevant
effective export permission. Connection-row locks serialize with existing
disconnect/deletion operations. Receipts bind to `authorized_at`, not the transient
OAuth refresh lease version; a new authorization invalidates prior pending work.
Concurrent workers use row locks/SKIP LOCKED. A transaction failure rolls record
and queue transitions back together. No mutation of existing scoring, profile,
organisation, Auth or Training Plan rows is introduced.

## Permission, deletion and retention behaviour

Permission notifications apply only in increasing `changeTimeInSeconds` order and
not before the current authorization. Conflicting changes in the same second (or
coincident with authorization) cannot widen access: permissions are intersected,
affected data is removed, and ingestion pauses for verification. Their health-specific permission overlay
does not rewrite OAuth/session code. Revoking HEALTH_EXPORT removes stored health
measurements; revoking ACTIVITY_EXPORT removes activity snapshots. Other permitted
categories remain usable. Later queued data is rechecked before processing.

Confirmed existing disconnect removes health records, receipts/conflicts and sync
state in the same connection update transaction. Existing Auth-user deletion
cascades through the connection to all three health tables. Failed/pending Garmin
cleanup retains records and encrypted recovery credentials; ingestion is fenced.
No notice silently clears recovery evidence or invokes account deletion.

Processed/rejected inbox payloads are erased immediately after processing; minimal
hash/source/outcome receipts remain for duplicate suppression. Pending and
ambiguous-conflict payloads remain private for retry/reconciliation. No automatic
age-based purge is implemented for records, receipts or conflicts. They remain
until the relevant permission removal, confirmed disconnect or account deletion.
**Before activation**, the owner must approve age-based retention/quotas, nominate
the recovery operator, and verify actual backup/log retention. Do not confuse the
90-day UI window with physical deletion or invent a retention commitment.

The current public privacy notice describes connection-only processing. Leave it
truthful while ingestion is disabled. Before activation, update it to disclose the
specific imported categories, private storage/use, operational receipt/conflict
retention, permission/disconnect/account-deletion effects, support/recovery path,
and verified backup/log exceptions. Health data is not shared with coaches or sent
to AI training, evaluation or model-improvement services. This code adds neither
an AI consumer nor a telemetry export of health payloads.

## Configuration and controlled activation — approval required

- `GARMIN_HEALTH_ENABLED=false` is the default; no health queries or ingestion
  occur while disabled. `.env.example` alone is updated; real environments were
  not changed. Enabling without the verifier still cannot activate the receiver.
- Existing `GARMIN_CONNECT_ENABLED` and strictly validated `GARMIN_TEST_USER_IDS`
  gate staging/worker eligibility through the existing OAuth allowlist helper.
  Empty/malformed lists deny all; there is no wildcard or client-controlled list.
  Turning new Connect off also stops health worker eligibility in this initial
  controlled rollout; existing cleanup remains independent.
- `CRON_SECRET`: an approved server-only scheduler credential, at least 32
  characters. Do not reuse/rotate provider credentials or encryption keys.
- Existing Supabase server secret remains server-only. Existing token encryption
  remains unchanged. No guessed provider notification secret is added.

Resolve the five contract/operational blockers above first. Then separately approve
and verify the single new migration; deploy code disabled; approve/verify privacy
and retention; configure documented provider verification and the durable worker;
approve one test user and the Health flag; separately configure only the supported
API Tools summary endpoints in PUSH mode. Do not change the OAuth callback URL.
Do not enable any pull/backfill endpoints for Starter access.

Only then authorize a real account test: sync a compatible Garmin device through
Garmin Connect; observe provider delivery, durable receipt, worker commit and owner
dashboard; replay a documented test delivery; verify an unrelated account cannot
read the records. Do not delete a real account or revoke its consent for QA without
separate approval. Report actual delivery timestamps and failures without secrets.

## Validation and reproducibility

`node --experimental-strip-types --test tests/garmin-health.test.mjs tests/health.test.mjs`
tests synthetic provider-shaped notifications and a mocked verification result.
The production null verifier is explicitly tested as a fail-closed blocker.

`node scripts/test-garmin-health-sql.mjs` requires existing absolute PG_BIN and
PG_DRIVER_MODULE paths. The maintained runner creates its own disposable loopback
PostgreSQL cluster, accepts no URLs/credentials/CLI arguments, emulates Supabase
roles/Auth, applies the three Garmin migrations, compares representative existing
data/columns/policies/trigger, runs rollback fixtures and independent-connection
concurrency checks, then stops/removes only its owned cluster. It does not prove
hosted JWT/PostgREST or production migration success.

### Verified local results (24 October 2026)

- 46 focused Garmin ingestion / Health UI tests passed.
- 132 focused ingestion, Health, OAuth and account-deletion tests passed.
- Full website suite: 384 passed, zero failures/skips.
- TypeScript, repository ESLint and production build passed.
- Disposable PostgreSQL 17.6: 46 assertions passed, including actual grants/RLS,
  existing-data/schema preservation, rollback/retry, nonempty deletion cascade,
  same-second permission ambiguity and independent-connection concurrency. Owned
  clusters were stopped and removed.
- Real localhost HTTP: push 503, worker 503, signed-out Health preview 307 to
  `/sign-in`. No database stage can run through the configured null verifier.
- No live migration, Garmin delivery, hosted JWT/PostgREST test or real account
  deletion was performed. API Tools security configuration remains unverified.
- Temporary PDF parser dependencies and CLI-generated `.temp/cli-latest` were
  removed. Source specifications remain ignored evidence, not application deps.

### Change manifest for this phase

New: `src/features/garmin/health/{types.ts,normalize.server.ts,config.server.ts,
store.server.ts,http.server.ts,read.server.ts,dashboard.ts}`;
`src/app/api/integrations/garmin/health/push/route.ts`;
`src/app/api/internal/garmin-health/process/route.ts`;
the single migration and rollback SQL fixture;
`scripts/test-garmin-health-sql.mjs`; `tests/garmin-health.test.mjs`; this runbook.

Updated: `.env.example`; `src/features/health/{read.server.ts,types.ts}`;
`src/features/health/components/{health-cards.tsx,health-dashboard.tsx}`;
`tests/health.test.mjs`; `docs/health-dashboard.md`.

Earlier pending Health navigation, icons, proxy integration, page routes, CSS,
charts and fictional preview remain intact. Existing Garmin OAuth/services,
account-deletion implementation, website homepage, scoring, Coach Workspace,
mobile app, shared core, package manifests and lockfile were not changed.
