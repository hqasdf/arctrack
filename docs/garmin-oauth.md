# Garmin account connection

Controlled activation, backup/rollback, administrator recovery and real-account
test sequence: [garmin-live-testing.md](./garmin-live-testing.md).
Retention decisions awaiting owner review: [garmin-retention-review.md](./garmin-retention-review.md).

New authorization is disabled unless `GARMIN_CONNECT_ENABLED=true` and provider
configuration is valid. All authenticated Arc Track users are eligible; no test-user
list is required. Start and Callback verify the Supabase identity and enforce the
master switch on the server. Keep provider configuration and keys when disabling new connections:
existing status/refresh, Disconnect and account deletion remain available to owners.

This is website-only account authorization, not health/activity synchronization.
Production update, 23 October 2026: both reviewed migrations were applied and
verified on project `pdwxphgyqbbflnrruobp`, under original versions
`20261023074736` and `20261023082837`. Do not reapply them. The website integration
was subsequently deployed at `0f5538720061f6d630f716014ce959592c14794b`.
Read-only checks on 24 October confirmed the production callback and APP_URL,
configured credential names and `GARMIN_CONNECT_ENABLED=true`. The earlier code
still required a test-user list, which denied all new connections when absent.
The approved public account-linking release removes that restriction; see
[garmin-public-release.md](./garmin-public-release.md). Real consent remains
unverified. Health ingestion is a separate disabled capability, not an OAuth result.

## Protocol and implementation

