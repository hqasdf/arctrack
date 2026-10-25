# Phase B: scoring lifecycle and Counter integrity

## Mobile scoring

Round loading depends on the stable authenticated user ID and Round ID. Same-account token refresh does not reload the Round. Each load and write completion is fenced against the screen lifecycle; a stale load, retired screen, or previous identity cannot replace current UI state. Queued mutations retain their captured End IDs, saved Arrow IDs and version maps.

A small in-process queue serializes each owner/Round/Arrow slot across screen mounts. Reopening a Round waits for already-enqueued writes before reading it. Different slots, Rounds and owners remain independent. Before queued save/delete RPCs, the adapter checks the current local Supabase session identity against the captured owner. Existing server ownership checks remain authoritative. No authentication architecture, scoring formulas, gestures or database objects changed.

This queue is not durable across process termination. It does not claim offline saving or recovery of unacknowledged Arrow mutations after Android kills the process.

## Counter state and storage

Both platforms use the same pure `@arc-track/core/counter` model. Browser storage remains localStorage; native storage remains AsyncStorage with the existing serialized write queue.

Version 3 retains `totalArrows` and `increment`, and stores history as `{ amount, addedAt }` records. Add records an ISO UTC timestamp; display uses local date/time. Undo removes the complete latest record; Reset clears history while retaining the selected increment. Increment changes never update addition times.

Version 1 preserves its saved total. Version 2 preserves the total, increment and every valid history amount, with `addedAt: null`. No historical time is invented. Missing storage is a valid first-use Counter. Invalid JSON, unsupported versions, impossible totals or invalid history fail loading and do not authorize writes. Invalid timestamp fields retain the amount and display an unknown time. Loading/migration itself does not write storage; the next explicit mutation persists version 3.

The web Counter applies every transition to its synchronous current-state reference, so delayed wheel settlement or rapid Add/Undo cannot replace a more recent tally. Explicit selection and confirmed Reset cancel pending wheel timers. Read failures expose Retry and keep mutations disabled. Write failures preserve the in-memory tally and report that it is not saved.

Older clients cannot read version 3. A rollback must retain the version-3 reader; do not downgrade the Counter model after users have saved new-format histories.

## Validation and release boundaries

The regression matrix includes website, native screen, shared model, queue, owner-check, storage failure, timezone, midnight, reload and race tests. Native mocks do not prove physical gesture behavior or Android device compatibility.

The existing mobile project has no configured `updates` URL or `runtimeVersion`, and does not declare `expo-updates`. No EAS Update is published. A compatible signed Android build is required for distribution through the existing app's testing workflow. Existing Expo dependency mismatches must be reviewed separately; this change does not upgrade dependencies or signing settings. No Android device/emulator was connected during this execution.

Production website verification should use a reversible Add/reload/Undo sequence and restore the original total. Do not Reset existing user history for testing. Do not test scoring mutations or fabricate backend data in production.
