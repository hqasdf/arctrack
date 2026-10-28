# Live Coaching management release notes

Local preparation only. Do not apply or deploy automatically.

The existing `20261028015918_live_coaching_target_coordinates.sql` remains separate
and unchanged. The new `20261028072232_live_coaching_session_management.sql` adds
only the private deletion function and its public invoker wrapper. It creates no
tables, changes no RLS policy, and never deletes athlete scoring Sessions.

Deletion requires the signed-in training creator to remain an active head coach in
the exact organization. It locks the training row using the same authority boundary
as the existing lifecycle/HR commands and checks the expected version. A currently
authorized coach can repeat deletion of an absent UUID safely. Invitations, live HR,
retained HR samples and End activity cascade from the training; scoring Sessions,
Rounds, Ends, arrows, Session Notes and Coach Feedback do not cascade from it.

The payload-free invalidation is emitted in the deletion transaction. New reads and
HR writes are denied after commit. Existing browser tabs clear private state on
reconciliation; the existing stream's 15-second authorization recheck also closes
revoked subscriptions if a broadcast is missed. Do not promise instantaneous delivery.

Before a separately approved website release, review and apply the two pending
migrations in chronological order using the established migration-aware workflow.
The deletion migration is compatible with the existing website; the new Delete UI
requires its RPC. Do not rewrite applied history. Rolling back website code does not
restore deleted training or HR; athlete scoring remains independent.

BLE flags, retention scheduling, Garmin and production configuration are unchanged.
Hardware acceptance, including Garmin Venu 4 compatibility, remains pending.
