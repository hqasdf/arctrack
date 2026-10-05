# Backend abuse protection preparation — 2026-10-05

Current status: DATABASE HARDENING LIVE; AUTH FOLLOW-UP REQUIRED.
The approved SQL was runtime-tested and applied as 20261005110858_backend_abuse_protection.
No Auth settings, application dependencies, billing, branches, commits, pushes, or deployments changed.
The preparation observations below are historical; the runtime/application update at the end supersedes their unexecuted-test status.

## Verified starting state

- Checkout HEAD: c14bb6ff52f1713927f60e7affe18382957aa06f (dependency updates). Starting working tree clean.
- The previously prepared dependency patches are already in HEAD and remain unchanged.
- Main project confirmed read-only: pdwxphgyqbbflnrruobp; Tokyo ap-northeast-1; ACTIVE_HEALTHY; PostgreSQL 17.6.1.166.
- Organisation folhwltdkdqqmmhabwgw is on Free.
- 14 live migration entries; latest is 20261004230822 guarded_scoring_mutations.
- Earlier live timestamps sometimes differ from the corresponding local filenames. Do not apply unrelated local pending files.
- Live private function definitions were read back. Rollback preserves exactly those six pre-change definitions.
- No INSERT/UPDATE/DELETE table-level or INSERT/UPDATE column-level grants to PUBLIC, anon, or authenticated on sessions/session_rounds/session_ends/arrows.
- Read-only privilege checks confirmed the inspected public mutation RPCs allow authenticated EXECUTE and deny anon EXECUTE. This does not prove anonymous Auth sign-in is disabled; those users carry authenticated role if enabled.
- No existing application rate-state tables or rate/budget helpers found in public/private.
- API role timeouts: authenticated 8s; anon 3s; authenticator statement/lock timeout 8s.
- Management SQL session statement timeout 2min is not the authenticated Data API timeout.
- max_connections 60 observed; do not equate this with a user rate limit.
- No pgrst.db_tx*, db_pre_request or db_max_rows override appeared in pg_db_role_setting. Process-level PostgREST settings are not proved by that query.

Usage aggregates only, without athlete names, scores or codes:
- 26 Sessions; max manually entered arrow_count 207.
- 31 Rounds; max planned Ends 6; max arrows/End 12; max planned Arrow slots 36.
- 1 Training Plan; span 6 days; weekly target 1000; one assignment.
- Max daily target 300 Arrows and 2 scored Rounds.
- Built-in presets: 10 x 3 indoor; 6 x 6 at 30/50/70 m.

## Threat model and input inventory

Authenticated clients can call RPCs directly and bypass all UI validation. Guarded owner/Coach checks remain unchanged.
Protect cardinality amplification, repeated low-frequency expensive writes and join-code guessing. Do not rate-limit normal scoring.

| Input | Current RPC minimum / maximum | Storage type ceiling | Amplification | Proposed |
|---|---|---|---|---|
| planned Ends | 1..32767 | smallint 32767 | Eager generate_series inserts that many End rows; update appends rows | 1..120 |
| arrows/End | 1..32767 | smallint 32767 | Does not pre-create Arrows; expands permitted slots and UI enumeration | 1..60 |
| distance / face diameter | 1..32767 | smallint 32767 | Scalar metadata, no DB row fan-out | unchanged |
| Session arrow_count | 0..2147483647 | int32 | One scalar UPDATE; not scoring-record creation | unchanged |
| Weekly/daily Arrow targets | positive int32 or NULL | int32 2147483647 | Scalar prescriptions; does not create scored Arrows | unchanged |
| Scored-Round target | positive int32 or NULL | int32 2147483647 | Scalar prescription; does not create Rounds | unchanged |
| Training Plan date span | ordered dates, no product span maximum | PostgreSQL date range includes infinity | Shared web editor preparation expands all dates before RPC; DB scans supplied days | inclusive 1..366 days, calendar years 0001..9999 |
| Training Plan days JSON | array of objects, no cardinality/byte maximum | limited by PostgreSQL/API resources, not a product cap | repeated recordset scans and child upserts/deletes | 0..366 objects and <=4194304 UTF-8 bytes of normalized jsonb text |
| Assigned athletes | distinct nonempty UUID array, no product maximum | array/resource limits | membership lookups, deletes and assignment inserts | 1..1000, one-dimensional |
| Join code input | normalized lookup, no RPC length cap | text/resource limits | indexed lookup plus membership write | raw length <=64; actual eight-character format unchanged |
| Organisation creation/leave | one organisation + creator membership / one membership update | UUID/text and existing name limit | small constant-cost operations | unchanged in this focused draft |
| Export | client-side image/SVG generation | device/browser memory | no server export RPC or DB fan-out | unchanged |
| Analytics/Coach reads | existing paging/date filters | statement timeout/API settings | large histories and rosters can still be expensive | no new read throttling; unchanged |

