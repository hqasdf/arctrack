# Native passkey sign-in: Phase 1 readiness and prepared SDK checks

**20 October 2026 update:** this document records the historical Phase 1 review.
The selected native dependency and disabled foundation are now integrated in the
existing app. See [current integration status](biometric-sign-in-integration.md).
The earlier direct-persistent verification outline below is historical, not the
current architecture: prepared verification uses an ephemeral client and persistent
session adoption is now implemented locally through the reviewed Option B
[session authority](session-authority.md). No passkey feature has been activated.

Reviewed 19 October 2026. This is preparation, not an activated feature.
Phase 1 separately removes the legacy biometric app lock; passkeys are not a
prerequisite for removing that optional local lock. Normal Supabase authentication
and its secure session storage remain the security boundary. Do not expose a
passkey button, native prompt or enrolment setting yet. No live challenge,
registration, sign-in or credential deletion was performed during this review.

## Verified state

- Installed Supabase JS/Auth SDK: 2.116.0. It exposes the experimental two-step API;
  no SDK upgrade is needed.
- Earlier preparation checked main project `pdwxphgyqbbflnrruobp`:
  read-only public Auth settings returned
  HTTP 200 with `passkeys_enabled: false`. Dashboard inspection also shows the
  Enable Passkey authentication switch off. These are earlier observations, not
  new live checks in Phase 1. No setting was changed.
- Earlier preparation's check of
  `https://archery-website.vercel.app/.well-known/assetlinks.json` returned HTTP
  404 without a redirect. This URL is only the current website candidate, not an
  approved permanent relying-party choice.
- Android application ID: `com.arctrack.archery`; iOS bundle ID:
  `com.whqq.arctrack`. No native passkey bridge is installed. App configuration
  has no iOS Associated Domains entitlement.
- Expo 57 / React Native 0.86.3 compatibility of a candidate native bridge is not
  established by a wildcard peer dependency or a mocked JavaScript test.

## Required implementation

Use the normal authenticated Supabase client with
`auth.experimental: { passkey: true }` after activation prerequisites are met.
Do not use browser-only `navigator.credentials` in native React Native.

Registration, from an explicit signed-in security action:

1. Verify the current confirmed, non-anonymous account.
2. `auth.passkey.startRegistration()` supplies `challenge_id` and `options`.
3. The reviewed native bridge runs the registration ceremony with those options.
4. `auth.passkey.verifyRegistration({ challengeId, credential })` sends the native
   response to Auth. Show success only after server verification; refresh the
   current account's `auth.passkey.list()` result.

Explicit signed-out sign-in:

1. Require a user tap; never start on launch, focus, navigation or background return.
2. `auth.passkey.startAuthentication()` supplies a fresh challenge and options.
3. The native bridge obtains the credential assertion.
4. `auth.passkey.verifyAuthentication({ challengeId, credential })` submits it.
   The installed SDK saves the server-issued session using its existing storage
   adapter and publishes `SIGNED_IN`. A local biometric boolean is never a login.
5. Integrate with the existing auth provider's generation/routing protections.
   Serialize attempts and invalidate pending native results on logout or account
   change. Test a logout/account switch while verification is pending, including
   SDK session persistence; UI-only generation checks are insufficient.

Normal logout continues to revoke/remove the active session, not registered
passkeys. No password or additional refresh-token copy is stored for convenience.
Use accurate "Passkey" terminology: the OS may use a fingerprint, face, device PIN
or another supported authenticator. A passkey does not guarantee fingerprint-only
verification.

Management uses the signed-in user's `auth.passkey.list()` and
`auth.passkey.delete({ passkeyId })`, with identity confirmation/recent
reauthentication and explicit confirmation before removal. Never use Admin APIs
or allow a caller-supplied user ID to choose another account.

## Native bridge review

