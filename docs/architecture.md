# Arc Track architecture and feature guide

Current source baseline: `83f0ad42f6a6cddfacfa99894cd44d931af1aaca`, with the
separate, uncommitted [Medium finding remediations](audit-medium-remediation.md).
This guide describes local source responsibilities, not production deployment state.

## Ownership and dependency direction

| Area | Owns | Allowed dependencies and boundary |
| --- | --- | --- |
| `src/app` | Next routes, layouts, transport and composition | Feature application services; routes do not own scoring formulas |
| `src/features/<feature>` | Web presentation, use cases and feature adapters | Core, shared web infrastructure and explicit peer-feature contracts; never route implementations |
| `apps/mobile/app` | Expo route composition and native screen lifecycle | Mobile adapters and core; never web implementation files |
| `apps/mobile/src` | Native UI, authenticated persistence and platform integration | Core and native libraries; never Next/web implementations |
| `packages/core/src` | Shared domain models, calculations and dependency-injected state machines | Internal core modules only; no React, Next, Expo, Supabase, Node or platform storage imports |
| `src/lib` | Web authentication/configuration and infrastructure adapters | Framework/provider libraries; feature rules remain with the feature |
| `supabase/migrations` | Durable constraints, authorization, concurrency and transactional persistence | Canonical predecessor schema; clients do not substitute for these checks |
| `infra/garmin-ingress` | Existing authenticated ingress and distributed admission limits | Fixed server forwarding contract, independent authentication; no UI imports |

Core's weather collector and Arrow persistence are state machines with injected
I/O; not every core module is a pure function. Keep deterministic calculations
pure and inject clocks, persistence and timers when a shared workflow needs them.
Do not add a generic repository/service framework for one caller.

Prefer documented core package subpath exports (for example `@arc-track/core/scoring`)
over reaching into another workspace's source. Existing re-export adapters are
intentional compatibility surfaces, not duplicate implementations to delete.
Web `@/` resolves to `src/`; mobile `@/` resolves to the mobile workspace. Keep
their TypeScript configurations separate. Use explicit peer-feature imports;
there is no blanket ban on feature collaboration or mandate for barrel files.

## Current flows and responsibilities

* Scoring/Sessions: platform UI collects intentions; shared scoring/analytics
  models calculate results; authenticated adapters and owned RPCs persist them.
  Round memory reuses the same account-backed configuration contracts. Scores,
  End completion and X-count must continue through existing calculations.
* Organisations/Coach Workspace/Live Coaching: membership and role checks remain
  authoritative in RPCs/RLS. Invitation summaries precede selected training
  details. Scoring association is explicit; invitation alone grants no scores.
  Realtime signals trigger authorized reconciliation, not new access rights.
* Garmin: `config.server.ts`, `provider.server.ts`, `service.server.ts` and
  `store.server.ts` separate configuration/provider transport, orchestration and
  encrypted persistence. Health and Session HR own their normalization/readers;
  ingress forwards to a fixed internal receiver, durable SQL admission precedes
  acknowledgment, and bounded workers process receipts. Keep provider contracts,
  permissions, pause/replay generations and OAuth cleanup fences intact.
* BLE: browser sensor access and the existing 1 Hz pipeline are distinct from
  Garmin cloud data. Diagnostic readings do not imply upload/consent. Detailed
  HR history requires its existing consent, authorization and retention rules.
* Authentication: web server adapters verify identity; native session authority
  fences operations by active account/lifecycle. SecureStore's guarded Android
  postinstall patch is part of the authentication contract. Account deletion
  retains password confirmation, verified identity and server-only Admin access.

## Contracts, validation and failures

1. Share a model when the semantics actually match across platforms. Keep DOM,
   native gestures, navigation, credential storage and transport adapters local.
   Avoid merging similar-looking UI state machines with different lifecycles.
