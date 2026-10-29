# Android offline scoring

Local implementation against `86ab1ce3c50ddfd5bfff3ba402e5d871519ca915`.
No production writes, migration application, commits, releases or dependency
changes are part of this work.

## Existing persistence and release dependency

Native scoring previously kept per-slot ordering in `arrow-save-queue.ts` and
used the shared revision-aware Arrow writer. That protects in-process retries,
but neither its queue nor its confirmed/unknown state survives process death.
Offline scoring adds a native durable journal around the same owned RPC contract;
the shared calculations, target geometry, web writer and Live Coaching server
publication remain unchanged.

Before a native release, independently confirm the existing scoring-integrity
migration is installed in the intended environment:

`20261029014758_scoring_integrity.sql`

SHA-256: `E9D8E9E699B392D2F0CE2E5544C6F9D0E9591D822E59552B2E2DCF81DA916FB0`.

It supplies `read_owned_arrow_slot` / `write_owned_arrow_slot`, revision tombstones
and idempotent request checks under the owned Round lock. This task neither changes
that file nor verifies/applies it to production. Missing RPCs fail closed; there
is no fallback to blind saves/deletes. The separate Garmin fairness migration
also remains untouched.

## Storage and preparation

The existing AsyncStorage dependency holds one versioned journal per Supabase
project, owner UUID and Round ID. It stores only:

* The selected Session's basic metadata and selected Round configuration.
* Existing server End IDs and verified per-slot Arrow/revision snapshots.
* Ordered save/edit/delete intentions with stable UUID request identities.
* Explicit conflict-review records retaining both device intentions and the
  reviewed server snapshot.

No credential, token, password, Garmin Health payload or other athlete's data is
copied into the journal. Credential storage and its SecureStore patch are unchanged.
AsyncStorage is app-private storage, not encrypted scoring storage; its isolation
does not protect a compromised/rooted device or establish Android backup policy.

The first online opening prepares all slots with at most four read RPCs outstanding
and reports progress. It checks Round configuration and End identity again before
committing the prepared journal. Offline editing requires this preparation; an
uncached Round cannot be created or assigned server IDs offline. Subsequent idle
refreshes reuse unchanged slot snapshots rather than rereading every revision.
Pending edits prevent an idle refresh replacing their baselines/configuration.

Each local mutation is serialized into the journal before acknowledgment or
transmission. Native write acknowledgment is followed by exact read-back; a lost
native acknowledgment can be reconciled by reading the intended bytes. A small
non-cryptographic checksum detects accidental corruption, including parseable
changes. It is not an authorization mechanism or protection against deliberate
local tampering. Unsupported versions or corrupt content are retained and blocked,
never reset automatically.

There is a conservative 900,000-byte encoded budget estimate per journal to stay
below common Android per-entry read limits. Oversized Rounds/history fail explicitly
instead of being partially prepared or silently truncated. Total device storage
can still fill. Archived conflict choices are not automatically pruned.

## Synchronization and conflict rules

1. A device save records an immutable request UUID and desired Arrow or deletion.
   It is displayed as device-pending, never server-saved.
2. Before upload, the expected revision is persisted. The worker reads the current
   slot. Its own completed request is acknowledged without a duplicate write;
   an unchanged baseline permits the same immutable request to be sent.
3. Any other revision becomes an explicit conflict. Matching score values alone
   do not authorize overwriting another device's revision.
4. An acknowledgment updates the baseline and removes only that operation from
   the durable queue. Later intentions retain their order. Deletion is a queued
   mutation, not removal of a local row that loses its server identity.
5. Conflicts block only their slot. Other slots can progress. The coach receives
   existing authoritative database scoring updates, not local provisional values.

One Round pass processes at most 32 operations in order. The selected scoring screen
retries every 15 seconds in the foreground; local edits do not await network I/O.
A separate app foreground scheduler scans at most five owned journal entries per
pass, rotates through history, and processes one other Round at a time. It skips
the Round already owned by an active scoring screen. Timers stop on backgrounding
and account/screen retirement; RPCs have a 12-second request timeout. An already
issued request cannot be undone, so its durable identity remains available for
reconciliation after restart. There is no OS background service or upload while
the application is terminated.

Conflict cards show device/server scores, deletions and normalized target positions.
The user explicitly chooses **Use server version** or **Keep device version**.
The server state is reread before either choice. A second correction requires
review again. A changed Round/target configuration blocks rebasing and retains the
device data for recovery rather than applying old shots to a different target.
Keeping the device version uses a new request against the reviewed
revision; it can conflict again rather than silently overwriting newer data.
Both versions remain in the device review history. Resolving conflicts requires
normal verified sign-in and connectivity.

## Restart, account boundaries and device-only access

Sessions includes **Saved Rounds on this device**, independently of the online
Sessions list. It opens the existing native scoring screen directly. Lists refresh
on return and app resume and only read this owner's scoring namespace.

The normal authentication startup guard still verifies identity online. When that
verification is pending/unavailable, a separate device-only view may use an already
accepted, normal-purpose SecureStore authority record to open prepared Rounds.
It does not create a fabricated authenticated user, mount protected app routes,
make RPCs, alter configuration, or unlock recovery-purpose/signed-out accounts.
Normal authentication must succeed before automatic uploads resume.

Every journal/writer is bound to the accepted account and authentication epoch.
Sign-out or account switching retires it; a new account cannot list/read/upload
the old account's data. Signing back into the original account can recover its
durable journal. Journals are retained on sign-out to avoid deleting pending scores.
Explicit logout removes device-only access until the account is accepted again.

