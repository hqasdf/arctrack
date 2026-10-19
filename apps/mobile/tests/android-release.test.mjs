import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import withOptimizedAndroidRelease from "../plugins/with-optimized-android-release.cjs";

const require = createRequire(import.meta.url);
const app = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8")).expo;

async function apply(contents, language = "groovy") {
  const config = withOptimizedAndroidRelease({});
  return (await config.mods.android.appBuildGradle({
    modRequest: {}, modResults: { language, contents },
  })).modResults.contents;
}

test("release optimisation uses the installed Expo template without changing native keep rules", async () => {
  const template = require.resolve("expo/template.tgz");
  const gradle = execFileSync("tar", ["-xOzf", template, "package/android/app/build.gradle"], { encoding: "utf8" });
  const result = await apply(gradle);
  assert.equal(result, gradle.replace('getDefaultProguardFile("proguard-android.txt")', 'getDefaultProguardFile("proguard-android-optimize.txt")'));
  assert.equal(await apply(result), result);
  assert.match(result, /minifyEnabled enableMinifyInReleaseBuilds/);
  assert.match(result, /shrinkResources enableShrinkResources.toBoolean\(\)/);
  assert.match(result, /"proguard-rules.pro"/);
  assert.match(result, /findProperty\('expo.useLegacyPackaging'\) \?: 'false'/);
});

test("unsupported template changes fail visibly instead of silently disabling optimisation", async () => {
  await assert.rejects(apply("android {}"), /default ProGuard configuration changed/);
  await assert.rejects(apply("android {}", "kotlin"), /Groovy/);
});

test("release flags survive actual Expo config plugin evaluation with existing SDK and permissions", () => {
  const output = execFileSync(process.execPath, [require.resolve("expo/bin/cli"), "config", "--type", "introspect", "--json"], {
    cwd: new URL("../", import.meta.url), encoding: "utf8", maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, EXPO_NO_DOTENV: "1" },
  });
  const evaluated = JSON.parse(output.slice(output.indexOf("{")));
  const properties = evaluated._internal.modResults.android.gradleProperties;
  const property = key => properties.find(p => p.type === "property" && p.key === key)?.value;
  assert.equal(property("android.enableMinifyInReleaseBuilds"), "true");
  assert.equal(property("android.enableShrinkResourcesInReleaseBuilds"), "true");
  assert.notEqual(property("android.enableR8.fullMode"), "false");
  assert.ok(!properties.some(p => p.type === "property" && /android\.(minSdkVersion|targetSdkVersion|compileSdkVersion)/.test(p.key)));
  // Introspection may omit untouched template defaults when android/ is absent.
  assert.notEqual(property("expo.useLegacyPackaging"), "true");
  assert.ok(app.android.versionCode > 4);
  assert.ok(app.android.blockedPermissions.includes("android.permission.ACCESS_BACKGROUND_LOCATION"));
});
