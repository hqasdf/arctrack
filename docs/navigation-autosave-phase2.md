# Phase 2 navigation and autosave

Local implementation only. No migrations, production settings, scoring formulas or provider contracts change. Phase 1, CI/Lighthouse and the pending Garmin index cleanup remain separate and intact.

## Fast active-training workflow

The existing Sessions workspace retains every loaded Round and its full scoring data. Opening a Round records `session` and `round` in the URL. Its Arrow Counter control switches to `tool=counter` using Next's supported native History API rather than navigating away from the loaded workspace. Continue Scoring returns to the same mounted scoring component. The Counter also remains mounted after first use during these switches. Slot selection, corrections, current tally and pending jobs therefore survive the fast workflow. Hidden scoring weather collection is paused; saves already in progress continue.

Desktop/mobile-web navigation recognizes the same active training context. Browser Back/Forward restores the corresponding loaded Session/Round/tool. Ordinary standalone `/arrow-counter`, Sessions deep links and modified/new-tab clicks remain available. Round Back still waits for the existing queue to confirm all changes. It no longer calls `router.refresh()` for the entire Session history.

Training Plan progress is preserved through an authenticated, read-only Server Action using the existing bounded progress reader. A notification generation handles the case where progress was unmounted during scoring. In-flight notifications coalesce, failed refreshes retain prior results, late responses after unmount are ignored, and a retry is available. This does not introduce an alternative scoring or authorization path.

Initial/cold Sessions loading still uses the existing complete reader. There is no Session pagination or mandatory per-Round lazy loading in this phase. A cold route load may still incur the existing full-history cost; that remains later work.

After 60 seconds, focus/reconnect/return-to-training can revalidate only the selected Session through `GET /api/sessions/[sessionId]`. The authenticated owner read includes all its Rounds. Requests are deduplicated and aborted on unmount. Local edit generations and explicit pending-Round tracking (including invisible pending deletes) prevent old responses replacing intentions. Unchanged data does not remount scoring. Changed authoritative data reinitializes a clean writer; temporary failure retains the loaded view, while failed authentication hides protected data. The comparison signature is not a write revision or authorization mechanism.

## Web recovery

`device-scoring.ts` stores only pending scoring recovery in browser localStorage, scoped by origin, public Supabase project URL, authenticated viewer and Round. It includes configuration, latest desired changes (including deletion), original confirmed values, known revisions and this writer's request IDs. It never stores credentials, Garmin measurements, Notes or Feedback text.

An exclusive Web Lock serializes editors of the same Round across tabs. It remains held until in-flight jobs settle when the view closes. Waiting acquisition can be cancelled on unmount. Recovery is loaded before editing is enabled. The writer journals its request identity before network mutation. Confirmed jobs remove their recovery record. Pending records are not silently expired or evicted.

Each record is limited to 2,000,000 JSON characters and 7,200 pending slots. Invalid/mismatched records are retained and editing fails closed. Storage/quota failures keep edits visible, show an error, prevent an unjournaled mutation and retain the navigation warning. Local storage is not encrypted and is not an authorization boundary; server authentication, RLS and revision checks remain authoritative. Device storage clearing can erase pending recovery; do not clear it to resolve an error.

Restored changes are marked Needs attention, not Saved, and require explicit Retry. Reconciliation preserves the original baseline even if the crash happened before the first revision read. A known writer request may explain an uncertain committed outcome; unrelated server revisions remain conflicts. A failed delete may restore an Arrow for display, but its separate deletion intent is journaled as null so Retry cannot resurrect it.

Conflicts offer an explicit Review server versions action, bounded to 20 pending slots per review. It reads fresh scores and plots, asks before discarding device intentions, journals the choice, then uses the existing revision-checked writer to confirm those same values and fence older requests. Cancellation leaves recovery unchanged; a subsequent other-device revision fails closed. This is a user-authorized no-op scoring mutation, not a read-only inspection or permission bypass. No such production request was executed during this task.