These caps provide generous headroom over observed usage and presets. They are product proposals, not empirically proven limits for every future archery format.
120 x 60 allows 7200 planned slots. No existing Round is changed, backfilled or locked.
Four MiB allows all 366 daily notes at the existing 2000-character limit, including multibyte Unicode.
The web preflight only rejects unsupported dates/array sizes before the existing shared preparation. Core formulas and Expo UI remain unchanged.

## Application budgets

Per auth.uid(), not user IDs/IP supplied by clients. UTC fixed windows.
| Budget | Per minute | Per hour | Expected legitimate use / reason |
|---|---:|---:|---|
| Session creation | 60 | 600 | normally a few Sessions/day; generous accidental/bulk headroom |
| Round creation and settings combined | 20 | 200 | normally a few per Session; bounds repeated End allocation |
| Training Plan save | 30 | 300 | explicit coach saves, not every keystroke; allows a large editing burst |
| Join-code attempts | 10 | 50 | normally 1–3 attempts; failed and successful attempts both consume |
| Join-code regeneration | 5 | 30 | normally rare; repeated generation invalidates a shared secret |

Budget helper uses one atomic indexed UPSERT. Windows never move backward if requests waited at a boundary.
Fixed windows can allow up to twice a nominal budget around a boundary. This is intentional, documented burst headroom, not a sliding-window guarantee.
At most five rows per user; no unbounded request log, scheduler or external service. Auth user deletion cascades only their budget rows.
Successful low-frequency mutations consume; a transaction failure rolls back its reservation. Invalid oversized input is rejected before child writes.
Denied calls do not increase counters further. Failed join-code lookups return invalid_code rather than raise, so their counters commit.
Throttled joining returns rate_limited; both clients map it to a controlled error. Successful joined/already_member contracts stay unchanged.
PostgREST must commit these RPC transactions and must NOT allow caller-controlled rollback (Prefer: tx=rollback). Confirm process-level db-tx-allow-override=false before application.
Normal HTTP API users cannot explicitly roll back a database transaction, but an account with direct DB SQL access is a different threat model.
Account farming is not solved by per-user limits.

Not limited: Arrow save/correction/move/clear/delete, normal reads, Session arrow_count updates, leave, code reading, grouping/export. No Arrow budget lookup, lock or timer.
Scoring queue and 1e-12 confirmation tolerance unchanged.

## Complete SQL and object scope

Complete single-transaction migration body: ../supabase/proposals/backend_abuse_protection.sql
Prepared exact rollback: ../supabase/rollback/backend_abuse_protection.sql
Disposable rollback fixture: ../supabase/tests/backend-abuse-protection.sql

Draft is outside migrations because the Supabase CLI is absent and no cached executable was available.
No invented migration timestamp or new package dependency. Register one migration through the supported tooling when available, after review.

Adds:
- private.operation_budgets with UUID owner FK ON DELETE CASCADE, (user_id,operation) PK, bounded operation names, counters/window starts; RLS enabled, no client policies/grants.
- private.consume_operation_budget(text), SECURITY INVOKER, empty search_path, auth.uid() required; EXECUTE revoked from PUBLIC/anon/authenticated.
- private.validate_round_workload(integer,integer), SECURITY INVOKER, empty search_path, auth.uid() required; EXECUTE revoked from PUBLIC/anon/authenticated.

