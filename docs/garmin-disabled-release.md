# Garmin website release — connections disabled

Prepared 23 October 2026. Local preparation only: no commit, push, deployment or
Vercel setting change is authorized by this document.

## Verified baseline and database

- Existing Vercel project: `archery-website`, linked to `hqasdf/arctrack`, branch main.
- Production and local HEAD: `44676727c9967849a219f424846900b0f09da79a` (homepage edits).
- A read-only `git ls-remote` check confirms remote main matches that same commit.
- Supabase project: `pdwxphgyqbbflnrruobp`.
- Original migration versions `20261023074736` and `20261023082837` are recorded.
  Do not run either migration again or invoke database synchronization on release.
- Garmin tables have 17/8 columns, 16 validated constraints, four supporting
  indexes, both guards/triggers, RLS and service-only DML/EXECUTE permissions.
  Both tables are empty. No Garmin connections or OAuth transactions exist.

## Required initial Production configuration

After explicit approval, add only `GARMIN_CONNECT_ENABLED=false` to the existing
Vercel project's Production environment as server configuration. Verify the saved
value before building the release. It is currently absent; absence already denies
new authorization, but this release requires an explicit false value.

Do not configure Garmin client credentials, encryption keys, callback configuration
or test-user UUIDs during this disabled rollout. No shared variables are currently
linked. Preserve APP_URL, the intended project's public Supabase configuration and
the existing server-only SUPABASE_SECRET_KEY. The latter remains required for the
existing account-deletion feature and the Garmin deletion-fence storage.

Missing Garmin configuration makes the Profile card unavailable and Start/Callback
return safe 503 responses. Status authenticates first (signed-out 401; configured
identity but missing Garmin configuration 503). With provider configuration present
and the switch false, Start and a valid pending Callback are denied by eligibility
checks before provider authorization/exchange. Service methods enforce the same
restriction. Neither an allowlist nor a UI change can override false.

Never-linked account deletion does not require Garmin credentials: the guarded
deletion preparation records a local readiness receipt without provider calls.
Future connected-account cleanup still needs its provider credentials and original
encryption key. The rollout gate intentionally does not disable status/refresh,
Disconnect or deletion cleanup for existing users.

## Complete intended change manifest

These 31 paths are the entire intended commit, relative to the repository root.
The base commit supplies all unchanged website, mobile, core and dependency files.
SQL files are included for source/history reproducibility, not execution on deploy.

```text
.env.example
docs/garmin-disabled-release.md
docs/garmin-live-testing.md
docs/garmin-migration-safety.md
docs/garmin-oauth.md
docs/garmin-retention-review.md
scripts/test-garmin-sql.mjs
src/app/(platform)/profile/page.tsx
src/app/api/integrations/garmin/callback/route.ts
src/app/api/integrations/garmin/disconnect/route.ts
src/app/api/integrations/garmin/start/route.ts
src/app/api/integrations/garmin/status/route.ts
src/app/delete-account/page.tsx
src/app/privacy/page.tsx
src/features/garmin/components/garmin-connection-card.tsx
src/features/garmin/config.server.ts
src/features/garmin/crypto.server.ts
src/features/garmin/http.server.ts
src/features/garmin/provider.server.ts
src/features/garmin/service.server.ts
src/features/garmin/store.server.ts
src/features/garmin/types.ts
src/features/profile/account-deletion-actions.ts
supabase/migrations/20261023074736_garmin_oauth_connections.sql
supabase/migrations/20261023082837_garmin_account_deletion_fence.sql
supabase/tests/garmin-account-deletion.sql
supabase/tests/garmin-additive-baseline.sql
supabase/tests/garmin-oauth-connections.sql
tests/account-deletion.test.mjs
tests/garmin.test.mjs
tests/privacy-policy.test.mjs
```

Exclude `.env.local`, every real credential/account UUID, `.next`, node_modules,
local tooling/caches, screenshots and other ignored artifacts. No package or
lockfile change is required. No homepage, scoring, core, Coach, Expo or SEO file
is changed. Use this explicit list for staging; never `git add .` or `git add -A`.

