# Live Coaching Phase 1 verification - 26 October 2026

## Result

Local functionality verified. Production release remains conditional on an
authorized hosted non-production Supabase Auth/Realtime and Vercel bridge test.
The three baseline failures were resolved in test fixtures as described below.
Nothing was committed,
pushed, deployed or applied to production during this task.

## Fresh checks

| Check | Result |
| --- | --- |
| Live Coaching application tests | 18 passed, 0 failed |
| Full website suite | 577 tests: 577 passed, 0 failed |
| Disposable PostgreSQL | 209 assertions: 36 Live Coaching, 143 existing SQL, 30 concurrency/harness; 0 failed |
| TypeScript | Passed |
| Repository ESLint | Passed; new lifecycle test also linted separately |
| Next.js production build | Passed on 16.4.1 |
| Migration consistency | 28 canonical migrations; 7 historical aliases preserved |
| git diff --check | Passed; existing LF/CRLF conversion notices only |

The previous baseline export reproduced three failures (15 tests: 12 passed,
3 failed). This follow-up traced and resolved each without production changes:

- Garmin: the test retained the old 1 MiB limit. Both Cloudflare's Worker and
  the shared Vercel receiver enforce 4 MiB, explicitly documented for Starter
  Activity Details Push. The fixture now rejects declared and streamed
  4 MiB + 1-byte requests before staging, and a new test accepts valid JSON at
  exactly 4 MiB. No actual size-limit bypass was established by the old failure;
  no receiver limit or security gate was changed.
- Homepage: load the actual HealthPerformanceShowcase with its declared React,
  Link and Icon dependencies in the SEO fixture. Homepage source is unchanged.
- Session categories: declare the missing GarminSessionHealth component mock
  in the isolated navigation/draft fixture. Session source is unchanged.

The affected suite now passes 16/16 tests. Full website tests include the existing
Cloudflare ingress and scoring regressions. Fresh SQL verification again passes
209 assertions and stops/removes its owned disposable database cluster.

Evidence files (ignored): `.verification/live-coaching-website-tests.txt`,
`live-coaching-focused-ui.txt`, `live-coaching-sql-results.txt`,
`live-coaching-baseline-tests.txt`, `live-coaching-typecheck.txt`,
`live-coaching-lint.txt`, and `live-coaching-build.txt`.
Follow-up evidence: `.verification/live-coaching-hosted-website-tests.txt`,
`live-coaching-baseline-fixed.txt`, `live-coaching-hosted-sql.txt`,
`live-coaching-hosted-typecheck.txt`, `live-coaching-hosted-lint.txt`, and
`live-coaching-hosted-build.txt`.

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

Follow-up inventory confirmed the same single project and default main branch.
The existing organization is on Free. The connector quotes a separate project
at $0/month and a preview branch at $0.01344/hour; these are creation quotes,
not guarantees against future usage/plan costs. The user explicitly chose
"Do not create infrastructure; finish local checks." No new project/branch,
hosted test identities, migrations or Vercel preview were created. Local checks
are complete. Hosted Supabase WebSocket and Vercel EventSource verification
remain unperformed and are retained as a separate production release gate.

Official Realtime documentation confirms that Broadcast channel authorization
is cached until reconnect/new JWT, rather than checked per message:
https://supabase.com/docs/guides/realtime/authorization
The implementation therefore checks recipients on emission and authorizes every
fresh score read, independently of the cached subscription. Previously queued
empty invalidations can still arrive; they cannot supply scores or authorize a
read. Hosted cached-authorization behavior, JWT renewal and logout remain test
requirements. A stream captures its opening request's cookie/token, so the
15-second membership check is not proof of immediate cross-tab logout detection;
the stream is bounded to 55 seconds and new requests must authenticate again.
Do not claim an immediate global JWT revocation guarantee from this mechanism.

Before a separately authorized production migration/deployment, verify actual
private Broadcast delivery with real test Auth identities, combined existing
Realtime policies, cookie/logout/account transitions, revoked membership,
cross-organisation denial, reconnect, and stream resource/plan limits. Preserve
the existing 55-second stream lifetime, 15-second authorization check and
coalesced authoritative reads. A revoked browser's previously received data
cannot be retroactively erased; future reads are denied and the stream closes
on reauthorization. No live HR or Garmin Health sharing is included.
