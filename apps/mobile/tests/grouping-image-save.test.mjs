import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
function evaluate(path, dependencies, suffix = "") {
  const exports = {};
  const source = readFileSync(new URL(path, import.meta.url), "utf8") + suffix;
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function("require", "exports", compiled)(name => { if (!(name in dependencies)) throw Error(`Unexpected dependency ${name}`); return dependencies[name]; }, exports);
  return exports;
}
function saveRuntime(os = "android", version = 36) {
  const calls = [];
  const platform = { OS: os, Version: version };
  let granted = true, canAskAgain = true, nativeError = null, requestResult = "granted", missing = false, fileInfo = { exists: true, isDirectory: false, size: 1024 };
  const native = {
    Platform: platform,
    PermissionsAndroid: { PERMISSIONS: { WRITE_EXTERNAL_STORAGE: "write" }, RESULTS: { GRANTED: "granted", NEVER_ASK_AGAIN: "never" },
      async check(p) { calls.push(["check", p]); return granted; }, async request(p) { calls.push(["androidRequest", p]); return requestResult; } },
  };
  const deps = { "react-native": native, "expo-file-system/legacy": { async getInfoAsync(uri) { calls.push(["fileInfo", uri]); return fileInfo; } } };
  Object.defineProperty(deps, "expo-media-library", { get() { if (missing) throw Error("Cannot find native module 'ExpoMediaLibraryNext'"); return { Asset: { async create(file) { calls.push(["create", file]); if (nativeError) throw nativeError; return { id: "asset" }; } } }; } });
  deps["expo-media-library/legacy"] = { async getPermissionsAsync(...args) { calls.push(["getPermission", ...args]); return { granted, canAskAgain }; }, async requestPermissionsAsync(...args) { calls.push(["requestPermission", ...args]); return { granted: requestResult === "granted", canAskAgain }; }, async saveToLibraryAsync(file) { calls.push(["iosSave", file]); if (nativeError) throw nativeError; } };
  const { saveGroupingImage } = evaluate("../src/grouping-image-save.ts", deps);
  return { save: saveGroupingImage, calls, platform, deny(permanent = false) { granted = false; canAskAgain = !permanent; requestResult = permanent ? "never" : "denied"; }, fail(error) { nativeError = error; }, missing() { missing = true; }, file(info) { fileInfo = info; } };
}
const png = "file:///app/cache/round.png";
test("Android 11+ publishes only the app PNG without any read/write permission request", async () => {
  for (const version of [30, 32, 33, 36]) { const f = saveRuntime("android", version); await f.save(png); assert.deepEqual(f.calls.filter(call => call[0] !== "fileInfo"), [["create", png]]); }
});
test("old Android requests only legacy write permission and handles permanent denial", async () => {
  const f = saveRuntime("android", 29); await f.save(png); assert.deepEqual(f.calls.filter(call => call[0] !== "fileInfo"), [["check", "write"], ["create", png]]);
  const denied = saveRuntime("android", 28); denied.deny(true); await assert.rejects(denied.save(png), /Android Settings/); assert.deepEqual(denied.calls.filter(call => call[0] !== "fileInfo"), [["check", "write"], ["androidRequest", "write"]]);
});
test("iOS explicitly requests add-only access and never requests photo read access", async () => {
  const f = saveRuntime("ios", "18"); await f.save(png); assert.deepEqual(f.calls.filter(call => call[0] !== "fileInfo"), [["getPermission", true, []], ["iosSave", png]]);
  const denied = saveRuntime("ios"); denied.deny(); await assert.rejects(denied.save(png), /not allowed/); assert.deepEqual(denied.calls.filter(call => call[0] !== "fileInfo"), [["getPermission", true, []], ["requestPermission", true, []]]);
  const permanent = saveRuntime("ios"); permanent.deny(true); await assert.rejects(permanent.save(png), /iOS Settings/); assert.deepEqual(permanent.calls.filter(call => call[0] !== "fileInfo"), [["getPermission", true, []]]);
});
test("missing native binary and native save failures return actionable errors, never success", async () => {
  const f = saveRuntime(); f.missing(); await assert.rejects(f.save(png), /updated Arc Track native app build/);
  const failure = saveRuntime(); failure.fail(Error("private native path")); await assert.rejects(failure.save(png), /could not be saved/);
  await assert.rejects(failure.save("https://example.test/remote.png"), /could not be prepared/);
});
function previewRuntime() {
  const slots = []; let cursor = 0, saveError, sharing = true, saveResolve, captureError = false, writeError = false, captureData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZYkAAAAASUVORK5CYII=";
  const calls = [];
  const react = { useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; }, useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; } };
  const deps = { "react/jsx-runtime": jsx, react, "react-native": { Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View", StyleSheet: { create: x => x }, useWindowDimensions: () => ({ width: 390 }) },
    "react-native-svg": { SvgXml: "SvgXml" }, "react-native-safe-area-context": { SafeAreaProvider: "SafeAreaProvider", SafeAreaView: "SafeAreaView" },
    "./appearance": { createThemedStyles: factory => () => factory({}) }, "./grouping-export-report": { EXPORT_TOP_PADDING: 100, mobileExportPreviewWidth: () => 366, renderMobileGroupingExport: () => ({ svg: "<svg/>", width: 390, height: 2200 }) },
    "@arc-track/core/grouping-export": { createGroupingExport: x => x },
    "expo-file-system/legacy": { cacheDirectory: "file:///cache/", EncodingType: { Base64: "base64" }, async writeAsStringAsync(...args) { calls.push(["write", ...args]); if (writeError) throw Error("disk full"); } },
    "expo-sharing": { async isAvailableAsync() { calls.push(["sharingAvailable"]); return sharing; }, async shareAsync(...args) { calls.push(["share", ...args]); } },
    "./grouping-image-save": { async saveGroupingImage(file) { calls.push(["save", file]); if (saveError) throw Error(saveError); if (saveResolve) await saveResolve.promise; } },
  };
  const previewModule = evaluate("../src/grouping-export.tsx", deps, "\nexport { GroupingExportPreview };\n");
  const render = () => { cursor = 0; return previewModule.GroupingExportPreview({ report: { round: { id: "round", name: "Round" } }, onClose() {} }); };
  render(); slots[0].current = { toDataURL(callback, dimensions) { calls.push(["capture", dimensions]); if (captureError) throw Error("native capture failed"); callback(captureData); } };
  const nodes = element => !element || typeof element !== "object" ? [] : [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)];
  const text = element => [element?.props?.children].flat(Infinity).filter(x => typeof x === "string").join("");
  const action = label => nodes(render()).find(node => node.type === "Pressable" && nodes(node).some(child => text(child) === label));
  return { calls, render, nodes, text, click(label) { action(label).props.onPress(); }, unavailable() { sharing = false; }, fail(message) { saveError = message; }, failCapture() { captureError = true; }, corruptCapture(value) { captureData = value; }, failWrite() { writeError = true; }, hold() { let resolve; const promise = new Promise(done => { resolve = done; }); saveResolve = { promise }; return resolve; } };
}
const settle = async () => { await new Promise(setImmediate); };
test("Save and Share preserve full PNG capture dimensions and only save confirms Gallery completion", async () => {
  const f = previewRuntime(); f.unavailable(); f.click("Save to Device"); await settle();
  assert.ok(f.calls.some(call => call[0] === "save")); assert.ok(!f.calls.some(call => call[0] === "sharingAvailable"));
  assert.deepEqual(f.calls.find(call => call[0] === "capture")[1], { width: 390, height: 2200 });
  assert.ok(f.nodes(f.render()).some(node => f.text(node) === "Image saved to Photos / Gallery."));
  const share = previewRuntime(); share.click("Share Image"); await settle();
  assert.ok(share.calls.some(call => call[0] === "share" && call[1].endsWith(".png") && call[2].mimeType === "image/png"));
  assert.ok(!share.calls.some(call => call[0] === "save")); assert.ok(!share.nodes(share.render()).some(node => f.text(node).includes("Image saved")));
});
test("pending saves prevent duplicate submissions and failed saves never display success", async () => {
  const f = previewRuntime(); const complete = f.hold(); f.click("Save to Device"); f.click("Saving..."); await settle();
  assert.equal(f.calls.filter(call => call[0] === "save").length, 1); assert.ok(!f.nodes(f.render()).some(node => f.text(node).includes("Image saved"))); complete(); await settle();
  const failed = previewRuntime(); failed.fail("Permission denied"); failed.click("Save to Device"); await settle();
  assert.ok(failed.nodes(failed.render()).some(node => failed.text(node) === "Permission denied")); assert.ok(!failed.nodes(failed.render()).some(node => failed.text(node).includes("Image saved")));
});
test("native config grants add-only iOS and caps legacy Android write permission without media reads", () => {
  const require = createRequire(import.meta.url);
  const result = spawnSync(process.execPath, [require.resolve("expo/bin/cli"), "config", "--type", "introspect", "--json"], { cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 60000 });
  assert.equal(result.status, 0, result.stderr); const config = JSON.parse(result.stdout);
  const plist = config._internal.modResults.ios.infoPlist; assert.match(plist.NSPhotoLibraryAddUsageDescription, /save exported/); assert.equal(plist.NSPhotoLibraryUsageDescription, undefined);
  const permissions = config._internal.modResults.android.manifest.manifest["uses-permission"].map(item => item.$);
  for (const name of ["READ_EXTERNAL_STORAGE", "READ_MEDIA_IMAGES", "READ_MEDIA_VIDEO", "READ_MEDIA_AUDIO", "READ_MEDIA_VISUAL_USER_SELECTED", "ACCESS_MEDIA_LOCATION"]) assert.ok(permissions.some(item => item["android:name"] === "android.permission." + name && item["tools:node"] === "remove"), name);
  const write = permissions.find(item => item["android:name"] === "android.permission.WRITE_EXTERNAL_STORAGE"); assert.equal(write["android:maxSdkVersion"], "29"); assert.equal(write["tools:replace"], "android:maxSdkVersion");
});