## Failed native storage is different from an offline network

While a save is being written, UI says **Saving on device**. Only read-back-confirmed
changes say **Saved on device**. Network failures preserve the journal and show
waiting; authorization/contract rejection shows a failure with retry guidance.

If native storage fails, the latest failed intentions remain visible in memory,
including across screen reopening in the same process. Other upload acknowledgments
cannot erase them. **Retry device save** / **Retry sync** rechecks disk and retries
the exact retained intentions. The screen warns to keep the app open. These failed,
unacknowledged local writes cannot be promised to survive process death, uninstall,
app-data clearing or device loss. Do not log out or switch accounts until a failed
device save has been retried successfully. Never represent it as durable.

## Files in this increment

* `apps/mobile/src/offline-scoring-store.ts`: journal validation, corruption checks,
  serialized local commits, revisions, retries and explicit conflict handling.
* `apps/mobile/src/offline-scoring.ts`: AsyncStorage/RPC adapters, owner/epoch
  isolation, reference-counted shared journals and foreground scheduling.
* `apps/mobile/src/offline-scoring-access.ts`: narrow device-only capability check.
* `apps/mobile/src/offline-rounds.tsx`: cached Round discovery/recovery UI.
* `apps/mobile/src/arrow-writes.ts`: bounded revision snapshot RPC adapters.
* `apps/mobile/app/rounds/[roundId]/score.tsx`: existing scoring interface plus
  device/sync states, conflict review, lifecycle cleanup and configuration guards.
* `apps/mobile/app/(tabs)/sessions.tsx`: entry point for prepared device Rounds.
* `apps/mobile/app/_layout.tsx`: foreground recovery scheduler and isolated
  device-only startup fallback; authenticated route guards remain in place.
* `apps/mobile/tests/offline-scoring.test.mjs` and
  `apps/mobile/tests/offline-scoring-adapter.test.mjs`: deterministic journal,
  transport, storage, lifecycle and authorization regression cases.
* `apps/mobile/tests/helpers/offline-scoring.mjs`: real journal with synthetic I/O
  for existing scoring/gesture component harnesses.
* `apps/mobile/tests/auth-routing.test.mjs`, `apps/mobile/tests/helpers/auth-runtime.mjs`,
  `apps/mobile/tests/native-target-gestures.test.mjs`, `tests/scoring-replot.test.mjs`,
  `tests/session-category-tabs.test.mjs`: integration assertions and updated harness
  dependencies. Website runtime source is unchanged.

## Physical Android acceptance checklist

Use a compatible installed binary with the existing SecureStore native patch;
Expo Go and Metro-only execution do not establish production behavior.

1. Online, open a real owned Round and wait for offline preparation to finish.
2. Enable airplane mode. Record scores/coordinates, correct an Arrow, clear a plot
   and delete both a previously synchronized and a newly device-recorded Arrow.
3. After **Saved on device**, force-stop the app and restart the phone. Reopen from
   device Rounds while offline; verify every score, coordinate and deletion.
4. Restore connectivity and verify sign-in. Confirm upload without manual entry,
   confirmed scoring on the website/coach and no duplicates.
5. Lose connectivity during upload; separately simulate a committed write with
   lost acknowledgment. Confirm recovery with the same request identity.
6. Edit the same slot on another device. Inspect the conflict, including equal-score
   coordinate changes; test both choices and a second correction before choosing.
7. Background/unmount during upload; switch accounts and log out/back into the
   original account. Verify isolation, no stale UI and eventual reconciliation.
8. Test expired/revoked authentication, server-deleted Round, storage exhaustion,
   unsupported/corrupt cache and upgrade with a pending journal. Do not clear app
   data containing unsynchronized records as a test shortcut.
9. Check 320/390px layouts, both themes, accessibility announcements and large
   Round preparation/budget failures on actual hardware.

Native crash durability, reboot behavior, backup/restore and physical-device UI
remain unverified until this checklist is exercised. Local synthetic fixtures do
not establish any of those results.

## Local verification on 2026-10-29

* Full mobile suite: 559 passed, zero failed.
* Website suite: 688 passed, zero failed.
* Shared-core suite: 123 passed, zero failed.
* Focused offline/scoring/gesture suite: 62 passed (overlapping the full suites).
* Web, mobile and core TypeScript: passed.
* Website/root ESLint and changed-file mobile ESLint: passed. Full mobile ESLint
  still reports eight existing errors in untouched recovery/auth/category/weather
  files; no rule was disabled.
* Next.js 16.4.1 production build and Android Hermes export: passed.
* Architecture: 342 source files passed. Migration consistency: 37 canonical
  files and seven historical aliases passed. `git diff --check`: passed.
* Disposable PostgreSQL: 532 assertions passed, including 32 scoring-integrity
  checks. An earlier broad run failed the unchanged hourly-budget concurrency
  assertion; the isolated rerun passed without modifying SQL or the test. The
  cause of that first failure was not established. No production fixtures ran.
* Expo Doctor: 19/20. Current metadata expects React Native 0.88.1; installed and
  locked React Native remains 0.88.0, Expo 58.0.21, SecureStore 58.0.2. Review that
  compatibility warning before an Android release; no dependency was upgraded
  and the native SecureStore patch remains intact.

The database fixtures emulate Auth roles and do not verify real JWT/PostgREST,
hosted Realtime or physical Android storage. Runtime code and database contracts
are implemented locally, not activated or published by these checks.
