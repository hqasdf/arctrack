# Android SecureStore write acknowledgment patch

Owner: Arc Track mobile maintainers. Reviewed dependency: `expo-secure-store@57.0.4`.

## Scope

The normal encrypted-write path used to ignore `saveEncryptedItem()`'s Boolean
`SharedPreferences.Editor.commit()` result. Arc Track's patch throws the existing
`WriteException` when that result is false. Successful writes, encryption,
Keystore aliases, JSON format, JS API and storage key names are unchanged.
This patch does not implement the Option B authority record or enable passkeys.

False means an unacknowledged/uncertain outcome. It does not mean the write was
rolled back: a value may still be visible in memory or even persisted. Readback
must not substitute for the missing acknowledgment. True is the platform's
documented persistent-write acknowledgment, not a promise of unlimited protection
against hardware failure or sudden power loss.

## Reproducibility

The root npm `postinstall` runs:

```sh
node apps/mobile/scripts/patch-secure-store-android.mjs
```

The script resolves SecureStore from the mobile workspace, checks version 57.0.4
and the entire reviewed Kotlin source checksum, then applies only the write-result
check. Repeating it is a no-op. An unknown version or source fails installation
visibly; do not update the checksums merely to silence this failure.

No patching package or other dependency is added. Keep the root package.json,
package-lock.json, patch script, mobile package.json and regression tests together.
Normal npm install/ci must run lifecycle scripts. `--ignore-scripts` intentionally
bypasses this safeguard; if required for dependency inspection, run the postinstall
explicitly before any native build and run the patch tests.

Expo 57 can use a precompiled SecureStore AAR. A source patch alone would then be
ignored. The mobile package.json therefore contains this supported, module-specific
Expo Autolinking setting:

```json
{
  "expo": {
    "autolinking": {
      "android": {
        "buildFromSource": ["expo-secure-store"]
      }
    }
  }
}
```

Only SecureStore is selected for source compilation. Do not replace this with a
React Native-wide source-build setting. Prebuild/CNG does not overwrite the
dependency's Kotlin file. Future local/EAS builds need both the npm patch and this
source-build selection; the fix requires a new native binary, not an OTA JS update.
There is no new permission, biometric prompt, database or storage migration.

## Tests

Run from the repository root:

```sh
node --experimental-strip-types --test apps/mobile/tests/secure-store-android-patch.test.mjs
npm test --workspace @arc-track/mobile
```

The focused tests verify exact patch checksums, idempotency, version/source drift
failure, line-ending compatibility, install wiring, source-build selection, the
installed JS wrapper's success/rejection behavior and the existing auth adapter's
failure handling. Injected JS native results do not constitute a real JNI test.

After generating the current app's Android project, run from apps/mobile/android:

```sh
./gradlew -I ../native-tests/secure-store/native-tests.init.gradle \
  :expo-secure-store:testDebugUnitTest \
  --tests expo.modules.securestore.SecureStoreCommitTest
```

On Windows use gradlew.bat. The init script attaches test sources only; it does not
change production source sets or production dependencies. SecureStore already
declares JUnit/Robolectric test dependencies. Normal Android SDK/JDK tooling is
required; do not commit host-specific SDK/NDK paths.

The Kotlin tests run the actual module and AES/GCM encryptor. They inject a test
key store and an editor that can return false even after applying its write. They
cover success/readback, failed acknowledgment, preservation of the legacy alias
on failure and an independently encoded prepatch-format value. They do not test
hardware Keystore, actual JS/JNI delivery, process termination or power loss.

## Upgrade and removal criteria

Before changing SecureStore versions, inspect the exact upstream native setter and
run the same false-commit tests. Remove the patch only when the installed upstream
implementation checks this result and equivalent native tests pass. Reassess the
source-build override separately: it may be removed once the shipped precompiled
artifact contains the verified upstream correction. Preserve other Arc Track R8,
Material, orientation and permission settings.

An existing installed Play Store binary and Expo Go do not acquire this native
patch merely by loading newer JS. No production release is authorized by this
checkpoint. Option B and real passkey activation require separate review.
