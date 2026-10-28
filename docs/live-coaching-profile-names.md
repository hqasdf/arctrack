# Live Coaching profile names and invitation capacity

The editable Archer Profile name is public.profiles.display_name. Both website saveProfile and native saveProfile write this owner-controlled field. Auth user metadata, email and imagined first/last-name fields are not authoritative.

The installed private.read_live_coaching reader joins profiles for both roster and participants, but coalesces a missing name to Archer. The website API now obtains the nullable original through the existing read_coach_athlete_roster RPC after the Live Coaching access check, scoped to the same organisation. It overlays names only on already-authorized roster/participant IDs. It performs no direct cross-user profile-table or Auth lookup and fails closed if scoped names cannot be verified. API reads stay private/no-store. Subsequent authoritative reads reflect profile edits.

The formatter prefers the saved displayName. Real names spelled Archer or Athlete remain valid; a single word does not by itself require an identifier. A missing value or duplicate name receives a minimal account-ID prefix, lengthened when necessary to avoid collisions within the authorized list. No contact information is added. The selector, scoreboard, details and coach sensor labels share this resolution.

## Existing limit: unchanged

Create Training's UI labels a maximum of 32, disables further selections at 32, and disables submit outside 1..32. The HTTP API rejects arrays outside 1..32 before SQL. The database private.live_coaching_command independently enforces cardinality 1..32, unique athlete IDs and current active archer membership. This check originated in 20261026142604_live_coaching.sql and is retained in 20261027233437_live_coaching_role_views.sql. Production function metadata was checked read-only and retains the 32 cap.

This is an explicit application creation guard, not a Supabase/PostgreSQL 32-row limit, organisation membership limit, scoring limit, or claim about simultaneous Bluetooth sensors. The source demonstrates bounded membership locking, invitation insertion and Realtime fan-out; interpreting the cap as a workload/safety bound is an inference. No documented benchmark establishes why the exact number 32 was selected.

Increasing it would require coordinated UI/API validation and a separately reviewed additive database migration (never rewriting applied SQL), plus tests at 32/33 and proposed larger sizes: membership revocation, duplicate IDs, concurrent creation, lock duration, payload size, nested scoring reads, Realtime subscriptions/fan-out, rendering on narrow screens and infrastructure resource limits. HR batching/device limits require a separate assessment. The current change does not increase capacity.

Tests use synthetic disposable data for saved/updated/null names, legitimate Archer names, scoped roster denial and direct-profile RLS. Training creation boundaries are tested through API and actual SQL. No production records or migrations are modified.
