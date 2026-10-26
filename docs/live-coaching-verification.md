# Live Coaching Phase 1 verification - 26 October 2026

## Result

Local functionality verified. Production release remains conditional on an
authorized hosted non-production Supabase Auth/Realtime test and review of the
three independently reproduced baseline website failures. Nothing was committed,
pushed, deployed or applied to production during this task.

## Fresh checks

| Check | Result |
| --- | --- |
| Live Coaching application tests | 18 passed, 0 failed |
| Full website suite | 576 tests: 573 passed, 3 failed |
| Disposable PostgreSQL | 209 assertions: 36 Live Coaching, 143 existing SQL, 30 concurrency/harness; 0 failed |
| TypeScript | Passed |
| Repository ESLint | Passed; new lifecycle test also linted separately |
| Next.js production build | Passed on 16.4.1 |
| Migration consistency | 28 canonical migrations; 7 historical aliases preserved |
| git diff --check | Passed; existing LF/CRLF conversion notices only |

The baseline export of unchanged HEAD reproduced all three remaining failures:
15 tests, 12 passed, 3 failed. The homepage and Session-category failures are
missing fixture dependencies; the Garmin private-webhook byte-limit assertion
expects 413 and gets 200. Its pre-existence is established; this verification
does not establish that its underlying production behavior is harmless.
Unrelated production code was not changed to silence these failures.

Evidence files (ignored): `.verification/live-coaching-website-tests.txt`,
`live-coaching-focused-ui.txt`, `live-coaching-sql-results.txt`,
`live-coaching-baseline-tests.txt`, `live-coaching-typecheck.txt`,
`live-coaching-lint.txt`, and `live-coaching-build.txt`.

## Actual local browser workflow

Repeated creation, waiting room, two invitations, decline then acceptance,
owned Session links and start. Used the existing ScoringWorkspace and guarded
arrow RPCs. Deleting one saved arrow from each athlete made both ends provisional
on the coach view without refreshing. Saving the empty slots restored confirmed
scores 28 and 30. Correcting the first athlete's eight to nine produced 29,
without double-counting. Navigating the coach away, correcting back to eight,
and returning through browser history recovered 28 automatically. Reload and
terminal review state preserved authoritative saved data.

Inline completion opens a confirmation panel; Keep training open dismisses it
without mutation. Keyboard Enter opens the panel. Confirm completion and
Confirm cancellation persist the correct terminal states and close the UI
stream. SQL verifies terminal sessions no longer emit scoring invalidations,
while original scoring remains editable. Replacement of an owned scoring link,
leave, Session deletion, revocation, concurrent scoring, and anonymous/direct
write denial are covered by disposable SQL assertions.

Desktop, 768 px, 390 px and 320 px browsing contexts were checked in light/dark
combinations. The narrow contexts were real-width iframes because the browser
viewport override was ineffective. DOM width measurements showed no horizontal
overflow. Earlier screenshots are under `.verification/live-coaching-preview/`;
final screenshot recapture timed out, so those captures are not presented as
fresh images of the terminal-state change. Full screen-reader, physical-phone
and all production layout interactions are not claimed.

## Database and privacy

Pending local migration: `20261026142604_live_coaching.sql`.
SHA-256: `0AF1D72AC31666E82AEF67465C77ED7D2B8DFEB6CBA587C4F085E121F7E90DFA`.

Two new RLS-enabled tables contain team lifecycle, invitations and explicit
scoring links. Ordinary clients cannot directly write either table; checked RPCs
use current organisation membership, ownership, lifecycle versions and locks.
Scoring observer triggers preserve existing scoring RPCs and formulas. Broadcast
payloads contain no scores, tokens or Health data. No Garmin functionality,
mobile code, production secrets or existing canonical migrations changed.

## Hosted Realtime release gate

The available Supabase branch inventory showed only production main; no
authorized non-production hosted environment was available. No hosted WebSocket
delivery was attempted against production. The local demo uses transactional
PostgreSQL NOTIFY to emulate the transport; the database assertions emulate
Auth roles and realtime.messages. Neither proves hosted broker JWT validation,
PostgREST behavior or Vercel stream operation.

Before a separately authorized production migration/deployment, verify actual
private Broadcast delivery with real test Auth identities, combined existing
Realtime policies, cookie/logout/account transitions, revoked membership,
cross-organisation denial, reconnect, and stream resource/plan limits. Preserve
the existing 55-second stream lifetime, 15-second authorization check and
coalesced authoritative reads. A revoked browser's previously received data
cannot be retroactively erased; future reads are denied and the stream closes
on reauthorization. No live HR or Garmin Health sharing is included.
