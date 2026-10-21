import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import * as jsx from "react/jsx-runtime";
import { createAppearanceStore, APPEARANCE_STORAGE_KEY } from "../src/appearance-store.ts";
import { getThemeColors } from "../src/theme.ts";
function fixture(value = null) {
  let os = "light", override = "system", callback;
  const values = new Map(value === null ? [] : [[APPEARANCE_STORAGE_KEY, value]]);
  const writes = [];
  let failRead = false, failWrite = false, reads = 0, stopped = 0;
  const store = createAppearanceStore({
    async getItem(key) { reads++; if (failRead) throw Error("offline"); return values.get(key) ?? null; },
    async setItem(key, value) { if (failWrite) throw Error("storage unavailable"); writes.push(value); values.set(key, value); },
  }, {
    current: () => override === "system" ? os : override,
    apply: preference => { override = preference; },
    listen(listener) { callback = listener; return () => { stopped++; callback = undefined; }; },
  });
  return { store, values, writes, get reads() { return reads; }, get stopped() { return stopped; }, setOS(value) { os = value; callback?.(); }, failRead(value) { failRead = value; }, failWrite(value) { failWrite = value; } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test("first launch defaults to System and follows OS changes without changing preference", async () => {
  const f = fixture(); f.setOS("dark"); const stop = f.store.start(); await flush();
  assert.deepEqual(f.store.getSnapshot(), { preference: "system", resolvedTheme: "dark", ready: true, error: null });
  f.setOS("light"); assert.equal(f.store.getSnapshot().resolvedTheme, "light"); assert.equal(f.store.getSnapshot().preference, "system");
  assert.deepEqual(f.writes, []); stop(); assert.equal(f.stopped, 1);
});
test("explicit Dark and Light override system, then System resumes following", async () => {
  const f = fixture(); f.store.start(); await flush();
  await f.store.setPreference("dark"); f.setOS("light"); assert.equal(f.store.getSnapshot().resolvedTheme, "dark");
  await f.store.setPreference("light"); f.setOS("dark"); assert.equal(f.store.getSnapshot().resolvedTheme, "light");
  await f.store.setPreference("system"); assert.equal(f.store.getSnapshot().resolvedTheme, "dark");
  assert.deepEqual(f.writes, ["dark", "light", "system"]);
});
test("startup restores saved Dark before reporting ready and survives a new store", async () => {
  const f = fixture("dark"); assert.equal(f.store.getSnapshot().ready, false); f.store.start(); await flush();
  assert.equal(f.store.getSnapshot().resolvedTheme, "dark"); assert.equal(f.store.getSnapshot().ready, true);
  await f.store.setPreference("light"); const restarted = fixture(f.values.get(APPEARANCE_STORAGE_KEY)); restarted.store.start(); await flush();
  assert.equal(restarted.store.getSnapshot().preference, "light");
});
for (const value of ["broken", '{"theme":"dark"}', "", "null"]) test(`invalid stored preference ${JSON.stringify(value)} falls back safely`, async () => {
  const f = fixture(value); f.store.start(); await flush(); assert.equal(f.store.getSnapshot().preference, "system"); assert.deepEqual(f.writes, []);
});
test("failed read does not overwrite stored preference; retry restores it", async () => {
  const f = fixture("dark"); f.failRead(true); f.store.start(); await flush();
  assert.equal(f.store.getSnapshot().ready, true); assert.match(f.store.getSnapshot().error, /could not be loaded/); assert.deepEqual(f.writes, []);
  f.failRead(false); await f.store.retry(); assert.equal(f.store.getSnapshot().preference, "dark");
});
test("failed persistence retains immediate appearance, reports failure, and can retry", async () => {
  const f = fixture(); f.store.start(); await flush(); f.failWrite(true); await f.store.setPreference("dark");
  assert.equal(f.store.getSnapshot().resolvedTheme, "dark"); assert.match(f.store.getSnapshot().error, /could not be saved/);
  f.failWrite(false); await f.store.setPreference("dark"); assert.equal(f.values.get(APPEARANCE_STORAGE_KEY), "dark"); assert.equal(f.store.getSnapshot().error, null);
});
test("rapid selections persist in order and final selection wins", async () => {
  const f = fixture(); f.store.start(); await flush(); await Promise.all([f.store.setPreference("dark"), f.store.setPreference("light"), f.store.setPreference("system")]);
  assert.deepEqual(f.writes, ["dark", "light", "system"]); assert.equal(f.values.get(APPEARANCE_STORAGE_KEY), "system");
});
test("late startup read cannot overwrite a user's newer choice", async () => {
  let finish;
  const store = createAppearanceStore({ getItem: () => new Promise(resolve => { finish = resolve; }), setItem: async () => {} }, { current: () => "light", apply() {}, listen: () => () => {} });
  store.start(); await store.setPreference("dark"); finish("light"); await flush(); assert.equal(store.getSnapshot().preference, "dark");
});
test("website base tokens are exact and stable; selector exposes all accessible choices", () => {
  assert.equal(getThemeColors("light").background, "#f7f5f1"); assert.equal(getThemeColors("dark").background, "#181715");
  assert.equal(getThemeColors("dark").text, "#f1e8df"); assert.equal(getThemeColors("dark").accent, "#e6b895");
  assert.equal(getThemeColors("dark"), getThemeColors("dark"));
  let active = "system"; const selected = [];
  const source = readFileSync(new URL("../src/appearance-settings.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(name => name === "react/jsx-runtime" ? jsx : name === "react-native" ? { View: "View", Text: "Text", Pressable: "Pressable", StyleSheet: { create: x => x } } : { createThemedStyles: factory => () => factory(getThemeColors("dark")), useAppearance: () => ({ preference: active, setPreference: value => { selected.push(value); active = value; }, error: null }) }, exports);
  const nodes = element => !element || typeof element !== "object" ? [] : [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)];
  let radios = nodes(exports.AppearanceSettings()).filter(node => node.props?.accessibilityRole === "radio");
  assert.equal(radios.length, 3); assert.equal(radios[2].props.accessibilityState.checked, true);
  radios[1].props.onPress(); radios = nodes(exports.AppearanceSettings()).filter(node => node.props?.accessibilityRole === "radio");
  assert.deepEqual(selected, ["dark"]); assert.equal(radios[1].props.accessibilityState.checked, true);
});
test("native and root boundary preserve auth architecture and mobile-local appearance across accounts", () => {
  const root = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");
  assert.match(root, /<AppearanceProvider><ThemedApp/); assert.match(root, /<AuthProvider>/); assert.match(root, /key=\{user\?\.id \?\? "signed-out"\}/);
  assert.match(root, /resolvedTheme === "dark" \? "light" : "dark"/);
  const config = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8")); assert.equal(config.expo.userInterfaceStyle, "automatic");
  const provider = readFileSync(new URL("../src/appearance.tsx", import.meta.url), "utf8");
  assert.match(provider, /preference === "system" \? "unspecified" : preference/);
  assert.doesNotMatch(provider, /SecureStore|supabase|signOut/);
});

test("every general palette token matches the actual website CSS", () => {
  const files = { light: "../../../src/styles/globals.css", dark: "../../../src/styles/theme.css" };
  const names = { background: "background", surface: "surface", control: "control-surface", text: "text", muted: "muted", accent: "primary", onPrimary: "on-primary", border: "border", soft: "soft", inputBorder: "input-border", error: "error", errorBackground: "error-background", errorBorder: "error-border", chartSecondary: "chart-secondary" };
  for (const mode of ["light", "dark"]) {
    const css = readFileSync(new URL(files[mode], import.meta.url), "utf8");
    const tokens = Object.fromEntries([...css.matchAll(/--color-([\w-]+):\s*(#[\da-f]+)/gi)].reverse().map(match => [match[1], match[2]]));
    const expand = value => value.length === 4 ? "#" + [...value.slice(1)].map(c => c + c).join("") : value;
    for (const [mobile, web] of Object.entries(names)) assert.equal(expand(getThemeColors(mode)[mobile]).toLowerCase(), expand(tokens[web]).toLowerCase(), mode + ": " + mobile);
  }
});
test("real Expo native configuration generates automatic Android and iOS appearance", () => {
  const require = createRequire(import.meta.url);
  const result = spawnSync(process.execPath, [require.resolve("expo/bin/cli"), "config", "--type", "introspect", "--json"], { cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 60000 });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(config.userInterfaceStyle, "automatic");
  assert.equal(config._internal.modResults.ios.infoPlist.UIUserInterfaceStyle, "Automatic");
  const strings = config._internal.modResults.android.strings.resources.string;
  assert.equal(strings.find(item => item.$.name === "expo_system_ui_user_interface_style")._, "automatic");
  assert.equal(config.android.package, "com.arctrack.archery");
});
