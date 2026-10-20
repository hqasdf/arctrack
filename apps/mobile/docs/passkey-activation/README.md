# Final Android biometric sign-in activation checklist

20 October 2026. The owner-supplied Play signing certificate is now populated in
the templates and in the website's `public/.well-known/assetlinks.json`.
The association is prepared locally; deployment requires separate approval.
The app's feature gates remain disabled. No live Supabase settings were changed.

## Verified values and missing approval

- Existing mobile/web project: `pdwxphgyqbbflnrruobp`.
- Existing Android identity: `com.arctrack.archery`.
- Existing EAS project: `dfd3b325-3579-49b1-bd3b-6e8c762993eb`.
- Display-name candidate: `Arc Track`, matching the existing app.
- The live public Auth settings report `passkeys_enabled: false`.
- Existing website's `/.well-known/assetlinks.json` returns HTTP 404.
- Owner-proposed RP ID: `archery-website.vercel.app`. Keep it stable after enrollment;
  changing the RP invalidates credentials registered against it. Applying this
  proposed value to Supabase remains a separate approval step.
- Owner-confirmed current Play App Signing SHA-256:
  `71:44:97:2B:C6:BE:FA:06:B2:DD:90:BF:C1:58:6D:1E:1A:B4:9A:6B:AD:03:E3:D9:D0:FA:30:D3:A2:BC:A7:BF`.
  This is supplied Play Console evidence, not an independently retrieved certificate.
  No debug/upload certificate was added or signing credential changed. Historical
  Play key rotation has not been established. If older supported installs use a
  different signing key, obtain its verified SHA-256 before adding another entry.
- Live stored RP/origins are not exposed by the public settings endpoint and
  were not verified through the authenticated management API in this task.

## Exact configuration to complete after owner review

1. Review the proposed RP `archery-website.vercel.app` and HTTPS origin
   `https://archery-website.vercel.app` before applying live configuration.
2. The supplied colon-hex fingerprint decodes to exactly 32 bytes. Independently
   encoding those bytes with Node Buffer and .NET Convert yields the same unpadded
   base64url digest: `cUSXK8a--gay3ZC_wVhtHhq0mmutA-PZ0Pow06K8p78`.
   Proposed Android origin:
   `android:apk-key-hash:cUSXK8a--gay3ZC_wVhtHhq0mmutA-PZ0Pow06K8p78`.
   This encodes the digest bytes directly; do not hash the fingerprint text again.
3. After separate deployment approval, publish the prepared static file at
   `https://archery-website.vercel.app/.well-known/assetlinks.json`. Verify HTTP 200,
   `Content-Type: application/json`, exact JSON, no login, redirect or HTML fallback.
   Local auth proxy matchers do not include this path; no routing change is needed.
   Do not add the local debug build's certificate without separate approval.
4. Inspect the existing Supabase Auth configuration through the dashboard/management
   API. Review the filled `supabase-auth-config.json.template`. The template deliberately
   says `passkey_enabled: false`. Activation requires a separately approved change
   to true with exact RP ID/display name/origins. HTTPS origins must match/be under
   the RP; Android origins bind the package's signing certificate.
5. Only after approved configuration and device security validation, review all
   four constants in `src/passkeys/feature.ts`. They remain false/empty today.
   Do not bypass them via an environment-variable or alternate app identity.

Supabase reference: https://supabase.com/docs/guides/auth/passkeys
Android reference: https://developer.android.com/identity/passkeys/credential-manager

## Local installation and phone procedure

No Android device was listed by the existing ADB installation during this task.
The locally assembled validation debug APK is **not** a live login test:
it uses synthetic `.invalid` configuration and debug signing. It cannot establish
production RP association, live registration, login or release/R8 compatibility.
Debug Android builds normally load the JS bundle from Metro.

Local ARM64 debug assembly succeeded with target SDK 36 and the unchanged package.
APK inspection confirmed the native Passkey module, SecureStore module and patched
failed-commit acknowledgment message. Windows required a task-local Gradle init
file to shorten C++ staging paths, enable object-name hashing and avoid a CMake
regeneration loop. These host workarounds are outside the repository and are NOT
changes to EAS or release configuration. A fresh release/R8 build remains untested.

Prerequisites for an actual existing-app debug test: an authorized USB-debugging
Android device, owner approval to install/replace this package, an approved signed
build/domain association, approved existing-project passkey configuration, and a
reviewed local test activation of the existing gates. No second app/project is needed.
Do not uninstall the existing app to bypass a signing mismatch: uninstalling loses
local app state. Do not use `pm clear` or reset storage. A debug-signed APK generally
cannot replace a Play-signed installation.

Once the prerequisites and installation are explicitly approved:

```powershell
# Read-only identity check first. Never install automatically.
adb devices -l
adb shell pm path com.arctrack.archery
# ONLY for an approved, signing-compatible local test build:
adb install -r "<approved-path-to-test.apk>"
# Start the existing app's Metro server with the approved local configuration:
adb reverse tcp:8081 tcp:8081
npm run start --workspace=@arc-track/mobile -- --localhost
```

Do not use the synthetic validation APK as the approved test build. If Play signing
prevents local replacement, the owner must choose a suitable test device/install
or separately authorize a future existing-track build; this task does neither.

Phone checklist, always keeping email/password fallback:

1. Normal password login, restart, Profile and existing scoring/Counter/navigation.
2. Explicit Profile registration: credential prompt, cancel/retry, server-confirmed
   registration and state after restart. No automatic startup/background prompts.
3. Explicit logout, then biometric login producing a fresh verified session.
4. Native prompt background/foreground timing, Home while prompt pending, result
   while remaining backgrounded, and missing provider/credential/network failure.
5. Logout/password login/account switching while verification is delayed; no stale
   acceptance or previous account's screen data. Repeat rapid button taps.
6. Refresh, recovery restrictions, failed native writes, force-stop/restart during
   pending login, accepted write and logout. Apply the explicit acknowledged versus
   interrupted guarantees documented in `../session-authority.md`.
7. Remove only the explicitly selected credential; verify reconciliation across
   restart and synced-credential caveats. No automatic other-device revocation.

## Release and rollback

No AAB/EAS/upload/deployment is authorized or performed. Debug compilation/export
does not validate optimized release behavior. Before the existing closed-testing
release: physical authentication results, approved associations/configuration,
release/R8 validation, review of the native SecureStore patch in that binary and
explicit owner approval remain required.

Keep password sign-in available. Disable enrollment/sign-in gates for a controlled
feature rollback; do not bulk-revoke credentials. Preserve Option B storage support
when rolling back code. An older binary cannot safely interpret the new authority
format; never remove only its key or revive obsolete legacy credentials.
