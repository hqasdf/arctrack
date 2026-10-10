# Self-service account deletion — server-only preparation

## Current state

The previous authenticated deletion RPC was never applied to main. Its pending migration has been removed so future migration application cannot recreate the bypass. No new database function, table, policy or grant is needed for this design. Main has not been modified.

## One verified deletion boundary

Web and Expo Profile still link to `/delete-account` on the existing production origin. The page/form are unchanged. Signed-out users use existing sign-in/recovery and return to the resource; users complete deletion themselves, without operator approval or support requests.

The server action checks exact DELETE confirmation, obtains the current account via authenticated getUser(), verifies its password using an isolated non-persistent publishable-key client, checks the verified ID/session, then calls Auth Admin deleteUser(currentUser.id, false). Browser-supplied IDs and email never choose the target. The isolated verification session is signed out in finally, including failures; normal browser cookies are changed only by successful deletion cleanup. Current Arc Track login/signup uses email/password; no OAuth, anonymous or passwordless login flow was found in application source.

The single admin helper imports server-only. It reads SUPABASE_SECRET_KEY exclusively from server environment and uses no cookies, caller Authorization headers, persistence or refresh timers. This may contain the configured project's Supabase secret or legacy service-role key. No real credential was added. A blank variable is documented in .env.example. Missing configuration fails safely. Do not prefix it with NEXT_PUBLIC_ or EXPO_PUBLIC_, store it in Git, or add it to Expo/EAS.

## Data behavior

Auth hard-deletion relies on existing FK cascades for profile, owned Sessions/Rounds/Ends/Arrows, memberships, athlete assignments, operation budgets and Auth sessions/refresh records. Shared organisations and Training Plans/days remain, creator/assigner references become NULL, and other athletes' records remain unchanged. No coach is promoted; an organisation may remain without management access. Current Storage is unused; recheck Storage ownership before release because it can block Auth deletion. Backups/provider-log retention remains an operator privacy-policy decision.

Success is shown only after the Admin API returns success. Provider/FK/network failure produces a safe error without browser sign-out. After success, browser Auth cleanup and local Counter cleanup retain their existing behavior. Other-device JWTs are not instantly cryptographically invalidated, and the server cannot remotely erase Expo's local Counter. Verify refresh/login rejection and database authorization in the disposable stack.

## Local runtime testing

Runtime validation executed on 2026-10-10 using Docker 29.8.2, Supabase CLI 2.120.0 and PostgreSQL 17.11 in the unlinked `arc-track-account-deletion-qa` workspace under the Windows temporary directory. All 15 current migrations applied; the retired deletion RPC was absent. No production connection or credentials were used for destructive tests.

The rollback SQL fixture passed legacy RPC denial for anon/authenticated, FK preservation, Auth-session and budget cleanup, and injected-failure atomicity. Its setup was corrected to capture the organisation UUID using INSERT RETURNING id, rather than selecting the inaccessible created_by column. Grants and application schema were not changed.

The local-only integration runner passed actual SDK password/Auth/Admin deletion and the real action logic, Archer/Head Coach/former-member cascades, shared-data preservation, ordinary-client Admin rejection, legacy RPC absence, wrong/missing confirmation, signed-out denial, repeat denial and deleted-account login/refresh rejection. Naturally expired local JWT denial was exercised with a temporary 60-second local Auth setting, then the stack was restored to 3600 seconds. Mismatched provider identity remains an application mock test because the real Auth provider must not return a different identity for that account's credentials. Browser-cookie/CSRF and manual UI acceptance remain separate from the module/API harness.

## Manual localhost test

Normal application use is supported at http://localhost:3000/delete-account. Docker and a special browser port are not required. The normal `.env.local` currently targets the main Arc Track project but has no `SUPABASE_SECRET_KEY`; this prevents Admin client creation after password verification. Configure that server-only variable with the intended project's secret key in the web repository's ignored `.env.local`, then restart `npm run dev`. Keep the existing public URL/key and APP_URL. Never put this credential in public variables, Expo, or Git. Do not use a main-project Admin credential for disposable deletion QA.

Next.js development precedence is process environment, `.env.development.local`, `.env.local`, `.env.development`, then `.env`. Remove stale process overrides if they select a different backend. Both the publishable client and Admin client use the same URL from `getAuthConfig()`; the secret must belong to that project. A development-only diagnostic reports missing Admin configuration without logging credentials.

The following is optional disposable QA, not normal application setup. Stop an existing dev server on port 3000 before running it; never rewrite the normal main-project configuration for this test.

The disposable stack is left running for this check. Run the following from the web repository in a fresh PowerShell window. Variables apply only to that process and its child; `.env.local` is not rewritten. Do not echo `$local`, whose values include generated local credentials.

```powershell
$env:PATH = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;" + $env:PATH
$qaRoot = Join-Path $env:TEMP 'arc-track-account-deletion-qa'
$local = (& npx --yes supabase --workdir $qaRoot status -o json | Out-String | ConvertFrom-Json)
if ($local.API_URL -notmatch '^http://(127\.0\.0\.1|localhost):54321/?$') { throw 'Non-local API rejected.' }
$env:NEXT_PUBLIC_SUPABASE_URL = $local.API_URL
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = $local.PUBLISHABLE_KEY
$env:SUPABASE_SECRET_KEY = $local.SECRET_KEY
$env:APP_URL = 'http://localhost:3000'
npm run dev
```

Open http://localhost:3000, create a fake account, add a test Session/Round, open Profile → Delete Account, verify the password and type DELETE. Confirm completion and failed subsequent sign-in. Local default email confirmation is disabled; this check is not production signup/OTP QA. Never enter real account credentials. Stop Next with Ctrl+C and close the test PowerShell window afterward.

To stop only the disposable stack later: `npx --yes supabase --workdir $qaRoot stop --project-id arc-track-account-deletion-qa`. Do not use --all or remote commands. Keep the configuration and migrations for reruns. No synthetic accounts or scoring records remain after automated test cleanup.

## Production approval and rollback

Before release, runtime-test the disposable stack, approve setting SUPABASE_SECRET_KEY in Vercel server environment, verify main still has no legacy deletion RPC, and separately approve deployment of the existing route/action. No deletion SQL needs applying. If an old RPC unexpectedly exists in any environment, stop and prepare reviewed revocation/removal SQL; do not silently remove live objects.

Rollback means disabling/removing the deletion server secret and reverting only the local deletion page/action/entries as separately approved. It does not undo a completed deletion. No historical applied migration is changed. The retired draft had an older timestamp than current migrations but no live history entry; do not rename it into a new applied migration or run bulk pending migrations against production.
