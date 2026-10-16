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