Reference: [Garmin OAuth 2.0 PKCE specification](https://developerportal.garmin.com/sites/default/files/OAuth2PKCE_1.pdf), checked 23 October 2026.

| Operation | Official endpoint |
| --- | --- |
| Authorization | `https://connect.garmin.com/oauth2Confirm` |
| Code exchange / refresh | `https://diauth.garmin.com/di-oauth2-service/oauth/token` |
| User identity | `https://apis.garmin.com/wellness-api/rest/user/id` |
| Granted permissions | `https://apis.garmin.com/wellness-api/rest/user/permissions` |
| Deregistration | `DELETE https://apis.garmin.com/wellness-api/rest/user/registration` |

Garmin uses S256 PKCE, form-encoded token requests and rotating refresh tokens.
API scopes are not chosen by adding a custom scope parameter. Use the response's
expiry fields; the published examples and prose give inconsistent fixed lifetimes.
The published permissions example has invalid JSON punctuation; this implementation
accepts a JSON array of permission strings. Confirm that response contract in live QA.

The Profile card submits a same-origin POST to `/api/integrations/garmin/start`.
Arc Track's existing no-referrer policy makes native forms send `Origin: null`.
The POST guard accepts that exact case only with `Sec-Fetch-Site: same-origin`;
cross-site, same-site and missing Fetch Metadata do not receive this exception.
Requests with an explicit matching Origin are accepted unless marked cross-site.
The server verifies the existing Supabase user, creates unpredictable state and a
64-character verifier, and binds the transaction to that user and a separate
HttpOnly browser cookie. The verifier is encrypted; only hashes of state and browser
binding are stored. The transaction expires after ten minutes.

`/api/integrations/garmin/callback` validates the current user, state, browser cookie,
callback configuration and transaction version. Atomic DELETE RETURNING consumes the
transaction once. Successful exchange, identity lookup, permission lookup and a
conditional database commit must all succeed before connection is reported.
Switching Arc Track accounts midway cannot transfer the association. One Garmin
user ID cannot be assigned to two Arc Track users. Success URL parameters alone
cannot cause the card to announce a successful connection.
Reauthorization cannot silently replace a previously linked Garmin identity; the
user must explicitly disconnect before linking a different Garmin account.

All Garmin API calls use fixed HTTPS endpoints, reject redirects, have a ten-second
timeout and bound response sizes. Provider bodies and credentials are never logged
or returned in error messages. Routes return private/no-store and no-referrer headers.

## Storage, refresh and disconnect

Prepared migration: `supabase/migrations/20261023074736_garmin_oauth_connections.sql`.

`public.garmin_connections` holds the provider identity, status, timestamps,
permissions, encrypted token envelope and versioned operation lease.
`public.garmin_oauth_transactions` holds one authorization transaction per user.
Both have RLS enabled, no ordinary-client policies, and no anon/authenticated table
privileges. Only the server service-role client can read or write them. API actor IDs
always come from verified Supabase `getUser()`, never submitted user IDs.

AES-256-GCM encrypts access/refresh tokens and the PKCE verifier with a new IV.
Authenticated additional data binds each envelope to its user and purpose. The key
is separate from Supabase credentials and never public. Replacing/loss of that key
requires users to reconnect; do not rotate it without an explicit migration plan.
There is no browser token storage and no cross-user cache.

Refresh runs on demand when Profile/status is read and the refresh margin is reached.
There is no timer, polling job, backfill or ingestion endpoint. A conditional
version/lease update permits one refresh worker; late results cannot overwrite newer
state. A database trigger locks/checks the connection version before publishing a
transaction, preventing a delayed old start from replacing a newer start. Expired
exchange/refresh leases require reauthorization because a provider refresh token
may have rotated before a process terminated. Transient failures report an error;
expired tokens are never presented as healthy. The card also expires its badge if
left open past the access-token deadline.

Status describes the last successful authorization/token refresh, not continuous
provider monitoring. Permission changes made in Garmin are not pushed to Arc Track
yet; a valid cached token does not trigger a provider call on every status read.

Disconnect attempts Garmin deregistration and then removes local tokens, permissions
and provider identity after confirmed success. If the provider request fails,
encrypted credentials are retained and the UI reports an error so cleanup can be
retried. Rotated tokens are durably checkpointed before subsequent identity or
deregistration requests. No existing Garmin activity is deleted.

### Arc Track account deletion

The official Garmin specification requires deregistration for both Disconnect and
Delete My Account. Account deletion now invokes Garmin cleanup after the existing
verified identity, exact DELETE confirmation, isolated password reauthentication
and matching-user-ID checks, and before Admin Auth deletion.

Follow-up migration: `supabase/migrations/20261023082837_garmin_account_deletion_fence.sql`.
It adds a durable `deletion_requested_at` fence, `deregistered_at` cleanup receipt,
a delete operation lease, and a private invoker trigger preventing fence removal or
new normal operations. The original OAuth migration remains unchanged.

Deletion claims only an idle connection or an expired deletion lease. A normal
operation already in progress must drain first; deletion reports busy without
invalidating credentials being returned by that operation. Expired normal operations
report recovery required rather than endless busy. After deletion acquires its
lease, new Connect, callback exchange, refresh and Disconnect claims are blocked,
including after a crash or lease expiry. Even a never-linked user gets a fenced
row, preventing Connect from racing an absence check.

Never-linked users need no Garmin provider credentials or calls. Connected users
must complete identity verification and deregistration. Expired tokens are refreshed
and checkpointed before further calls. Only a successful provider DELETE permits
credential erasure and a durable cleanup receipt. For never-linked users the same
receipt records that remote cleanup was unnecessary. Admin deletion runs only after
this receipt exists; the existing Auth FK cascade then removes both Garmin tables'
user records. If Auth deletion fails, the receipt and fence survive for retry.

Network, query, configuration and remote failures do not become deletion success.
Generic 401, 404 and invalid_grant responses are NOT interpreted as confirmed prior
revocation: the supplied Garmin specification defines no such response guarantee.
Encrypted credentials remain available where they were successfully stored.
Interrupted token rotation/exchange and a lost remote-success response may require
provider-assisted recovery. The UI reports that the account has not been deleted;
it does not automatically send users to Garmin Connect or claim automatic recovery.
No cross-system transaction can make Garmin HTTP and PostgreSQL/Auth deletion
atomic. A crash after token rotation but before storage can still lose the newly
issued credential; ambiguous cases fail closed instead of erasing evidence.

**Release ordering is mandatory:** approve and apply BOTH Garmin migrations before
deploying the account-deletion hook. Missing schema/query errors fail closed even
for never-linked users; they are not silently treated as absent Garmin data. Garmin
configuration loss for a connected user also blocks deletion safely. A successful
deletion request permanently pauses Garmin connection changes until deletion
finishes; there is no automatic fence reset or new cancellation workflow.

## Development configuration

Use ignored `.env.local`; never put real values in `.env.example`, source, logs or chat.
Required existing settings: `APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and server-only `SUPABASE_SECRET_KEY` for the
same intended project. The integration additionally requires:

```dotenv
GARMIN_CLIENT_ID=
GARMIN_CLIENT_SECRET=
GARMIN_REDIRECT_URI=http://127.0.0.1:3000/api/integrations/garmin/callback
GARMIN_TOKEN_ENCRYPTION_KEY=
```

Generate a dedicated 32-byte key locally and save its base64 output securely:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

1. Obtain a separately registered development callback from Garmin. The provided
   production callback does not authorize arbitrary localhost callbacks. If Garmin
   requires HTTPS, use an explicitly registered trusted HTTPS development origin.
2. Make `APP_URL` and the callback origin identical, including port. Use one host
   consistently; `localhost` and `127.0.0.1` are different origins/cookie hosts.
3. Review/apply only the prepared migration in an approved development database.
   Never run the SQL test fixture against production; it is disposable-database-only.
4. Set the four Garmin server variables plus the existing Supabase settings; restart
   the local Next server. Never expose these settings through `NEXT_PUBLIC_`.
5. Sign in normally and use Profile → Garmin Connect. Perform the real-account QA
   below only with explicit approval and the approved registered callback.

The runtime disables Garmin controls if any required setting is absent/invalid.
No production URL is embedded in provider/service code. For the current production
site, the separately configured callback must be exactly:
`https://archery-website.vercel.app/api/integrations/garmin/callback`.

## Validation and remaining QA

Maintained automated suite: `node --experimental-strip-types --test tests/garmin.test.mjs`.
It covers PKCE, encryption, state/browser/user binding, replay, failures, duplicate
associations, token rotation, concurrency, interrupted leases, disconnect, safe DTOs,
HTTP guards/cookies and Profile controls. Garmin HTTP responses are mocked.

The maintained disposable PostgreSQL runner requires existing local tooling only:

```powershell
$env:PG_BIN = '<absolute directory containing initdb, postgres and pg_ctl>'
$env:PG_DRIVER_MODULE = '<absolute node_modules/pg directory>'
node scripts/test-garmin-sql.mjs
```

It creates its own loopback-only cluster, applies the migration, runs the rollback
fixture, tests CAS and stale-publication races on independent connections, stops
the cluster and removes its owned temporary directory. It accepts no database URL,
does not read `.env`, and emulates Supabase Auth roles/schema. It does not validate
real GoTrue/JWT or PostgREST HTTP against Supabase.

Before production activation:

- Approve and apply BOTH Garmin migrations in order before deploying the hook;
  review live grants/definitions and the recovery limitations above.
- Set server-only Vercel settings and the exact registered production callback.
  Do not change live settings as part of local verification.
- Approve/deploy the application separately, then test real Garmin consent, denied
  consent, account switching, callback expiry/replay, returned permissions, refresh
  rotation and disconnect with a test account. Revisit serverless execution limits
  if real provider latency exceeds the bounded request budget.
- Confirm rendered Profile layout and keyboard/touch behavior on real mobile and
  desktop browsers. Mocked/static UI tests do not prove a real provider round trip.

Future Health/Activity work still needs authenticated push handling, consent/removal
notifications, idempotency, private data storage, user deletion controls and a private
Health UI. No Garmin data is automatically exposed to coaches. No health/activity
data import, synchronization success, or real-account testing is claimed here.
