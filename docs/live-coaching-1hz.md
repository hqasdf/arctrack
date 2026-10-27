# Live Coaching 1 Hz — local implementation and verification

27 October 2026, Asia/Singapore. This supersedes the ten-second history and
two-second upload descriptions in the earlier Phase 2 reports. Local only: no
production migration, flag change, deployment, commit or push was performed.

## Sampling and upload policy

The BLE manager takes the first **new notification** in each one-second clock
bucket. A missing notification produces no sample or upload. BPM/contact/packet
validation, random source assignments, generation and monotonic sequence fences
remain intact. The software connection bound is twelve; this is not a claim about
actual adapter/device capability.

`HeartRateBatcher` holds at most one pending frame per athlete, twelve pending
frames and one twelve-frame request in flight. It flushes once per second only
when frames exist. Requests have a five-second deadline; queued frames older than
five seconds are dropped. There is no automatic retry or replay of an uncertain
upload. Backpressure drops frames; permanent/network failures stop the affected
local sharing and require an explicit reconnect. Backgrounding clears the queue
and disconnects local sensors. A late failure from a replaced sensor cannot
disconnect its replacement.

The authenticated same-origin API accepts at most 8 KiB and twelve distinct,
validated athlete envelopes per batch. `live_hr_batch` independently calls the
existing checked command for each athlete in stable athlete-ID order. Invalid,
revoked and rate-limited samples cannot invalidate another athlete's successful
sample, while unexpected transaction/lock failures fail the request without a
false acknowledgement. SQL also bounds batch size/encoded length. Only checked
authenticated wrappers are granted; no anonymous or direct table access is added.

SQL accepts at most one sample per athlete per server reception-second bucket,
and requires the notification timestamp to advance to a new second. The prior
generation, source, sender, sequence, timestamp-age, membership, lifecycle and
consent checks are preserved. These are deterministic second buckets, not a
guarantee of exactly 1,000 ms between observations or proof of sensor identity.
The notification time is the browser reception time, not an attested device clock.

Each accepted sample updates one current control row and, with additional
timeline consent, inserts one historical row. One outer upload RPC handles up to
twelve athletes; authorisation checks/locks still run independently for each.
No HR sample triggers full scoring reconciliation or a scoring Broadcast.

## Latest display and historical charts

The latest authorised readings are fetched at up to 1 Hz, with one current-read
request in flight and a five-second deadline. Per-athlete `useSyncExternalStore`
subscriptions update BPM/status leaves without putting each tick in the team
component's state. Team metadata refreshes every five seconds or immediately on
consent changes. Freshness remains ten seconds; loss of data never creates a BPM.

History fetches are independent of latest-read fetches, so a slow chart query
cannot block current BPM or scoring. Short-window history refreshes at most every
five seconds, three-hour/day windows at most every thirty seconds, and completed
review polls at fifteen seconds. One history request is in flight with a ten-second
deadline. Interval changes do not dispose the BLE manager or restart sensors.
Stale interval responses are ignored. History responses/cached history must match
current consent generation and history revision; revoke/reconsent cannot restore
an erased chart through a delayed response.

Available windows are 1/5/15/30 minutes, three hours and retained 24 hours. Earlier,
later and latest controls allow historical inspection; changing the window keeps
the selected history anchor. One-minute zoom returns full one-second resolution.
Overview queries select actual first, last, minimum and maximum observations in
each of about 180 time buckets across the **entire** requested interval, bounded
to 724 actual points per athlete. They do not take only the most recent 240 points.
Statistics use all retained observations in the window. Segments are calculated
before downsampling; gaps over three seconds and generation changes split paths.
The compact cards omit redundant point circles, preserving paths and isolated
samples; detailed charts retain actual point labels and the accessible table.

## Storage and pending migration checksums

Both Phase 2 migrations are pending, so the authorised smallest change was to
adjust them together. Applied historical migrations and the seven historical
timestamp aliases are unchanged. No new migration version is necessary.

| Pending migration | SHA-256 |
| --- | --- |
| `20261026162902_live_coaching_bluetooth_hr.sql` | `EC61BF146BCC18BCD3F14DCC86268DED0E9EF36C84CD95959581626627172ADD` |
| `20261027012339_live_coaching_monitoring_history.sql` | `216353A71851F88D2A644134F35AD7F7002AB8CE84FA91E49F5D6BBDE17E3E6D` |

History uniqueness is `(live_id, athlete_id, reception-second bucket)`. Both browser
notification (`observed_at`) and server reception timestamps are retained with the
source and generation. The existing per-athlete window/expiry indexes remain;
a team/session timestamp index supports bounded multi-athlete reads. The history
table remains RLS-enabled and inaccessible directly to client roles. Existing
pause/revocation/leave/completion/membership cleanup and 24-hour expiry remain.
Timeline collection still needs its separate athlete consent. Garmin data is not
read, shared or changed.

