import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { BiometricLock } from "../src/biometric-lock-model.ts";
const require = createRequire(import.meta.url);
function compile(file, dependencies) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {};
  new Function("require", "exports", "__DEV__", compiled)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, exports, false);
  return exports;
}
function native({ platform = "android", hardware = true, enrolled = true, types = [1], level = 3, environment = "bare", result = { success: true } } = {}) {
  const calls = [];
  const sdk = { AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2 }, SecurityLevel: { BIOMETRIC_STRONG: 3 },
    hasHardwareAsync: async () => hardware, isEnrolledAsync: async () => enrolled,
    supportedAuthenticationTypesAsync: async () => types, getEnrolledLevelAsync: async () => level,
    authenticateAsync: async options => { calls.push(options); return result; } };
  return { calls, ...compile("../src/biometrics.ts", { "expo-local-authentication": sdk,
    "expo-constants": { __esModule: true, default: { executionEnvironment: environment }, ExecutionEnvironment: { StoreClient: "store" } },
    "react-native": { Platform: { OS: platform } } }) };
}
test("only secure enrolled Android biometrics reach the native prompt; no passcode fallback", async () => {
  const n = native(); assert.equal((await n.biometricAvailability()).available, true);
  assert.deepEqual(await n.authenticateBiometric(), { success: true });
  assert.equal(n.calls.length, 1); assert.equal(n.calls[0].biometricsSecurityLevel, "strong");
  assert.equal(n.calls[0].disableDeviceFallback, true); assert.equal(n.calls[0].fallbackLabel, "");
});
for (const options of [{ hardware: false }, { enrolled: false }, { types: [] }, { level: 2 }, { level: 1 }, { platform: "web" }]) {
  test(`unavailable/weak capabilities cannot enable biometric unlock (${JSON.stringify(options)})`, async () => {
    const n = native(options); assert.equal((await n.authenticateBiometric()).success, false); assert.equal(n.calls.length, 0);
  });
}
test("iOS labels Face ID and Touch ID accurately and refuses Face ID in Expo Go", async () => {
  assert.equal((await native({ platform: "ios", types: [2] }).biometricAvailability()).label, "Face ID Unlock");
  assert.equal((await native({ platform: "ios", types: [1] }).biometricAvailability()).label, "Touch ID Unlock");
  const go = native({ platform: "ios", types: [2], environment: "store" });
  assert.equal((await go.authenticateBiometric()).success, false); assert.equal(go.calls.length, 0);
});
test("native failure/cancellation exposes no raw OS error or warning", async () => {
  const n = native({ result: { success: false, error: "private OS detail", warning: "private warning" } });
  const r = await n.authenticateBiometric(); assert.equal(r.success, false); assert.doesNotMatch(r.message, /private/);
});

function boundary(snapshot, auth = {}) {
  const dependencies = {
    react: { createContext: () => ({ Provider: "Provider" }), useContext: () => null, useEffect: () => {},
      useState: initial => [typeof initial === "function" ? initial() : initial, () => {}], useSyncExternalStore: () => snapshot },
    "react/jsx-runtime": jsx,
    "expo-secure-store": {}, "./biometrics": {}, "./biometric-lock-model": { BiometricLock },
    "react-native": { View: "View", Text: "Text", Pressable: "Pressable", Switch: "Switch", ActivityIndicator: "Spinner", AppState: {}, StyleSheet: { create: v => v } },
    "./auth": { useAuth: () => ({ user: { id: "A" }, loading: false, authError: false, recoveryRequired: false, signOut: async () => {}, ...auth }) },
    "./auth-flow": {}, "./supabase": { supabase: null }, "./theme": { colors: {} },
  };
  const { BiometricLockProvider } = compile("../src/biometric-lock.tsx", dependencies);
  return BiometricLockProvider({ children: jsx.jsx("ProtectedRoutes", {}) }).props.children;
}
const state = { userId: "A", loaded: true, enabled: true, locked: true, busy: false, obscured: false, hasUnlocked: false };
function contains(node, type) {
  if (!node || typeof node !== "object") return false;
  if (node.type === type) return true;
  return [node.props?.children].flat(Infinity).some(child => contains(child, type));
}
test("cold start/deep links cannot mount protected routes before preference read/unlock", () => {
  for (const s of [state, { ...state, loaded: false }, { ...state, userId: "B", hasUnlocked: true }]) {
    const tree = boundary(s); assert.equal(contains(tree, "ProtectedRoutes"), false);
    const cover = tree.props.children[1]; assert.equal(cover.props.style.position, "absolute"); assert.equal(cover.props.accessibilityViewIsModal, true);
  }
});
test("later locks preserve scoring state under an opaque, noninteractive, accessibility-hidden cover", () => {
  const tree = boundary({ ...state, hasUnlocked: true }); assert.equal(contains(tree, "ProtectedRoutes"), true);
  const content = tree.props.children[0]; assert.equal(content.props.pointerEvents, "none");
  assert.equal(content.props.accessibilityElementsHidden, true); assert.equal(content.props.importantForAccessibility, "no-hide-descendants");
});
test("unlocked/disabled users and normal sign-in/recovery retain their existing route boundary", () => {
  for (const [s, auth] of [[{ ...state, locked: false }, {}], [{ ...state, locked: false, enabled: false }, {}], [{ ...state, enabled: false, obscured: true }, {}], [state, { user: null }], [state, { recoveryRequired: true }]]) {
    const tree = boundary(s, auth); assert.equal(contains(tree, "ProtectedRoutes"), true); assert.equal(tree.props.children[1], false);
  }
});
test("actual Expo plugin evaluation preserves Face ID permission without protecting Supabase token reads", () => {
  const result = spawnSync(process.execPath, [require.resolve("expo/bin/cli"), "config", "--type", "introspect", "--json"], {
    cwd: new URL("../", import.meta.url), encoding: "utf8", maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.status, 0, "Expo configuration evaluation must succeed");
  const config = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
  assert.equal(config._internal.modResults.ios.infoPlist.NSFaceIDUsageDescription, "Allow Arc Track to use Face ID for optional app unlock.");
  assert.ok(config.android.permissions.includes("android.permission.USE_BIOMETRIC"));
  assert.ok(!config.android.permissions.some(p => /READ_SMS|RECEIVE_SMS|READ_EMAIL/.test(p)));
  const wrapper = readFileSync(new URL("../src/secure-auth-storage.ts", import.meta.url), "utf8");
  assert.doesNotMatch(wrapper, /requireAuthentication|LocalAuthentication/);
});
