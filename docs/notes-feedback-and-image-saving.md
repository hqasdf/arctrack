# Session Notes, Coach Feedback and image saving

Local implementation prepared on 22 October 2026. The initial migration is applied to Supabase; the Session-only cleanup is a separate forward migration. No website deployment or native release was made.

## Session-only simplification

Standalone General Feedback has been removed from current web/Expo types, composers
and APIs. The forward migration `20261022100526_remove_general_coach_feedback.sql`
restricts database kind to `session`, rejects legacy general RPC requests and requires
an owned Session for new creation. Existing `session_id = NULL` history remains valid.
Production cleanup is applied: exactly one approved obsolete feedback entry and
its one linked request were deleted. The existing Session Note and Session Feedback
counts remained one each; RLS/grants and unrelated schema fingerprints are unchanged.
The applied predecessor is immutable. RPC signatures retain a session-only compatibility
argument so there is no unguarded obsolete overload.

## Data and authorization

Migration: `supabase/migrations/20261022022012_session_notes_shared_coach_feedback.sql`.

- `session_notes`: one optional plain-text document per Session. Ownership comes
  from `sessions.user_id`; the owner writes, and existing currently authorized
  Head Coaches can read. Coaches cannot write the athlete's note.
- `coach_feedback`: multiple Session-specific entries. The recipient
  can read. Only the original author with an active Head Coach relationship to
  an active Archer in the entry's exact organisation can read/edit/delete as a
  coach. Other coaches, including same-organisation Head Coaches, cannot read.
- Client table access is SELECT only. Mutations use guarded RPCs with server-derived
  identity, immutable context, explicit EXECUTE grants, privileged implementations
  in `private`, empty search paths and qualified database references.
- Bodies contain 1-4,000 Unicode code points after trimming. Notes permit up to
  eight unique technique tags, each 1-40 code points. Text is rendered as text.
- Updates/deletes require the last persisted `updated_at`; SQLSTATE `40001`
  prevents silent stale overwrites. A null expected version creates only.
- Note creation locks the parent Session. Feedback writes lock the exact coach
  and athlete memberships to serialize authorization revocation against writes.
- New feedback requires a stable creation-request UUID. A private request ledger
  stores a SHA-256 digest of the original normalized body and full context, never
  the feedback text. It has a UUID primary key, unique feedback reference, and no
  client privileges. A request-scoped transaction lock serializes simultaneous
  submissions; current authorization, author and original payload are verified on
  every replay before returning the existing ID. Conflicting requests fail safely.
- Deleting feedback leaves only its private request tombstone, preventing delayed
  requests from recreating a deleted entry. Athlete-account deletion cascades this
  operational metadata; coach-account deletion clears its author reference. A retry
  of the original payload remains valid after the retained feedback's Session FK
  is cleared, while edits still use the normal optimistic revision.
- New feedback creation is limited to 10 entries per fixed UTC minute and 100 per
  fixed UTC hour per authenticated coach, shared across organisations and athletes.
  This permits normal human-written feedback while bounding automated bursts.
  Replays and edits are not charged. A private, atomically updated budget table
  follows the existing operation-budget convention without changing that helper,
  its supported operations, Session limits or Training Plan limits. Exhaustion
  returns: "Too many feedback entries. Try again shortly."
- The scoped feedback reader supplies author display names without widening the
  existing profile SELECT policy. History uses keyset pagination, 25 rows at a time.

Public RPCs: `save_session_notes`, `delete_session_notes`, `save_coach_feedback`,
`delete_coach_feedback`, `read_coach_feedback`. Session Notes use a normal RLS SELECT.
No service-role client is introduced in the website or mobile feature.
`save_coach_feedback` appends `p_creation_request_id uuid default null` after
`p_expected_updated_at`: new creates require it; existing edit calls remain valid.
The private additions are `coach_feedback_creation_requests`,
`coach_feedback_creation_budgets`, the digest/context guard and creation-budget helper.

## Retention

| Event | Result |
| --- | --- |
| Athlete or coach leaves | Athlete keeps feedback; coach access requires a current exact-organisation relationship |
| Session deleted | Session Notes cascade; feedback Session FK becomes null and its kind remains `session` |
| Organisation deleted | Feedback organisation FK becomes null; athlete keeps the entry |
| Athlete account deleted | Addressed feedback cascades; Session Notes cascade through owned Sessions |
| Coach account deleted | Author FK becomes null; recipient keeps feedback with a Former coach label |
| Authorized author deletes entry | Only that entry is removed, including from the recipient's history |

