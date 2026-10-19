import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import withAndroidMaterialComponents from "../plugins/with-android-material-components.cjs";
import withOptimizedAndroidRelease from "../plugins/with-optimized-android-release.cjs";

const require = createRequire(import.meta.url);
const template = execFileSync("tar", ["-xOzf", require.resolve("expo/template.tgz"), "package/android/app/build.gradle"], { encoding: "utf8" });

async function apply(contents, language = "groovy", plugin = withAndroidMaterialComponents) {
  const config = plugin({});
  return (await config.mods.android.appBuildGradle({
    modRequest: {}, modResults: { language, contents },
  })).modResults.contents;
}

test("Material constraint changes only app dependencies and remains repeatable", async () => {
  const result = await apply(template);
  const inserted = result.slice(result.indexOf("    constraints {"), result.indexOf("    // The version of react-native"));
  assert.match(inserted, /implementation\("com.google.android.material:material:1\.14\.0"\)/);
  assert.equal(result.replace(inserted, ""), template);
  assert.equal(await apply(result), result);
  assert.doesNotMatch(inserted, /force|strictly|resolutionStrategy|androidx|proguard|screenOrientation/);
  assert.equal((result.match(/com\.google\.android\.material:material/g) ?? []).length, 1);
  const windowsResult = await apply(template.replace(/\r?\n/g, "\r\n"));
  assert.equal(await apply(windowsResult), windowsResult);
});

test("Material constraint composes with R8 without changing release configuration", async () => {
  const optimized = await apply(template, "groovy", withOptimizedAndroidRelease);
  assert.equal(await apply(optimized), await apply(await apply(template), "groovy", withOptimizedAndroidRelease));
  assert.match(await apply(optimized), /getDefaultProguardFile\("proguard-android-optimize.txt"\)/);
});

test("unexpected Gradle template changes fail visibly", async () => {
  await assert.rejects(apply("android {}"), /dependencies block changed/);
  await assert.rejects(apply(template, "kotlin"), /Groovy/);
});

test("CNG registers the Material plugin alongside the unchanged release and orientation plugins", () => {
  const app = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8")).expo;
  for (const plugin of ["with-android-material-components", "with-optimized-android-release", "with-android-adaptive-orientation"]) {
    assert.equal(app.plugins.filter(entry => entry === `./plugins/${plugin}.cjs`).length, 1);
  }
});
