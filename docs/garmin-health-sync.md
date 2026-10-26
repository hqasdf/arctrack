# Garmin Health / Activity sync foundation — local, disabled

The additive local pause/resume/deletion implementation and replay limitations are
documented in [Garmin Health controls](garmin-health-controls.md). The reviewed
Health migration is unchanged; controls require the separate later migration.

Current local Phase B implementation and activation gates: [garmin-phase-b-implementation.md](garmin-phase-b-implementation.md). The earlier readiness snapshot below is historical where superseded by that report. No Phase B production activation has occurred.

This is **not an activated or live-verified integration**. No production migration,
endpoint configuration, environment change, real Garmin authorization or provider
delivery was performed. Existing OAuth, token encryption and deletion-fence code
remain unchanged. The white Health dashboard layout and stylesheet are preserved.

For the 24 October provider-UI findings, Hobby scheduling constraint, expanded
database verification and local permission-cleanup correction, see
[Phase 2 readiness](garmin-phase2-readiness.md). Public OAuth account linking is
already deployed; that does not activate this separate Health foundation.

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
   of origin. The authenticated API Tools endpoint/pillar configuration and linked
   OpenAPI definition were inspected on 24 October; they expose no sender-security
   control or incoming webhook-authentication contract. This does not establish
   whether Garmin supports another mechanism on request. A precise support draft
   is in `garmin-notification-security-request.md`. `configuredGarminNotificationVerifier`
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
   enabled. Session HR expands the authenticated raw Push bound to 4 MiB and
   atomically admits up to 512 normalized events (100 per internal sub-batch).

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
manuallyUpdatedActivities, userPermissionsChange and deregistrations. With
`GARMIN_SESSION_HR_ENABLED=true`, Starter `activityDetails` Push is also supported:
`{ "activityDetails": [{ "userId": "...", "summaryId": "...", "activityId": "...",
"summary": { "startTimeInSeconds": 0, "durationInSeconds": 0, "activityType": "..." },
"samples": [{ "startTimeInSeconds": 0, "heartRate": 100 }] }] }` (shape only;
zero timestamps are not accepted measurements). The owner is on the outer record;
`summary` and optional `samples` follow Activity API sections 4 and 6.3. A sample's
`startTimeInSeconds` is UTC seconds and `heartRate` is recorded integer bpm.
Manual/unsupported recordings may have no samples. They retain a genuine activity
summary but do not invent a timeline from an average.

This is full-data Push, not the separate Enterprise Ping/Pull mode in section 8.
`GARMIN_ACTIVITY_ENTERPRISE_PULL_ENABLED` must remain unset/false on Starter.
Callback messages and outbound callback processing require that independent gate
as well as the Session HR gate. No historical access/backfill is implemented.

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
- Activity Details Push: validate the owner, activity ID, summary interval and each
  timestamped HR sample. Discard GPS/device and non-HR fields. Each receipt is split
  into at most 289 chunks of 300 samples, bounded by 24 hours / 86,401 samples and
  512 events per whole notification. `admit_garmin_hr_push` admits every sub-batch
  in one transaction before HTTP 200; one retryable failure rolls back the whole
  notification. Processing remains bounded to 50 receipts per worker request;
  partial datasets stay unpublished until all chunks are present.
- Both Cloudflare and Vercel reject raw notifications above 4 MiB (HTTP 413), below
  Vercel's 4.5 MB function limit. Nothing is silently truncated or acknowledged.
  The provider does not document a universal payload maximum: long or GPS-heavy
  recordings/batched notifications can exceed this bound even below 24 hours.
  Confirm actual delivery sizes before enabling at scale. Larger supported
  provider batching or a separately reviewed large-payload ingress is required
  if this bound is exceeded; do not solve that by enabling Enterprise callbacks.
- Daily `timeOffsetHeartRateSamples` map offsets from the summary's start to bpm.
  Each entry represents the preceding 15 seconds; absent entries remain missing.
  The Session UI labels these as lower-resolution all-day samples. Statistics and
  tooltips use original samples, not interpolated points or activity averages.
- Enterprise-only callback support remains isolated and disabled on Starter.
  When explicitly entitled, the bearer capability is AES-GCM encrypted before
  service-only persistence; same-host HTTPS GETs do not follow redirects and are
  bounded at 16 MiB. No callback tokens appear in browser data or diagnostics.
- Garmin daily `calendarDate` is preserved. Activity calendar filtering/display
  follows Arc Track's existing Asia/Singapore convention. Source offsets are
  validated, not misrepresented as an IANA timezone.