test("capture and file-write failures clear pending state without claiming a saved image", async () => {
  for (const action of ["failCapture", "failWrite"]) {
    const f = previewRuntime(); f[action](); f.click("Save to Device"); await settle();
    assert.ok(f.nodes(f.render()).some(node => f.text(node).includes("PNG image could not be prepared")));
    assert.ok(!f.calls.some(call => call[0] === "save"));
    assert.ok(!f.nodes(f.render()).some(node => f.text(node).includes("Image saved")));
  }
});
test("sharing unavailable never blocks Save and never announces a Gallery save", async () => {
  const f = previewRuntime(); f.unavailable(); f.click("Share Image"); await settle();
  assert.ok(!f.calls.some(call => call[0] === "capture" || call[0] === "share" || call[0] === "save"));
  assert.ok(f.nodes(f.render()).some(node => f.text(node).includes("could not be shared")));
});

test("missing, empty or directory PNG paths cannot reach native Gallery saving", async () => {
  for (const info of [{exists:false},{exists:true,isDirectory:false,size:0},{exists:true,isDirectory:true,size:4096}]) {
    const f=saveRuntime();f.file(info);await assert.rejects(f.save(png),/missing or empty/);
    assert.deepEqual(f.calls,[["fileInfo",png]]);
  }
  for(const uri of ["file:///cache/image.jpg","content://media/1.png","file:///cache/image.png?invalid"]) {
    const f=saveRuntime();await assert.rejects(f.save(uri),/could not be prepared/);assert.equal(f.calls.length,0);
  }
});
test("non-PNG or empty capture output is rejected before file writing, saving or sharing", async () => {
  for(const data of ["",null,"not-a-png","/9j/not-png"]) {
    const f=previewRuntime();f.corruptCapture(data);f.click("Save to Device");await settle();
    assert.equal(f.calls.some(call=>["write","save","share"].includes(call[0])),false);
    assert.ok(f.nodes(f.render()).some(node=>f.text(node).includes("PNG image could not be prepared")));
    assert.equal(f.nodes(f.render()).some(node=>f.text(node).includes("Image saved")),false);
  }
});
test("repeated completed saves perform a new native save each time", async () => {
  const f=previewRuntime();f.click("Save to Device");await settle();f.click("Save to Device");await settle();
  assert.equal(f.calls.filter(call=>call[0]==="save").length,2);
});
