# Live Coaching Phase 2 monitoring — local implementation

27 October 2026. This extends the existing deployed Phase 1 and the pending BLE
foundation. It is not deployed or activated. No production data or flags changed.

## Views and authoritative data

The existing LiveCoaching component retains session creation, invitation,
participation, inline lifecycle confirmation and authoritative reconciliation.
LiveMonitor adds responsive athlete cards, a compact scroll-contained table,
name/participation/signal filters, confirmed-score/progress/end sorting, an
individual detail panel and user-initiated browser fullscreen with an expanded
fallback and Escape handling. No second scoring subscription is created.

Cards and details reuse `scoringProgress` and the existing shared scoring helpers:
confirmed completed-end totals, saved provisional arrows, latest saved arrow
values, current round/division/distance, progress, completed end history and
per-end score bars. Authorised notes and feedback open the existing Session
review route; this feature does not duplicate private note data.

The header separates actual local browser sensor connections, fresh received
signals, recent saved scoring changes and participating athletes. A website
heartbeat is not proof of attendance, shooting or physical activity. Visible
authenticated coaching and owned scoring pages send at most one in-flight
heartbeat every 20 seconds; SQL accepts an update at most every 10 seconds.
The label expires after 45 seconds. Backgrounding stops heartbeats; it does not
falsely claim an athlete is offline when another tab might be open.

New lifecycle timestamps record the team training start and completion/cancel
using the database clock. No individual Session timer is restored. Older live
sessions with no recorded start display `Not recorded` rather than an inferred
duration.

## Explicit timeline consent and retention

The previous latest-only consent does **not** opt an athlete into retention.
A joined athlete must first share live HR and separately choose the 24-hour
timeline. Only that athlete can enable/erase it; the current generation and
history revision fence stale preference requests. The creating coach cannot
grant consent. Reads recheck current live-session access and membership.

The existing sensor manager remains responsible for explicit BLE discovery,
parsing, duplicate local assignments, source/generation/sequence checks and
manual reconnects. It still accepts only Heart Rate Service 0x180D / Heart Rate
Measurement 0x2A37. No device hardware identifiers reach storage.

The new table retains the **first actual accepted reading in each 10-second
bucket**, only with both consents and an active live session. Each sample expires
24 hours after receipt. Reads enforce expiry even if cleanup is delayed. Live
values become unavailable after 10 seconds; physical latest-value cleanup uses
the existing 60-second TTL. Timeline consent revocation erases retained samples;
full consent revocation, leaving, cancellation or relevant membership revocation
also removes them. Sensor disconnection stops current HR while separately
consented history can remain for review. Completion invalidates assignments and
clears latest values, retaining only authorised bounded review history.

`supabase/ops/live-coaching-hr-retention.sql` remains an **inactive** job preparation
script. Its updated pruner removes expired samples and completed controls after
24 hours. Before production timeline collection, separately approve/install both
migrations, activate and verify this cleanup job, and review operational privacy.
At a healthy one-minute cadence, physical deletion can lag expiry by roughly a
minute. Failures can delay it further; this is not a backup-erasure guarantee.

## Charts, observations and review limits

The checked monitor read permits only 5/15/30-minute or retained 24-hour windows.
Raw samples are segmented before downsampling: gaps over 20 seconds and assignment
generation changes start a new segment. It returns at most 240 actual timestamped
points per athlete. SVG paths never bridge segments; min/max/average describe the
stored coarse samples in the selected interval, not continuous physiology. The
selected chart has an accessible sample table. No BPM or missing point is invented.

New arrow changes record only latest observed end-update metadata. Arrows, totals
and scoring formulas remain in the existing tables. Confirmed-update markers
reflect corrections, not original shot time. Old ends remain explicitly untimed.
The display makes no causal HR/performance claim. Review reads the current
authorised scoring Session, not an immutable snapshot; later athlete corrections
can change it. Retained HR disappears on expiry/revocation. Garmin Health, Sleep
and other unrelated private health records are never exposed.

