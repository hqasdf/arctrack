# Live Coaching role-specific views

The athlete entry is `/live-coaching`. Coach monitoring is entered explicitly from
`/organization/<organizationId>/live-coaching`. Existing server layout checks require
an active `head_coach` membership. The existing training creator restriction remains;
this change does not give every coach access to another coach's training.

An athlete joins an open invitation before choosing a scoring Session. Connection
uses the existing locked command, owned training Session/date validation and conflict
checks. Creating a new Session reuses `createSession`; if association fails after
creation, the current form retains that Session ID for retry. Existing Sessions are
not deleted when a connection or participation changes.

## Database dependency

`20261027233437_live_coaching_role_views.sql` is a new, unapplied migration. It replaces
only Live Coaching command/read functions and adds restricted helper/wrapper functions.
It adds no tables, backfills or RLS policies and leaves scoring, Garmin, BLE ingestion,
consent, generation fencing and retention mutations unchanged.

- `read_live_coaching` requires the matching organization context for coach reads.
  A missing organization selects athlete context, never implicit coach authority.
- `live_coaching_view_access` is a lightweight EventSource role-context probe. Events
  remain empty invalidations on user-specific private topics; the existing topic RLS
  and recipient checks remain authoritative. The stream rechecks context every 15 seconds.
- `read_live_monitor` requires the authorized training creator's active coach role.
- `read_live_athlete_hr` permits a joined athlete's own consent/history reads, using
  the same existing membership, retention and privacy filters. It exposes no teammates.
- The internal snapshot helper is not executable by clients or the service role.
- Invitation responses omit scoring content and association IDs until joined. Joining
  without a selected Session explicitly clears any legacy invitation association.

## Release and verification

This is a coordinated database/application change. Old coach clients omit the new
organization context and will fail closed after migration. Do not apply the migration
independently to an active old release. Arrange a short Live Coaching cutover and deploy
the matching website together after separate approval. No BLE activation is required.
Do not use broad migration push or modify historical migration aliases.

Run the website/shared-core suites, typecheck, lint, build, `check:migrations`, and
`scripts/test-notes-feedback-pg.mjs` with the existing disposable PostgreSQL tooling.
The role fixture checks real SQL roles, context isolation, pre-connection privacy,
ownership, revocation, anonymous denial and dual-role organization separation.
Hosted JWT/Realtime and physical BLE behavior still need post-release validation.

The synthetic local preview emulates identities and event transport; it is not proof
of hosted Supabase authentication, Realtime delivery or physical sensor connectivity.