CREATE OR REPLACE changes only these existing private implementations, preserving signatures/owners/ACLs:
- create_owned_session: budget after existing auth/validation.
- create_round_with_ends: shared workload validator + configuration budget; owner lock/numbering/atomic End creation unchanged.
- update_owned_round_settings: read immutable arrows_per_end for the same validator + shared configuration budget; owner check/no-decrease/append unchanged.
- save_training_plan: early span/cardinality/size guard, then original authorization/validation/persistence + plan budget.
- join_organization_by_code: budget, bounded raw text, controlled negative results; role/status joining behavior unchanged.
- regenerate_organization_join_code: budget after current Coach check; code format/rotation unchanged.

No public wrapper, existing table/column, owner policy, Coach SELECT policy, existing grant, Arrow function, scoring data or Auth setting changes.
All newly added object references inside empty-search_path helpers are schema-qualified; SQL special forms CASE/FOUND are not object lookups.
No client EXECUTE grant on the new helpers. Existing SECURITY DEFINER mutations call them with their existing owner privileges.

## Auth: live read limitation and proposed review

The Supabase dashboard read was rejected by automatic approval review because its review service hit a usage limit.
No alternative browser/token/management-API workaround was used to bypass that denial.
Actual live email confirmation, secure email change, anonymous sign-ins, password policy, OTP settings, Auth rates, Site URL, redirects, refresh/session settings are UNVERIFIED.
Do not substitute historical audit values or documentation defaults for actual live settings.

Verified source:
- Web password creation/update policy 12–128 characters; six-digit email code validation.
- Mobile password policy mirrors 12–128; native scheme arctrack.
- Web HttpOnly SameSite=Lax cookies and HTTPS secure flag unchanged.
- Mobile AsyncStorage persistSession=true, autoRefreshToken=true, detectSessionInUrl=false unchanged.
- Email code entry is the normal signup/recovery flow; legacy web /auth/callback remains.
- Shared ordinary URLs do not carry login credentials.

Conditional proposals only; capture exact OLD values and rollback configuration before approval:
| Setting | Current live | Proposed |
|---|---|---|
| Email confirmation | unverified | retain enabled; if unexpectedly disabled, separately review enabling |
| Secure email change | unverified | retain enabled |
| Anonymous sign-in | unverified | disabled, if not already disabled |
| Password minimum | unverified | 12, matching existing UI; no new complexity/current-password/reauthentication requirement |
| Leaked password protection | availability known: Free plan | unavailable on current plan; no upgrade or DIY substitute |
| Email OTP expiry | unverified (earlier report 3600 is not fresh evidence) | 900 seconds if current value and email delivery QA support it |
| OTP length | live unverified; clients expect 6 | keep 6 if confirmed |
| Auth endpoint rates / email resend interval | unverified | no numerical tightening until live values and shared-server IP effects are assessed |
| Site URL | unverified | https://archery-website.vercel.app, if it differs and review confirms change |
| Redirect allowlist | unverified | exact production callback/recovery paths; preserve required local/Expo/preview entries until individually traced |
| Session/refresh settings | unverified | unchanged |
| CAPTCHA | unverified | do not add |
| Password-change reauthentication/current-password | unverified | do not enable additional steps |

Candidate production callback: https://archery-website.vercel.app/auth/callback and its supported next=/update-password use.
Local documented origin is http://127.0.0.1:3000; inspect actual allowed local origins/ports before removal.
arctrack scheme exists but current native code-entry auth does not require token-link handling; inspect any deployed native/Expo Go redirect before narrowing allowlist.
Do not authorize a global *.vercel.app wildcard; if previews are needed, use project/team-owned patterns and verify ownership.
An executable Auth PATCH and exact rollback are deliberately NOT prepared with guessed OLD values.

## Existing provider protections