No additional retention period is introduced. Privacy and public deletion guidance
describe these rules. The initial migration was additive. The new forward migration restricts feedback to Session entries.

## Interfaces and lifecycle

Web and mobile integrate notes and Session feedback in athlete Session details and
Coach Session Review. Only an authorised scoring Session can receive new feedback.
Coach Athlete Details and athlete Sessions retain expandable Session Feedback history,
including deleted-Session entries, with no standalone creation control.

Editors are scoped to account/Session/organisation, suppress stale responses,
prevent duplicate saves, retain failed drafts, confirm deletion and protect dirty
navigation. Mobile refreshes on focus without replacing dirty drafts. Conflicts
require an explicit reload/review before retrying. Missing database support is
reported as unavailable, never as a successful save.

Creation retry identities and their submitted payload survive failed/uncertain
responses and focus refreshes in the mounted editor. Web provides an explicit
original-submission retry and a confirmed new-entry action. Expo rejects changed
payload reuse and offers explicit cancellation before starting another entry.
Both preserve drafts. Success clears the request identity; a genuinely new entry
gets a fresh key. Full reload/process termination does not persist an unsaved draft
or request ID, and no automatic retry occurs on restart or navigation.

UUID formatting is shared in core. The website supplies Web Crypto random bytes;
Expo uses the already installed Expo Core native UUID v4 binding (Java UUID on
Android, Foundation UUID on iOS). Missing secure generation fails visibly. No
Math.random fallback, dependency addition or new native module is used by this fix.

## PNG saving

The existing web renderer/download implementation and shared report calculations
remain unchanged. Mobile retains the same report renderer, dimensions and PNG
capture, adding separate Save to Device and Share Image actions.

`expo-media-library` is pinned to SDK-compatible `~57.0.5` in the mobile package
and root lockfile. Android API 30+ uses `Asset.create(fileUri)` for app-owned
MediaStore insertion without media-read permission. Earlier Android requests only
WRITE_EXTERNAL_STORAGE, capped at API 29 by `with-save-only-media.cjs`; Android 10's
legacy creation path retains requestLegacyExternalStorage. Modern Android ignores
that flag and uses scoped storage.

iOS uses the SDK's legacy add-only `saveToLibraryAsync` path deliberately: the newer
Asset.create implementation fetches the created PHAsset, while add-only saving
does not need library reads. Configuration supplies NSPhotoLibraryAddUsageDescription
without full photo-read usage. Modern Android photo/video/audio read and media-location
permissions are blocked. No permission request is made merely to Share Image.

Media imports are lazy so a missing native module does not prevent opening the
export preview or sharing. Success is shown only after the save call resolves.
The existing native app needs a new build for the library/configuration; no such
build was made in this task.

## Earlier implementation validation (before Session-only cleanup)

- Full mobile suite: **485 passed, 0 failed**.
- Full website/root suite: **248 passed, 0 failed**.
- Shared core suite: **106 passed, 0 failed**.
- SQL: **142 assertions passed, 0 failed**, complete 17-migration chain applied
  unchanged to disposable PostgreSQL 18.6 through PGlite 0.5.11; fixture rollback verified.
  The runner also confirms the existing operation-budget function and operation
  constraint are unchanged. New cases cover request replay/misuse, tombstones,
  original payload after editing or Session deletion, isolated budgets and resets.
- Native PostgreSQL **17.6**, matching production's major/minor: all 17 migrations,
  **142 SQL assertions and 24 concurrency/harness assertions passed**, 0 failed.
  Eight independent connections using one key returned one ID, produced one row
  and charged once. Twenty parallel distinct-key requests with one prior creation
  accepted nine and safely rejected eleven (ten total). Five parallel requests
  with one remaining hourly allowance accepted one and rejected four; count stayed
  at 100. Exhausted-budget replay, coach isolation, cross-author collision and
  post-revocation retry passed. The owned loopback test cluster was stopped and
  its data removed. Test budget windows were pinned in disposable fixtures to
  avoid time-boundary flakiness; ordinary window reset tests are in the SQL fixture.
  Hosted-style broad default grants were exercised. The native runner checks the
  actual server data directory and loopback bind before applying any test SQL.
