import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import withAndroidAdaptiveOrientation from "../plugins/with-android-adaptive-orientation.cjs";

const require = createRequire(import.meta.url);

test("Android manifest adjustment removes orientation without adding a replacement restriction", async () => {
  const manifest = { manifest: { application: [{ activity: [{ $: {
    "android:name": ".MainActivity", "android:screenOrientation": "portrait",
    "android:configChanges": "orientation|screenSize", "android:windowSoftInputMode": "adjustResize",
  }, "intent-filter": [{ action: [{ $: { "android:name": "android.intent.action.MAIN" } }] }] }] }] } };
  const ios = { supportsTablet: true };
  const config = withAndroidAdaptiveOrientation({ orientation: "portrait", ios });
  assert.equal(config.orientation, "portrait");
  assert.equal(config.ios, ios);
  assert.equal(config.mods.ios, undefined);
  const apply = async () => config.mods.android.manifest({ modRequest: {}, modResults: manifest });
  await apply();
  const activity = manifest.manifest.application[0].activity[0];
  assert.deepEqual(activity.$, {
    "android:name": ".MainActivity", "android:configChanges": "orientation|screenSize",
    "android:windowSoftInputMode": "adjustResize",
  });
  await apply();
  assert.equal("android:screenOrientation" in activity.$, false);
});

test("actual Expo-generated manifest has unrestricted Android orientation and keeps iOS/R8 policies", () => {
  const output = execFileSync(process.execPath, [require.resolve("expo/bin/cli"), "config", "--type", "introspect", "--json"], {
    cwd: new URL("../", import.meta.url), encoding: "utf8", maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, EXPO_NO_DOTENV: "1" },
  });
  const config = JSON.parse(output.slice(output.indexOf("{")));
  const results = config._internal.modResults;
  const activity = require("expo/config-plugins").AndroidConfig.Manifest.getMainActivityOrThrow(results.android.manifest);
  assert.equal("android:screenOrientation" in activity.$, false);
  assert.notEqual(activity.$["android:resizeableActivity"], "false");
  assert.equal(activity.$["android:windowSoftInputMode"], "adjustResize");
  for (const change of ["orientation", "screenSize", "smallestScreenSize"]) assert.ok(activity.$["android:configChanges"].split("|").includes(change));
  assert.doesNotMatch(JSON.stringify(results.android.manifest), /PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY|windowOptOutEdgeToEdgeEnforcement/);
  assert.deepEqual(results.ios.infoPlist.UISupportedInterfaceOrientations, ["UIInterfaceOrientationPortrait", "UIInterfaceOrientationPortraitUpsideDown"]);
  // Preserve Expo's existing iPad multitasking policy as well as iPhone portrait.
  assert.deepEqual(results.ios.infoPlist["UISupportedInterfaceOrientations~ipad"], ["UIInterfaceOrientationPortrait", "UIInterfaceOrientationPortraitUpsideDown", "UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight"]);
  const properties = results.android.gradleProperties;
  for (const key of ["android.enableMinifyInReleaseBuilds", "android.enableShrinkResourcesInReleaseBuilds"]) {
    assert.equal(properties.find(p => p.type === "property" && p.key === key)?.value, "true");
  }
});