- Actual role timeouts and connection ceiling above are verified.
- Supabase documents Auth endpoint token-bucket limits, per-user resend intervals and configurable SMTP/email limits. Actual project quotas still require read-only verification.
- Vercel documents automatic DDoS mitigation on all plans; project-specific WAF rules/bypasses were not read.
- Vercel protection does not cover Expo or direct calls to the public Supabase API.
- RLS and guarded ownership do not implement rate quotas. General API row limits/timeouts do not prevent repeated 32767-End requests.
- No global pre-request hook, CAPTCHA, paid service, arbitrary forwarded-IP trust or service-role client was added.

References:
https://supabase.com/docs/guides/api/securing-your-api
https://supabase.com/docs/guides/auth/rate-limits
https://supabase.com/docs/guides/auth/password-security
https://supabase.com/docs/guides/auth/redirect-urls
https://supabase.com/docs/guides/database/postgres/timeouts
https://vercel.com/docs/vercel-firewall/ddos-mitigation
https://docs.postgrest.org/en/stable/references/configuration.html#db-tx-allow-override

## Validation and pending gates

Application tests/typechecks/builds validate client code; source-contract tests are NOT SQL execution.
No psql/PostgreSQL/Docker/Supabase executable found; offline npm CLI lookup returned ENOTCACHED. No tooling installed.
Do not run any fixture on main, even with ROLLBACK, in this preparation phase.

Prepared fixture covers:
- Round min/common/large/exact caps; max+1/datatype extreme/zero/negative; create and update; planned End counts.
- Burst budget and sustained budget; user independence; old windows restore access; shared create/update budget.
- Rapid 100 Arrow edits without budget; coordinates preserved; Session count remains independent scalar.
- Failed join attempts persist; valid join at cap; hourly rejection; reset; already-member idempotence.
- Plan 366-day max, exact 1000 distinct active assignments, exact 4 MiB normalized JSON, oversized range/JSON/assignments; Coach regeneration cap.
- Session 60/61 and 600/601 budget boundaries; plan-save 30/31 and 300/301 budget boundaries.
- Direct scoring write denial, cross-user denial, Coach read-only behavior, anonymous denial.
- All fixture rows/helpers roll back.

Before production approval/application, additionally execute in a safe disposable DB:
1. Proposal and new fixture with ON_ERROR_STOP, plus existing guarded/atomic/plan fixtures.
2. Concurrent separate authenticated connections: budget never admits more than its cap, including minute boundary and competing Round create/update.
3. Run the prepared exact assignment and JSON-byte boundary checks; additionally test legitimate multibyte Unicode notes.
4. Run the prepared Session and plan-save minute/hour boundary checks; all failures clean and data atomic.
5. Verify HTTP invalid_code commits budget and caller tx=rollback cannot override; response mappings do not falsely claim joined.
6. Failed downstream child insert rolls back the mutation and reservation, not ownership/RLS.
7. Measure local/staging Arrow saves and low-frequency operations before/after; normal Arrow path has no new DB code but runtime latency is not yet measured.
8. Confirm fixture cleanup with read-only checks.

Post-Auth-change QA (after a separate verified proposal/approval):
signup, six-digit confirmation, password sign-in, close/reopen web/native persistence, logout, recovery, Secure Email Change, OTP expiry just-before/after, canonical/local/Expo redirects.
No credentials, tokens or secrets should be saved in test artifacts.
No physical-device or live email QA performed in this preparation pass.

Local validation completed after source changes:
- Targeted new preparation/client/preflight tests: 11/11 pass.
- Web full tests: 119/119 pass.
- Core full tests: 80/80 pass.
- Mobile full tests: 101/101 pass.
- Explicit guarded-write/queue regression invocation: 23/23 pass.
- Web/core/mobile typechecks and lint pass.
- Next.js 16.3.6 production build passes, routes preserved.
- Android Expo export passes (1513 modules); iOS export passes (1368 modules).
- Native exports emitted the existing NO_COLOR/FORCE_COLOR warning, not a failure.
- SQL fixture/source-contract checks pass; SQL syntax/RLS/rate behavior has NOT been runtime-validated.
- Pure local web preflight benchmark (100000 iterations after warm-up): normal mean 0.003745 ms; extreme-range rejection mean 0.004126 ms. This is not end-to-end request, Supabase or database timing.
- git diff --check passes; original dependency manifests/lockfile have no new diff; temporary native export folders removed.