- Website, mobile and core TypeScript checks passed.
- Repository lint and explicit changed mobile-source/test/plugin lint passed.
- Full mobile lint retains **10 pre-existing errors, 0 warnings** in untouched
  recover, score, auth, session-category-tabs, session-weather and use-session-weather files.
- Next.js production build passed. Android and iOS Expo JavaScript/Hermes exports passed.
- Real web/mobile report SVGs were rasterized to PNG and decoded for full-face,
  six-ring and triple-face reports, including long End summaries and unchanged data.
- Expo config introspection checked narrow native save permissions. Component
  harnesses exercised capture, save/share separation, denial, duplicate presses,
  failed writes, missing modules and delayed success confirmation.

SQL uses real PostgreSQL roles/RLS with a minimal Supabase Auth schema/auth.uid()
shim. It does not validate GoTrue, JWT verification or PostgREST. PGlite is single
connection; the separate native PostgreSQL runner tests independent concurrent
connections. UI/action tests use mocks; they do not prove deployed cross-device
behavior. No browser download, interactive visual QA or physical Photos/Gallery
save was performed. No production data was used for testing.

To rerun the disposable SQL test without using project credentials:

```powershell
npm install --prefix "$env:TEMP\arctrack-notes-db-runtime" @electric-sql/pglite@0.5.11 --ignore-scripts --no-audit --no-fund
$env:PGLITE_MODULE = "$env:TEMP\arctrack-notes-db-runtime\node_modules\@electric-sql\pglite"
node scripts/test-notes-feedback-sql.mjs
```

The runner ignores database connection URLs and .env files and uses an in-memory
database. The maintained SQL fixture is enclosed in BEGIN / ROLLBACK.

For native PostgreSQL concurrency checks, separately provision portable PostgreSQL
17 binaries and the Node `pg` driver outside the application, then run:

```powershell
$env:PG_BIN = '<absolute portable PostgreSQL bin directory>'
$env:PG_DRIVER_MODULE = '<absolute separately installed pg package directory>'
node scripts/test-notes-feedback-pg.mjs
```

This runner accepts no connection URL or command-line arguments and ignores project
.env files. It creates its own temporary cluster, listens only on 127.0.0.1 on a
free port, uses isolated synthetic users, and removes its owned data after stopping.
It does not connect to an existing server or install tooling. This run used the
portable `@embedded-postgres/windows-x64@17.6.0-beta.15` package and `pg@8.16.3`
downloaded into OS temporary tooling; no application dependency/lockfile changed
for these corrections.

## Before release (initial migration is already applied)

1. Both the original migration and Session-only forward cleanup are applied. Do not
   reapply them or repair the seven historical migration ID mismatches.
2. Validate notes/feedback using separate owner, author coach, non-author coach
   and unrelated accounts in a safe Supabase environment, including re-login,
   refresh, conflicts, leaving and cross-device updates.
3. Review/deploy the website separately, then exercise actual browser PNG downloads
   and responsive Light/Dark/System editors and unsaved-navigation prompts.
4. Approve a new native build through the existing signing workflow; do not rely
   on the currently installed binary for the new Photos/Gallery module.
5. Test real Android/iOS saving, image presence, permission denial/permanent denial,
   disk failure, Share Image, and long PNGs. Keep scoring and passkey regression QA.
6. Resolve or explicitly accept the existing mobile lint findings separately before
   any release decision. Publishing remains a separate approval.

## Retry and budget correction scope

The audit correction changes only these files from the preceding implementation:

- `supabase/migrations/20261022022012_session_notes_shared_coach_feedback.sql`
- `supabase/tests/session-notes-coach-feedback.sql`
- `scripts/test-notes-feedback-sql.mjs`
- `scripts/test-notes-feedback-pg.mjs` (new maintained native test runner)
- `packages/core/src/notes-feedback.ts`
- `packages/core/tests/notes-feedback.test.mjs`
- `src/features/notes-feedback/actions.ts`
- `src/features/notes-feedback/coach-feedback-panel.tsx`
- `tests/notes-feedback-actions.test.mjs`
- `tests/notes-feedback-web.test.mjs`
- `apps/mobile/src/notes-feedback.ts`
- `apps/mobile/src/notes-feedback-ui.tsx`
- `apps/mobile/tests/notes-feedback.test.mjs`
- `docs/notes-feedback-and-image-saving.md`

