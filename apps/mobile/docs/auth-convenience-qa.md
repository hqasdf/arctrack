# OTP AutoFill and optional biometric unlock

Local implementation and validation: 15 October 2026. No commit, push, deployment, release build, production Auth/configuration change, database/RLS/RPC change, or account deletion.

## Scope and architecture

- Expo SDK 57.0.25 / React Native 0.86.3. Added only expo-local-authentication 57.0.3 (SDK manifest-compatible ~57.0.3); lockfile records exactly that new package, with no existing package upgrades.
- Web already uses one-time-code, numeric input and six-digit validation in its existing email/recovery form. No web source change was required.
- Native signup/recovery share a small single-input wrapper. iOS uses textContentType oneTimeCode; Android uses the supported generic autoComplete one-time-code and importantForAutofill yes. No SMS-only hint, inbox access, reading permission, auto-submit, endpoint or verification type change.
- BiometricLockProvider wraps the existing router under AuthProvider. Supabase remains authoritative. Its getUser identity check must still succeed for the same account after native authentication. No password/token copy, fake session or replacement login is created.
- Preference is a single enabled marker in a separate per-user SecureStore key, arc-track.biometric-unlock.v1.<user-id>. No tokens, passwords, codes or raw biometric information are stored there. Existing SecureStore session migration and token options remain unchanged.
- Default is disabled. Enabling requires supported enrolled biometrics, a successful native prompt, verified current Supabase identity, then successful preference persistence. Strong Android biometrics only. Native passcode fallback is disabled; password fallback is normal Supabase sign-out/sign-in.
- Cold restore reads the preference before mounting protected routes. Subsequent locks use an opaque root cover and disable underlying pointer/accessibility access without unmounting scoring queues or route state.
- When enabled, brief inactive/background transitions obscure content; a return after 60 seconds requires unlock. Prompt-generated inactive/active interruptions do not cause prompt loops. Cancellation/error remains locked. Native/identity results are account- and attempt-scoped; actual backgrounding invalidates a pending result. If an old native prompt is still settling on return, Unlock may need to be pressed manually.
- SIGNED_OUT immediately invalidates local unlock state, then serializes removal of that account's preference. A late enable write cannot recreate it after cleanup. A server-reported invalid, expired, revoked or deleted identity cannot pass unlock validation; the normal sign-out path clears local preference. Browser account deletion and password reauthentication are unchanged.

## Native permission integration

The old expo-secure-store faceIDPermission false removed NSFaceIDUsageDescription during actual Expo plugin evaluation. Both plugin entries now use the same purpose text: Allow Arc Track to use Face ID for optional app unlock. This is only permission-description configuration, not requireAuthentication on Supabase token reads.

Actual Expo introspection verifies that purpose string, USE_BIOMETRIC, and no SMS/email-reading permission. Existing unrelated native permissions are unchanged. A rebuilt native binary is required for plugin changes; do not expect an older installed binary to acquire this module/permission through JavaScript alone.

Official references:
- https://docs.expo.dev/versions/latest/sdk/local-authentication/
- https://reactnative.dev/docs/textinput

## Automated validation

Baseline before edits: clean Git working tree at 5ed3173; web/mobile typechecks, 126 mobile tests, 80 core tests, 11 focused web auth tests and root lint passed.

Feature regression tests exercise the actual lock controller, native adapter with mocked OS calls, boundary rendering, and actual Expo config-plugin evaluation. Covered cases include opt-in/cancel/failure, unsupported/unenrolled/weak biometrics, cold restore, duplicate prompts, background thresholds, native interruptions, stale native/identity results, account switch, serialized preference cleanup, corrupt/unreadable/failed storage, network/revoked identity, initial deep-link mount protection and later scoring-state preservation. OTP tests cover typed/full pasted/native-inserted values, leading zeros, deletion and retained six-digit/busy/resend contracts.

Final commands:
- node --experimental-strip-types --test apps/mobile/tests/biometric-lock.test.mjs apps/mobile/tests/biometric-native.test.mjs apps/mobile/tests/otp-input.test.mjs
- npm run test --workspace @arc-track/mobile
- npm run test --workspace @arc-track/core
- npm test
- npm run typecheck --workspace @arc-track/mobile
- npm run typecheck --workspace @arc-track/core
- npm run typecheck
- npm run lint
- npx eslint --no-ignore apps/mobile/src/biometric-lock.tsx apps/mobile/src/biometric-lock-model.ts apps/mobile/src/biometrics.ts apps/mobile/src/otp-input.tsx --max-warnings 0
- npm run build
- npx expo export --platform android --output-dir <temporary-QA-directory>/android-export --clear
- npx expo export --platform ios --output-dir <temporary-QA-directory>/ios-export --clear
- git diff --check