## Approved-later production method

Use the existing Git-connected Vercel workflow, avoiding a new project or a CLI
upload of the working directory. Before the approved action, confirm that local
HEAD, remote main and the assigned production baseline have not advanced. Stop
and reassess if they differ; never reset, stash or discard unrelated work.

1. Obtain approval to save Production `GARMIN_CONNECT_ENABLED=false`; save and
   verify only that configuration value. Do not change provider credentials.
2. Obtain approval to stage exactly the manifest, review `git diff --cached
   --name-only` and `git diff --cached --check`, and create one narrow commit:
   `feat: add guarded Garmin OAuth integration (disabled)`.
3. Obtain approval to push that commit to main **and trigger its production
   deployment**. Run `git push origin HEAD:main` only with that approval. A push
   to main publishes through the existing Vercel Git integration; it is not merely
   a source backup. Do not use force-push or run a separate duplicate deployment.
4. Verify Vercel builds the approved commit with the explicit false value, retains
   the expected project/domain, and reports Ready. Review safe build/runtime errors.
5. Run the non-destructive checks below. If a failure occurs, keep authorization
   disabled and preserve the database/credentials; no automatic schema rollback.

There is no migration invocation in the npm build or postinstall scripts. No
additional install, database export or provider API call is required for this
release. Commit, push and configuration approvals have not yet been granted.

## Checks completed locally

- Focused Garmin/account-deletion tests: 86 passed, zero failed.
- Full website suite: 338 passed, zero failed.
- TypeScript, repository lint and production build: passed.
- Build emits all four Garmin route handlers and preserves existing routes.
- Generated browser JavaScript contains no Garmin client-secret/encryption-key,
  Supabase server-secret or test-user-allowlist identifiers or available local
  secret values. The exact manifest matches all 31 pending paths, with no extras.
- Disabled/default eligibility, pending-callback rejection, cleanup while disabled,
  missing configuration, never-linked deletion and account identity checks are
  covered by synthetic tests. These do not constitute real Garmin testing.
- Production database compatibility was verified read-only; no migration or fixture
  was rerun. Existing homepage, scoring, Coach, Expo and SEO sources are unchanged.

## Non-destructive post-deployment checklist

1. GET /: 200; finalized cinematic homepage and target rendering unchanged.
2. GET /sign-in and /sign-up: render; normal password sign-in with an existing
   designated account works. Inspect signup UI/validation without creating an account.
3. Signed-out GET /profile redirects to sign-in. Signed-in Profile renders its
   existing fields and unavailable/disabled Garmin card, with no Connect action.
4. Open an existing Session/Round, grouping insights and Coach Workspace read-only.
   Do not plot, edit, delete or create scoring records merely to smoke-test release.
5. GET /api/integrations/garmin/callback without credentials returns safe 503,
   not 404 and no Garmin authorization redirect. Do not supply a real OAuth code.
6. Signed-out GET /api/integrations/garmin/status: 401. Signed-in without Garmin
   configuration: safe 503, without credentials or raw provider details.
7. Verify the deployment uses false; direct same-origin POST /api/integrations/
   garmin/start from a designated account returns safe 503 with missing provider
   settings, no Location to Garmin and no new database row. The same applies to
   any other account. Do not configure credentials just to obtain a 403 response.
8. Account-deletion page renders and retains identity/password/DELETE controls.
   Do not submit real deletion; non-destructive production QA cannot prove actual
   successful deletion. Rely on the focused automated/disposable coverage.
9. /privacy, /delete-account, /robots.txt and /sitemap.xml remain accessible with
   their established behavior. No new private route is added to public navigation.
10. Inspect generated client assets and safe response data: no Garmin secret,
    encryption key, Supabase server secret, token or test-user allowlist is exposed.
11. Review selected safe runtime errors; verify both Garmin tables remain empty.

No post-deployment check or real authenticated browser interaction has occurred as
part of this preparation. Existing backup/log-retention publication placeholders
remain an owner decision; this release does not invent retention commitments or
represent Garmin connection as health-data synchronization.
