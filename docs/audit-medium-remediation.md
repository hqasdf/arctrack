# Medium audit finding remediation

Local implementation against `83f0ad42f6a6cddfacfa99894cd44d931af1aaca`.
No production migration, configuration change, commit, push or deployment is included.

## Arrow write integrity

The original WebArrowQueue reproduced two failures before editing: a committed
first save with a lost response followed by deletion sent no delete; a committed
9 with a lost response followed by reverting to 8 falsely reported 8 saved.

The queue now retains uncertainty after failed responses. Cached equality cannot
settle an unknown outcome. A failed deletion retains a visible failed target,
including when the first save never supplied an ID.

The shared `createArrowPersistence` reconciles authoritative slot state after an
uncertain outcome. Each mutation carries an expected revision and unique request
identity. The database compares these under the owned Round lock, applies the
mutation, and returns its actual Arrow/revision in the same transaction. Empty
slots retain revision tombstones, so a delayed old save cannot resurrect a later
deletion. Replaying the current request is idempotent; changing its payload is
rejected. Another writer's revision is a conflict requiring reload, not a silent
overwrite. Local recovery identity memory is bounded to 64 requests per slot;
exceptionally old outcomes fail closed.

Web uses the existing bounded, same-origin Arrow HTTP route, retaining independent
slot request concurrency. The legacy POST contract remains compatible. Android
uses the same shared persistence logic with native Expo UUID generation, current
owner checks and the existing per-slot FIFO/lifecycle checks. Unknown saved IDs
no longer skip deletion. Failed deletions are restored as failed, never saved.

## Safe Configure Round

The new `configure_empty_round` RPC changes full settings on the existing Round.
It checks the caller, authoritative expected settings and absence of Arrows under
the same Round lock used by Arrow writes. Input/workload/budget checks precede
changes. Retained End IDs and the Round ID/number survive; only excess empty Ends
are removed. Any failure rolls the transaction back. Reconfiguration invalidates
existing slot revisions, and untouched slot revision identities also include the
Round configuration, fencing requests prepared for superseded target settings.

The old six-argument `update_owned_round_settings` RPC keeps its existing scored
metadata/End-expansion semantics. It was not tightened to empty-only. Explicit
Round deletion remains a separate owner-authorized action. Web validation now
matches the existing SQL limits of 120 Ends and 60 Arrows per End.

## Garmin queue fairness

The new dispatcher excludes non-null OAuth operations before selecting owners,
considers one oldest pending receipt per owner, and applies `SKIP LOCKED` before
the bounded owner limit. It locks at most the requested batch of owners and keeps
total processing/rejection bounded. Locked/busy owners cannot fill a fixed receipt
window and hide later healthy accounts. Uncertain expired operations are not
cleared: their own receipts remain durable until normal safe OAuth recovery.

Permission, pause, generation, deletion and connection-change rejection paths and
the reviewed inner processor remain intact. No Garmin API or feature flag changed.

## Android invitation loading

Organisations renders invitation summaries without detail reads or subscriptions.
Respond/Open Training selects at most one detail view; it reuses the existing
Join, Decline, Connect, Continue Scoring and Leave controls after authoritative
access verification. There is one summary refresh lifecycle and at most one detail
lifecycle/channel, independent of invitation count. Selection changes/background
clear private detail and clean up the old channel. Stale responses cannot populate
the new selected view. Creation uncertainty/known IDs survive detail collapse and
background remount within the Organisations screen; late creation cannot silently
trigger an association from a retired detail.

## Files

Product:
- `packages/core/src/arrow-persistence.ts`
- `packages/core/package.json` (export only; no dependency/version change)
- `src/features/sessions/web-arrow-queue.ts`
- `src/features/sessions/arrow-slot.server.ts`
- `src/app/api/session-arrows/route.ts`
- `src/features/sessions/components/scoring-workspace.tsx`
- `src/features/sessions/components/sessions-workspace.tsx`
- `src/features/sessions/actions.ts`
- `src/features/sessions/validation.ts`
- `apps/mobile/src/arrow-writes.ts`
- `apps/mobile/app/rounds/[roundId]/score.tsx`
- `apps/mobile/src/live-coaching-ui.tsx`

Regression tests and disposable fixtures:
- `packages/core/tests/arrow-persistence.test.mjs`
- `tests/web-arrow-queue.test.mjs`
- `tests/application-security.test.mjs`
- `tests/recent-round-configs.test.mjs`
- `tests/scoring-replot.test.mjs`
- `apps/mobile/tests/live-coaching-summary.test.mjs`
- `apps/mobile/tests/guarded-writes.test.mjs`
- `apps/mobile/tests/native-target-gestures.test.mjs`
- `scripts/scoring-integrity-fixture.mjs`
- `scripts/garmin-queue-fairness-fixture.mjs`
- `scripts/test-notes-feedback-pg.mjs`
- `scripts/test-garmin-health-sql.mjs`

## Unapplied migrations and release order

1. `20261029014758_scoring_integrity.sql`
   SHA-256: `E9D8E9E699B392D2F0CE2E5544C6F9D0E9591D822E59552B2E2DCF81DA916FB0`
   Creates the private revision table/trigger, owner-only read/write RPC wrappers,
   full empty-Round configuration RPC, and replacement legacy Arrow helpers that
   acquire the common Round lock. No historical migration is rewritten.
2. `20261029014932_garmin_queue_fairness.sql`
   SHA-256: `9AC58FAC7DE1620E5994DD04058FA9F97C993756794B4182A150F9F25123E931`
   Adds a pending-receipt owner index and replaces only the global queue wrapper.

Both were generated with the existing Supabase CLI and tested locally. They need
separate production approval and normal target/schema/history checks. Do not run
a broad db push. Review index-build locking against actual queue volume before
application. Keep the seven historical timestamp aliases unchanged.

Install the scoring migration before releasing the new web/native writers; an
absent revision RPC fails closed, with no silent unsafe fallback. Existing clients
and their guarded RPCs remain compatible, but old releases do not become
revision-aware automatically. Legacy writes invalidate new snapshots; refresh old
browser tabs and distribute the updated Android JS/app to use the repaired flow.
Keep OAuth/ingestion/BLE flags and all production secrets unchanged.

## Verification and limits

- Website: 682 passed, zero failed.
- Mobile: 529 passed, zero failed; final screen handlers additionally passed 33
  scoring/gesture checks after removal of obsolete local ID maps.
- Shared core: 123 passed, zero failed.
- Web/mobile/core TypeScript passed; root ESLint and changed mobile source ESLint
  passed. The audit's unrelated eight full-mobile lint findings were not repaired.
- Next.js 16.4.1 production build and Android Hermes export passed.
- General disposable PostgreSQL: 532 assertions, including 32 new scoring checks.
- Garmin disposable PostgreSQL: 339 assertions, including 10 new fairness checks.
- 37 canonical migration files validate; seven historical aliases remain intact.
- `git diff --check` passed. No dependencies, scoring formulas, authentication
  protections or production configuration were changed.

Tests cover unknown save/delete outcomes, reverting scores, stale/replayed
requests, another device's revision, owner/anonymous denial, full settings and
identity preservation, rollback, both configuration/scoring lock orders, more than
200 busy receipts, locked owner windows, concurrent workers, bounded rejection,
100 invitation summaries, selected-channel cleanup and uncertain creation remount.

Disposable roles/Auth/Realtime are emulated. Real JWT/PostgREST, physical Android,
browser-to-device end-to-end sync, native SecureStore durability and genuine Garmin
delivery are not newly verified. Other Low audit findings and dependency advisories
remain outside this four-finding patch. These fixes are local, not production-live.