## Rollback

Database:
- Recheck six original function definitions against the live target before eventual apply; stop if they drift.
- Apply the prepared rollback transaction only with separate approval.
- Restore exact prior bodies first, then drop only the two new helpers and private budget table (no CASCADE).
- Public wrappers/ACLs/owner RLS never changed, so rollback contains no broad GRANT.
- Budget counters are discarded; Sessions/Rounds/Ends/Arrows/Plans/memberships are preserved.

Local app:
- Remove the three new join-throttle handling lines if reverting the feature completely.
- Remove the training-plan-workload preflight/import/helper if reverting the workload limits.
- Do not revert unrelated dependency/security work or use blanket git checkout.

Auth:
- No change made. Exact rollback must restore each captured OLD setting, not reset project defaults.
- Current live configuration must be obtained before building an executable patch/rollback.

Remaining limitations: Auth inspection blocked; SQL/runtime/concurrency/performance/physical-device tests unexecuted; process-level PostgREST transaction override unverified; per-user limits do not prevent account farming or unlimited historical storage; large existing read histories remain outside this mutation-focused proposal.

## Runtime validation and application update — 2026-10-05

- Main project remains pdwxphgyqbbflnrruobp. Fresh six-function readback exactly matched the rollback originals; no drift.
- Pre/post real scoring counts: 26 Sessions, 31 Rounds, 158 Ends, 709 Arrows, one Training Plan.
- Current maximum Round workload is 6 Ends and 12 Arrows per End; maximum Plan span/day rows is 6, with one assignment. All are below the proposed caps.
- A temporary official PostgreSQL 17.11 binary distribution supplied a loopback-only disposable database. Historical application migrations reproduced the schema with synthetic Auth prerequisites. No project dependencies were installed or changed.
- Proposal SQL compiled and applied locally. The rollback fixture passed all workload, exact JSON/assignment boundaries, budgets, ownership, Coach, anonymous, and helper/table access assertions. All fixture data rolled back.
- Three fixture corrections were necessary: seed a missing Session-budget row with UPSERT; separate delete calls from post-delete cascade reads; replace legacy Training Plan scoring setup/direct-write expectations with current guarded RPCs and explicit direct/RPC Coach denials. No proposal function/grant/policy changed.
- Existing guarded-scoring, atomic-Round, owner-Round-update, and Training Plan database fixtures pass against the hardened disposable database.
- Two separate psql connections contended for the same final join slot. A consumed slot 10 and held its row lock; B visibly waited, then returned rate_limited. Both committed; counters stayed 10/10, windows did not move backward, no deadlock, and synthetic data cleaned up.
- Local PostgREST 16.4 HTTP invalid joins, including Prefer: tx=rollback, committed counters 1 then 2 with effective transaction mode commit.
- Before live application, the hosted existing Session RPC with Prefer: tx=rollback committed a disposable Session, proved by a separate authenticated REST read. Preference-Applied did not accept rollback. The Session, QA Auth user and sign-in were cleaned up.
- After live application, two real hosted invalid-join RPC calls (one with Prefer: tx=rollback) returned invalid_code and committed join counters 2/2. This directly verifies the new counter cannot be bypassed using that transaction preference. Disposable Session persistence, deletion and Auth sign-out also passed.
- Live rollback smoke passed Session/Round/Plan create/edit, Round expansion, normal join flows, 100 Arrow writes, correction/move/clear/delete/re-entry, unchanged Arrow budget footprint, Coach read-only access, cross-user denial, anonymous denial and private-helper denial.
- Local rollback and reapply both passed. Live apply used only the reviewed proposal, exact SHA256 E5444723E94335D37DCC89DE1B8803BC5BE42A266D92C810AC09C8F7DBD37A46.
- Live migration history: 20261005110858_backend_abuse_protection. Local migration is an exact byte copy using that actual identifier; no timestamp was invented.
- All eight new/replaced live function bodies match the applied SQL. Pre/post public RLS hash, public table ACL hash, and Arrow/count/delete function hash are unchanged.
- Budget table has RLS, only postgres table ACL, and zero remaining QA rows. Helpers have no client EXECUTE grants. Growth remains at most five operation rows per user, not a request log.

