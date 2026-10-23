# Garmin connection retention review

Status: local implementation review for owner decisions, not a declaration that
the Garmin integration or its migrations are deployed. No live provider settings,
backup configuration, logging retention, or real-account deletion were inspected
for this document.

## Current data and behavior

This phase connects an account. It does not import Garmin activity or health
records. The privacy wording in `src/app/privacy/page.tsx` describes connection
credentials and permissions, cleanup before account deletion, and unresolved
provider backup/log retention. Do not describe account connection as activity
history storage or remote deletion of a Garmin account.

| Data | Implemented storage and removal behavior |
| --- | --- |
| OAuth state/browser-binding hashes and encrypted PKCE verifier | One `public.garmin_oauth_transactions` row per Arc Track user. Authorization validity expires after ten minutes. Expired rows cannot be consumed by the callback, but expiry does **not** physically delete them. Rows can remain until replaced by a later start, consumed by a valid callback, invalidated through the scoped disconnect/deletion path, or removed by Auth-user cascade. |
| Browser-binding cookie | HttpOnly and scoped to `/api/integrations/garmin`; ten-minute maximum age. Success and selected failure/disconnect paths clear it. Browser cookie expiry is not deletion of the corresponding database row. |
| Access and refresh credentials | Encrypted together before storage in `public.garmin_connections.token_ciphertext`. Provider expiry timestamps determine use/refresh eligibility; expiry does **not** delete ciphertext. Successful rotation replaces saved credentials. |
| Failed or uncertain cleanup credentials | Available encrypted credentials are retained to support deregistration retry or reviewed recovery. A provider failure, lost response, expired token, or interrupted operation does not establish successful remote deregistration. No automatic finite retention deadline is implemented for these cases. |
| Connection metadata | Garmin user identifier, status, permissions, authorization/check timestamps, expiry timestamps, operation/version/lease and safe error code. A successful disconnect clears saved credentials, Garmin identifier, permissions and connection/authorization timestamps, while retaining a local status/cleanup receipt and applicable check metadata. |
| Account-deletion fence and receipt | `deletion_requested_at` is durable; lease expiry does not remove it. `deregistered_at` records confirmed cleanup. If Arc Track account deletion fails afterward, the receipt/fence remains for a safe retry. Successful Auth-user deletion cascades the local connection and transaction rows. |

Both tables have RLS enabled, no ordinary client grants/policies, and narrowly
limited service-role table grants. Status DTOs do not expose saved credentials or
the raw Garmin identifier. Encryption is a confidentiality control, not an expiry
or erasure mechanism.

No scheduled physical cleanup job, TTL deletion, retention scheduler, or Garmin
record archive exists in these migrations. Lease expiration releases no personal
data by itself and must not be treated as a retention job.

## Account deletion and exceptions

The web account-deletion hook verifies identity and password before preparing
Garmin cleanup. Confirmed remote deregistration precedes local Auth deletion.
When cleanup cannot be confirmed, deletion fails closed: the account, deletion
fence and available encrypted credentials remain. This is distinct from a
successfully deleted account whose old records may still exist in provider
backups.

Successful Auth deletion removes the two Garmin tables' rows through their
`auth.users` foreign keys. This is live-row removal, not a claim about immediate
physical erasure from PostgreSQL storage, backups, replicas or logs. It does not
delete the user's Garmin account or Garmin activity history.

Remote deregistration, token rotation and local persistence are separate systems.
A crash or lost response can make the remote outcome uncertain. Do not silently
erase retained credentials/fences to resolve that uncertainty, or promise that
every failed cleanup can recover automatically.

## Backups and operational logs: not established

This source review does not establish Supabase backup/PITR retention, deleted-row
physical storage reclamation, Vercel request/error-log retention, third-party
monitoring retention, or Garmin's own retention. Those settings and contractual
obligations require operator verification. The existing privacy policy marks
backup/log retention as awaiting confirmation.

Application code avoids deliberately logging tokens or raw provider responses,
but that does not prove that infrastructure logs never record callback query
parameters, request URLs, IP addresses, or account identifiers. The callback's
no-store/no-referrer responses do not configure hosting log retention. Review
provider logs and observability configuration without copying credentials into
documentation or issue trackers.

## Decisions for the owner before wider activation

1. **Abandoned OAuth attempts:** approve a retention policy for physically deleting
   expired transaction rows. Decide who operates cleanup and how failures are
   monitored. Ten-minute authorization validity must remain separate from the
   chosen storage-retention policy. No period or cleanup implementation is
   approved by this review.
2. **Successful disconnect metadata:** decide which status/check/confirmation
   fields must remain to distinguish confirmed deregistration from uncertain
   cleanup, and when those noncredential receipts should be removed. Do not retain
   unnecessary provider identifiers or permissions after a successful disconnect.
3. **Failed cleanup:** define a support owner, secure recovery/escalation process,
   and review policy for retained credentials and permanent deletion fences.
   Document how the user is informed and requests help. Any finite retention or
   forced-erasure exception requires an explicit decision about losing retry
   capability; it must not be presented as confirmed Garmin deregistration.
4. **Backups and logs:** verify actual enabled providers and retention settings,
   access restrictions, log redaction, and deletion-request handling. Set truthful
   policy wording only after this evidence is available; do not invent periods.
5. **Encryption keys:** assign key custody and a tested rotation/recovery process.
   Destroying a key while failed cleanup still needs its credentials can make
   remote deregistration unrecoverable. A key rotation plan is not implemented by
   these connection migrations.
6. **Notice consistency:** preserve the current distinction between connection
   metadata, retained cleanup credentials, expired-but-stored transactions and
   backup/log copies. Review the public notice again before any later Garmin data
   import feature changes the information collected.

## Evidence locations

- `supabase/migrations/20261023074736_garmin_oauth_connections.sql`
- `supabase/migrations/20261023082837_garmin_account_deletion_fence.sql`
- `src/features/garmin/store.server.ts`: scoped consume/invalidate and persisted rows.
- `src/features/garmin/service.server.ts`: refresh, deregistration and deletion preparation.
- `src/features/garmin/http.server.ts`: binding-cookie lifecycle and response headers.
- `src/features/profile/account-deletion-actions.ts`: cleanup before Auth deletion.
- `src/app/privacy/page.tsx`: existing public retention/deletion wording.

This document records existing behavior and proposed policy decisions only. It
does not authorize a database job, live configuration change or retention period.
