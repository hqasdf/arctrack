# Biometric Sign-In: existing-app integration

Updated 20 October 2026. Source is integrated into the real Arc Track mobile app;
the feature is **disabled**, not a working or released biometric login.

## Preserved application

- Android package: `com.arctrack.archery`; scheme: `arctrack`.
- Existing EAS project, build profiles, app icon and iOS identity remain unchanged.
- Expo 57.0.25, React Native 0.86.3 and Supabase JS/Auth 2.116.0 are unchanged.
- `react-native-passkey` is pinned to 3.6.2. No other installed package version
  was changed. Native autolinking discovers its Android package and codegen entry.
- R8/resource shrinking/optimized ProGuard, adaptive Android orientation and
  Material Components 1.14.0 configuration are unchanged.
- No alternate app configuration, development identity, backend or project was
  copied from the experiment. Existing normal Supabase environment names are used.

## Implemented source

`src/passkeys/native-adapter.ts` lazily loads the bridge only after an explicit
credential operation. It validates server options and signed response structure,
preserves signed strings, and normalizes cancellation/unsupported/error states.
The initial support check is only Android API 28+, not proof of a provider,
screen lock, credential or approved RP association. iOS actions remain unavailable.

`service.ts` uses fresh clients with persistence, auto-refresh and URL session
detection disabled. They have no SecureStore adapter or production auth listeners.
Registration verifies the borrowed actor through server `getUser`, matches the
approved RP, performs native creation, verifies with Supabase and confirms the
returned credential in the server list. Borrowed owner tokens are copied and
checked after awaited work; their refresh-token grant is blocked. Disposal never
signs out that legitimate password session. Listing/removal operate on server
metadata and removal verifies ownership, deletes one explicit UUID and confirms
absence. It never bulk-deletes credentials or treats the first credential as local.

`verifyAuthenticationWithoutAdoption()` prepares the challenge/assertion/verification
transport and server identity check. It returns only a user ID, then attempts to
sign out its newly issued temporary session and disposes the client. It is not
exposed by the application provider or connected to navigation. Cleanup failure
rejects. This does not claim immediate access-JWT revocation.

`authenticate()` remains blocked by production feature gates. Its prepared future
acceptance path now uses the reviewed Option B coordinator; see
[session authority](session-authority.md). A device-success boolean never authenticates.

`coordinator.ts`, `runtime.ts` and `lifecycle.ts` coordinate prepared management
operations only. There is one pending operation, owner/result checks, foreground
and disposal invalidation. Existing AuthProvider hooks cancel pending work
synchronously before password login/logout and on auth events/cleanup. These are
in-memory cancellation hooks, not a replacement for password/session management.
The existing Supabase client now uses the durable authority; password/recovery
workflows and routes are preserved. The authority adds no automatic native prompts
on startup, navigation or background return while the feature is disabled.

## UI and feature gates

The existing Sign In and Profile screens mount small gated controls. Both render
null with the current constants in `feature.ts`:

- `PASSKEY_FEATURE_ENABLED = false`
- `PASSKEY_REGISTRATION_READY = false`
- `PASSKEY_SESSION_ADOPTION_READY = false`
- `PASSKEY_RELYING_PARTY_ID = ""` (not yet selected)

The prepared labels are **Biometric Sign-In**, **Use your device authentication
to sign in faster.**, and **Sign in with Biometrics**. Password login, Create
Account and Forgot Password remain available exactly as before. No app PIN,
app lock, automatic prompt or inactivity timer was introduced.

When tested with mocked ready gates, the Profile control shows Enabled only after
registration returns server-confirmed metadata. Existing account-wide credentials
are not assumed to belong to this device. Each removal requires an explicit
credential selection and a confirmation explaining possible other-device impact.
Cancellation is quiet; other errors use fixed text without native/server details.

Registration association is now persisted in a separate, scoped SecureStore record
by `credential-state.ts`/`credential-storage.ts`. It contains only version, owner,
project origin, approved RP and the registration's server-confirmed credential ID.
No tokens, passwords or private keys are stored there. The iOS metadata item uses
`WHEN_UNLOCKED_THIS_DEVICE_ONLY`; no biometric-gated storage access is requested.

