import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const { withAndroidIcons, dpiValues } = require("@expo/prebuild-config/build/plugins/icons/withAndroidIcons");
const root = fileURLToPath(new URL("../", import.meta.url));
const app = JSON.parse(await readFile(path.join(root, "app.json"), "utf8")).expo;
const foreground = app.android.adaptiveIcon.foregroundImage;

test("Android launcher config uses existing Arc Track artwork without changing other platforms", async () => {
  assert.equal(app.android.icon, "./assets/android/icon.png");
  assert.equal(foreground, "./assets/android/adaptive-foreground.png");
  assert.equal(app.android.adaptiveIcon.monochromeImage, foreground);
  assert.equal(app.android.adaptiveIcon.backgroundColor, "#563d30");
  assert.equal(app.icon, undefined, "Android artwork must not change iOS/web defaults");
  assert.equal(app.ios.icon, undefined);
  assert.equal(app.android.package, "com.arctrack.archery");
  const source = await readFile(new URL("../../src/app/icon.svg", new URL("../", import.meta.url)), "utf8");
  const original = await sharp(Buffer.from(source)).resize(1024, 1024).raw().toBuffer();
  const exported = await sharp(path.join(root, app.android.icon)).raw().toBuffer();
  assert.deepEqual(exported, original, "Legacy PNG is a raster export, not a redesigned logo");
  for (const asset of [app.android.icon, foreground]) {
    const ignored = spawnSync("git", ["check-ignore", "--no-index", path.join(root, asset)], { cwd: root, encoding: "utf8" });
    assert.equal(ignored.status, 1, `Icon asset must be eligible for the EAS source archive: ${ignored.stdout}`);
  }
});

test("adaptive and themed foreground retains transparent padding inside the Android safe circle", async () => {
  const { data, info } = await sharp(path.join(root, foreground)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 1024); assert.equal(info.height, 1024);
  let visible = 0, furthest = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 4;
    if (data[i + 3] === 0) continue;
    visible++;
    furthest = Math.max(furthest, Math.hypot(x + .5 - 512, y + .5 - 512));
    if (data[i + 3] === 255) assert.deepEqual([...data.subarray(i, i + 3)], [245, 223, 205]);
  }
  assert.ok(visible > 10000);
  assert.ok(furthest <= 1024 * 33 / 108, `Foreground exceeds the safe circle: ${furthest}`);
  assert.equal(data[3], 0, "The monochrome source must not contain an opaque square background");
});

test("installed Expo icon plugin generates all launcher densities and adaptive/themed references repeatedly", async () => {
  const parent = path.join(root, ".expo");
  await mkdir(parent, { recursive: true });
  const project = await mkdtemp(path.join(parent, "android-icons-test-"));
  try {
    await cp(path.join(root, "assets"), path.join(project, "assets"), { recursive: true });
    const isolated = structuredClone(app);
    isolated.android.icon = path.join(project, app.android.icon);
    isolated.android.adaptiveIcon.foregroundImage = path.join(project, foreground);
    isolated.android.adaptiveIcon.monochromeImage = path.join(project, foreground);
    const config = withAndroidIcons(isolated);
    const modRequest = { projectRoot: project, platformProjectRoot: path.join(project, "android"), platform: "android", introspect: false };
    const manifest = await config.mods.android.manifest({ ...config, modRequest,
      modResults: { manifest: { application: [{ $: { "android:name": ".MainApplication", "android:icon": "@mipmap/ic_launcher" } }] } } });
    assert.equal(manifest.modResults.manifest.application[0].$["android:roundIcon"], "@mipmap/ic_launcher_round");
    const colors = await config.mods.android.colors({ ...config, modRequest, modResults: { resources: {} } });
    assert.ok(colors.modResults.resources.color.some(color => color.$.name === "iconBackground" && color._ === "#563d30"));
    const generate = () => config.mods.android.dangerous({ ...config, modRequest, modResults: null });
    await generate();
    const res = path.join(project, "android/app/src/main/res");
    const square = await readFile(path.join(res, "mipmap-xxxhdpi/ic_launcher.webp"));
    const expected = await sharp(path.join(project, app.android.icon)).resize(192, 192).flatten({ background: "#563d30" }).raw().toBuffer();
    const actual = await sharp(square).flatten({ background: "#563d30" }).raw().toBuffer();
    assert.equal(actual.length, expected.length);
    // Expo's image pipeline and WebP encoding need not match Sharp byte-for-byte.
    const meanError = actual.reduce((sum, value, index) => sum + Math.abs(value - expected[index]), 0) / actual.length;
    assert.ok(meanError < 3, `Generated launcher differs from the custom logo: mean channel error ${meanError}`);
    for (const { folderName, scale } of Object.values(dpiValues)) {
      for (const [name, size] of [["ic_launcher", 48], ["ic_launcher_round", 48], ["ic_launcher_foreground", 108], ["ic_launcher_monochrome", 108]]) {
        const meta = await sharp(path.join(res, folderName, `${name}.webp`)).metadata();
        assert.equal(meta.width, size * scale); assert.equal(meta.height, size * scale);
      }
    }
    for (const name of ["ic_launcher", "ic_launcher_round"]) {
      const xml = await readFile(path.join(res, "mipmap-anydpi-v26", `${name}.xml`), "utf8");
      assert.match(xml, /<adaptive-icon/);
      assert.match(xml, /@color\/iconBackground/);
      assert.match(xml, /@mipmap\/ic_launcher_foreground/);
      assert.match(xml, /<monochrome android:drawable="@mipmap\/ic_launcher_monochrome"/);
    }
    await generate();
    assert.equal(createHash("sha256").update(await readFile(path.join(res, "mipmap-xxxhdpi/ic_launcher.webp"))).digest("hex"), createHash("sha256").update(square).digest("hex"));
  } finally {
    assert.ok(project.startsWith(parent + path.sep));
    await rm(project, { recursive: true, force: true });
  }
});
