# Automatic weather logging — local implementation

This addition is disabled by default. No production migration or configuration is applied by the code change.

## Eligibility

The user-approved V1 rule excludes exactly 18 m; other valid positive whole-metre distances are eligible. Collection also requires today in Arc Track's existing Asia/Singapore calendar, an empty planned Arrow slot, a focused scoring screen and foreground/unlocked app. History never starts collection. This conservative guard intentionally skips historical editing, fully entered Rounds and some overnight shooting. No Session completion system is introduced.

## Configuration (server only)

- ARC_TRACK_WEATHER_ENABLED=true enables the configured backend after its migration has been separately reviewed and applied.
- ARC_TRACK_WEATHER_MODE=development permits the public Open-Meteo endpoint only when NODE_ENV=development. Use only for testing permitted by the provider's non-commercial terms.
- ARC_TRACK_WEATHER_MODE=commercial requires OPEN_METEO_API_KEY and uses the customer endpoint. This is the only enabled production mode. Commercial access/subscription must be arranged separately; no service is purchased here.
- SUPABASE_SECRET_KEY remains server-only and is used only for guarded weather coordination/save RPCs after a confirmed owner is verified. It must never enter public environment variables or mobile bundles.
- Expo EXPO_PUBLIC_ARC_TRACK_API_URL is the HTTPS web backend origin, not a provider key. A local private-network HTTP origin is allowed only in development.

Without configuration or before the migration, weather becomes unavailable without affecting Sessions or Arrow saving. No real credentials belong in Git.

## Privacy and limitations

A one-shot low-accuracy foreground position is rounded to two decimal places on the client and again on the server. Coordinates are transient and never stored in weather rows. Provider request URLs/coordinates, tokens and keys must not be logged. Open-Meteo may retain request logs for 90 days under its terms; therefore do not claim location never leaves the device. Readings are regional model estimates, not measurements at the shooting line. Wind direction is the direction from which wind originates.

Review privacy notices, Apple privacy details and Google Play Data safety before release. No background tracking or foreground service is added. New Android/iOS binaries are needed for native location configuration; Expo Go alone does not prove release behavior. Owner-only weather SELECT is intentional; Coach weather access is not added.

## Local verification

Use maintained core, web and Expo weather tests; the SQL fixture must run in an isolated disposable database inside BEGIN/ROLLBACK, never against production as an experiment. Existing Arrow queues, scoring geometry, exports, Analytics and Training Plans remain independent. The local migration and fixture names are reported with implementation results.
## Phase 3W reliability corrections (local, not released)

The existing model, eligibility, snapshot schema and SQL leases are unchanged. Weather remains independent of scoring and navigation.

- Browser positioning timeouts are retryable, including when the Permissions API is absent. Actual denial continues to suppress repeated prompts. Concurrent fixes are rejected rather than issuing overlapping positioning requests. Native fixes remain fenced until the underlying request settles, even if the UI timeout fires first.
- Weather errors retain safe categories for authentication, authorization, ineligibility, database reads, provider availability/rate limits/response validation, and persistence. The existing `ok`/`message` API envelope is preserved; `code`, `retryable`, `retryAt` and Retry-After are additive. Transient provider failures use 502, and database/persistence failures use 500. The server does not turn query failures into a successful disabled response.
- New native and web clients retry appropriate 429/5xx responses. Provider and transport Retry-After values are preserved and normalized, with a 24-hour maximum deadline. Automatic collector retries are limited to three after the initial failure, using 1/5/15-minute delays plus up to 10% positive jitter. Explicit Retry or foreground reactivation starts a new episode. Manual Retry respects a currently known retry deadline. The database lease remains authoritative over capture frequency.
- Valid displayed snapshots survive temporary reload errors within the same authorized Session. Authentication/authorization failures clear protected readings. Native state carries an account/Session scope, hiding old data immediately on scope changes; stale request and collector callbacks remain cancelled/fenced. Web panels retain their existing Session/Round keys and authenticated workspace ownership.
- Retry actions are available for unavailable active and history views. No historical readings or location are fabricated. Background requests are not placed in the Arrow autosave or Back-navigation path.

Intentional rules remain: exactly 18 m excluded, Singapore current-day eligibility, at least one unfilled planned Arrow slot, foreground collection only, two-decimal coordinates, 30-minute successful refresh interval, saved historical snapshots only, Celsius and km/h. Changes to these rules require separate product approval.

The browser Permissions Policy concern was not reproduced in a real browser in this task, so next.config.ts is unchanged. Before release, test direct /sessions entry, navigation from Profile and other routes, reload, Back/Forward, denied/granted permissions and browser differences. No physical Android, genuine provider outage, paid provider entitlement or production configuration acceptance is claimed.

Older Android clients can still consume the unchanged success envelope and ignore additive error fields. They need the mobile update to gain the new recovery behavior. Backend and website fixes can be released independently; no migration or synchronized mobile cutover is required.

Verification: final full website suite 737 passed; mobile 566 passed; shared core 129 passed; focused weather suite 67 passed; maintenance 32 passed. TypeScript for all platforms, website lint, Next.js production build and migration consistency passed. Full mobile lint retains eight existing errors and zero new warnings. An intermediate icon-plugin fixture hit Windows EPERM; a complete rerun passed unchanged. Android export is validated separately from signed native and physical-device acceptance. No production requests with synthetic measurements were sent.
