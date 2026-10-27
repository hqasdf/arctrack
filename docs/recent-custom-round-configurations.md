# Automatic custom Round configuration memory

Implemented locally inside the existing Configure Round interfaces. No new Session creation flow, naming workflow, manual save action or management screen.

## Behavior

The existing format is **Ends × arrows per End**: `9 × 4` means nine Ends with four arrows per End (36 planned arrows). Recall restores Round name, division, distance, face diameter, face layout, planned Ends and arrows per End. Edits remain local until the existing confirmation action succeeds.

The database remembers committed custom configurations through an `AFTER INSERT OR UPDATE OF` configuration fields trigger on `session_rounds`. Existing Round creation/update RPCs are unchanged. If validation, workload limits, End creation or any later statement fails, the whole existing transaction rolls back, including memory. An uncertain network response can still correspond to a committed Round; its configuration is then correctly remembered.

Exact unmodified shared presets in their default Recurve division are already available and are not duplicated in history. A changed name, division, distance, face or count is custom. The SQL preset comparison is checked against the actual shared `ROUND_PRESETS` in the disposable fixture.

History is capped at 20 per account. Equivalent shooting settings deduplicate by division, distance, diameter, layout, Ends and arrows per End; a renamed equivalent keeps the latest confirmed Round name. Reconfirmation, including a successful no-change settings save, moves an entry to the front. Removing memory never deletes or alters actual Sessions, Rounds, Ends or Arrows. Using a removed configuration again legitimately remembers it again. There is no historical backfill or scanning of old scores.

## Persistence and security

Canonical migration: `20261027061217_recent_custom_round_configs.sql`, created with the installed Supabase CLI. SHA-256: `7BB398255D5F9BB934E7CCE281FCE3D2E748A5CA8EF3B6FF0B94AD01A345B1F4`. It adds:

- `public.recent_round_configs`, a configuration-only owner store with authenticated owner SELECT/DELETE RLS, a unique settings constraint and owner/recency index.
- `private.remember_custom_round_config()`, a trigger-only SECURITY DEFINER function with an empty search path, verified `auth.uid()`/Session ownership and per-account transaction advisory locking. Direct execution is revoked from clients and service_role. Clients cannot INSERT or UPDATE memory.
- One configuration-change trigger on `public.session_rounds`.
- `public.read_recent_round_configs(uuid)` and `public.forget_recent_round_config(uuid,uuid)`, SECURITY INVOKER RPCs retaining RLS and explicitly rejecting a mismatched expected account. Ownership is never assigned from the supplied account parameter.

No scores, coordinates, Session/Round identifiers, notes, coach feedback, Garmin information or Session timestamps are stored. Only a last-used timestamp is retained for ordering. Account deletion cascades configuration memory. No existing policy, scoring function, operation budget, historical migration, permission model or production setting is replaced.

Web and Expo use one shared model/label/transport contract in `packages/core/src/recent-round-configs.ts`, the same authenticated Supabase project and the same two read/removal RPCs. Web focus/visibility/network-online events, mobile focus/foreground and reopening Configure Round fetch peer-device changes. There is no manual Refresh control. Temporary loading failures get at most three automatic retries after 1, 4 and 15 seconds; success stops retries. Hidden/background screens issue no retry requests, and unmount cancels pending timers. After retry exhaustion, returning to the screen/app (or a web network-online event) starts a fresh recovery attempt. There is no offline-sync or Realtime claim. Unavailable history shows a retry state while the normal configuration fields and confirmation remain available.

## Existing mobile restrictions

The new-Round configuration form supports recalling every field. The existing scoring settings modal deliberately keeps arrows per End and target layout fixed and permits planned Ends only to increase. Recent entries incompatible with that existing Round are disabled with an explanation to use the new-Round Configure Round form. Compatible entries populate every supported field. No partial restoration or scoring-rule change is performed.

## Local verification

- Website: 620 tests passed; mobile: 508 passed; shared core: 116 passed. No failures.
- The 16 focused new tests cover labels, field restoration, editing independence, shared transport, offline/errors, confirmed removal, peer refresh, account switches and actual web/mobile Configure Round submissions through existing actions.
- Disposable PostgreSQL 17.6: 359 assertions passed (39 new + 320 existing), including four concurrent confirmations, bounded history, owner isolation, invoker/trigger grants, exact preset parity, successful update capture and injected failure during End creation after the Round/history inserts. The owned cluster was stopped and removed.
- Web, mobile and core TypeScript passed. Root lint and lint on changed mobile runtime files passed. Next.js 16.4.1 production build passed. Android and iOS Expo JavaScript/Hermes exports passed; no EAS/native build was submitted.
- Opera rendered the actual Sessions/Configure Round components with isolated synthetic transports. One-tap `9 × 4` restored all fields, editing to `6 × 12` used the existing confirmation flow, desktop light and 320-pixel dark layouts were inspected, and the narrow layout had no horizontal overflow. Browser error logs were empty. The scoring viewport in this presentation fixture was stubbed; scoring correctness is covered by the existing regression suite.

The database fixture emulates Supabase Auth roles and does not validate hosted JWT/PostgREST. Browser fixtures are not production synchronization. Physical Android/iOS and real signed-in web-to-phone synchronization remain release checks.

## Release requirements

1. Separately review/authorize the additive migration and apply only that canonical version using the intended project's migration-aware transaction workflow. Preserve all existing migrations and the seven documented historical aliases. Verify owner RLS/grants and trigger installation. No production database operation occurred during implementation.
2. Release the reviewed web and Expo changes through their existing workflows. The trigger also captures successful custom configurations from older clients using the unchanged RPCs; existing installed clients remain compatible.
3. Verify web → mobile and mobile → web recall, recency, deletion and account switching using consenting test accounts. Check native keyboard, horizontal history scrolling, accessibility and restricted modal behavior on devices.

## File manifest

New: `packages/core/src/recent-round-configs.ts`, `packages/core/tests/recent-round-configs.test.mjs`, `src/features/sessions/recent-round-actions.ts`, `src/features/sessions/components/recent-round-configs.tsx`, `src/features/sessions/components/recent-round-configs.module.css`, `apps/mobile/src/recent-round-configs.tsx`, `apps/mobile/tests/recent-round-configs.test.mjs`, `supabase/migrations/20261027061217_recent_custom_round_configs.sql`, `scripts/recent-round-configs-fixture.mjs`, `tests/helpers/recent-round-runtime.mjs`, `tests/recent-round-configs.test.mjs`, this document.

Modified: `packages/core/package.json` (export only), `src/features/sessions/components/sessions-workspace.tsx`, `apps/mobile/app/sessions/[sessionId]/configure-round.tsx`, `apps/mobile/app/rounds/[roundId]/score.tsx` (recent UI integration only), `scripts/test-notes-feedback-pg.mjs` (new fixture invocation), `tests/session-category-tabs.test.mjs`, `tests/scoring-replot.test.mjs`, `apps/mobile/tests/native-target-gestures.test.mjs` (new child mocks, existing assertions preserved).

No dependencies, authentication architecture, Session creation, Live Coaching/BLE/1 Hz code, Garmin logic, EAS configuration or production infrastructure changed. Work remains uncommitted on local `main`.
