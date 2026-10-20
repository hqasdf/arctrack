import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { providerRuntime } from "./helpers/auth-runtime.mjs";
import { invalidatePasskeyOperations, observePasskeyInvalidation } from "../src/passkeys/lifecycle.ts";

const mobile = fileURLToPath(new URL("..", import.meta.url));
const read = file => readFileSync(path.join(mobile, file), "utf8");
function load(file, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  new Function("require", "exports", code)(name => {
    if (name in mocks) return mocks[name];
    if (name === "react/jsx-runtime") return jsx;
    if (name === "./feature") return load("src/passkeys/feature.ts");
    throw Error(`Unexpected dependency ${name}`);
  }, exports);
  return exports;
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const outcome = promise => promise.then(value => ({ value }), error => ({ error }));

test("controlled Android testing enables the reviewed gates and exact approved RP without substituting the project", () => {
  const feature = load("src/passkeys/feature.ts");
  assert.equal(feature.PASSKEY_FEATURE_ENABLED, true);
  assert.equal(feature.PASSKEY_REGISTRATION_READY, true);
  assert.equal(feature.PASSKEY_SESSION_ADOPTION_READY, true);
  assert.equal(feature.PASSKEY_RELYING_PARTY_ID, "archery-website.vercel.app");
  assert.equal(feature.canShowBiometricSignIn(), true);
  assert.equal(feature.canShowBiometricSignInSetting(), true);
  assert.doesNotThrow(feature.assertPasskeysAllowed);
  for (const file of ["feature.ts", "provider.ts", "runtime.ts", "service.ts"]) {
    assert.doesNotMatch(read(`src/passkeys/${file}`), /passkeydev|ARC_TRACK_DEV|arcTrackDevelopment|productionHost/);
  }
});

function coordinatorRuntime() {
  const { createPasskeyOperationCoordinator } = load("src/passkeys/coordinator.ts");
  let owner = "athlete-a", creations = 0, allowed = true, current;
  const gate = deferred();
  const coordinator = createPasskeyOperationCoordinator({
    assertAllowed() { if (!allowed) throw Error("Disabled"); }, getOwnerId: () => owner,
    createService(isCurrent) { creations++; current = isCurrent;
      return { register: async () => { await gate.promise; return { id: "server-confirmed" }; },
        list: async () => [], remove: async () => undefined };
    },
  });
  return { coordinator, gate, get creations() { return creations; }, get current() { return current; },
    setOwner(value) { owner = value; }, disable() { allowed = false; } };
}

test("coordinator is idle and cannot adopt even if called directly", async () => {
  const r = coordinatorRuntime();
  r.coordinator.setForeground(false); r.coordinator.setForeground(true);
  assert.equal(r.creations, 0);
  await assert.rejects(r.coordinator.authenticate(), /session adoption has not been implemented/);
  assert.equal(r.creations, 0);
});

test("main-app provider cannot create native/server clients while disabled", async () => {
  let creations = 0, ownerReads = 0;
  const factory = load("src/passkeys/provider.ts", {
    "./feature": { assertPasskeysAllowed() { throw Error("not available"); } },
    "./native-adapter": { createNativePasskeyAdapter() { creations++; throw Error("Unexpected native adapter"); } },
    "./service": { createPreparedPasskeyService() { creations++; throw Error("Unexpected server client"); } },
    "./coordinator": load("src/passkeys/coordinator.ts"),
  });
  const provider = factory.createApplicationPasskeyProvider({
    supabaseUrl: "https://pdwxphgyqbbflnrruobp.supabase.co", publishableKey: "sb_publishable_synthetic",
    currentOwner() { ownerReads++; return null; },
  });
  assert.equal(creations, 0); assert.equal(ownerReads, 0);
  await assert.rejects(provider.register(), /not available/);
  await assert.rejects(provider.authenticate(), /session adoption has not been implemented/);
  assert.equal(creations, 0); assert.equal(ownerReads, 0);
});

test("only one management operation can run, and returned data is not session authority", async () => {
  const r = coordinatorRuntime(), pending = r.coordinator.register();
  await assert.rejects(r.coordinator.register(), /already in progress/);
  assert.equal(r.creations, 1); assert.equal(r.current(), true);
  r.gate.resolve(); assert.deepEqual(await pending, { id: "server-confirmed" });
  assert.deepEqual(await r.coordinator.list(), []);
});

for (const reason of ["logout", "switch", "background", "dispose"]) {
  test(`${reason} invalidates a pending management result`, async () => {
    const r = coordinatorRuntime(), pending = outcome(r.coordinator.register());
    if (reason === "logout") r.coordinator.invalidate();
    if (reason === "switch") r.setOwner("athlete-b");
    if (reason === "background") r.coordinator.setForeground(false);
    if (reason === "dispose") r.coordinator.dispose();
    assert.equal(r.current(), false); r.gate.resolve();
    assert.match((await pending).error.message, /abandoned/);
  });
}

test("unavailable or signed-out management rejects before service creation", async () => {
  const r = coordinatorRuntime(); r.disable();
  await assert.rejects(r.coordinator.list(), /Disabled/); assert.equal(r.creations, 0);
  const s = coordinatorRuntime(); s.setOwner(null);
  await assert.rejects(s.coordinator.register(), /Sign in before/); assert.equal(s.creations, 0);
});

test("both prepared controls remain hidden even if callers claim availability", () => {
  const ui = load("src/passkeys/prepared-ui.tsx", {
    "./feature": { canShowBiometricSignIn: () => false, canShowBiometricSignInSetting: () => false },
    "react-native": { Pressable: "Pressable", Text: "Text", View: "View" },
    "../auth-ui": { AuthAction: () => { throw Error("Must not render"); }, authStyles: {} },
    "../theme": { colors: {} },
  });
  const action = async () => { throw Error("No unfinished operation may run"); };
  assert.equal(ui.BiometricSignInAction({ available: true, onPress: action }), null);
  assert.equal(ui.BiometricSignInSetting({ available: true, serverConfirmed: true, onEnable: action, onRemove: action }), null);
});

test("actual screen boundaries mount no hooks, focus work, native probe or requests while gated", () => {
  const forbidden = () => { throw Error("Disabled UI must be idle"); };
  const controls = load("src/passkeys/screen-controls.tsx", {
    "./feature": { canShowBiometricSignIn: () => false, canShowBiometricSignInSetting: () => false },
    "../auth-native-prompt": { nativeAuthPrompt: { active: false } },
    react: { useCallback: forbidden, useRef: forbidden, useState: forbidden },
    "expo-router": { useFocusEffect: forbidden },
    "react-native": { Platform: { OS: "android", get Version() { return forbidden(); } } },
    "../auth-ui": {}, "../theme": {}, "./prepared-ui": {},
  });
  assert.equal(controls.SignInBiometricControl({ disabled: false, onError: forbidden }), null);
  assert.equal(controls.ProfileBiometricControl({ userId: "athlete-a" }), null);
  assert.match(read("app/(auth)/sign-in.tsx"), /<SignInBiometricControl disabled=\{busy \|\| !!configError\} onError=\{setError\}/);
  assert.match(read("app/(tabs)/profile.tsx"), /<ProfileBiometricControl userId=\{user\?\.id \?\? null\}/);
});

test("activated controls are Android-only, remain idle on render, and keep registration opt-in", () => {
  const forbidden = () => { throw Error("Rendering must not start authentication"); };
  const platform = { OS: "android", Version: 36 };
  const controls = load("src/passkeys/screen-controls.tsx", {
    "../auth-native-prompt": { nativeAuthPrompt: { active: false } },
    react: { useCallback: forbidden, useRef: forbidden, useState: forbidden },
    "expo-router": { useFocusEffect: forbidden },
    "react-native": { Platform: platform }, "../auth-ui": {}, "../theme": {}, "./prepared-ui": {},
  });
  assert.ok(controls.SignInBiometricControl({ disabled: false, onError: forbidden }));
  assert.ok(controls.ProfileBiometricControl({ userId: "athlete-a" }));
  assert.equal(controls.ProfileBiometricControl({ userId: null }), null);
  platform.OS = "ios";
  assert.equal(controls.SignInBiometricControl({ disabled: false, onError: forbidden }), null);
  assert.equal(controls.ProfileBiometricControl({ userId: "athlete-a" }), null);
  platform.OS = "android"; platform.Version = 27;
  assert.equal(controls.SignInBiometricControl({ disabled: false, onError: forbidden }), null);
});

test("activated labels are available with password fallback and registration only invokes its explicit action", async () => {
  let calls = 0;
  const ui = load("src/passkeys/prepared-ui.tsx", {
    "react-native": { Pressable: "Pressable", Text: "Text", View: "View" },
    "../auth-ui": { AuthAction: "AuthAction", authStyles: {} }, "../theme": { colors: {} },
  });
  const onPress = async () => { calls++; };
  const action = ui.BiometricSignInAction({ available: true, onPress });
  assert.equal(action.props.label, "Sign in with Biometrics");
  const setting = ui.BiometricSignInSetting({ available: true, onEnable: onPress, onRemove: onPress });
  const enable = setting.props.children.find(child => child.type === "Pressable");
  assert.equal(enable.props.accessibilityLabel, "Enable Biometric Sign-In");
  assert.equal(calls, 0);
  action.props.onPress(); assert.equal(calls, 1);
  enable.props.onPress(); assert.equal(calls, 2);
  assert.match(read("app/(auth)/sign-in.tsx"), /signIn\(/);
});

for (const stale of [false, true]) {
  test(`activated sign-in passes its verified candidate through the existing authority lease${stale ? " and rejects late acceptance" : ""}`, async () => {
    const calls = [], candidate = { user: { id: "athlete-a" }, access_token: "synthetic", refresh_token: "synthetic" };
    let current = true, acceptCandidate, began = 0;
    const attempt = { isCurrent: () => current, owns: () => false,
      async accept(session) { if (!current) throw Error("abandoned"); calls.push(["accept", session]); },
      async abandon() { calls.push(["abandon"]); } };
    const runtime = load("src/passkeys/runtime.ts", {
      "../supabase": { mobileAuthentication: { async beginPasskey() { began++; return attempt; } } },
      "./lifecycle": {}, "./provider": {}, "./credential-state": {}, "./credential-storage": {},
      "./native-adapter": { createNativePasskeyAdapter: () => ({}) },
      "./service": { createPreparedPasskeyService(input) {
        assert.equal(input.environment.relyingPartyId, "archery-website.vercel.app");
        assert.equal(input.isCurrent, attempt.isCurrent);
        assert.equal(input.ownsAdoptedSession, attempt.owns);
        acceptCandidate = input.adoptVerifiedSession;
        return { async authenticate() { await acceptCandidate(candidate); return { userId: candidate.user.id }; },
          dispose() { calls.push(["dispose"]); } };
      } },
    });
    assert.equal(began, 0);
    if (stale) current = false;
    if (stale) await assert.rejects(runtime.signInWithPasskey(), /abandoned/);
    else assert.deepEqual(await runtime.signInWithPasskey(), { userId: "athlete-a" });
    assert.equal(began, 1);
    assert.deepEqual(calls, stale ? [["dispose"], ["abandon"]] : [["accept", candidate], ["dispose"], ["abandon"]]);
  });
}

test("logout invalidates management synchronously before waiting for the existing SDK", async () => {
  const user = { id: "athlete-a" }, app = providerRuntime({ restoredUser: user });
  await app.settle(); await app.settle();
  const r = coordinatorRuntime(), pending = outcome(r.coordinator.register());
  const unsubscribe = observePasskeyInvalidation(() => r.coordinator.invalidate());
  try {
    const logout = deferred(); app.auth.signOut = () => logout.promise;
    const signingOut = app.render().signOut();
    assert.equal(r.current(), false, "Invalidation must precede SDK completion");
    r.gate.resolve(); assert.match((await pending).error.message, /abandoned/);
    logout.resolve({ error: null }); await signingOut;
    assert.equal(app.render().user, null);
    assert.equal(app.getUserCalls(), 1, "No extra identity requests");
  } finally { unsubscribe(); }
});

test("password sign-in/account switch invalidates management before the password request settles", async () => {
  const user = { id: "athlete-a" }, other = { id: "athlete-b" }, app = providerRuntime({ restoredUser: user });
  await app.settle(); await app.settle();
  const r = coordinatorRuntime(), pending = outcome(r.coordinator.register());
  const unsubscribe = observePasskeyInvalidation(() => r.coordinator.invalidate());
  try {
    const password = deferred(); app.auth.signInWithPassword = () => password.promise;
    const switching = app.render().signIn("synthetic@example.invalid", "synthetic-password");
    assert.equal(r.current(), false);
    r.gate.resolve(); assert.match((await pending).error.message, /abandoned/);
    password.resolve({ data: { user: other, session: { user: other } }, error: null }); await switching;
    assert.equal(app.render().user.id, other.id);
  } finally { unsubscribe(); }
});

test("normal auth events invalidate passkey work without adding an auth listener or session fetch", async () => {
  const user = { id: "athlete-a" }, app = providerRuntime({ restoredUser: user });
  await app.settle(); await app.settle();
  let invalidations = 0;
  const unsubscribe = observePasskeyInvalidation(() => { invalidations++; });
  try {
    app.emit("TOKEN_REFRESHED", { user });
    assert.equal(invalidations, 1); assert.equal(app.render().user, user);
    assert.equal(app.getUserCalls(), 1);
  } finally { unsubscribe(); }
  app.emit("SIGNED_OUT", null); assert.equal(invalidations, 1);
});

function managementRuntime() {
  let owner = null, allowed = true, reads = 0, operations = 0, invalidations = 0, disposals = 0;
  let sessionResult = { data: { session: { user: { id: "athlete-a" }, access_token: "synthetic-access", refresh_token: "synthetic-refresh" } }, error: null };
  let gate = null;
  const { createPasskeyManagement } = load("src/passkeys/runtime.ts", {
    "./native-adapter": {},
    "./service": {},
    "../supabase": { supabase: { auth: { async getSession() { reads++; if (gate) await gate.promise; return sessionResult; } } } },
    "./feature": { assertPasskeysAllowed() { if (!allowed) throw Error("Disabled"); } },
    "./lifecycle": { observePasskeyInvalidation },
    "./provider": { createApplicationPasskeyProvider(input) { owner = input.currentOwner;
      return { list: async () => { operations++; return []; }, register: async () => { operations++; return { id: "confirmed" }; },
        remove: async () => { operations++; }, invalidate() { invalidations++; }, dispose() { disposals++; } };
    } },
    "./credential-storage": { deviceCredentialStorage: {} },
    "./credential-state": { createDeviceCredentialState({ server }) {
      return { reconcile: server.list, register: server.register, remove: server.remove };
    } },
  });
  return { create: () => createPasskeyManagement("athlete-a"), get reads() { return reads; }, get operations() { return operations; },
    get owner() { return owner?.(); }, get invalidations() { return invalidations; }, get disposals() { return disposals; },
    disable() { allowed = false; }, block() { gate = deferred(); return gate; },
    wrongUser() { sessionResult = { data: { session: { user: { id: "athlete-b" } } }, error: null }; } };
}

test("management reads the existing owner session only on explicit work and never persists it", async () => {
  const r = managementRuntime(), manager = r.create();
  try {
    assert.equal(r.reads, 0); assert.equal(r.owner, null);
    await manager.list(); assert.equal(r.reads, 1); assert.equal(r.operations, 1);
    assert.deepEqual(r.owner, { userId: "athlete-a", accessToken: "synthetic-access", refreshToken: "synthetic-refresh" });
    invalidatePasskeyOperations(); assert.equal(r.owner, null); assert.equal(r.invalidations, 1);
  } finally { manager.dispose(); }
  assert.equal(r.disposals, 1);
});

test("logout during owner session acquisition prevents a management request", async () => {
  const r = managementRuntime(), manager = r.create(), gate = r.block();
  try {
    const pending = outcome(manager.register());
    invalidatePasskeyOperations(); gate.resolve();
    assert.match((await pending).error.message, /abandoned/);
    assert.equal(r.operations, 0); assert.equal(r.owner, null);
  } finally { manager.dispose(); }
});

test("wrong account cannot become the borrowed credential-management owner", async () => {
  const r = managementRuntime(), manager = r.create();
  try { r.wrongUser(); await assert.rejects(manager.list(), /Sign in before/); assert.equal(r.operations, 0); }
  finally { manager.dispose(); }
});

test("disabled or disposed management does no further session read and unregisters cancellation", async () => {
  const r = managementRuntime(); r.disable(); assert.throws(r.create, /Disabled/); assert.equal(r.reads, 0);
  const s = managementRuntime(), manager = s.create(); manager.dispose();
  const invalidations = s.invalidations;
  invalidatePasskeyOperations(); assert.equal(s.invalidations, invalidations);
  await assert.rejects(manager.list(), /unavailable/); assert.equal(s.reads, 0);
});

test("release identity, R8, orientation and Material settings retain the existing configuration", () => {
  const config = JSON.parse(read("app.json")).expo, eas = JSON.parse(read("eas.json"));
  assert.equal(config.android.package, "com.arctrack.archery"); assert.equal(config.scheme, "arctrack");
  assert.equal(config.ios.bundleIdentifier, "com.whqq.arctrack");
  assert.equal(eas.build["passkey-development"], undefined);
  assert.deepEqual(eas.build.production, { environment: "production", autoIncrement: true });
  const plugins = config.plugins.map(item => Array.isArray(item) ? item[0] : item);
  for (const plugin of ["./plugins/with-optimized-android-release.cjs", "./plugins/with-android-adaptive-orientation.cjs", "./plugins/with-android-material-components.cjs"])
    assert.ok(plugins.includes(plugin));
  assert.equal(JSON.parse(read("package.json")).dependencies["react-native-passkey"], "3.6.2");
  assert.doesNotMatch(read("src/supabase.ts"), /passkey|experimental/);
  assert.doesNotMatch(read("src/secure-auth-storage.ts"), /passkey|requireAuthentication/);
});
