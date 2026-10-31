# Protected production release gates

Status: implemented locally; GitHub/Vercel enforcement is NOT enabled by these files.
No settings, deployments, secrets or production data were modified.

## Exact check contract

Workflow: `Validate Arc Track` (`.github/workflows/validate.yml`).
Required check name/job name/job ID: **`release-gate`**.
Publisher expected in GitHub: **GitHub Actions**.
No other workflow should publish a check with this name.

Every pull request (including drafts/any target branch) and every push to main
triggers the workflow without path filters. Manual dispatch is retained and
forces all scopes. Existing concurrency cancels superseded runs; a cancelled
or missing gate is not an approval. Existing essential/full-suite selection,
web production build, core/mobile tests and advisory Lighthouse behavior remain.

`changes` computes explicit true/false outputs. Maintenance is mandatory for
all commits, including documentation-only commits. Known platform scopes retain
their existing routing. Unclassified paths require all platform jobs. Only
root Markdown/text files and docs Markdown/text can skip platform tests when
no executable/configuration path changed. Git diffs disable rename detection
so moving an executable source to documentation cannot hide its deletion.

`release-gate` uses `if: always()` and waits for changes/web/mobile/core/maintenance.
Its Node script exits nonzero if scope detection fails, scope outputs are absent
or malformed, mandatory maintenance was disabled, or any required job does not
succeed. An unaffected job may be skipped or may succeed; a failure/cancellation
still rejects the gate. No npm install is necessary in the gate itself.
All jobs use pinned actions, contents:read only, and checkout credentials are
not persisted. Validation jobs do not receive deployment secrets.

A green gate means all validation required by this repository's scope policy
ran successfully; it is not proof of exhaustive tests, browser acceptance or a
production deployment. Full workflow cancellation may prevent the final job
from starting: the required result then stays cancelled/missing, never success.
A repository administrator who can edit/remove rules or workflows remains a
trust boundary; this does not make malicious workflow edits impossible.

## GitHub ruleset: manual configuration after approved publication

Repository: hqasdf/arctrack. Settings -> Rules -> Rulesets -> New branch ruleset.

| Setting | Required value |
| --- | --- |
| Name | Protect main releases |
| Enforcement status | Active |
| Target branches | Include main only (`refs/heads/main`); no exclusions |
| Bypass list | Empty, including no ordinary admin/team/app bypass actor |
| Require a pull request before merging | Enabled |
| Required approving reviews | 0 (solo developer can merge their own PR after CI) |
| Require Code Owner review | Disabled for the solo workflow |
| Require approval of most recent reviewable push | Disabled; cannot self-approve |
| Require conversation resolution | Enabled |
| Require status checks | `release-gate`, expected source GitHub Actions |
| Require branches to be up to date | Enabled |
| Do not require status checks on creation | Disabled |
| Block force pushes | Enabled |
| Restrict deletions | Enabled |
| Restrict updates | Do not enable; this could block ordinary PR merges |
| Require deployments before merging | Do not require production; avoid a merge/deploy dependency cycle |
| Merge queue | Leave disabled: this workflow does not yet handle merge_group |

Publish only the reviewed CI changes with separate commit/push approval. Let
GitHub record the exact check name before selecting it as required. Verify the
repository plan/visibility supports active rulesets. A missing check should
block merging rather than being replaced with a differently named check.
For classic branch protection, also enable the option preventing administrator
bypass, and leave force-push/deletion allowances disabled.

Do NOT select the failing Supabase Preview integration check as required. Its
migration-history issue is separate and not repaired or ignored by this gate.

GitHub references:
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository

## Vercel Deployment Checks: manual configuration

Read-only inspection on 2026-10-31 confirmed:
- Project: arctrack (`prj_NqILzPu1e3tzpBH9wK9MrWxsICej`), Next.js.
- Team ID: team_BuAMYUKoFWU2hau5s3JuryqH.
- Listed domain: archery-website.vercel.app.
- Latest returned production-target deployment: dpl_EixaPQV3Ub8DfxRXTkLrdBsLnvUb,
  READY. This is an observation, not a deployment performed by this task.

The current checkout has neither a root vercel.json nor a .vercel/project.json
link. The read-only project response did not expose Deployment Check settings,
Git linkage details, or automatic-aliasing configuration. Existing enforcement
is therefore NOT claimed verified. Do not create a new project or relink blindly.

In the existing arctrack project:
1. Settings -> Git: verify repository hqasdf/arctrack and production branch main.
2. Production environment settings: verify automatic production domain assignment
   is enabled, as required by GitHub-backed Deployment Checks.
3. Settings -> Deployment Checks -> Add Checks -> provider GitHub.
4. Select the exact GitHub Actions check `release-gate` and make it required for
   production. Do not substitute the Vercel build result or Supabase Preview.
5. Keep existing credentials, build settings, root directory and domains unchanged.

Vercel may build a production artifact while CI is running. With the check
configured, it holds production domain assignment until the matching commit's
required result passes. A READY build alone does not prove promotion. The main
push run supplies validation for the production commit; PR checks may run on a
synthetic merge SHA and must not be assumed to validate a different deployed SHA.
No repository_dispatch bridge, Vercel token, status-write permission or deployment
step is required for this ordinary GitHub Actions check.

Vercel documents a Force Promote override. Limit release/configuration access to
trusted maintainers and do not use Force Promote in the ordinary workflow.
This preparation cannot claim an unbypassable Vercel security boundary. CLI/manual
release paths must be verified separately; do not assume a staged CLI build or
manual promotion is governed identically to the configured Git integration.

Reference: https://vercel.com/docs/deployment-checks

## Activation acceptance (requires separate publication/settings authorization)

Use safe, unmerged test PRs for passing/failing/cancelled and docs-only cases.
Confirm check names and actual hosted needs results; local tests do not simulate
GitHub's scheduler. Required-job skips must fail the gate, while docs-only runs
must show maintenance success and unaffected platform skips.

After settings are enabled, verify one approved production release is held while
its matching main-commit gate is pending, remains unpromoted on failure, and only
receives the production domain after success. Confirm deployment SHA and domain
assignment independently. Do not deploy deliberately broken code merely to test
this; use a controlled safe CI failure before promotion. Neither this hosted
acceptance nor settings activation was performed during local preparation.

## Local verification results

- Gate policy/CLI/workflow regression tests: 50 passed, 0 failed, 0 skipped.
- Full website regression suite: 859 passed, 0 failed, 0 skipped.
- Maintenance suite: 82 passed, 0 failed, 0 skipped (includes the 50 gate tests).
- Workflow contract validation, architecture boundaries, migration consistency,
  root ESLint and git diff --check passed.
- No hosted GitHub workflows were dispatched and no deployment/promotion was
  performed. GitHub scheduler/cancellation and Vercel hold/release behavior still
  require hosted acceptance after separately approved publication/configuration.
- Application code, database files and all pre-existing uncommitted work were
  preserved. Mobile/core jobs and web build commands remain in CI unchanged;
  local mobile/core/build suites were not unnecessarily repeated for CI-only edits.
