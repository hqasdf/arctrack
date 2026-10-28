# SDK 58 workspace repair

Run dependency installation from the repository root with both development servers stopped:

~~~powershell
npm ci
~~~

Postinstall must remain enabled. SecureStore 58.0.2 is pinned and its exact native source is guarded/patched. It still ignores encrypted-write commit failure upstream. Keep the source-build autolinking setting; Expo Go and a JS export do not validate this native fix.

The root Next.js tsconfig is independent of Expo and includes website source and generated Next types only. The mobile tsconfig extends expo/tsconfig.base. Root Expo Router is an explicit development-tool peer so the hoisted SDK 58 CLI can resolve Router typed-route internals; the website does not import Router. Do not disable typed routes or create node_modules shims.

Start each server in a separate terminal from the repository root:

~~~powershell
npm run dev -- --port 3000
npm run start --workspace @arc-track/mobile -- --localhost --port 8081
~~~

For a physical Android phone outside localhost, use the existing LAN/USB setup; localhost alone is not a phone network address. Use an SDK 58 native/development build for custom passkey modules and the SecureStore correction. The generated Android directory was refreshed from existing config/plugins, preserving its old contents in .verification/sdk58/android-sdk57-backup. Host SDK/NDK paths remain ignored local properties.

Dependency changes legitimately invalidate Turbopack's package graph. Never run npm install/ci/dedupe against node_modules while these servers are running. Stop the old process before starting another; Next's development lock must not be deleted to bypass a running server.

Live Coaching uses payload-free events, a 55-second server stream lifetime and a 60-second foreground recovery interval. Reconnection reads and server authorization checks are expected. Stable rerenders must not create streams or fetch loops; a regression test covers that boundary.

No migrations, production settings or releases are part of this repair. Full Android hardware acceptance remains separate from Node tests and Metro export.

## Verification result

Clean npm ci with postinstall passed; ordinary npm dedupe passed after lock reconstruction. Expo Doctor passed 20/20. Website/mobile/shared-core suites passed 667/525/116 tests. Both TypeScript checks, website lint/build and Android Hermes export passed. Four actual SecureStore Kotlin tests passed, including false commit and legacy-key preservation.

Full mobile lint still reports eight existing findings in unchanged recovery/auth/category/weather files. No rules were disabled. Full debug APK assembly reached native compilation but Ninja failed on a Gradle-cache library path longer than 260 characters. Use a shorter native build/cache location for that remaining Windows build check; no APK or device acceptance is claimed. Eight dependency advisories remain (3 high, 5 low); no blanket audit fix was applied.