2. Validate untrusted input at the API/RPC boundary. UI validation helps users;
   database ownership, size limits, constraints and locks establish correctness.
   TypeScript types alone do not validate JSON. Preserve omitted versus null
   meanings, units, timestamps, timezone and provider provenance explicitly.
3. Keep existing DTO/RPC names and shapes stable. A new contract must document
   callers, validation, privileges, failure states and compatibility. Do not add
   a universal response envelope or error library solely for uniform appearance.
4. Distinguish validation, forbidden, stale/conflict, retryable failure and unknown
   mutation outcome in application state. Do not turn every failure into retry.
   Redact credentials, cookies, OAuth codes, health payloads and private endpoint
   paths from diagnostics; log a safe stage/category and correlation identity.
5. Success follows authoritative confirmation. A timeout is not proof of failed
   persistence. Preserve request identity, expected version and confirmed versus
   desired state. Reconcile uncertain outcomes before settling or retrying;
   reject stale intentions rather than overwriting another device's work.
   See the separate remediation guide for the pending Arrow/Round contracts.

## Authorization and privacy

Derive the actor from verified authentication, never submitted owner IDs. Check
membership, resource ownership and consent at the authoritative operation. Client
visibility is UX, not authorization. RLS and grants are separate checks: review
both, including RPC execution, public wrappers and private functions. Use narrowly
scoped definer code only where necessary, with qualified objects, controlled
search paths and explicit authorization. Never resolve a denial by adding a
service key to a client or weakening RLS.

Keep server credentials in server-only modules. An authorized coach roster is not
permission to read private Health data. Pause, revocation, deletion and account
switching invalidate in-flight work as well as future requests. Preserve minimal
durable fences needed to prevent replay; do not claim provider or backup erasure
that the application cannot establish.

## Async lifecycle and resource conventions

* Capture active account/resource generation before an await; verify it before
  publishing state, navigating or making a dependent mutation. Cancellation of
  a local promise does not undo a remote commit.
* Own timers/subscriptions in one mounted lifecycle; release them on unmount,
  backgrounding, selection change and account switch as applicable. Guard late
  callbacks even when unsubscribe/AbortController is available.
* Load summaries first and one selected expensive detail at a time. Bound lists,
  worker batches, retries and parallel requests. Avoid one timer/channel per
  historical invitation and avoid locking every owner in a scheduled job.
* Preserve 1 Hz per-athlete updates without rerendering an entire scoreboard.
  Lazy-load heavy plotting/history. Use stable IDs, missing-data gaps and truthful
  freshness; never convert an unavailable value into a fabricated zero.
* Reconcile on Realtime reconnect, focus/app resume and mutation completion using
  the existing bounded scheduling. A new effect must explain its request budget
  and cleanup; do not add polling to hide an authorization or state bug.

## Database and release compatibility

Applied migrations are immutable. Preserve canonical versions and the seven
documented historical aliases. Additive migrations must be created using the
maintained CLI workflow and tested against all required predecessors in disposable
PostgreSQL. Review grants, owner isolation, concurrency, deletion and retries as
well as the happy path. `check:migrations` checks source consistency; it does not
verify production state or execute SQL.

Name the old/new caller contracts and deployment sequence before changing RPCs.
Keep older browser tabs and independently released Android builds in the plan.
Use compatible expansion where possible, otherwise a separately approved cutover
with stale-client rejection. Record recovery limitations. A successful local
build or enabled feature flag is not proof of genuine Garmin delivery, hosted
Realtime, physical BLE compatibility or safe production activation.

## Automated boundaries and their limits

`npm run check:architecture` parses imports/exports and literal dynamic imports/
require calls across web/mobile application and core source. It enforces:

* Core has only internal dependencies and no runtime import cycles.
* Web and mobile do not import each other's implementations.
* Features do not depend on Next route implementations.
* Consumers reference declared core package exports.