### Measured PostgreSQL execution latency

Same disposable database, five warm-up calls and 40 measured calls per operation and phase; each sample rolls back. Milliseconds, excluding network, contention and browser rendering. Invalid join changes from an exception to an ordinary result, so its comparison is not identical error handling.

| Operation | Original median | Hardened median | Original p95 | Hardened p95 |
| --- | ---: | ---: | ---: | ---: |
| Session create | 0.1460 | 0.2190 | 0.2291 | 0.3017 |
| Round create | 0.2810 | 0.4575 | 0.5304 | 0.9743 |
| Round update | 0.3425 | 0.4845 | 0.7323 | 0.9083 |
| Plan save | 0.5090 | 0.6400 | 0.7898 | 0.8452 |
| Invalid join | 0.0895 | 0.1580 | 0.1625 | 0.2898 |
| Join-code regenerate | 0.3975 | 0.4995 | 0.5735 | 0.6221 |

Arrow function bodies are unchanged; there is no budget lookup or new artificial wait on Arrow writes.

### Fresh live Auth inspection

- Free plan confirmed. Leaked-password protection is unavailable on this plan; billing unchanged.
- Email provider/new signups/email confirmation enabled. Secure Email Change enabled. Anonymous sign-ins disabled. Manual linking disabled.
- Secure password change and require-current-password disabled; preserved.
- OTP length 6; expiry 3600 seconds. No email-delivery evidence justified changing expiry to 900, so it remains unchanged.
- Minimum password length and email-send rate are redacted by the browser connection. Their exact values remain unverified; no guessed patch or rollback was created. User clarification requested.
- Token refresh: 150 requests/5 min/IP (1800/hour); token verification: 30/5 min/IP (360/hour); signups/signins: 50/5 min/IP (600/hour). No tightening.
- Single-session enforcement disabled; session timebox and inactivity timeout 0 (never); JWT expiry 3600 seconds; refresh replay detection enabled and reuse interval 10 seconds. All unchanged.
- Site URL: https://archery-website-wonghanqian123456-5398.vercel.app/
- Redirects retained: local /auth/callback; local /auth/callback?next=/update-password; old Vercel origin root and /**; https://archery-*-website-wonghanqian123456-5398.vercel.app root and /**; http://127.0.0.1:3000/**. No arctrack entry is currently listed.
- The canonical archery-website.vercel.app hostname is absent from this displayed allowlist. Deployed APP_URL/legacy email-change callback usage must be verified before altering these live settings. Native code-entry Auth and persistent AsyncStorage settings remain unchanged.
- Security advisors report intentional private.operation_budgets RLS-without-client-policies INFO and existing unavailable leaked-password-protection WARN. No client policy was added to silence the intended deny-by-default warning.

### Final local validation and limitations

- Web 119/119, core 80/80, mobile 101/101 pass; lint, all typechecks, production web build and git diff --check pass.
- Android export: 1513 modules, 27 assets; iOS export: 1368 modules, 23 assets; both pass.
- No physical iPhone/Android runtime, browser close/reopen, real-mail signup/OTP/recovery delivery QA was performed. Auth sign-in/sign-out passed through the controlled hosted QA account.
- Local preflight and clean join-throttle app handling are not deployed, per instructions. Pending Auth numeric-setting/URL follow-up and private-email/device QA prevent claiming the entire Auth hardening phase complete.
- Temporary database/service/QA artifacts are removed after evidence is recorded; permanent regression fixtures remain.
- No commit, push, deployment, branch change, billing change, dependency update or unrelated pending migration application.