On each gated Profile focus/restart, the controller loads the authenticated server
list and matches the remembered ID. Missing server credentials clear only local
metadata; network/read errors never prove Enabled or trigger revocation. Failed
mutation confirmation clears the UI's confirmed state. Repeat registration avoids
duplicates when the remembered registration is still server-confirmed. Removal
targets one explicitly confirmed ID; interrupted local cleanup is repaired during
the next successful reconciliation.

This remembers a registration performed from this app, not exclusive ownership of
a credential by a physical device. Providers can sync passkeys. Unremembered or
synced-in account credentials are listed without being treated as this app's
registration. The UI states this synchronization caveat. Metadata never authorizes
sign-in. Actual device persistence/backup behavior still needs Android testing.
Session adoption is implemented locally; do not enable these controls yet.

## Local adoption implemented; activation remains blocked

The reviewed Option B authority now coordinates password/OTP/recovery, refresh,
logout, migration and future passkey acceptance in the existing app. See
[the authoritative contract](session-authority.md) for schema, ordering, failure,
restart and rollback boundaries. No new storage dependency was introduced. The
previous persistent-verification negative control remains a regression example;
it is never the app's verification path. Physical Android validation and approved
RP/Supabase/signing configuration remain mandatory before activation.
An already-sent registration verification may finish on the server after the
operation is invalidated. Its stale UI result is discarded. Reconcile through a
later server list; do not automatically revoke arbitrary credentials. Android's
native credential dialog/AppState interaction also requires physical-device QA.

## Configuration checklist: separate approval required

No production Auth setting, domain association file or backend record was changed.
The main project's disabled passkey state is carried forward from the previous
review/user brief, not newly queried in this task.

1. Owner approves the permanent WebAuthn **RP ID** (bare domain, no scheme/path).
   Do not infer it from the current Vercel deployment or change it after enrollment.
2. Confirm RP display name; `Arc Track` matches the existing product name.
3. Obtain the **Play App Signing** certificate SHA-256 from the existing Play
   listing's App integrity page. Do not substitute the upload/debug certificate.
4. Prepare the exact approved HTTPS website origins and Android origin
   `android:apk-key-hash:<base64url of SHA-256 certificate bytes>`. The colon-hex
   fingerprint used in Digital Asset Links is a different encoding.
5. Prepare the RP host's `/.well-known/assetlinks.json`, public HTTPS/200 without
   redirects/auth, with relation `delegate_permission/common.get_login_creds`,
   namespace `android_app`, package `com.arctrack.archery`, and the approved Play
   signing certificate's SHA-256 fingerprint. Review contents before deployment.
6. Review/approve exact Supabase RP ID, display name and allowed origins, then
   separately approve enabling passkeys on the existing project. No new project.
7. Validate the implemented secure adoption/restoration and persisted registration
   association on the real device; see `session-authority.md` for the current
   storage contract, explicit crash boundaries and simulated evidence.
8. Validate the real signed native build and association on physical Android:
   registration, cancellation, missing provider/credential, network failure,
   logout then fresh sign-in, account switching, concurrent attempts, background
   prompt behavior, force-stop/restart, and unchanged password/OTP/recovery flows.
9. Validate release/R8 behavior and existing app functionality, then obtain explicit
   approval for a future AAB and rollout to the existing closed-testing track.

The custom bridge requires a new native binary; Expo Go/JavaScript updates cannot
install it. Earlier isolated ARM64 debug compilation is useful compatibility
evidence, not this main integration's release/R8/device validation. No AAB, EAS
cloud build, installation or store submission was performed for this integration.

References:
- [Supabase passkey authentication](https://supabase.com/docs/guides/auth/passkeys)
- [Android credential-provider integration](https://developer.android.com/identity/sign-in/credential-manager)
- [Android passkey website association](https://developer.android.com/identity/passkeys/credential-manager)

## Validation scope

Maintained mobile tests exercise native mapping, the installed Supabase SDK with
synthetic HTTP, stale operations, guarded screen boundaries and UI metadata/
confirmation behavior. Existing auth, storage, routing, Counter, scoring, weather,
R8, orientation and Material tests remain in the suite. No real account, token,
credential, location or production data is used. Prior 72 isolated security/model
tests are separate research evidence, not production persistence proof.