Current HR/metadata fetches are serialized every five seconds while visible;
history fetches are limited to once per 15 seconds (completed review uses 15
seconds). Sampling POSTs do not trigger an additional read per sensor. The existing
55-second EventSource lifetime, 15-second authorization check, coalesced scoring
reads and 60-second recovery remain unchanged. No client sample array grows
without bounds. Fullscreen/detail selection reuse the same manager and data feed.

## Local database release order

1. Existing Phase 1 migration (already deployed; do not reapply).
2. Pending, unchanged `20261026162902_live_coaching_bluetooth_hr.sql`.
3. New CLI-created `20261027012339_live_coaching_monitoring_history.sql`.
4. Verify checked RPCs/grants/RLS, consent races, retention, then separately release
   the matching application and approve cleanup/feature activation.

The new migration adds `started_at`/`ended_at`, participant `last_seen_at`, two
history-consent fields, private-by-grant RLS sample/end-observation tables and
checked invoker RPCs backed by narrowly authorised private functions. It replaces
only the pending BLE cleanup/pruning functions to support consented review. It
does not rewrite canonical historical SQL or alter scoring values, Garmin tables,
native code, organisation permissions or existing authentication.

## Disposable visual fixture

Use the existing `scripts/test-notes-feedback-pg.mjs` tooling with absolute
`PG_BIN` and `PG_DRIVER_MODULE` paths from the maintained verification runbook.
Set `LIVE_COACHING_DEMO=true`, `LIVE_COACHING_MONITOR_DEMO=true`,
`LIVE_COACHING_DEMO_PORT=3220` and `LIVE_COACHING_DEMO_DURATION_MS=600000`.
The runner first passes its real SQL assertions, then seeds eight clearly labelled
synthetic athletes and actual disposable SQL records. It accepts fake identities
on loopback only and MUST NOT be deployed or exposed. Build the existing ignored
`.verification/live-coaching-preview/build.mjs` bundle first. This bundles the
actual UI/scoring components with fixture-only navigation/auth transport stubs.
It is not a hosted Auth/Realtime or physical BLE test.

The `/demo/viewport?width=320&theme=dark` fixture (also 390, 768, 1280) renders the
actual application in a width-constrained iframe. Normal product code contains
no demo values or demo authorization bypass. The server and owned cluster stop
automatically and are removed after the configured duration.

## Verification and release limitations

Local application, SQL, build and browser results are recorded in
`live-coaching-verification.md`. Physical BLE, multiple real sensors/adapter limits,
actual browser background disconnects, reconnection and Apple Watch relay support
remain unverified. Eight is a software safety bound, not a hardware guarantee.
Browser QA uses synthetic fixture values only. Production Phase 2 flags remain
false/unset and no migration or retention job is applied/activated by this work.

Files added for this extension:

- `src/features/live-coaching/monitor-model.ts`
- `src/features/live-coaching/monitoring-dashboard.tsx`
- `src/features/live-coaching/monitoring-dashboard.module.css`
- `src/features/live-coaching/presence.tsx`
- `src/app/api/live-coaching/presence/route.ts`
- `supabase/migrations/20261027012339_live_coaching_monitoring_history.sql`
- `scripts/live-coaching-monitor-fixture.mjs`
- `scripts/live-coaching-monitor-demo.mjs`
- `tests/live-coaching-monitor.test.mjs`
- This document.

Existing local foundation/related files extended:

- `src/features/live-coaching/live-coaching.tsx`, `model.ts`
- `src/features/live-coaching/heart-rate/{measurement.ts,panel.tsx,http.server.ts}`
- `src/features/sessions/components/sessions-workspace.tsx` (heartbeat wrapper only)
- `src/app/privacy/page.tsx`
- `supabase/ops/live-coaching-hr-retention.sql`
- `scripts/test-notes-feedback-pg.mjs`, `scripts/live-coaching-demo.mjs`
- `tests/live-coaching-{ui,heart-rate}.test.mjs`
- `tests/session-category-tabs.test.mjs`, `tests/scoring-training-plan-visibility.test.mjs`
- `tests/privacy-policy.test.mjs` (updated policy date and timeline disclosures)
- Live Coaching documentation. Other pending foundation files remain preserved.
