# Live Coaching Phase 1 (local implementation)

Current local Phase 2 monitoring implementation: see `live-coaching-monitoring.md`
for the dashboard, separate timeline consent, bounded history, presence and review.
Phase 1 production status remains documented separately; Phase 2 is not deployed.

## Architecture and boundaries

Two new tables hold team lifecycle and invitations/explicit athlete Session links.
There is no second arrow/end database. Existing `save_owned_arrow` and scoring
components stay unchanged; scores persist per arrow. An end is confirmed only
when every planned arrow is saved. Partial persisted arrows are labelled
provisional. Shared scoring helpers calculate totals; Round IDs remain stable.

Lifecycle: created -> waiting -> active -> completed, with cancellation before
completion. The creating active Head Coach manages the live session. Invited
active Archers accept/decline, explicitly select their own training Session on
the team's Singapore calendar date, change it or leave. A scoring Session can
belong to only one joined, non-completed live training at a time. Completed
reviews read the underlying current scores, not immutable historical snapshots.
Completion/cancellation closes the browser update stream and stops automatic
scoring broadcasts and fallback polling. An explicit refresh can still review
current individual history; completion does not lock an athlete's own scoring.

`20261026142604_live_coaching.sql` was applied to production on 27 October 2026
(Asia/Singapore). See `live-coaching-production-release.md` for the hosted canary,
data-preservation evidence and existing READY website deployment. It adds two tables,
restricted authenticated RPC wrappers around private checked functions, private
Broadcast authorization, and scoring/lifecycle observation triggers. No existing
scoring grants, formulas, organisation policies, Garmin objects or Health data
change. Client roles cannot write the live tables directly. Coach reads contain
only explicitly linked Sessions of eligible participants; athletes see only
own participation/scores. No notes or Garmin measurements are included.

## Synchronization and security

Committed scoring changes call `realtime.send` with an empty payload and a
private per-viewer topic: `live-coaching:<live-id>:<viewer-id>`. Current database
membership is checked on EVERY emission. Revoked cached channels receive no
further invalidations. Channel SELECT authorization is separate from scoring
RLS. No client Broadcast INSERT policy is granted. Every read/mutation repeats
current authorization; mutations use row locks, current membership locks and
optimistic lifecycle versions. Single active scoring association uses a scoring
identity advisory lock.

Existing web cookies are HttpOnly. `/api/live-coaching/events` bridges private
Supabase Broadcast to an authenticated browser EventSource; refresh tokens and
access tokens never enter the browser or SSE payload. A stream is bounded to
55 seconds (Node route maxDuration 60), reauthorizes every 15 seconds and cleans
up on abort/cancel. The native EventSource reconnects and each subscription
reconciles fresh state. The UI serializes/coalesces reads so older results do not
overwrite a required newer reconciliation. Events never increment totals.
Backgrounding clears private snapshots, and returning/online recovers fresh data.
A 60-second visible-page fallback covers missed transport notifications.
Revocation removes server access immediately; an already rendered snapshot is
cleared on invalidation/reauthorization (up to the stream's 15-second check), not
an impossible promise to erase all previously received browser data instantly.

Transport failure cannot roll back valid scoring; a failed emission logs a
payload-free database message, with eventual snapshot recovery. Connectivity
labels describe this dashboard stream only. Athlete presence is explicitly
unknown, not evidence of physical activity. No live HR is connected.

## Routes and interface

- Coach Workspace: `/organization/<id>/live-coaching`.
- Athlete invitations: `/live-coaching`, linked from Archer membership.
- Selected training uses `?session=<live-id>` with normal links/history.
- Athlete scoring links open `/sessions?session=<owned-session-id>` using the
  existing Sessions/scoring workspace. Foreign IDs are never loaded by this link.
- GET/POST `/api/live-coaching`: no-store authoritative reads/checked commands.
- GET `/api/live-coaching/events`: server-authenticated private update stream.

## Local verification and demo

Existing `scripts/test-notes-feedback-pg.mjs` installs canonical migrations into
an owned loopback PostgreSQL cluster. It emulates Auth roles/uid and Realtime
message authorization. `scripts/live-coaching-fixture.mjs` exercises actual
scoring RPCs, concurrent athletes, corrections/deletions, ownership, revocation,
channel RLS and lifecycle/history preservation. Realtime.send is emulated with
transactional PostgreSQL NOTIFY. This does NOT prove a hosted Realtime broker,
JWT verification or PostgREST subscription behavior.

With existing absolute PG_BIN / PG_DRIVER_MODULE tooling configured, run:

    node scripts/test-notes-feedback-pg.mjs
    node --experimental-strip-types --test tests/live-coaching*.test.mjs

For the optional disposable three-user browser demo, build the ignored fixture:

    node .verification/live-coaching-preview/build.mjs

Then set LIVE_COACHING_DEMO=true and run the same PostgreSQL runner. It exposes
loopback port 3218 and synthetic role URLs only, never production credentials.
This fixture server intentionally has selectable fake identities and MUST NOT
be exposed/deployed. Its scoring page uses the real unchanged ScoringWorkspace
and guarded scoring RPCs. The main application uses real server authentication
and Supabase private Broadcast, not this fixture transport.

## Release gates and remaining validation

The original release gate below was subsequently completed for Phase 1; see
`live-coaching-production-release.md`. Phase 2 remains local and separately gated.
The pre-release verification checklist was:
verify actual Realtime schema/send/topic APIs and enabled Broadcast service;
audit other realtime.messages policies (permissive policies combine with OR);
verify authenticated cookies through server streams, broker delivery/reconnect,
logout/revocation across tabs and realistic athlete/load limits. Review the
bounded stream duration/connections on the existing Vercel plan. No paid service
or production configuration was changed here. Stage and validate the migration
against hosted non-production Auth/Realtime before production approval.
The repository's unrelated baseline failures are recorded in verification output.

The local Phase 2 BLE foundation now implements a separate revocable consent
boundary and random sensor assignments. The monitoring extension adds separately
consented timelines. Existing Garmin Health/Activity delivery is not continuous
live HR and remains private; neither pending BLE migration is applied here.
