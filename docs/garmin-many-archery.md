# Same-day many-to-many Garmin Archery matching

Release candidate isolated from the production baseline. Production database prerequisites were applied through the version-preserving Supabase CLI under the owner’s explicit backup waiver. Website validation and deployment are tracked separately.

## New behavior

Every authorized activity with normalized category ARCHERY and actual UTC start converted to the Session's established Singapore calendar date is eligible. No name-based sport inference or undocumented aliases are used. Multiple Sessions can show the same original recordings. Ordering is start time, then activity ID. No Session timer, overlap threshold, ranking or association write is introduced.

Legacy manual links and null unlink rows remain intact. Automatic Archery entries are additional to a preserved manual selection; manually selected non-Archery data remains explicitly selected, never automatically classified as Archery. Per-Session exclusions are persisted separately and suppress both automatic display and the display of an excluded manual recording without deleting the link. Restore is explicit.

## Presentation and bounds

The overview reports matched count, detailed-HR count and summed per-recording duration (including overlaps). Cards show available names, times, provider HR statistics, device and data availability. Samples load only on expansion or combined-chart request. The existing Activity Details route, reader, individual timeline and conditional refresh are reused. Combined series remain separate; gaps and nulls break each trace, overlapping device readings are not averaged, and inspection uses original timestamps. No combined average is inferred.

Discovery now uses session_garmin_archery_candidates_v2: owner-authorized Singapore start-date filtering, canonical source deduplication, Archery filtering before the page bound, and stable (start_seconds, source_id) keyset pages of 200. The server completes successive pages, rejecting errors and repeated cursors instead of returning a partial successful day. Its safety ceiling is 10,000 candidates per date; exceeding it fails explicitly. The old RPC remains unchanged for released clients. The combined view limits workloads to 250,000 samples with two concurrent activity reads; the full individual views remain available for larger recordings. Summary card enrichment uses batches of 100 IDs, without a silent 100-record cap or one query per activity.

## Required local migration

20261031050052_garmin_session_activity_exclusions.sql was generated using the installed Supabase CLI. It adds only an owner-isolated exclusion table, index, policy and lifecycle cleanup function/triggers. It does not rewrite existing migrations or relationships. Authenticated CRUD requires matching auth.uid() and owned Session. Anonymous access is revoked. Service role receives SELECT/DELETE for cleanup, not new ingestion privileges. Session/connection deletion cascades remove rows; disconnect, authorization identity changes and Health deletion clean exclusion metadata.

The new website requires this additive schema. If exclusion state is missing, failed or capped, matching fails closed. Existing deployed code remains compatible with the added table. The exclusion migration and additive 20261031055949_garmin_archery_activity_discovery migration were verified in disposable PostgreSQL and applied separately to production, preserving canonical versions. The pending inbox-index migration was not applied. Existing explicit links are not backfilled, migrated or deleted.

Recovery: revert the application first if needed. The added table can safely remain unused. Destructive removal of exclusion state is a separately reviewed action, with that loss explicitly acknowledged. The disposable test exercises owner CRUD, idempotency, other-user denial, connection cleanup, scoring-Session preservation and rollback of schema-removal statements.

## Changed files for this increment

- src/features/session-health/activity-matching.ts
- src/features/session-health/http.server.ts
- src/features/session-health/model.ts
- src/features/session-health/garmin-session-health.tsx
- src/features/session-health/activity-details.tsx (embedded presentation only)
- src/features/session-health/combined-hr.ts
- src/features/session-health/matched-activities.server.ts
- src/features/session-health/matched-activities.tsx
- supabase/migrations/20261031050052_garmin_session_activity_exclusions.sql
- scripts/garmin-activity-exclusions-fixture.mjs
- scripts/test-garmin-health-sql.mjs
- tests/garmin-many-archery.test.mjs
- tests/garmin-activity-insights.test.mjs
- tests/session-health.test.mjs
- tests/helpers/session-layout-runtime.mjs
- docs/garmin-activity-insights.md
- docs/garmin-many-archery.md

## Verification and release limits

Full web: 781 passed; mobile: 566 passed; core: 142 passed; maintenance: 32 passed. Focused matching/Session HR checks: 83 passed. Disposable PostgreSQL: 358 assertions passed, including eight new exclusion checks. All TypeScript checks, website lint and Next.js production build passed. Migration consistency: 39 canonical files and seven aliases. Prior mobile icon-fixture EPERM was resolved by rerunning through supported local permissions. No rules/tests were removed to force a pass.

Automated fixtures are not a real-browser viewport review or genuine Garmin acceptance test. Actual production category values, notification delivery, authentication across real account switches and deployed RLS still require controlled acceptance. The old pending weather/Session-contract work and Garmin activity detail implementation were preserved. No Android UI, Garmin ingestion, OAuth, scoring formula, weather, provider subscription or production flag was changed by this increment.

## Isolated release verification

The candidate is based on production commit b22503ec222a9bbbcd2eb65ed5cdfc6ab01736db. Uncommitted Phase 3W weather, Phase 3A contracts and the other local development commit are excluded. Fresh candidate results: 732 website tests, 561 mobile tests, 124 core tests and 32 maintenance tests passed, with zero failures/skips. Website/mobile/core TypeScript, website ESLint, architecture and migration checks, and Next.js 16.4.1 production build passed. SQL fixture results and hosted acceptance are recorded in the release report; older counts above refer to the original development workspace, not this isolated candidate. Genuine Archery detailed HR delivery remains unverified; summary values never create a synthetic graph.
