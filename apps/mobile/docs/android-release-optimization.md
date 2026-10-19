# Android release optimisation

## Audit and change

Inspected on 19 October 2026:

- Expo 57.0.25, React Native 0.86.3.
- The installed React Native Gradle Plugin declares AGP 8.12.0. Expo's template uses Gradle 9.3.1.
- React Native's Android version catalog specifies minimum API 24, target/compile API 36, build tools 36.0.0 and NDK 27.1.12297006.
- Android and iOS directories are generated and ignored, with no maintained native project or `.easignore` override. EAS will run Prebuild when those directories are absent from the upload.
- Previously there was no `expo-build-properties` plugin or app-specific R8 configuration. The installed template defaults release minification and resource shrinking to false.
- The template selects `proguard-android.txt`, which disables bytecode optimisation even if minification is subsequently enabled.
- Production EAS uses the release variant by default, remote app-version management and `autoIncrement: true`. Internal distribution profiles are not development-client/debug profiles.

`expo-build-properties` 57.0.22 is the version recommended by the installed Expo SDK. It now writes:

```properties
android.enableMinifyInReleaseBuilds=true
android.enableShrinkResourcesInReleaseBuilds=true
```

The local `with-optimized-android-release.cjs` config plugin changes only the default ProGuard file to `proguard-android-optimize.txt`. It retains `proguard-rules.pro` and library consumer rules. It is idempotent and fails explicitly if a future template cannot be recognised.

No `-dontoptimize`, `-dontobfuscate`, `-dontshrink`, or `android.enableR8.fullMode=false` flags were added. Template keep rules for React Native TurboModules and Reanimated are preserved, including the latter's currently unused rule. Framework/native reflection and JNI rules must not be indiscriminately removed.

No SDK, NDK, native-library packaging, ABI or runtime dependency was upgraded. AGP 8.12 supports R8; an AGP 9 upgrade is not required merely to enable it. The optional AGP 8.12 integrated resource-shrinking pipeline is not enabled by this change; standard resource shrinking is enabled.

The reported Build 4 Play metrics are owner-supplied. No Build 4 AAB or EAS build log was available for direct comparison, so the audit confirms the repository's configuration defect rather than retrospectively proving the exact compiler invocation used for that upload.

## Validation and outstanding release checks

Actual Expo Prebuild was run before and after the change using the installed SDK template. The generated Android files confirmed both release flags, the optimised default rules file, and versionCode 5. These generated files are validation artifacts, not maintained source.

Automated checks: 183 mobile tests, 101 core tests, 205 web tests, mobile/core typechecks and repository lint passed. Android Metro/Hermes export passed (4.2 MB JavaScript bytecode; this is **not** Android DEX size).

A local `:app:bundleRelease` was attempted but failed in the Gradle wrapper download with `java.net.SocketException: Connection reset`, before Gradle/R8 could run. A separate curl attempt timed out after 90 seconds with only 4,969,984 of 137,037,885 bytes received. Native-build completion, R8 execution, mapping generation, DEX size and device behaviour remain unverified. This machine has no connected Android device, only the API 37 platform installed, and no installed NDK. API 36 and the required NDK remain local build prerequisites. The generated Android directory and incomplete downloads were removed after inspection.

## Next AAB

Run from `apps/mobile` with an authenticated EAS CLI:

```sh
eas build:version:get --platform android --profile production
```

The local fallback is versionCode 5. **Remote version management takes precedence**: confirm the remote current code is at least 4 and production auto-increment will produce a code above 4. If the remote counter is lower, use `eas build:version:set` to set the current counter to 4 before building. Do not reset a higher remote counter.

```sh
eas build --platform android --profile production
```

This builds an AAB; do not use auto-submit. No Play upload is part of this task. Keep generated `android/` absent from the EAS upload so both config plugins run.

Before requesting permission to replace the closed-test release:

1. Verify the EAS log contains `:app:minifyReleaseWithR8` and resource shrinking, with no R8 missing-class failure. Do not suppress failures globally.
2. Check `android/app/build/outputs/mapping/release/` for `mapping.txt`, merged `configuration.txt`, and `usage.txt` where emitted. The merged configuration must not contain active global optimisation/obfuscation/shrinking disabling flags. Preserve the matching mapping artifact for crash decoding.
3. Inspect the AAB ZIP for `BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map`. Sum the uncompressed lengths of every `*/dex/classes*.dex` entry for a comparable DEX-size measurement.
4. Install a release APK derived from the same AAB using bundletool, or test the equivalent signed release build. Expo Go/Metro alone does not test R8.
5. Check cold start, login/logout, secure session restoration/biometrics, Session/Round creation, scoring/auto-advance/edit/delete, reload persistence, navigation, Analytics, Counter, grouping export/share, and foreground weather permissions. Use disposable authorised QA data; preserve real records.
6. Verify native ELF/page alignment and Play's 16 KB page-size checks on the new AAB. This configuration change does not alter native geometry or packaging, but that is not artifact-level alignment proof.
7. After a separately approved upload, compare Build 4 and the new bundle in Play Console App Bundle Explorer: versionCode, uncompressed DEX size, optimisation/shrinking/obfuscation percentages, and R8 configuration reporting. The 25% thresholds cannot be claimed from configuration or JavaScript tests.

## References

- [Expo build-properties](https://docs.expo.dev/versions/latest/sdk/build-properties/)
- [Expo Continuous Native Generation](https://docs.expo.dev/workflow/continuous-native-generation/)
- [Expo remote app versions](https://docs.expo.dev/build-reference/app-versions/)
- [Android R8 configuration](https://developer.android.com/topic/performance/app-optimization/enable-app-optimization)
- [Google Play technical quality requirements](https://support.google.com/googleplay/android-developer/answer/17492799?hl=en)
