# Live Coaching Phase 1 production verification

Verified 27 October 2026, Asia/Singapore. This supersedes the earlier hosted
verification blocker in `live-coaching-verification.md`.

## Production installation

- Project: `pdwxphgyqbbflnrruobp`, ACTIVE_HEALTHY.
- Applied version: `20261026142604_live_coaching`.
- Exact approved SHA-256:
  `0AF1D72AC31666E82AEF67465C77ED7D2B8DFEB6CBA587C4F085E121F7E90DFA`.
- Supabase CLI 2.121.0, isolated release copy, `migration up --linked
  --project-ref pdwxphgyqbbflnrruobp --workdir
  .verification/live-coaching-production/release --yes`.
- CLI migration listing first established that only the approved version was
  pending. Seven documented aliases were used in isolated copies only. Canonical
  historical files and production history were not rewritten.
- The migration has no outer BEGIN/COMMIT. The established CLI fault-injection
  evidence demonstrates schema/history rollback together for this workflow.
- Independently verified the canonical history row, two new RLS-enabled tables,
  checked private functions/public invoker wrappers, six observation triggers and
  the private Realtime receive policy. Anonymous RPC execution and direct client
  table writes remain denied. Existing public RLS policy hash is unchanged.

## Existing data preservation

| Object | Before | After final canary cleanup |
| --- | ---: | ---: |
| Sessions | 62 | 62 |
| Rounds | 73 | 73 |
| Ends | 401 | 401 |
| Arrows | 1797 | 1797 |
| Garmin connections | 3 | 3 |
| Garmin Health records | 8 | 10 |

Existing Session and Arrow row hashes match exactly before/after. Existing public
policy hash matches exactly. Health records increased while the existing Garmin
scheduler continued running; do not describe that count as unchanged. Canary
accounts had no Garmin connections and no fabricated Health measurements were
inserted. Final queries found zero canary Auth accounts and zero canary live
sessions. Only generated canary users/organisations/scoring records were cleaned
up; no real user's account was reconnected, disconnected or deleted.

## Actual hosted canary

The final run passed 35 checks through real Supabase Auth, private WebSocket
Broadcast and the actual Vercel HTTP/EventSource endpoints. It covered:

- Coach and athlete private subscriptions, anonymous/other-identity denial.
- Real JWT refresh, plus denial after membership revocation despite token refresh.
- Two athletes' concurrent guarded arrow saves and authoritative mapped scores.
- Score correction and deletion without accumulating notification totals.
- Active athlete EventSource receiving `revoked` and closing after revocation.
- Revoked cached WebSocket no longer receiving new scoring invalidations.
- Actual Vercel stream lifetime: 55,018 ms, against the 55-second application bound.
- A new EventSource request after that cutoff joined a fresh private WebSocket
  and delivered the next saved scoring change through Vercel.
- Missed-event recovery via a fresh authorized snapshot after a stream closes.
- Completion, stopped scoring broadcasts and preserved individual history.
- Logged-out new requests denied. This is not proof of instant global revocation
  of every previously issued JWT or a full cross-tab browser logout test.

Observed six-write batch plus delivery time was 666 ms in the final run (1,586 ms
in the earlier complete run). These include network and all six writes; they are
not per-event latency measurements, an SLA or a high-load test.

The installed `realtime.send()` adds a generated UUID `id` to an otherwise empty
application payload. Canary assertions validate this metadata-only shape; SSE
still forwards empty invalidations. No scoring/Health payload is broadcast.

Earlier attempts included an initial subscription rejection which did not recur,
an assertion assuming literally `{}` before inspecting the hosted generated-ID
envelope, and a JWT probe that incorrectly reused the SDK's existing channel.
The final probe uses a fresh WebSocket. No RLS or production configuration was
weakened to pass these checks. One invocation was not executed when automatic
approval review hit a usage limit; later invocations passed the supported review.

Programmatic hosted tests and the previous/local actual-browser UI tests are
distinct evidence. The full authenticated two-athlete UI was not repeated in a
production browser during this task. No new staging infrastructure was created.

## Website release state

The matching Phase 1 implementation was already live when work began:

- Source: `164c9017a676d191c5d64ea77064036ee617d1de`.
- Vercel deployment: `dpl_J9AkQjSPuqUphd55La62T7SKzGgJ`, READY.
- Domain: `https://archery-website.vercel.app`.

Actual API/scoring/SSE canary verifies deployed behavior beyond the Git metadata.
Public homepage and sign-in return 200; signed-out Live Coaching redirects to
sign-in and its API returns 401. A fresh website deployment was unnecessary.
No commit, push, Vercel deployment or production setting change was performed.

Security advisor returned no ERROR findings. The two new no-policy INFO findings
are expected for RPC-only, directly revoked Live Coaching tables. Existing
pg_net placement, Auth leaked-password and Garmin definer warnings were not
modified. Review ongoing connection usage under real team load; no eight-sensor
or maximum-team concurrency claim follows from this canary.

## Evidence and Phase 2 boundary

Ignored execution/evidence artifacts are in `.verification/live-coaching-production/`.
Canary credentials were protected with Windows DPAPI; they are not release files.
Never publish that directory or environment files. The canonical migration and
this report contain no credentials.

Phase 2 BLE source, separate migration, retention SQL and privacy wording remain
LOCAL ONLY. Production `live_coaching_hr` does not exist and the BLE endpoint is
404. See `live-coaching-bluetooth-hr.md` for activation prerequisites.
