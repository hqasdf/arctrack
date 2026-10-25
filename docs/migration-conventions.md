# Migration source integrity and historical aliases

This document and `supabase/migration-baseline.json` describe repository evidence, not a fresh production check. Phase C made no database connections or SQL changes.

## Existing history

The local source snapshot contains 24 migrations through `20261025003708_garmin_health_admission.sql`. The seven known timestamp discrepancies below are retained from [the earlier deployment record](notes-feedback-production-deployment.md#preserve-historical-mismatches):

| Migration | Canonical local version | Previously recorded production version |
| --- | --- | --- |
| organization_hierarchy | 20260924031957 | 20260924072616 |
| coach_athlete_roster | 20260924080600 | 20260924081628 |
| allow_all_members_to_leave_organization | 20260924132000 | 20260924133550 |
| join_code_organization_model | 20260924160000 | 20260924155552 |
| atomic_round_creation | 20260926010823 | 20260926081514 |
| guarded_scoring_mutations | 20261005010000 | 20261004230822 |
| session_weather_snapshots | 20261016000901 | 20261016130846 |

Do not rename historical files, rewrite recorded versions, repair history automatically, or reapply these aliases. Lexicographic local source ordering cannot establish the actual production execution sequence. A broad `supabase db push` is inappropriate until an independently approved reconciliation/execution plan accounts for these differences.

## New migrations

1. Use the supported Supabase CLI `migration new descriptive_name` workflow. Preserve the generated unique 14-digit UTC timestamp and lowercase underscore description.
2. New versions must follow the canonical baseline. Implement data-preserving, preferably additive changes with explicit dependencies and a reviewed recovery plan. Never edit an already-applied migration to change production behavior; use a new migration.
3. Review existing-data compatibility, transaction/lock effects, RLS/ownership, function search paths and grants. Prefer invoker functions; justify any privileged function. Client roles must not gain access to private ingestion state.
4. Run `npm run check:migrations`. When SQL behavior changes, run the relevant existing disposable fixtures once. Static checks do not prove additive-only semantics, rollback safety, permissions or concurrency.
5. Before any live execution, obtain explicit approval for the exact project, SQL checksum, original version and recovery decision. Use a reviewed version-preserving procedure that records history only with successful execution. Never let unrelated pending migrations run implicitly.
6. Verify actual schema, history and permissions after authorized execution. Do not fabricate a history row or blindly rerun SQL after a partial failure. Preserve diagnostic evidence without exposing data/secrets.

## Baseline safeguards

The local checker rejects duplicate/invalid timestamps, empty/conflicted SQL, historical content changes, missing/renamed baseline files and retroactively dated new migrations. Baseline hashes normalize CRLF to LF for Windows/Linux Git checkout consistency. They are **not** the byte-exact production execution checksums used in approval manifests.

After a new migration is reviewed, extend the baseline deliberately. Never regenerate existing hashes to hide a changed historical file, and never treat editing the baseline as permission to modify applied SQL. The baseline itself must be reviewed in Git. No baseline update can reconcile live history or authorize execution.
