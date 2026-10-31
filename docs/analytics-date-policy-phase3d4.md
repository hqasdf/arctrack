# Phase 3D-4: Analytics and Coach date consistency

## Confirmed discrepancy

Personal Analytics already included future-dated persisted Sessions in All Time.
Both Coach filter-option discovery and Coach aggregation unconditionally capped
Session dates at today, including for All Time. Android uses these same core
models, so the discrepancy was between Personal and Coach, not a separate
Android scoring formula. The legacy website athleteAnalytics helper already
included all Session dates. This-week helpers correctly stop at today.

## Final policy

- Session.date remains the authoritative YYYY-MM-DD calendar date. Never use
  creation timestamps to choose an Analytics day.
- All Time has no date bounds, including future persisted records. Other owner,
  roster, Session-type and Round-format filters remain effective.
- 7, 30 and 90 days are inclusive Singapore calendar ranges ending today,
  beginning today minus 6, 29 or 89 calendar days. Future records are excluded.
- Recent Activity remains past/today-only, retaining its existing limit and
  stable ordering. It need not contain every Session included in All Time totals.
- All Time Coach totals, trends, filter options, athlete insights and review
  eligibility now consistently operate over the complete date domain. Future
  completed records may therefore qualify for review, as with other included
  Sessions; Recent Activity is deliberately separate.
- Period-over-period score comparisons and this-week summaries are unchanged.
- Singapore today conversion is shared by the existing web and Android exports.
  No new midnight timer, loading behavior, navigation behavior or refresh loop
  is introduced. Views still obtain today through their existing lifecycles.

## Implementation

Shared date.ts supplies inclusive analyticsDateWindow / matchesAnalyticsDate
and singaporeDate. Personal and Coach consume the same policy. Coach computes
its window once per aggregation, retaining Phase 3D-3 maps and calculation order.
The web singaporeDate and mobile singaporeToday names remain compatible exports.
No API, database or scoring DTO changed.

The original Phase 3D-3 frozen oracle remains byte-preserved. Its parity harness
now compares the unchanged historical domain for All Time. Dedicated date-policy
tests independently assert the intentional future-date extension, rather than
changing the oracle or masking differences with floating-point tolerances.

## Reproduction and results

Before the fix, the new core policy suite passed 12 tests and failed 3 (All Time
future-date inclusion and future-only filter availability). After: 15/15 pass.
A deterministic two-athlete synthetic fixture with 7 persisted Sessions:

| Period | Sessions before -> after | Recorded Session Arrows | Scored Arrow rows |
| --- | --- | --- | --- |
| All Time | 5 -> 7 | 610 -> 861 | 180 -> 288 |
| 7 days | 2 -> 2 | 247 -> 247 | 72 -> 72 |
| 30 days | 2 -> 2 | 247 -> 247 | 72 -> 72 |
| 90 days | 3 -> 3 | 369 -> 369 | 108 -> 108 |

Recent Activity IDs were identical before/after for every period. These are
synthetic results, not production measurements or user records.

Coverage includes past/today/future dates, exact inclusive endpoints, training
and competition filters, multiple athletes, custom/partial Rounds, full-output
parity on unaffected histories, Singapore midnight, year rollover, leap day and
instants near overseas DST changes. Cross-platform tests execute both actual
web exports and mobile adapter, not separate reimplemented expectations.

## Boundaries

No migrations, production writes, UI redesign, pagination, dependency changes,
commits, pushes or deployments. Phase 3A/3W/3D-1/3D-2/3D-3 and Garmin work remain
in place. Physical Android and browser acceptance are not claimed by unit tests.

## Final validation

- Website: 793 passed, 0 failed, 0 skipped.
- Mobile: 613 passed, 0 failed, 0 skipped.
- Core: 263 passed, 0 failed, 0 skipped.
- Maintenance: 32 passed, 0 failed, 0 skipped.
- Focused date-policy / frozen-reference parity: 121 passed, 0 failed, 0 skipped
  (overlaps the full core and mobile suites).
- Website, mobile and core TypeScript: passed.
- Root website/shared lint and changed mobile module lint: passed.
- Full mobile lint: 8 existing errors; complete output matches Phase 3D-3.
- Architecture: 370 source files passed, no core runtime cycles.
- Migration consistency: 41 canonical versions and 7 historical aliases valid.
- Next.js 16.4.1 production build: passed on retry. First attempt hit Windows
  EPERM while creating a generated _not-found directory; no source workaround.
- git diff --check: passed (normal CRLF conversion notices only).

The isolated Garmin release remains clean at
5be941df292c781eaba7ec03d172ad1fdd83aed3. Local main remains at
106cb92e6ca0a710b1896b1c68f76cfd3a6f558f with existing work uncommitted.
