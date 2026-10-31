# Phase 3A Session data contracts

Local, additive preparation only. Existing UI, reader callers, scoring RPCs and loading behavior are unchanged. No pagination, API route, migration, dependency upgrade or production change is included.

## Contracts

`@arc-track/core/sessions` exports:

- `SessionSummary`: id, title, date, createdAt, sessionType, arrowCount and roundCount. arrowCount is the existing athlete-recorded Session count; it is not inferred from scored Arrows. It has no rounds, scores or plotting coordinates.
- `SessionSummaryPage`: items and nextCursor (string or null). This is a future response type only. There is no cursor encoding, paging request, page-size limit or pagination implementation in Phase 3A.
- `SessionDetail`: a compatible alias of the existing SessionDraft scoring DTO. It retains every Round configuration and loaded Arrow score/coordinate. It does not change the flattened End model or add a new authority token. Notes, Feedback, weather and Garmin data keep their existing independently authorized readers.
- `mapSessionSummary` validates the database row/count shape; missing children/counts are errors, not zero Rounds. Zero is valid only when explicitly returned. Creation timestamps preserve the database string, including fractional precision.
- `mapCompleteSummaryBatch` rejects absent data/counts and capped responses. Empty history is valid only with an explicit empty array and count zero.

## Additive readers

Website: `src/features/sessions/summary-read.server.ts`, readSessionSummaries.
Android: `apps/mobile/src/session-summaries.ts`, readOwnSessionSummaries.

Both select id,title,session_date,created_at,session_type,arrow_count,session_rounds(count), request an exact root count, filter by owner and optionally category, and order by session_date DESC, created_at DESC, id DESC. There is one Session data request, not one Round-count request per Session. Native additionally verifies current getUser() identity against the requested owner. All reads use the authenticated client and existing RLS; there is no privileged client or service-role bypass.

These readers are not wired to any existing screen. They do not traverse pages. A server-capped response fails explicitly rather than pretending to contain complete history. The exact count adds database work; it is an intentional safety check while no pagination exists, not a claim of the optimal later paging design.

The documented PostgREST embedded count syntax avoids retrieving individual Rounds or Arrows. It has been verified with deterministic query mocks, not a hosted PostgREST request or production query plan. Confirm deployed support, child RLS visibility and zero-count shape before wiring callers. No migration is presently required by the source design; if hosted evidence requires an RPC/index, seek separate approval.

## Preserved consumers

- Website readSessions/readOwnedSession/mapSession and complete detail select remain unchanged.
- Android MobileSession/readOwnSessions/readOwnSession/readOwnRound/readOwnAnalyticsSessions and mapper remain unchanged.
- Website Analytics still calls the existing full reader; Coach readers retain existing authorization, batching and complete-detail mapping.
- Retained workspace, selected-Session revalidation, revision journal, writer handoff, Counter, browser/native Back and offline scoring are untouched.
- All Phase 3W weather changes present at task start remain untouched.

The detail alias documents the existing contract; it does not prove hosted nested results are complete or repair existing nullable-child mapping. Complete child-count validation/assembly and historical completeness are Phase 3B/3D integration prerequisites. Never cast a summary to SessionDraft or fill its missing details with empty arrays. A summary must resolve through an authorized complete Session read before scoring can open. All Rounds must arrive automatically, with no mandatory per-Round loading.

## Verification and measurements

22 new deterministic cases cover mapping, both categories, empty/multiple Round counts, recorded-vs-scored Arrow count, malformed data, ownership, errors, capped responses, deterministic query ordering and retained full-reader consumers.

`node scripts/measure-session-summary.mjs` measures synthetic uncompressed UTF-8 query-result JSON. One Session with three Rounds and 216 Arrows: detail 26,456 bytes, summary 212 bytes. Fifty equivalent Sessions: detail 1,322,751 bytes, summaries 10,551 bytes. These exclude compression, HTTP headers, exact-count work, authentication, database time and rendering. No existing caller was switched, so no user-visible improvement is claimed yet.

## Phase 3B prerequisites

Approve website integration separately. Implement cursor validation and traversal, category-isolated listing state, insertion/deletion reconciliation and deep-link detail resolution. Keep listing summaries separate from retained active detail. Preserve pending edits and reject stale responses. Inspect the existing sessions_user_date_idx before proposing an index with the id tie-breaker; justify any migration using representative plans. Keep Analytics and Coach full-history paths independent of listing pages. Test timestamp ties, API caps, large nested histories, revocations and old Session links. No Phase 3B implementation is included here.
