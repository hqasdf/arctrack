# Live Coaching Phase 2 - browser Bluetooth HR

The subsequent local monitoring extension is documented in
`live-coaching-monitoring.md`. Its separate timeline consent, bounded retention
and completed-review cleanup supersede this original latest-only foundation.

Local implementation, 27 October 2026. Native Expo code and Garmin pipelines
are unchanged. No physical sensor or Apple Watch relay was tested.

## Device contract

Discovery filters the standard BLE Heart Rate Service `0x180D`; notifications are
read from Heart Rate Measurement `0x2A37`. The parser supports little-endian
8-bit/16-bit BPM, optional sensor-contact flags, Energy Expended and RR-interval
packet structure. It does not store energy/RR values or infer timeline points.
Malformed packets, zero, values above 300 BPM and explicit no-contact readings
are unavailable. Reserved flags do not change the known field offsets.

References: [Bluetooth SIG Heart Rate Service](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/HRS_v1.0/out/en/index-en.html)
and [Chrome Web Bluetooth guidance](https://developer.chrome.com/docs/capabilities/bluetooth).
Supported browser APIs and BLE broadcasting, rather than the brand, determine
compatibility. An ANT+-only device is not compatible. Some Garmin/Polar/Wahoo
devices are plausible candidates, not verified Arc Track hardware.

Apple's [accessory guidance](https://support.apple.com/en-mide/105059) describes
pairing external monitors to an Apple Watch; that is not evidence of a standard
browser-readable Watch broadcast. Arc Track has no direct Watch integration.
An iPhone relay, or other broadcasting app/bridge, must actually expose the
standard service/characteristic and notifications to the receiving browser.
No particular relay is certified here, and an iPhone relay is not assumed to
work with every browser. Never infer support from the device name alone.

## Controls and data flow

Athlete joins a live training and explicitly grants HR consent for that athlete
and live session. The creating coach selects the consenting athlete, clicks
Connect sensor, chooses a device in the browser's own chooser and associates it.
No prompt occurs at startup. Reconnection is explicit. Unsupported browser,
cancelled chooser, authorization failure and unavailable sensor states are honest.

The connection manager prevents duplicate hardware IDs within the browser and
tracks independent devices. It serializes chooser ownership, cancels delayed
work, removes listeners and disconnects on navigation/background/revocation.
Software caps connected entries at eight, but adapter/browser/sensor capacity
must be measured on actual hardware. Physical identity across independent
browsers is not cryptographically verified. Hardware IDs/names are not sent to
the server; random per-assignment UUIDs are sent instead.

Actual notification -> parsed BPM + browser reception timestamp -> authenticated
same-origin bounded POST -> checked SQL command -> latest private reading ->
athlete card. Notifications do not refetch scoring or use the Garmin pipeline.
Samples are coalesced to at most one every two seconds per sensor. Rate-limited
frames are dropped without inventing a replacement; the next actual notification
can be accepted. Other publish failures stop sharing. Visible-page HR reads occur every five seconds, plus
confirmation reads after local changes. Private snapshots and devices are
cleared when the page is backgrounded. Backend reception time is authoritative
for freshness; browser clocks must be reasonably correct for admission.

## Database and authorization

Separate pending migration:
`20261026162902_live_coaching_bluetooth_hr.sql`.
SHA-256: `4B1A93C01D4F39FD2C5872ED6C0D94A27F9E8C8B26806899C0303C2FC1E46BAF`.

It adds one RLS-enabled, directly inaccessible latest-value/control table.
Public invoker RPCs call private fixed-search-path functions. Athlete-only
consent, current creating-coach permission, joined participation and current
organisation membership are verified in SQL. Coach cannot consent for an athlete.
No unrelated Health/Sleep/Stress access is granted.

Consent and assignment generations reject delayed grants, revoked assignments
and replaced sensors. Strictly increasing sequence, bounded reception timestamps,
database-enforced sample frequency and per-athlete transaction locks protect
against retries/concurrent requests. Revocation serializes with an in-flight
sample and clears its result. Leaving or membership changes erase HR consent
and values; completion/cancellation erases the session's HR rows. New participation
requires new consent. Existing scoring persistence and formulas are unchanged.

No HR values enter public or private Broadcast payloads. Latest values are read
through freshly authorized HTTP/SQL access, not cached channel authorization.
A permitted coach can submit client-reported measurements; BLE identity and
which athlete is wearing a sensor are not hardware-attested medical claims.

## Retention and privacy — original latest-only foundation

The new local monitoring extension in `live-coaching-monitoring.md` supersedes
the latest-only retention and completion behavior described in this section.
It requires an additional migration and explicit separate history consent; old
live-sharing consent never opts an athlete into retained history. Validation
counts below are the historical foundation results, not the new final totals.

No HR history is stored. Readings older than ten seconds are not shown as live.
The disconnect path immediately clears local display and attempts a fenced
server clear. Network failure can delay that clear, so stale/TTL rules still apply.
Revocation, leave and lifecycle cleanup run transactionally in the database.

`prune_live_coaching_hr()` clears values older than sixty seconds. The reviewed
`supabase/ops/live-coaching-hr-retention.sql` prepares one INACTIVE cron job;
it does not install extensions or activate processing. Before Phase 2 activation,
enable its one-minute cadence and monitor successful execution. Healthy physical
live-table retention is therefore under about two minutes. Failures can delay
erasure. Reads also lazily clear expired values. Minimal consent/generation state
persists while participation remains eligible. Existing infrastructure log/backup
retention limitations apply; no immediate backup deletion promise is made.

The local Privacy Policy and in-product privacy link describe these controls.

## Local validation

- Full website: 592 passed, zero failed.
- Focused BLE/application boundary suite: 15 passed, zero failed.
- Disposable PostgreSQL: 240 assertions, zero failed: 31 HR, 36 Phase 1,
  143 existing SQL, 30 concurrency/harness.
- TypeScript, repository ESLint, production build, migration consistency and
  diff whitespace validation passed.

The existing disposable PG runner tests actual functions and concurrent
transactions, not a production database. Run with the established absolute
PG_BIN/PG_DRIVER_MODULE tooling:

    node scripts/test-notes-feedback-pg.mjs
    node --experimental-strip-types --test tests/live-coaching-heart-rate.test.mjs

The temporary loopback browser fixture used actual React components and real
disposable SQL, with emulated scoring transport. Athlete grant/revoke updated the
coach controls. Scoring saved a confirmed 30 with HR revoked. Desktop 1391px,
390px dark and 320px light had no measured horizontal overflow; no console
warnings/errors were captured. A native screenshot succeeded after the CDP
screenshot method timed out. Physical sensor and real-phone QA remain pending.

## Release prerequisites

1. Review and separately authorize/apply only the Phase 2 migration with the
   established isolated version-preserving workflow. It is NOT applied now.
2. Prepare/activate retention cleanup and verify monitoring before accepting HR.
3. Review the privacy wording and retention operations for the release.
4. Enable `LIVE_COACHING_BLE_ENABLED=true` on the server and
   `NEXT_PUBLIC_LIVE_COACHING_BLE_ENABLED=true` at build time only for the separately
   approved release/test environment. Both default off. App flags are not a
   substitute for database authorization. Do not deploy these local changes as
   part of the already-live Phase 1 release.
5. Verify one physical standard BLE sensor first, including GATT discovery,
   contact/format behavior, actual BPM, chooser cancellation, sleep/wake,
   disconnect, stale labeling, consent revocation and simultaneous scoring.
6. Increase independent sensors gradually and measure connection/reconnection
   limits. Test any Apple Watch relay as a distinct hardware/browser combination.

## Changed-file manifest

New local source and tests:

- `src/features/live-coaching/heart-rate/measurement.ts`
- `src/features/live-coaching/heart-rate/sensor-manager.ts`
- `src/features/live-coaching/heart-rate/http.server.ts`
- `src/features/live-coaching/heart-rate/panel.tsx`
- `src/app/api/live-coaching/heart-rate/route.ts`
- `supabase/migrations/20261026162902_live_coaching_bluetooth_hr.sql`
- `supabase/ops/live-coaching-hr-retention.sql`
- `scripts/live-coaching-hr-fixture.mjs`
- `tests/live-coaching-heart-rate.test.mjs`

Existing local files updated:

- `src/features/live-coaching/live-coaching.tsx`
- `src/features/live-coaching/live-coaching.module.css`
- `src/app/privacy/page.tsx`
- `scripts/test-notes-feedback-pg.mjs`
- `scripts/live-coaching-demo.mjs`
- `tests/live-coaching-ui.test.mjs`
- `docs/live-coaching.md`
- `docs/live-coaching-verification.md`

New reports: `docs/live-coaching-production-release.md` and this document.
The approved Phase 1 migration file was not changed. Ignored execution/canary
artifacts are not release source and must not be committed or deployed.
