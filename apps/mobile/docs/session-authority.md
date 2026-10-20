# Option B: durable mobile session authority

20 October 2026. Implemented locally in the existing app. Passkey feature gates
remain false. No live Auth calls, credentials, configuration or domain changes.

## One authority, existing SDK

`supabase.ts` creates one `createMobileSessionClient` instance per application JS
runtime. It retains the normal Supabase client and automatic refresh. Its main
session storage is now one encrypted SecureStore value under
`arc-track.auth-authority.v1.<project-host>.<port>`:

```ts
{
  version: 1,
  epoch: number,
  phase: "pending" | "accepted" | "signedOut",
  accepted: null | {
    epoch: number,
    accountId: string,
    binding: string, // session:<JWT session_id>, or legacy:<user_id>
    mode: "normal" | "recovery",
    session: Session
  }
}
```

This value contains secrets and must never be logged, exported or placed in
AsyncStorage. JWT parsing supplies structural binding, not authentication proof.
Candidate adoption uses the primary SDK's `setSession` server identity validation.

## Transitions and ordering

- Boot reads the authoritative record before SDK restoration. A pending attempt
  is abandoned: retain its previous accepted session, or settle signed out. Never
  resume its candidate. The SDK/provider still verify restored identity.
- Begin increments the live operation revision immediately, then acknowledges a
  pending epoch retaining the previous valid accepted session. Network failure or
  cancellation does not gratuitously sign out that predecessor.
- Password/signup/OTP candidates use nonpersistent SDK clients with no production
  listeners or storage. Only the current candidate may enter the serialized primary
  adoption queue. A candidate grant is one-shot. Session ownership transfers only
  after an accepted record has been acknowledged.
- All authority writes use one queue. An obsolete candidate whose native write was
  already issued is never published to the UI. Its predecessor is restored with an
  acknowledged compensating write in the same queue before a newer transition.
  Compensation failure freezes access; it is not reported as successful rollback.
- Logout invalidates attempts and closes protected UI synchronously, then writes
  a signed-out tombstone. Success requires native acknowledgment, primary SDK
  cleanup and the existing global-scope server logout. Remote failure cannot undo
  local retirement. A new identity request waits for the logout barrier.
- Installed SDK `processLock` orders complete primary refresh, setSession,
  updateUser and removal operations. A stale refresh receives an internal,
  nonretryable superseded result so it drains rather than retrying with the lock.
  Normal transport errors are unchanged. Delayed removal drains before newer
  adoption. SDK v3 or lock changes require a fresh compatibility review.
- Refresh may rotate tokens only for the accepted epoch/account/session binding.
  Legacy bindings can upgrade through that authenticated refresh. User updates
  preserve the binding and recovery purpose. Pending login does not break refresh
  of its still-accepted predecessor. Logout/account replacement invalidates it.
- Recovery purpose is stored with the accepted session. Missing AsyncStorage UI
  metadata cannot unlock protected content. Only the successful current-account
  password update changes that purpose to normal.
- The provider requires authority approval for SDK events and server identity.
  Navigation is keyed by accepted account identity, preventing a new account from
  inheriting old mounted screen data. Same-account refresh does not reset screens.

The `/recover` and `/resend` email-request endpoints remain public SDK actions.
Normal data queries are untouched. No polling, per-navigation SecureStore reads,
extra biometric prompts or new mandatory login step is introduced. Interactive
identity adoption adds durable writes and server identity verification; actual
device latency has not been measured.

## Migration and recovery

Only when no authority key exists, read the existing SecureStore/legacy adapter,
validate its session shape and migrate recovery purpose. Commit the authority
first; remove legacy credentials afterward. A failed commit blocks access without
deleting the source. Failed cleanup cannot override a committed authority.

Once an authority exists, signedOut, pending, corrupt and unknown-version records
never fall back to a legacy session. Storage failures close access and expose the
existing retry path. Retry rereads the durable value after queued writes drain.
Persistently corrupt data requires a reviewed reset/recovery action; it is not
silently erased or recovered from obsolete credentials.

Rollback is NOT simply running the old binary: old code cannot read this new key
and may see obsolete legacy credentials if interrupted cleanup left them behind.
Any release rollback must preserve the authority gate or explicitly clear both
formats through a reviewed migration and require login. Never delete only the
authority key to reactivate legacy fallback. There is no automatic downgrade.

## Failure boundaries: no false crash-atomicity claim

The approved Android native patch rejects failed encrypted commit acknowledgment;
the module remains version/checksum pinned and source-built. One acknowledged
record replaces a multi-key acceptance decision. SecureStore does not supply
cross-operation transactions or compare-and-set.

A completed, acknowledged logout survives ordinary restart and blocks old results.
An interrupted logout is different: a kill before its tombstone reaches storage
can restore the last surviving accepted record. Similarly, a candidate write may
physically persist before its acknowledgment is lost. The running app fails closed;
restart observes the actual surviving record, not an imagined rollback. A kill
before stale-write compensation/newer intent is durable cannot guarantee that
unrecorded intent survives. Already-issued server requests can also finish after
process death; abandoned server token revocation is best effort, not guaranteed.

This implementation assumes ONE app JS runtime/writer. The queue and SDK lock do
not provide native fencing between independent runtimes/processes. Do not run two
clients against the same authority store or use Fast Refresh as process-death QA.
Full restart after changing the storage architecture is required. An independent
multi-process writer would need a separately reviewed native authority/CAS design.

Deterministic tests recreate adapters/clients over surviving synthetic storage;
they simulate termination boundaries, not native kill/power-loss behavior. Neither
successful debug compilation nor unit tests establish real-device crash durability.

## Future passkey adoption (disabled)

The prepared explicit-gesture path obtains a current passkey authority lease,
verifies using an ephemeral SDK client and server identity, then uses the same
serialized primary acceptance path. No local biometric-success boolean authorizes
anything. Cancellation/background/logout/password replacement invalidate the
lease. While the explicit Android credential dialog is outstanding, temporary
activity backgrounding does not cancel the dialog itself. The result must return
to the active app (at most a one-second event-ordering grace) before verification.
Ordinary background network work is still invalidated. AppState cannot identify
Home versus credential UI; real-device event ordering remains to be checked.
Untransferred candidate sessions are locally revoked; transferred sessions
are not revoked by stale verifier cleanup. Registration metadata remains separate
and never authorizes access. No automatic startup/background prompt is added.

Before activation: approve the RP and signing/domain association; separately approve
live Supabase settings; validate the intended signed Android binary on a physical
device, including native prompt AppState behavior, failed storage acknowledgment,
force-stop/restart at adoption/logout, refresh, recovery and account switching.
See `passkey-activation/README.md` for prepared configuration and phone steps.
Test normal scoring, Counter, weather, analytics and navigation. Confirm product
acceptance of the explicit interrupted/unacknowledged-write boundaries above.
Do not activate by flipping constants alone. No production build or installation
over the Play app has been performed by this phase.