The 28 other pre-existing changed files were hash-checked and remain unchanged.
Previously applied migration files, application dependencies/lockfile, native
configuration, passkeys, SecureStore authority, Digital Asset Links, Health and
scoring are not modified by these corrections.

## Exact changed-file manifest

No files were deleted.

### Created

- `apps/mobile/plugins/with-save-only-media.cjs`
- `apps/mobile/src/grouping-image-save.ts`
- `apps/mobile/src/notes-feedback-ui.tsx`
- `apps/mobile/src/notes-feedback.ts`
- `apps/mobile/tests/grouping-image-save.test.mjs`
- `apps/mobile/tests/notes-feedback.test.mjs`
- `docs/notes-feedback-and-image-saving.md`
- `packages/core/src/notes-feedback.ts`
- `packages/core/tests/notes-feedback.test.mjs`
- `scripts/test-notes-feedback-sql.mjs`
- `scripts/test-notes-feedback-pg.mjs`
- `src/features/notes-feedback/actions.ts`
- `src/features/notes-feedback/coach-feedback-panel.tsx`
- `src/features/notes-feedback/draft-guard.ts`
- `src/features/notes-feedback/notes-feedback.module.css`
- `src/features/notes-feedback/session-notes-panel.tsx`
- `src/features/notes-feedback/types.ts`
- `supabase/migrations/20261022022012_session_notes_shared_coach_feedback.sql`
- `supabase/tests/session-notes-coach-feedback.sql`
- `tests/grouping-png.test.mjs`
- `tests/notes-feedback-actions.test.mjs`
- `tests/notes-feedback-web.test.mjs`

### Modified

- `apps/mobile/app.json`
- `apps/mobile/app/(tabs)/organization/[organizationId]/athletes/[userId].tsx`
- `apps/mobile/app/(tabs)/organization/[organizationId]/athletes/[userId]/sessions/[sessionId].tsx`
- `apps/mobile/app/(tabs)/sessions.tsx`
- `apps/mobile/app/sessions/[sessionId].tsx`
- `apps/mobile/package.json`
- `apps/mobile/src/grouping-export.tsx`
- `apps/mobile/tests/grouping-export.test.mjs`
- `package-lock.json`
- `packages/core/package.json`
- `src/app/(platform)/organization/[organizationId]/athletes/[userId]/page.tsx`
- `src/app/(platform)/organization/[organizationId]/athletes/[userId]/sessions/[sessionId]/page.tsx`
- `src/app/(platform)/sessions/page.tsx`
- `src/app/delete-account/page.tsx`
- `src/app/privacy/page.tsx`
- `src/features/organizations/components/coach-athlete-detail.tsx`
- `src/features/sessions/components/sessions-workspace.tsx`
- `tests/privacy-policy.test.mjs`
- `tests/scoring-training-plan-visibility.test.mjs`
- `tests/session-category-tabs.test.mjs`

## Session-only removal validation, 22 October 2026

- Web 249/249, Expo 486/486, core 107/107 tests passed.
- PostgreSQL 17.6: 18 migrations, 143 rollback fixture assertions and 30 independent
  concurrency/cleanup assertions passed. PGlite: 143 assertions passed.
- Cleanup proof rejects a second unexpected obsolete row and preserves both rows
  on rollback, then removes only the approved obsolete entry/request while retaining
  synthetic Session Feedback and Session Notes. Owned test cluster was removed.
- Root/mobile TypeScript, root lint, changed-mobile-file lint and Next build passed.
  Full mobile lint retains 10 pre-existing errors, 0 warnings in unrelated files.
- Production migration 20261022100526 applied atomically; exactly one history entry.
  SHA-256: 93313F630D464B8EA2DE509532E5235B354F14BAF0514FCEC6EEA39565F813AC.
  Previous 17 history rows are unchanged. All 18 function bodies match the expected
  original definitions plus the three reviewed replacements. No live fixtures run.
- Web/Expo changes are local and need separately approved releases. No native,
  browser-interaction or cross-device end-to-end validation is claimed here.