Recommended first candidate for a separately approved compatibility evaluation:
**`react-native-passkey` 3.6.2**, not installed or selected as a production
dependency. The upstream release page identifies 3.6.2 as latest and shows recent
Android/iOS fixes. The earlier 3.3.1 review is superseded; cached `main` raw files
still returned 3.3.1 during this review, so findings below use immutable 3.6.2 tags.
[Releases](https://github.com/f-23/react-native-passkey/releases).

Verified source facts for that candidate:

- Its tagged package still develops against RN 0.81.4 and accepts wildcard RN
  peers; this does not certify RN 0.86.3 or Expo 57.
  [Package](https://github.com/f-23/react-native-passkey/blob/v3.6.2/package.json).
- Android uses Credential Manager 1.6.0 and an explicit AGP 8.13.0 buildscript.
  New Architecture conditionals apply the React plugin/codegen settings. Arc
  Track's installed RN Gradle version catalog specifies AGP 8.12.0, so actual
  resolution and configuration compatibility must be tested without upgrading
  the app's toolchain. Library-local `minifyEnabled false` is not an instruction
  to disable Arc Track's release R8/shrinking settings.
  [Gradle](https://github.com/f-23/react-native-passkey/blob/v3.6.2/android/build.gradle).
- Native Android creation/assertion call Credential Manager, require an active
  Activity and reject missing responses. Cancellation and missing-credential
  codes can support password fallback; map them at the provider boundary.
  [Android module](https://github.com/f-23/react-native-passkey/blob/v3.6.2/android/src/main/java/com/reactnativepasskey/PasskeyModule.kt).
- iOS pod metadata declares iOS 15 and React/New Architecture dependency paths.
  This is source evidence, not a successful iOS build.
  [Podspec](https://github.com/f-23/react-native-passkey/blob/v3.6.2/react-native-passkey.podspec).

Alternative **`react-native-passkeys` 0.4.2** is an Expo module. Its current
package declares Expo >=53 and RN >=0.71. The changelog records recent Android
support-check and Java/Kotlin toolchain fixes; it should not be described as
abandoned. Its Android Gradle source still pins Credential Manager
1.3.0-alpha01, uses the older ExpoModulesCorePlugin.gradle lookup and Java 17.
Neither its peer range nor its Expo 54 example demonstrates Expo 57/RN 0.86.3
New Architecture compatibility. It remains a fallback candidate pending native
build/device evidence.
[Package](https://github.com/peterferguson/react-native-passkeys/blob/main/package.json),
[Gradle](https://github.com/peterferguson/react-native-passkeys/blob/main/android/build.gradle),
[Changelog](https://github.com/peterferguson/react-native-passkeys/blob/main/CHANGELOG.md).

Neither candidate has been compiled with Arc Track, checked through R8, or tested
with Supabase's actual challenge/response encoding on Android/iOS. Do not install
either or change Expo, RN, AGP, R8, orientation or Material configuration now.

A chosen bridge needs a new native development/release binary; Expo Go cannot
gain that native module through a JavaScript update. No such build is authorised
or performed here. [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/).

## Intended provider-neutral interface (documentation only)

No unused production service is added before a bridge is proven. Keep the native
provider limited to availability plus the two WebAuthn ceremonies. It must not
read/write Supabase sessions, store passwords or decide whether an account is
authenticated. Derive the eventual request/response types from the installed
SDK's `AuthPasskeyApi` signatures, not independently duplicated payload shapes.

```ts
// Proposed shape only; not compiled, installed or called by the application.
interface NativePasskeyProvider {
  availability(): Promise<"available" | "unsupported" | "unavailable">;
  create(options: RegistrationOptions): Promise<RegistrationCredential>;
  get(options: AuthenticationOptions): Promise<AuthenticationCredential>;
}

interface PasskeySignInService {
  register(): Promise<RegisteredPasskey>; // challenge -> native create -> verify -> list
  signIn(): Promise<VerifiedSession>; // challenge -> native get -> verify; server session only
  list(): Promise<RegisteredPasskey[]>; // authenticated SDK operation
  remove(passkeyId: string): Promise<void>; // authenticated SDK operation + refresh list
}
```

The capitalised payload types above are descriptive placeholders for SDK-derived
types, not new domain values. No RP ID/origin is supplied by this interface:
ceremonies consume server-provided options after approved Auth configuration.
Service orchestration must preserve challenge IDs, expiry and base64url values;
verify a non-null server session/user before reporting sign-in success. Reject
cancelled, expired, unavailable or rejected ceremonies without a synthetic login.
Existing email/password sign-in stays available. Enrolment/management remain
explicit authenticated actions; signed-out sign-in requires a user tap.

## External approvals and information needed

- Approve a stable RP ID/domain and display name. Changing RP ID later makes
  existing passkeys unusable. Do not silently select a temporary/dev domain.
- Approve enabling passkeys and setting RP/origins in the main Auth project.
- Confirm the Play **app-signing** SHA-256 certificate, not just the upload key.
  Derive the native `android:apk-key-hash:<base64url SHA-256>` origin from its bytes.
- Publish reviewed HTTPS Digital Asset Links at the approved RP domain, containing
  the real package/certificate and `delegate_permission/common.get_login_creds`.
  Website deployment is a separate approval, not part of preparation.
- Development builds need their own authorised certificate/origin association.
- Earlier read-only Play Console inspection reported Play-managed signing and a
  previous signing key as well as the then-current key. Its visible Digital Asset
  Links example contains SHA-256
  `71:44:97:2B:C6:BE:FA:06:B2:DD:90:BF:C1:58:6D:1E:1A:B4:9A:6B:AD:03:E3:D9:D0:FA:30:D3:A2:BC:A7:BF`.
  Do not assume that example alone covers every installed certificate after key
  rotation; establish which certificate signs the relevant installed release and
  include all appropriate approved certificate/origin associations. No key was
  changed or downloaded.
- For iOS, confirm the Apple Team ID, Associated Domains entitlement and matching
  `apple-app-site-association` file. Never invent the Team ID or certificate values.

## Legacy lock removal in this phase

Phase 1 removes the provider, model, overlay, background timer, Profile setting,
app-lock-only tests and unused `expo-local-authentication` dependency/plugin,
without waiting for passkeys. SecureStore remains installed for session storage;
its plugin explicitly sets `faceIDPermission: false` because token reads do not
require biometric authentication.

After the existing auth provider accepts an account, it asynchronously deletes
only `arc-track.biometric-unlock.v1.<that-user-id>`. It never enumerates/wipes
SecureStore, deletes another account's flag or touches session keys. This cleanup
does not gate routes; storage failure leaves an inert flag and retries on a later
mount/account change. Flags for accounts not signed in on this installation stay
inert until that account signs in. A legacy preference never becomes a passkey
and never grants a session.

Remove the obsolete biometric privacy dependency from `src/use-session-weather.ts`
while retaining authenticated, focused, foreground and existing eligibility and
cancellation checks. Existing secure auth storage, auth initialization, recovery
restrictions, sign-out and account-switching protections remain in place.
Existing R8, orientation and Material plugins remain unchanged.

## Prepared validation and remaining limits

`tests/passkey-contract.test.mjs` uses the actual installed SDK, entirely mocked
HTTP and in-memory storage to verify opt-in, two-step envelopes, server-response
gating, session creation/event/persistence, logout without credential deletion,
missing/rejected credentials and management's signed-in requirement.

These tests do **not** validate server cryptography, live Auth policy, Android/iOS
credential providers, app/domain associations, physical biometrics, native bridge
compatibility, UI integration or cross-account race handling. Those remain release
gates. Existing auth-routing, secure-storage, R8/orientation and app tests must pass
again when the coordinated replacement is integrated.

Earlier preparation validation on 19 October 2026: six focused SDK contract tests
passed; the suite then contained 199 mobile tests and 101 core tests. The later
auth UI work added coverage and reported 209 mobile tests. These are historical
checkpoints, not the Phase 1 result. Reconcile the current executable count and
removed app-lock-only tests in the Phase 1 implementation report. This document
does not claim a native passkey build or live authentication test.

Phase 1 local validation on 19 October 2026: baseline 209 mobile tests passed;
33 tests exclusively for the removed lock/native adapter were deleted, seven
removal/security regressions and one weather-authentication regression were
added, leaving **184/184 mobile tests passing**. All six existing passkey contract
tests remain unchanged and pass. Shared core: **101/101 passed**. Mobile/core
TypeScript checks, repository lint and `git diff --check` passed. Expo config
introspection confirms no Face ID purpose text or biometric permissions, and
existing R8, Android orientation and Material configuration regressions pass.
Native upgrade/device behaviour still needs testing; no binary was built.

## Primary references

- https://supabase.com/docs/guides/auth/passkeys
- https://github.com/f-23/react-native-passkey
- https://github.com/peterferguson/react-native-passkeys
- https://developer.android.com/identity/credential-manager/prerequisites
- https://developer.android.com/identity/passkeys/create-passkeys
- https://developer.apple.com/documentation/authenticationservices/supporting-passkeys
- https://docs.expo.dev/develop/development-builds/introduction/
