# Automatic Garmin Session matching and activity insights

Local implementation only. No migration, production mutation, commit, push, deployment, credential change or provider subscription change is part of this task.

## Existing architecture reused

OAuth/PKCE, encrypted credentials, authenticated Cloudflare forwarding, atomic durable inbox, Starter Activity Details Push, chunk storage/publication, queue retries, permission cleanup and deletion fences remain unchanged. Activity Details already validates samples[].startTimeInSeconds and samples[].heartRate, stores bounded chunks outside compact metrics, and publishes completed datasets. Daily timeOffsetHeartRateSamples retain their existing explicitly labelled fallback path for manual Session links. Enterprise callbacks remain isolated under their existing entitlement flag.

Official locally saved reference: .verification/garmin-sync/activity.txt (Activity API specification). Added compact fields are activityName, deviceName, maxHeartRateInBeatsPerMinute, activeKilocalories, averageSpeedInMetersPerSecond, totalElevationGainInMeters, totalElevationLossInMeters, averageRunCadenceInStepsPerMinute and averageBikeCadenceInRoundsPerMinute. Existing activity type, average HR and distance remain. Missing optional fields stay absent; zero speed/elevation remains zero. No route/location data, raw payload or sample arrays are added to metrics. The existing 8 KiB metrics constraint is unchanged. Historical records are not rewritten; older summaries may lack these optional values until a genuine future delivery.

## Matching (updated: many-to-many Archery)

Automatic matching includes all authorized ARCHERY-category candidates whose actual start timestamp falls on the Session's Singapore calendar date. Case is normalized, but names and unknown categories never imply Archery. Multiple Sessions may display the same original activities; no automatic association or health-record writes occur. No timing overlap, ranking or peer-Session restriction applies. Previous-day activities crossing midnight are excluded from the next day because the start date is authoritative.

Explicit selections are preserved separately, including manually selected non-Archery activities. An explicit null link retains the existing all-activities unlink decision. A new owner-isolated exclusion table stores per-Session activity exclusions; these also hide an excluded explicit recording without deleting its persisted link. Restore is explicit. A candidate result at the existing 50-record boundary displays an incomplete-result warning; additional activities are not claimed to be included. Exclusion reads also fail on capped results.

Individual graphs load on expansion using the unchanged Activity Details API. The opt-in combined chart requests at most two activities concurrently and caps its workload at 250,000 samples, reporting a limit rather than claiming complete data when exceeded. Independent series preserve overlapping and duplicate timestamps across devices, actual per-source samples, nulls and gaps. No average of activity-average HR is computed. Duration is summed per recording and labelled to disclose overlap counting.

Visible 60-second refresh, focus revalidation, authorization checks and deduplication remain. The legacy Session RPC revision does not cover exclusions, so Session responses no longer use its 304 shortcut; Activity Details conditional 304 refresh remains unchanged. No provider fetch is started by discovery.

## Activity details

Activity history links to /analytics/health/activity?activityId=... with browser Back and an explicit history link. The authenticated page uses GET /api/integrations/garmin/activity. Retrieval uses the verified user, exact stable provider activity ID, owner filters and existing RLS. Current HR-owner permission is checked before and after reading. Compact summaries, the single published activity dataset and at most 290 chunk rows are fetched; expected parts/sample count and every timestamp/BPM pair are validated. Missing/partial chunks produce an error, never a false complete recording.

The page reuses the existing responsive min/max-envelope timeline, original-sample tooltips, interval controls and gap behavior. Statistics derived from samples are labelled observed; provider average/maximum cards remain separate. Detailed series are never drawn from summary averages. Optional metrics are whitelisted and empty cards omitted. Unknown personal zones, moving duration and lap data are not invented or ingested speculatively.

Details refresh has an owner-authorized conditional revision. Unchanged refreshes return 304 before reading HR chunks; hidden-page data and conditional state are cleared. There is no shared user-data cache or browser health-data persistence. Summary-only records explicitly say detailed samples are unavailable.

## Database/security and performance

The exclusion migration is required before the new matching interface is released. Existing activity and HR storage are reused: reuse garmin_health_records, garmin_hr_datasets, garmin_hr_chunks, session_garmin_activity_links, sessions and the existing authorization RPCs. No scoring row, user connection, stored measurement or grant is modified by automatic discovery or details retrieval. The current connection/consent/generation policies and lifecycle cleanup remain authoritative.

Dataset reads use existing owner/source identity and published dataset indexes. Candidates stay at the existing RPC's 50-row bound; Session dates are read through a single owner-scoped query. Name enrichment is a single bounded query, not N+1. Complete HR arrays are only retrieved in a Session HR/detail view. No Session listing or scoring queue depends on Garmin success.

## Acceptance and limitations

Fixture success is not evidence of genuine Garmin delivery. Production Activity Details subscription state, consenting-account payload availability and current entitlements were not inspected or modified in this local task. No historical Starter backfill is assumed. Browser interactions at 320/390/768 px, device performance, scroll restoration and genuine imported-data acceptance remain release checks; static component renders are not real-browser acceptance.

Existing charts/styles are reused; no Android UI, native BLE, Homepage, weather, scoring formulas or Session contracts are changed. Prior weather and Phase 3A pending work is retained separately. Release requires reviewed source, preview acceptance, verified existing schema/RPC compatibility and a consenting user's genuine Activity Details delivery. Any external Garmin category activation still requires separate authorization.
