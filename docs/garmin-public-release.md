# Garmin public account-linking release — 24 October 2026

## Scope and eligibility

The owner approved removing the temporary OAuth test-user restriction, committing
and pushing the scoped change to main, and deploying through the existing Vercel
project `archery-website`. Public means **all authenticated Arc Track website
users**, not anonymous access. No UUID list, email exception or administrator role
is required. The server accepts only a verified Supabase user identity, exact
`GARMIN_CONNECT_ENABLED=true`, valid provider configuration and the existing
PKCE/state/browser-binding/single-use transaction checks.

Cleanup remains available when new connections are switched off. Encryption,
provider identity/ownership checks, refresh leases, deregistration and durable
account-deletion fences are unchanged. No real deregistration or account deletion
is authorized by this release.

## Verified preflight

- Production alias: `https://archery-website.vercel.app`.
- Vercel project ID: `prj_NqILzPu1e3tzpBH9wK9MrWxsICej`.
- Starting production deployment: `dpl_FsY4Qz6DGQB8wrRCM6ZgqZ5a6ANv`, Ready,
  sourced from main at `0f5538720061f6d630f716014ce959592c14794b`.
- Local HEAD and remote main match that starting production commit; the local
  working tree was clean before this release work.
- Production already has `GARMIN_CONNECT_ENABLED=true`, the canonical APP_URL and
  `GARMIN_REDIRECT_URI=https://archery-website.vercel.app/api/integrations/garmin/callback`.
- Client ID, client secret, encryption-key and Supabase server-secret variable
  names are present. Secret values were not displayed or rotated. The obsolete
  OAuth test-user variable is absent, so no production variable deletion is needed.
- All Garmin variables were created after the starting deployment became Ready.
  Its anonymous Start/Callback probes return safe 503 responses. A new deployment
  is required to load the saved production configuration as well as the new code.
- The two OAuth migrations are recorded in Supabase project
  `pdwxphgyqbbflnrruobp`; health migration `20261023155612` is not applied.
  The read-only connection-status aggregate contains no connection rows.

## Health remains unavailable

Public OAuth does not enable health delivery. There is no approved ingestion
cohort; its configured list is empty, and the Health flag alone cannot enable
readers/receiver/worker. The incoming provider verifier still returns null.
The configured push and internal process handlers therefore return 503 before
reading a body or accessing the database. No health migration, scheduler or
provider endpoint configuration is changed. The dashboard reports connection
status and explicitly says health import is not activated; it does not fabricate
an awaiting-delivery state based on successful OAuth alone.

## Validation and rollout

Local verification: 124 focused Garmin/Health tests and all 390 website tests pass;
TypeScript, repository lint, production build and diff checks pass. There are no
test failures or skips. Review the exact changed-file list and stage
only this release. Commit message: `feat: enable Garmin Connect for authenticated users`.
Verify remote main still matches the starting commit before pushing. Do not use
force push. Follow the Git-connected production build and verify its commit, Ready
state and canonical alias before reporting completion.

After delivery, check the homepage, sign-in, authenticated Profile/Connect button,
signed-out status/start rejection, callback route, and disabled push/worker
responses. Do not initiate real consent, deregistration or account deletion as a
substitute for these non-destructive release checks. A real Garmin authorization
and subsequent provider delivery remain separate, unverified tests.

Rollback: redeploy with `GARMIN_CONNECT_ENABLED=false` to stop new linking, retaining
the existing credentials and encryption key for cleanup. Do not revert to the old
allowlist implementation while the production flag is true, or erase existing
connection evidence. No database rollback is required for this release.