Exports are JavaScript/Hermes bundle checks, not native IPA/APK compilation or release builds. Root lint excludes apps/mobile by repository convention; the additional explicit lint command covers the new mobile implementation.

## Actual Android emulator check

An existing Android API 37 AVD was launched read-only with no wipe or snapshot save. Existing Expo Go 57.0.9 loaded the app through a local offline Metro server. Its existing authenticated session restored and navigation reached Sessions, then Profile. The setting rendered Biometric Unlock, disabled/unchecked, with Set up device biometrics in Settings first. This exercises real native availability/enrollment detection; the emulator has no enrolled biometrics. No account/password was entered, signed out or deleted, and no scoring records were modified. No successful biometric prompt/scan or email autofill suggestion was tested. A manifest-asset warning occurred in offline Expo development startup; production Android/iOS asset exports succeeded.

## Physical-device acceptance (pending)

Use a native development build containing the new module/plugin configuration. On macOS, a local iOS development build can be created using npx expo run:ios --device after normal signing setup. Android development builds can use npx expo run:android. Do not publish or make a store/release build as part of this checklist. Face ID cannot be tested in Expo Go.

1. Verify ordinary sign-in, logout, signup code, wrong/expired code, resend cooldown, full six-digit paste and supported OS email-code suggestion. Code insertion must not itself submit. Confirm manual input/deletion still works. OS/provider support varies, particularly Android email extraction.
2. On enrolled devices, verify Face ID / Touch ID / secure Android fingerprint or face label and opt-in success. Cancel/fail opt-in: setting remains off. Disable: later launches do not prompt.
3. Enable and terminate/relaunch: no protected-content flash; native scan plus valid Supabase session required. Cancel/fail: Retry or sign out only; a deep link/back navigation must not uncover protected content.
4. Switch apps for less than 60 seconds, then at least 60 seconds. Check native-prompt interruptions do not loop. Review OS task-switcher snapshot behavior on real hardware; React covers cannot alone prove OS screenshot timing.
5. On a disposable account/environment only, verify removed/revoked session requires normal sign-in; network failures stay locked with retry. Test A opt-in -> sign out -> B login with no preference/unlock inheritance. Verify enrollment removal/change has a safe sign-out fallback.
6. With unsent local scoring edits, background-lock and unlock: state/selection/save queue must be retained. Check Sessions, Analytics, Training Plans, Coach Workspace and deep-link destinations. Existing calculations remain covered by unchanged core regression tests.
7. Account deletion still opens the existing canonical web URL and still requires the current password plus exact DELETE. Do not delete real accounts for QA. Returning to mobile after deletion must fail server identity validation and return to normal login.

No physical iPhone, Touch ID/Face ID scan, enrolled Android scan or real email OTP suggestion was available in this pass. Those outcomes are pending, not passed by unit tests.

## Dependency advisory scope

The current npm audit reports existing-graph advisories; expo-local-authentication itself is not directly flagged. Only the new package was added. No audit-fix, dependency upgrades, install-script approvals or unrelated security remediation were performed.

## Final recorded results

- Focused OTP/biometric suite: 37 passed, 0 failed.
- Complete mobile suite: 163 passed, 0 failed (baseline 126).
- Complete shared-core suite: 80 passed, 0 failed.
- Complete web suite: 143 passed, 0 failed.
- Web/mobile/core typechecks, root lint, explicit new-mobile-source lint and production Next.js build passed.
- Android and iOS Expo exports passed; generated artifacts remained outside the repository.
- Expo configuration evaluated successfully with the expected Face ID purpose string.
- Emulator startup/session restoration/Profile/unenrolled-setting checks passed. Real scan, OTP suggestions and physical-device cases remain pending.
- No pre-existing working-tree changes existed; all current changes belong to this task.
- npm audit currently reports 33 advisories (11 moderate, 22 high) in the existing package graph; the new biometric package is not directly flagged. No existing version was changed and no audit-fix was run.

The task-created read-only emulator and offline Metro server were stopped after QA. No other development services were stopped.
