# Phase 3D-1: complete Analytics and Coach histories

The history readers use `read_complete_session_history_v1` rather than treating
a successful PostgREST table request as proof that every matching row arrived.
The old personal reads could silently accept the API's row cap. Coach offset
pages could duplicate or omit tied rows, or mix different concurrent snapshots.

## Contract and snapshot

The additive migration `20261031101849_complete_session_history.sql` installs
one read-only, STABLE, SECURITY INVOKER RPC. It returns one scalar JSON envelope,
not a PostgREST rowset, so a 1,000-row API cap cannot truncate its nested arrays.
All queries and existing STABLE authorization helpers share the calling query's
MVCC snapshot. Inserts, deletes, corrections and membership changes committed
after that snapshot are visible on the next request, without mixing read pages.
No long-lived transaction, scoring lock or history cursor is introduced.

The actor must equal `auth.uid()`. Owner requests are self-only. Coach requests
use the existing authorized organisation roster, with existing scoring RLS still
in effect. No definer privileges or direct-write grants are added. Anonymous and
service-role RPC execution are revoked. The roster in the envelope is checked
against the roster used by team presentation; a changed roster fails explicitly.

Session order is date descending, creation timestamp descending, ID descending.
Rounds, Ends and Arrows have stable positional/ID ordering. Independent persisted
row counts cover all four levels. Shared validation rejects missing counts,
missing nested arrays, duplicate identities/positions, scope mismatches, invalid
scoring values and count mismatches. There is no silent deduplication.

Metadata/index reads explicitly omit scoring arrays and return the full ordered
index. They are not represented as SessionDraft. Detail reads preserve every
persisted Round/End/Arrow, including plotting, X and misses. A partial Round is
valid; planned Arrows are not fabricated or counted as persisted scoring rows.
The athlete's recorded Session Arrow count remains a separate field.

## Budgets and failures

One request can contain up to 10,000 Sessions, 100,000 Rounds, 500,000 Ends and
1,000,000 Arrows, subject to a 64 MiB serialized JSON budget. SQL sentinel limits
read one row beyond each bound and raise an error on overflow; they never return
a capped successful response. Infrastructure timeout/body limits may reject a
smaller history. Missing RPC, transport, authorization, validation and capacity
failures propagate as errors, never empty histories or partial statistics.

Web route error boundaries offer Retry and state that partial statistics were
not calculated. Existing native error/retry states remain. Selected-Session
refreshes still read only that Session, leaving Phase 2 writer handoff and
pending-intention recovery unchanged. No UI pagination was introduced.

## Release requirement

The migration is prepared and tested locally only. Apply it through a separately
reviewed, approved production migration workflow before releasing these reader
changes. Existing deployed websites and Android clients remain compatible with
the additive RPC. There is deliberately no unsafe legacy-reader fallback when
the new function is absent. No Phase 3W, Phase 3A, Garmin or scoring formula
changes are required. PostgreSQL fixture tests emulate Auth; hosted JWT,
PostgREST and physical-device acceptance remain release checks.