This is recovery around the existing web queue, not a new background synchronization service. Existing jobs can finish while the document remains alive; closing the document relies on the journal and explicit retry after reopening. Browsers lacking Web Locks can continue guarded online-only scoring if no prior recovery record needs exclusive handling. They do not receive a false claim of durable recovery.

## Persistence ledger

| State | Authority and behavior |
| --- | --- |
| Counter tally, increment, Undo history | Existing device storage/model preserved. Web writes synchronously; native writes remain serialized. Failed storage has Retry and a guard. The Counter remains device-local, not account-backed cloud synchronization. |
| Web Arrow edits/coordinates/deletion | Existing server revision/RPC authority, plus account/project/Round-scoped pending recovery. Server-confirmed state alone is Saved. |
| Native Arrow edits | Existing offline journal and foreground scheduler retained. New Back guard waits for device durability, not cloud connectivity. |
| Session/Configure Round forms | Existing in-workspace form state retained; unsubmitted forms receive route/reload warnings. No automatic Session or Round creation and no new durable form-draft store. Explicitly discarding a warning can lose an unsubmitted draft. |
| Notes and Feedback | Existing explicit save/publish, draft guards and request identities preserved. Sign-out submission now participates in the dirty-state guard; normal editor submissions are unaffected. No auto-publishing. |

The web Counter guards unsettled increment previews and failed storage. Its in-workspace continuation is disabled while storage needs recovery. Neither a local tally nor a locally preserved Arrow is presented as a cloud-confirmed save.

## Android

No offline engine replacement or new native dependency. The existing owner/epoch-fenced journal, revision RPCs, serialized per-slot writes, storage integrity checks and background scheduling remain in use. A navigation guard waits for pending device writes and blocks failed durability; an unmount/account change suppresses late navigation.

Foreground revalidation keeps the same owner's loaded Round visible instead of replacing it with a spinner. It deduplicates overlapping loads and briefly disables editing during writer handoff; pending device writes settle first. Failure retains the visible recovery data and requires Retry before editing. Selected slot/latest-plot context is retained for the same Round, within current configuration bounds. New account/other Round data remains fenced by the existing authenticated screen scope.

Physical Android Back, app termination, BLE/hardware and browser Web Locks acceptance still need real-device testing. No new signed Android build or production deployment has been performed.

## Measurement and verification

`node --expose-gc --experimental-strip-types scripts/benchmark-navigation.mjs <baseline-commit>` compares the baseline and working-tree workspace handlers with identical synthetic data: two Sessions, with five Rounds/360 Arrows in the selected Session. It counts full router-refresh invocations and targeted progress notifications for 100 Back/reopen cycles. Handler time and Node heap deltas exclude HTTP, database latency, React DOM and physical devices; they are not user-navigation speed claims. The baseline source is loaded read-only from Git. Use an immutable pre-Phase-2 SHA for later comparisons.

`training-navigation.test.mjs` additionally exercises 100 Counter/Scoring switches, browser traversal, complete multi-Round visibility, Session switching and retained edits. Recovery tests cover lost responses, crash-before-read baselines, deletion, quota failures, account/project/configuration isolation and unsupported-lock fallback. Screen integration exercises actual handlers with mocked I/O. Training Plan tests verify targeted, authenticated refresh and lifecycle behavior. Native guard tests cover deferred durability, failure, duplicate Back and account/unmount cancellation.

Review source, full web/mobile/core tests, TypeScript, web lint, changed-native lint, architecture, migration consistency and production build before release. Full mobile lint has a separately recorded eight-error baseline in untouched files; do not suppress those rules. No hosted or device result should be inferred from the fixture tests.

Release remains separately authorized. The optional core recovery hooks and new read-only Server Action are additive; existing scoring HTTP/RPC payloads and supported Android backend contracts are unchanged. No coordinated database cutover is required. Validate a web preview and a separately signed Android development build before a production/mobile release.

## Verified local results