- Raw GPS, device names, unused fields and detailed HR samples are excluded from
  Health metric snapshots. Garmin callback tokens exist only as authenticated
  encrypted queue capabilities until the pull completes; they are not written
  plaintext to the inbox or included in dashboard DTOs.

## Session heart-rate activation order

The applied baseline is `20261025124444_garmin_session_heart_rate.sql`.
The LOCAL follow-up `20261026022713_garmin_activity_session_links.sql` removes manual timing.
Activity discovery uses the owner's Session calendar date in Asia/Singapore, including
recordings that overlap midnight. Only explicit selection associates an activity.
The selected provider start and duration determine the HR interval; a summary can
supply timing while authorized all-day samples provide a labelled fallback. No score
creation timestamp or whole-day interval is substituted for a missing recording.

`set_session_garmin_activity` is the only client association writer. Its narrow
SECURITY DEFINER boundary verifies auth.uid() and Session ownership, serializes on
connection/control rows and a per-Session advisory lock, and uses exact optimistic
revisions. It returns no credentials and grants no direct association or scoring writes.
Lifecycle cleanup clears associations and HR as before. The old timer RPC and reader
are dropped, and old rows move intact to a restricted private archive. Service-role
access to the archive is limited to clearing imported association IDs for privacy.
Destructive removal of that archive requires separate authorization.

This is a coordinated migration/application release, not a production db push.
Do not deploy the new application before its new RPCs exist. The old application
must not remain in use after the migration removes its timing RPCs. Capture exact
predecessor function definitions and archive/grant state for an approved rollback;
new associations must be preserved if rolling back. Never blindly revert migrations
or rerun the old baseline. Historical SQL fixtures intentionally test the old schema
BEFORE this upgrade; current JS fixtures and UI exercise only activity associations.

For the separately approved production release:
1. Build and stage the exact matching application without assigning the production
   domain. Record the current application deployment and exact predecessor SQL,
   grants and archive location; confirm the new migration is still pending.
2. Use a short, explicitly arranged Session HR maintenance window to drain legacy
   Session HR requests. Do not run the old application against the retired RPCs.
   Ordinary Garmin ingestion does not require the old timer RPCs.
3. Apply only `20261026022713_garmin_activity_session_links` transactionally through
   the version-preserving migration workflow, recording history with successful SQL.
   Verify association preservation, archive restrictions, grants, RLS and RPCs.
4. Promote the already-validated matching application, refresh open Session pages
   and verify owner-only discovery, link/unlink and provider timestamps before
   restoring Session HR access. Old manual commands are rejected by the new API.
5. If application promotion fails, keep Session HR unavailable while reviewing a
   coordinated application/SQL rollback. Preserve new associations and historical
   timestamps; an old application rollback alone is incompatible with this schema.
   Zero-interruption rollout would require a separately reviewed compatibility
   bridge rather than applying this decommissioning migration to a live old UI.

Keep the matching Cloudflare 4 MiB ingress and the existing activation/security gates.
Keep the Enterprise Pull flag false. Then enable the existing **Push** Activity
Details category for a consenting real-device test; configured endpoints are not
proof of delivery. Check raw delivery sizes, durable receipts, complete sample
datasets, explicit Session matching and owner-only display. Existing independent
Cloudflare-to-Vercel capability authentication is URL-possession authentication,
not cryptographic proof of Garmin identity. Existing emergency shutdown, privacy,
permission, replay, pause and deletion gates remain required.

Local SQL verification can reuse the previously provisioned tooling without an
installation: `PG_BIN` is the `extracted/package/native/bin` directory under the
temporary `arctrack-feedback-pg17-tooling` folder; `PG_DRIVER_MODULE` is its
`node_modules/pg` directory. Set absolute paths and run
`node scripts/test-garmin-health-sql.mjs`. The runner creates and removes a new
loopback-only cluster, reads no `.env`, and accepts no production database URL.

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
check the server-supplied ingestion cohort, connected state, operation/deletion fence and relevant
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
- Public OAuth does not authorize ingestion. The former shared OAuth test-user
  list is removed. The configured ingestion cohort is deliberately empty, so the
  Health reader/receiver/worker remain disabled even if the Health flag is set.
  The provider verifier also remains null. Future ingestion requires a separately
  reviewed sender contract and activation change; ordinary account linking cannot
  silently activate health processing. Existing cleanup remains independent.
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
