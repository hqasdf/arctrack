# Garmin Health general availability — 24 October 2026

This document supersedes historical pilot-UUID requirements in the Phase B
implementation notes. OAuth connection alone still does not prove synchronization.

## Eligibility and bounded work

The application no longer reads `GARMIN_HEALTH_TEST_USER_IDS`. No administrator
UUID enrollment is required. The public callback without documented authentication
and the experimental secret-bearing Vercel path remain closed. Production uses the
existing Cloudflare capability and independently authenticated fixed Vercel receiver.

New service-only RPC overloads are `stage_garmin_health_push(jsonb)` and
`process_garmin_health_queue(integer)`. The database maps each verified Garmin
provider ID to its connection, applies Health/Activity permissions, and reuses the
existing receipt guard and processing core. No caller-supplied owner list grants
access. Old service-only signatures remain for rolling-deployment compatibility;
new application code never supplies a UUID list.

A worker processes at most 50 receipts, looks ahead at most 200 pending receipt
entries, and selects at most 50 connection candidates under SKIP LOCKED. Rejected
stale-generation cleanup counts against that same receipt limit. A partial dispatch
index avoids enumerating every connected account. Stable connection lock ordering,
consent changes, deletion fences, paused state, generation checks and conservative
event-time cutoffs remain in effect.

Each scheduled tick also selects at most three due, unpaused, permitted connections
using a partial refresh index. It invokes the existing OAuth status/refresh path
outside SQL transactions, preserving rotation leases, encrypted credentials and
identity verification. Individual provider failures do not block other accounts;
connection error/recovery state remains authoritative. Monitor refresh backlog and
queue age as user volume grows. Expired or invalid authorization remains fail-closed.

Newly connected accounts get the existing automatic control row. A first successful
OAuth authorization can import without operator enrollment. A previously paused or
deleted account still requires explicit Resume with provider verification; connecting
does not erase a deliberate pause. Delete Health Data continues preserving OAuth
while deleting imported and queued data and rotating its durable replay fence.

## Database and scheduler execution

Applied production migration: `20261024153040_garmin_health_general_availability`.
SHA-256: `53889F666F7344B5BE01920C5D5443B78C813E8465E390AE1136E44009B81F96`.
It adds only Garmin functions and indexes. Prior migrations, policies and connection
rows are unchanged. No synthetic Health data was inserted into production.

The initial attempt stopped on an over-strict pg_net privilege check and rolled
back completely, including its history entry. Inspection established the tables
are extension-owned by `supabase_admin`, with provider-default PUBLIC grants that
the project role cannot revoke. The corrected, retested migration leaves these
provider-managed ACLs untouched and applied successfully under its original version.

The updated operational SQL was executed against the existing inactive scheduler.
It is repeatable, validates the expected fixed command, and always leaves the job
inactive. The historical name `arctrack-garmin-health-pilot` is retained solely to
avoid replacing the existing job; there is no pilot eligibility list in the new
application. No credential rotation or new job was needed.

Vault and private scheduler records remain inaccessible to client roles, and client
roles cannot execute the scheduler function. Managed pg_net ACLs are accepted only
for genuine Supabase-owned extension objects and non-login client roles. Unexpected
transport grants still fail the guard. Before preparing or activating the scheduler,
verify public Data API probes using `Accept-Profile: net`, `vault` and `private`
return HTTP 406 / PGRST106. All three probes were checked successfully. Never expose
those schemas, publish views over transport tables, or add a generic SQL proxy RPC.

## Activation state and remaining external prerequisites

Final local validation: 445 website tests and 171 disposable PostgreSQL assertions
passed, with zero failures. TypeScript, repository ESLint, production build and
diff whitespace checks passed. The SQL suite covers multi-user isolation, replay,
delete/pause/resume, revocation, duplicate delivery, concurrency and scheduler
guards. No new physical-watch, genuine provider-delivery or interactive browser
validation is claimed.

The revised database functions and inactive scheduler are installed. The website
source requires release; Cloudflare remains disabled. No secrets were rotated,
no recurring processing was enabled, and genuine Garmin delivery is unverified.

Before enabling collection, resolve the existing Privacy Policy's backup/log
retention placeholders and confirm responsibility for failed cleanup/privacy
requests. Do not assert `GARMIN_HEALTH_PRIVACY_READY=true` from automated tests.
The current policy explicitly says those operational details need confirmation.

Garmin API Tools notification configuration and provider approval have not been
verified in this execution. No provider rejection is claimed. The account owner
must confirm Health and Activity permissions and configure the protected production
callback directly for Dailies, Sleeps, Stress Details, Activities, User Permissions
Change and Deregistrations, using the actual categories available to the application.
Do not print the callback path or transfer it through source control or chat.

Once these prerequisites are satisfied: release the reviewed website with existing
Production secrets; verify fixed-receiver authentication and readiness gates; enable
the Cloudflare receiver and the existing cron job in a coordinated change; check
queue/HTTP processing outcomes and obtain the first genuine Garmin delivery. No
tester UUID is required. Retain global emergency switches and the existing private
ingress capability rotation procedure. Watch testing confirms delivery after activation,
not prerequisite nomination of a pilot account.

Remaining conservative limitations: same-duration changed summaries can be quarantined
as ambiguous, and Resume rejects historical/spanning-cutoff or insufficiently timestamped
events rather than reconstructing deleted history. Monitor conflicts, refresh backlog,
queue age and non-200 scheduled responses; do not report these as silent success.