Final website suite: 727 passed, 0 failed, 0 skipped. Mobile: 564 passed, 0 failed, 0 skipped. Shared core: 128 passed, 0 failed, 0 skipped. Maintenance: 32 passed. All three TypeScript checks, full website lint, changed-native lint, Next.js 16.4.1 production build and Android JavaScript export passed. Disposable PostgreSQL: 532 assertions passed across the existing combined fixture categories, 0 failures, 38 migrations; owned cluster stopped and removed. Supabase Auth/roles are emulated there, not a hosted authorization test. Migration consistency retains 38 canonical migrations and seven documented aliases. No SQL was changed.

Full mobile lint retains eight existing errors in untouched recover.tsx, auth.tsx, session-category-tabs.tsx, session-weather.tsx and use-session-weather.ts. No rule was disabled. Real browser timing, authenticated browser acceptance, physical Android Back/process termination and signed native-build acceptance remain unverified.

One final synthetic 100-cycle sample: baseline 106.79 ms handler time, 100 router.refresh invocations and 43,976 bytes retained harness heap delta; working tree 26.66 ms, zero router.refresh invocations, 100 targeted progress notifications and 120,688 bytes heap delta. These single-run Node diagnostics do not establish a browser speedup, HTTP count, memory reduction or leak-free behavior. The retained sample increased; investigate browser heap over longer real usage during acceptance.

## Phase 2 file manifest

The following files were added or changed for Phase 2. sessions-workspace.tsx, recent-round-configs.test.mjs and session-category-tabs.test.mjs also retain earlier Phase 1 edits. Phase 1-only files are intentionally excluded from this manifest. Verification logs and exports remain ignored under .verification.

- `apps/mobile/app/(tabs)/counter.tsx`
- `apps/mobile/app/rounds/[roundId]/score.tsx`
- `apps/mobile/src/offline-scoring.ts`
- `apps/mobile/tests/counter-responsive.test.mjs`
- `apps/mobile/tests/native-target-gestures.test.mjs`
- `packages/core/src/arrow-persistence.ts`
- `src/app/(platform)/sessions/page.tsx`
- `src/components/layout/navigation.tsx`
- `src/features/arrow-counter/components/arrow-counter.tsx`
- `src/features/auth/components/sign-out-button.tsx`
- `src/features/notes-feedback/draft-guard.ts`
- `src/features/sessions/components/scoring-workspace.tsx`
- `src/features/sessions/components/sessions-workspace.tsx`
- `src/features/sessions/read.server.ts`
- `src/features/sessions/web-arrow-queue.ts`
- `tests/counter-reliability.test.mjs`
- `tests/health.test.mjs`
- `tests/helpers/session-layout-runtime.mjs`
- `tests/notes-feedback-web.test.mjs`
- `tests/recent-round-configs.test.mjs`
- `tests/scoring-replot.test.mjs`
- `tests/scoring-training-plan-visibility.test.mjs`
- `tests/session-category-tabs.test.mjs`
- `tests/training-plans-ui.test.mjs`
- `apps/mobile/src/device-save-navigation-guard.tsx`
- `apps/mobile/tests/device-save-navigation.test.mjs`
- `docs/navigation-autosave-phase2.md`
- `scripts/benchmark-navigation.mjs`
- `src/app/api/sessions/[sessionId]/route.ts`
- `src/features/organizations/components/athlete-plan-progress.tsx`
- `src/features/organizations/training-plan-events.ts`
- `src/features/organizations/training-plan-progress-actions.ts`
- `src/features/sessions/device-scoring.ts`
- `src/features/sessions/session-snapshot.ts`
- `src/features/sessions/training-navigation.ts`
- `tests/device-scoring-recovery.test.mjs`
- `tests/helpers/training-navigation-runtime.mjs`
- `tests/session-revalidation.test.mjs`
- `tests/training-navigation.test.mjs`
- `tests/training-plan-progress-refresh.test.mjs`