The existing inactive retention SQL must be separately reviewed/activated and
monitored before production collection. A twelve-athlete 24-hour stream could
contain roughly one million rows before expiry; the three-hour test below is not
proof of long-term production storage, cost or capacity. Outages can delay physical
cleanup, while read-time expiry still denies expired history.

## Fresh local results

- Full website suite: **614 passed, 0 failed, 0 skipped**.
- Disposable PostgreSQL 17.6: **320 assertions passed, 0 failed**: 43 new 1 Hz,
  37 monitoring, 31 BLE, 36 Phase 1, 143 existing SQL and 30 harness/concurrency.
- TypeScript, repository ESLint and Next.js 16.4.1 production build passed.
- Thirty canonical migrations validate; seven historical aliases remain unchanged.
- `git diff --check` passed.

The 1 Hz workload used three real wall-clock ticks for each roster size. Requests
below count the admission uploads; additional duplicate attempts were separately
rejected and did not create records.

| Athletes | Accepted observations | Upload requests | Mean local admission RPC |
| --- | ---: | ---: | ---: |
| 1 | 3 | 3 | 3.69 ms |
| 2 | 6 | 3 | 2.96 ms |
| 8 | 24 | 3 | 66.81 ms |
| 12 | 36 | 3 | 7.32 ms |

These short samples ran alongside other local checks; the eight-athlete outlier
is retained rather than hidden. They are not a sustained throughput guarantee.

The disposable fixture then bulk-created **129,600** synthetic rows: twelve
athletes times 10,800 one-second observations. This tests a three-hour data volume,
not a three-hour continuous wall-clock/hardware run. The fixture analyses its
bulk-loaded table before timing queries; no production ANALYZE is run.

| Team history window | Local query time | Returned points across twelve athletes |
| --- | ---: | ---: |
| 1 minute | 11.29 ms | 660 |
| 15 minutes | 115.17 ms | 4,308 |
| 3 hours | 1,335.23 ms | 8,640 |
| 24 hours | 997.93 ms | 1,140 |

The three-hour response was about 849 KB. Tests confirm beginning/end coverage,
full-resolution minute zoom, ordering, duplicate rejection, delayed notifications,
owner-only historical reads, complete history erasure and completed-session batch
rejection. Existing SQL assertions cover simultaneous scoring updates and consent
revocation races. An initially slow aggregation/join revision was replaced with
bounded window selection/materialisation; the final values above are from the
corrected query. Wide histories deliberately refresh less frequently.

## Browser verification and remaining limits

Actual Opera browser QA used twelve synthetic signal identities, the real UI,
disposable PostgreSQL and fixture-only Auth/SSE transport. BPM/reception timestamps
changed without a page reload; minute zoom, earlier/later/latest history, tablet
tables and 320/390/768px plus desktop layouts worked without page-level overflow.
An inspected development React Profiler capture recorded 206 commits, 4.77 ms
average actual render duration and 15.60 ms p95, including both leaf and dashboard
updates. This is not end-to-end latency, production-build profiling or a claim that
the entire team rerendered on every commit. No console errors were observed in
the inspected dashboard tab. Screenshot: `.verification/live-hr-1hz-detail.png`.

The synthetic driver is confined to the loopback disposable runner and requires
`LIVE_COACHING_DEMO=true`, `LIVE_COACHING_MONITOR_DEMO=true` and
`LIVE_COACHING_DEMO_1HZ=true`. Nothing in product code creates fake readings.
The preview prints its PID; writing that PID as ASCII to the ignored
`.verification/live-coaching-preview/stop-requested` file requests graceful cleanup.
It also has an automatic duration limit. A preview-only port-collision/shutdown
defect was corrected; stale owned preview processes were stopped without touching
application or production databases.

Physical BLE, twelve simultaneous devices, adapter limits, real mobile browser
background behaviour and real hosted Auth/network latency remain unverified.
Production release still requires separately approved pending migrations,
retention readiness, matching application release and controlled hardware/hosted
verification. Phase 2 production flags were not changed.

## Changed files for this task

- `src/features/live-coaching/heart-rate/{batch.ts,sensor-manager.ts,measurement.ts,panel.tsx,http.server.ts}`
- `src/features/live-coaching/{monitor-model.ts,monitoring-dashboard.tsx}`
- The two pending migrations listed above.
- `src/app/privacy/page.tsx` (sampling disclosure only).
- `scripts/live-coaching-{1hz-fixture,hr-fixture,monitor-fixture,monitor-demo,demo}.mjs`
- `scripts/test-notes-feedback-pg.mjs`
- `tests/live-coaching-{1hz,heart-rate,monitor}.test.mjs`
- This report and the existing Live Coaching monitoring/verification documentation.

Prior completed dashboard/scoring functionality is preserved. Native/Expo, Garmin,
Counter, scoring formulas, credentials and production configuration are untouched.
