# Controlled Android biometric sign-in testing

20 October 2026. Existing Arc Track app/project only. This is a local activation,
not a published release. Password login and recovery stay available.

## Confirmed configuration and limits

- Project: `pdwxphgyqbbflnrruobp`; Android package: `com.arctrack.archery`.
- Live public Auth settings: `passkeys_enabled: true`.
- Live association URL: `https://archery-website.vercel.app/.well-known/assetlinks.json`.
  HTTP 200, JSON, exact supplied certificate, no redirect.
- Locally configured RP: `archery-website.vercel.app`; display name supplied by
  owner: `Arc Track`. The app rejects server registration/authentication options
  whose RP differs from this constant before invoking the native prompt.
- Expected origins: `https://archery-website.vercel.app` and
  `android:apk-key-hash:cUSXK8a--gay3ZC_wVhtHhq0mmutA-PZ0Pow06K8p78`.
- The public settings endpoint does not expose saved RP/display-name/origin fields.
  No authenticated management credential was available. Confirm these in the
  existing Supabase Dashboard Authentication > Passkeys before live testing.
- The existing nonpersistent verifier, Option B authority, encrypted storage,
  acknowledged Android SecureStore patch and password flows are preserved.
- No startup/native background prompt. Profile loads credential metadata on focus;
  native registration and sign-in require explicit button presses.

## Safest route for the existing Play-installed app

1. Use the existing Google Play internal testing track and an approved new AAB
   from the existing EAS production profile. Do not upload anything until approved.
2. A Play-delivered update is signed by Google with the App Signing certificate
   associated with the live RP. The upload certificate only authenticates the AAB
   upload; a local APK signed with that key will not match the Play association.
3. Do not use Internal App Sharing as an interchangeable substitute: Google signs
   those artifacts with a separate Internal App Sharing certificate, which is not
   in the approved association. Do not add certificates without approval.
4. A normal debug APK/Expo Go also does not establish the Play certificate's origin.
   Do not uninstall the Play app or clear its data to work around signing conflicts.
5. Ensure the new versionCode is greater than every installed/testing version. The
   existing EAS production profile uses remote versioning and autoIncrement. Do not
   substitute the generated local native versionCode without checking Play.
6. Before the separately approved build, review the current source snapshot and
   normal EAS production environment. Keep the root postinstall patch script,
   pinned SecureStore dependency and `buildFromSource` autolinking setting in the
   archive; an update to an old native binary cannot supply the native storage fix.
   Do not publish this change as an OTA-only activation to an older binary.
7. The normal future build command, only after approving a cloud build, is:

   ```powershell
   cd "C:\Users\Han Qian\Documents\ChatGPT\archery website analyst\web\apps\mobile"
   npx eas-cli build --platform android --profile production
   ```

   Building is separate from uploading. Do not run `eas submit` or enable automatic
   submission. Review/sign the resulting AAB with the existing upload credentials;
   Google supplies the App Signing certificate on delivery. Never copy private keys
   into source or logs.

## Local build validation

Local release validation uses the existing Gradle/native toolchain and an external
host-only init file. Release signing is explicitly disabled for this validation;
it must not reuse the generated native project's debug signing configuration.
The validation selects ARM64 and uses the existing public project URL/publishable
key. A resulting unsigned bundle is not a Play-upload-ready artifact, cannot update
the installed app and does not prove the Play certificate or device interaction.
Local result: ARM64 release AAB compilation, R8 and release lint succeeded. Artifact
inspection confirmed no signing entries, the expected RP/project in the embedded
bundle, Passkey/SecureStore in the R8 mapping and the SecureStore failed-commit
acknowledgement in DEX. SHA-256:
`4D367DB3BA7BC3AA98B9ADFAF5CA790B0122D757BE1C104FE89064C72226977F`.
Size: 26,351,546 bytes. Generated manifest versionCode: 5, target SDK: 36. This
versionCode has not been checked against Play and is not approved for upload.
Windows required external staging-path/CMake workarounds; no toolchain versions
or checked-in build/signing settings were changed. The temporary signing override
uses `androidComponents.finalizeDsl` so the generated debug signing cannot replace
it. No physical device was connected, and this unsigned AAB was not installed.

The existing production profile, signing configuration, R8, resource shrinking,
optimized ProGuard, orientation plugin and Material dependency are unchanged.
No connected phone was reported by `adb devices -l` during this task.

## Phone checks after approved Play delivery

1. Update through the existing Play internal testing opt-in link. Preserve app data.
   Check version and package; use a device with a screen lock and credential provider.
2. Sign in with email/password. Verify existing Sessions/history and Profile.
3. Profile > Biometric Sign-In > Enable. Cancel once; no Enabled claim should appear.
   Retry explicitly; complete the system registration prompt. Enabled appears only
   after Supabase verification, credential listing and local-state reconciliation.
4. Restart normally: the remembered registration must reconcile against the server.
   No automatic biometric prompt. A synced credential is not proof of exclusive
   physical ownership by this phone.
5. Sign out, then tap Sign in with Biometrics. Cancel/retry, then authenticate.
   Supabase verifies the signed assertion; only the existing authority may accept
   the resulting session. Password fallback must continue to work.
6. Test rapid taps, network failure, Home/background during the prompt and while
   verification is pending, then return. No late result may override completed
   logout or a later password/account-switch attempt.
7. Repeat with expired sessions and process force-stop/restart during verification,
   acceptance and logout. Simulated process tests are not real Android validation.
   An interrupted logout before its durable acknowledgement is different from a
   completed logout; preserve the documented authority failure boundaries.
8. Remove only an explicitly selected credential with confirmation. Reopen Profile;
   no stale Enabled indicator or silent other-device revocation.
9. Verify signup/recovery, scoring/final Arrow/Undo, Counter, Analytics, navigation,
   weather and retained data. Do not intentionally destroy real user records.

## Rollback

For a future reviewed release, disable the three presentation/readiness booleans
without removing authority storage support. Do not clear SecureStore, revive legacy
credentials or downgrade to an authority-unaware native binary. No bulk credential
revocation or production change is authorized by this local activation.