Type-only edges remain boundary-checked but do not count as runtime cycles.
Tests exercise invalid examples, not just the current passing tree. The check
does not prove complete purity, server-secret safety, arbitrary computed imports,
cross-feature acyclicity or every bundler resolution rule. TypeScript, framework
server-only checks, regression tests and code review remain necessary. Add a
specific tested rule when a recurring concrete violation appears; do not add a
large exception baseline to claim a clean architecture.

Validation CI now includes infrastructure paths and runs isolated ingress tests
plus architectural checks in maintenance. It still performs no production writes
or deployment. Hosted CI execution has not been established by local tests.

## Findings and prioritized debt

| Priority | Evidence / impact | Action and ownership |
| --- | --- | --- |
| High correctness release dependency | Separate Arrow uncertainty, atomic Round replacement and Garmin fairness fixes are local and need two approved migrations before their consumers release | Track in `audit-medium-remediation.md`; this architecture task does not change or apply them |
| Medium lifecycle cost | Previous native invitation fan-out scaled channels/timers with history | Selected-detail remediation is preserved separately; verify on a physical Android device before release |
| Low, fixed here | `infra/` absent from workflow path filters and scope selection | Include infra in validation and ingress regression coverage |
| Low, fixed here | Dependency directions were described but not automatically enforced | Add focused import/core-cycle checks and this ownership guide |
| Low, existing | Full mobile lint reports eight errors in auth/recovery, category and weather code | Separate behavior-aware cleanup; do not suppress hooks rules to obtain a green report |
| Follow-up assessment | Nested scoring reads and long histories need representative pagination/performance measurements | Measure query sizes and truncation first; no proven bottleneck or automatic rewrite asserted here |
| Follow-up assessment | Whole-application runtime cycles and peer-feature coupling are not exhaustively analyzed | Extend graph analysis only with understood framework/server-action semantics |
| Separate audit backlog | Enterprise pull retry/deadline recovery, native uncertain-create/title constraints, stale detail errors and cached date handling | Keep the original audit evidence and individual behavioral tests; do not bundle into structural maintenance |

No confirmed duplicate scoring engine was found in this scoped pass. Core already
owns shared calculations and web adapters re-export them. Large platform screens
alone are not evidence that extraction would improve correctness.

## Checklist for the next feature

1. Identify the owning feature, platform surfaces and authoritative data contract.
2. Reuse existing core semantics and authorized RPCs; document any genuine gap.
3. Define empty/error/unknown/stale states, request budget and lifecycle cleanup.
4. Test authorization, account switching, concurrency/retry and privacy boundaries.
5. Run architecture, affected platform/core tests, types/lint and migration checks;
   build/export when delivery surfaces change. See `development.md` for commands.
6. Keep a narrow file manifest and separate local evidence from production/hardware
   verification. Obtain explicit authorization for commits, pushes and release.

## Local verification of this architecture increment

On 2026-10-29, the current uncommitted tree passed 688 website tests, 529 mobile
tests and 123 core tests. The maintenance subset passed 28 tests (included in the
website suite, not an additional independent total). All three TypeScript checks,
website/root ESLint, Next.js 16.4.1 production build, Android Hermes export and
Expo Doctor's 20 checks passed. Full mobile ESLint still reports the eight
pre-existing errors listed in `development.md`; no mobile source was changed by
this increment.

Disposable PostgreSQL passed 532 general/scoring assertions and 339 Garmin
assertions, including the separate pending remediation migrations. Auth roles
are emulated: these results do not verify production JWT/PostgREST, hosted
Realtime, physical Android/BLE hardware or genuine Garmin deliveries.
Migration consistency passed for 37 files and seven historical aliases;
`git diff --check` passed. Existing pending migration checksums were preserved.

The eight files belonging to this increment are `docs/architecture.md`,
`docs/development.md`, `scripts/check-architecture.mjs`, `scripts/ci-scope.mjs`,
`tests/architecture.test.mjs`, `tests/maintenance.test.mjs`, `package.json` and
`.github/workflows/validate.yml`. No runtime behavior, dependency versions,
lockfile, SecureStore patch, database SQL or production configuration changed.
