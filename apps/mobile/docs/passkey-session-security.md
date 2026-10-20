# Passkey session acceptance: local security checkpoint

**Phase 2 supersession, 20 October 2026:** the historical blocker below informed
the approved Option B implementation. The main app now has a single-record durable
authority and coordinated, server-validated session adoption. See
[current contract and explicit crash boundaries](session-authority.md). Passkey
activation remains disabled; this historical negative control remains useful.

20 October 2026. The existing application remains on its current password/session
storage path. Passkey enrollment and sign-in controls remain disabled. No production
Auth configuration or credential was used or changed.

## Decision

**Do not implement persistent passkey adoption on top of the current adapter as
if it were crash-atomic.** The current public SecureStore architecture cannot prove
the requested interrupted-authentication guarantees unchanged. The application
provider/coordinator/service retain their existing rejection before authentication
client construction, native prompts or writes. No temporary verification session
is accepted into the persistent client or used to open protected routes.

This is an explicitly documented blocker, not a completed session-adoption
implementation. Generation checks protect live JS continuations but do not create
durable intent or cancel a native write that has already been issued.

## Source evidence

- `auth-storage.ts` has a per-key Promise queue in a local Map. A fresh adapter
  after restart does not inherit that queue, cancellation or operation generation.
- Its logout removes legacy data then secure data in separate awaited operations.
  No durable logout/account-switch retirement is recorded before those operations.
- Its compatibility migration deliberately returns the previous legacy session
  if writing its secure copy fails. A future acceptance fence must also cover this
  fallback, rather than simply changing the SecureStore write method.
- `supabase.ts` constructs the persistent SDK client using the existing adapter.
  Future restoration fencing must precede SDK initialization and auto-refresh.
- Installed Supabase Auth 2.116.0 `_verifyPasskeyAuthentication()` calls
  `_saveSession()` and publishes `SIGNED_IN` before an application-level result
  check. The SDK's separate refresh-removal epoch guard does not protect this path.
- Installed Expo SecureStore exposes individual sync/async key operations but no
  public compare-and-set or cross-operation transaction. Its Android per-item
  `SharedPreferences.Editor.commit()` is not evidence of a transaction across
  logout, acceptance, other keys, SDK state and protected-route state.

## What is tested now

Maintained `tests/passkey-session-security.test.mjs` uses the actual installed SDK
and current `createAuthStorage()` implementation against synthetic HTTP and storage.
All HTTP is restricted to a fake `.invalid` host. Tests cover:

1. Unsafe negative control: persistent verification completes after an acknowledged
   logout and recreates a stored session. This is deliberately not the app's path.
2. Ephemeral verification completes after main logout: a fresh main SDK/storage
   instance stays signed out.
3. Ephemeral verification completes after password account switch: a fresh main
   instance restores the chosen password account, not the verifier's account.
4. Completed normal password logout remains cleared on a fresh adapter/SDK.
5. Interrupted, unacknowledged secure deletion has no durable logout-intent fence;
   a fresh adapter can still read the previous session.
6. Interrupted legacy cleanup can leave previous copies available.
7. Adversarial native-completion model: an old issued write lands after another
   adapter commits an account. The per-instance queue has no native revision fence.
8. The existing legacy-migration fallback remains intact and must be included in
   a future acceptance authority.
9. Fresh/recreated passkey coordinators reject adoption before factories or writes.
10. Rejection cannot reveal protected routes or add startup identity requests.
11. Ordinary password fallback still authenticates and persists normally.

Cases 5-7 are **simulated interruption/adversarial storage models**, not observed
Android force-stop, flash-storage, power-loss or OS scheduling behavior. In
particular, a full process kill terminates its JS/native threads; these tests do
not assert an old thread necessarily survives. They expose missing API guarantees.
An interrupted logout in cases 5-6 was not completed or acknowledged; this does not
claim existing successful password logout is broken.

Actual credential-state restart/removal tests separately recreate controllers over
persisted metadata and reconcile against a mocked server. They do not prove the
native app's real restart/backup behavior.

## Smallest safe architectural change to review next

Introduce one native encrypted auth-state authority, rather than a multi-key JS
journal pretending to be atomic. Its minimum contract is:

- A single versioned record owns the accepted session and operation epoch.
- Native serialized compare-and-commit rejects an operation carrying a retired
  epoch. Native atomic replacement/durability semantics must be verified.
- Logout/account switching durably retires the prior epoch before success is
  acknowledged. JS also clears accepted UI authority synchronously.
- Startup establishes the current durable epoch before constructing a persistent
  SDK or enabling legacy fallback/refresh. Unaccepted or ambiguous state stays
  signed out; server identity is validated before opening protected routes.
- Verification stays on a nonpersistent client. Identity/session validation,
  serialized commitment, durable acceptance and accepted UI state are coordinated.
- Every writer/reader participates: password sign-in, passkey commitment, refresh,
  logout, startup restoration and legacy migration. Raw `SIGNED_IN` events alone
  cannot be the authority for a passkey result.
- The native layer may protect encryption keys using the platform keystore or a
  reviewed SecureStore integration. No plaintext token fallback or duplicate token
  cache should be introduced.

This requires a supporting native module or an equivalently validated transactional
encrypted store, followed by a narrowly reviewed authentication integration. A
new JavaScript mutex, extra boolean, separate tombstone key, or sync `setItem()` is
not equivalent. No dependency/module/schema/storage migration was added speculatively.

There is an unavoidable intent boundary: termination **before any durable logout
intent reaches storage** cannot preserve an intent the system never recorded.
Define that behavior explicitly and distinguish it from completed/acknowledged
logout. Do not promise loss-proof storage without native durability/device evidence.

Before enabling, test interruption at retirement, verification response, validation,
commit, acceptance acknowledgment and startup restoration. Include competing
accounts, late callbacks/native I/O, offline startup, storage failure, revoked
sessions and legacy tokens; then run real Android process-kill/relaunch tests.

## Credential metadata is not session authority

`credential-state.ts` now persists a registration ID scoped to owner/project/RP,
and requires a successful authenticated server-list match before displaying Enabled.
It does not store sessions or authorize users. A late metadata write is tolerable
only because the next read still requires server confirmation and cannot log in.
That limited safety argument must never be reused for session acceptance.

## Activation status

All readiness gates remain false and the RP remains unset. No automatic prompts,
new normal-navigation checks, changes to password auth/storage, signing changes,
production settings, live credentials, release build, deployment or publication.

Remaining prerequisites: reviewed durable auth authority, native/device validation,
approved RP/origins/Play signing certificate/Digital Asset Links and separate
approval for production Auth activation and any subsequent closed-testing release.
