import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

// Exercise the real gated Profile UI with synthetic service results only.
// Synthetic service results; no native prompts or live authentication requests.
function runtime({ restoredId = null } = {}) {
  const slots = [], effects = [], alerts = [], removals = [], registrations = [];
  let cursor = 0, focus, cleanup, generation = 0, controller, onAppState;
  const prompt = { active: false };
  let signInResult = Promise.resolve(), signIns = 0;
  const registered = { id: "new", friendly_name: "This registration" };
  let registerResult = Promise.resolve({ credentials: [registered], registeredHere: registered.id });
  let removeResult = Promise.resolve({ credentials: [], registeredHere: null });
  const first = { id: "other-device", friendly_name: "Other device" };
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback: callback => callback,
  };
  const mocks = {
    react: hooks, "react/jsx-runtime": jsx,
    "expo-router": { useFocusEffect(callback) { focus = callback; } },
    "react-native": { Pressable: "Pressable", Text: "Text", View: "View", Platform: { OS: "android", Version: 36 },
      Alert: { alert: (...args) => alerts.push(args) }, AppState: { addEventListener: (_event, listener) => { onAppState = listener; return { remove() {} }; } } },
    "../auth-ui": { authStyles: {} }, "../theme": { colors: {} },
    "../auth-native-prompt": { nativeAuthPrompt: prompt },
    "./feature": { canShowBiometricSignIn: () => true, canShowBiometricSignInSetting: () => true },
    "./prepared-ui": { BiometricSignInSetting: "Setting", BiometricSignInAction: "Action" },
    "./runtime": { signInWithPasskey() { signIns++; return signInResult; }, createPasskeyManagement() {
      const id = ++generation;
      controller = { id, disposed: false, readState: async () => ({ credentials: restoredId ? [first, registered] : [first], registeredHere: restoredId }),
        register: async () => { registrations.push(id); return registerResult; },
        remove: async credential => { removals.push(credential); return removeResult; }, invalidations: 0,
        invalidate() { this.invalidations++; }, dispose() { this.disposed = true; } };
      return controller;
    } },
  };
  const exports = {}, code = ts.transpileModule(readFileSync(new URL("../src/passkeys/screen-controls.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "exports", code)(name => { assert.ok(name in mocks, name); return mocks[name]; }, exports);
  const props = { userId: "athlete-a" };
  function render() {
    cursor = 0;
    const outer = exports.ProfileBiometricControl(props);
    const tree = outer.type(outer.props); effects.splice(0).forEach(effect => effect()); return tree;
  }
  return { render, alerts, removals, registrations, get controller() { return controller; },
    renderSignIn(disabled = false) { cursor = 0; const outer = exports.SignInBiometricControl({ disabled, onError() {} }); return outer.type(outer.props); },
    signInWith(promise) { signInResult = promise; }, get signIns() { return signIns; },
    background(nativePrompt) { prompt.active = nativePrompt; onAppState("background"); },
    focus() { cleanup = focus(); }, blur() { cleanup?.(); },
    registerWith(promise) { registerResult = promise; },
    removeWith(promise) { removeResult = promise; },
    async settle() { await new Promise(setImmediate); return render(); } };
}
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : [];
const text = node => typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join(" ") : node ? text(node.props?.children) : "";
const setting = tree => nodes(tree).find(node => node.type === "Setting");
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test("repeated biometric sign-in taps issue one attempt and expose busy until completion", async () => {
  const app = runtime(), gate = deferred(); app.signInWith(gate.promise);
  const action = app.renderSignIn();
  const first = action.props.onPress(); await action.props.onPress();
  await new Promise(setImmediate);
  assert.equal(app.signIns, 1); assert.equal(app.renderSignIn().props.busy, true);
  gate.resolve(); await first;
  assert.equal(app.renderSignIn().props.busy, false);
  await app.renderSignIn().props.onPress(); assert.equal(app.signIns, 2);
});

test("disabled biometric action performs no work and keeps password fallback independent", async () => {
  const app = runtime(); await app.renderSignIn(true).props.onPress();
  assert.equal(app.signIns, 0);
});

test("Profile permits native credential UI transitions but invalidates ordinary background work", async () => {
  const app = runtime(); app.render(); app.focus(); await app.settle();
  app.background(true); assert.equal(app.controller.invalidations, 0);
  app.background(false); assert.equal(app.controller.invalidations, 1); app.blur();
});

test("an account's other credentials do not mark this device Enabled or trigger removal", async () => {
  const app = runtime(); app.render(); app.focus();
  const tree = await app.settle();
  assert.equal(setting(tree).props.serverConfirmed, false);
  assert.doesNotMatch(text(tree), /Enabled/); assert.deepEqual(app.removals, []);
  app.blur();
});

test("Enabled appears only after registration returns confirmed server metadata", async () => {
  const app = runtime(), gate = deferred(); app.registerWith(gate.promise);
  app.render(); app.focus(); let tree = await app.settle();
  const pending = setting(tree).props.onEnable(); tree = app.render();
  assert.equal(setting(tree).props.busy, true); assert.equal(setting(tree).props.serverConfirmed, false);
  gate.resolve({ credentials: [{ id: "new", friendly_name: "This registration" }], registeredHere: "new" }); await pending;
  tree = app.render(); assert.equal(setting(tree).props.serverConfirmed, true); assert.match(text(tree), /Enabled/);
  app.blur();
});

test("credential removal requires confirmation and targets only the selected ID", async () => {
  const app = runtime(); app.render(); app.focus(); const tree = await app.settle();
  nodes(tree).find(node => node.type === "Pressable").props.onPress();
  assert.deepEqual(app.removals, []);
  const buttons = app.alerts[0][2]; assert.equal(buttons[0].text, "Cancel");
  assert.match(app.alerts[0][1], /another device/);
  buttons[1].onPress(); await app.settle();
  assert.deepEqual(app.removals, ["other-device"]);
  app.blur();
});

test("a completed registration from a previous focus cannot mark the refocused UI Enabled", async () => {
  const app = runtime(), gate = deferred(); app.registerWith(gate.promise);
  app.render(); app.focus(); const tree = await app.settle();
  const pending = setting(tree).props.onEnable(), old = app.controller;
  app.blur(); assert.equal(old.disposed, true);
  app.render(); app.focus(); await app.settle();
  gate.resolve({ credentials: [{ id: "abandoned" }], registeredHere: "abandoned" }); await pending;
  assert.equal(setting(app.render()).props.serverConfirmed, false);
  app.blur();
});

test("a restarted Profile shows Enabled only when reconciliation confirms its remembered registration", async () => {
  const app = runtime({ restoredId: "new" }); app.render(); app.focus();
  const tree = await app.settle();
  assert.equal(setting(tree).props.serverConfirmed, true); assert.match(text(tree), /Enabled/);
  assert.match(text(tree), /may sync this credential/);
  assert.deepEqual(app.registrations, []); assert.deepEqual(app.removals, []);
  app.blur();
});

test("partial removal/cleanup failure cannot leave a stale Enabled indicator", async () => {
  const app = runtime({ restoredId: "new" }), gate = deferred();
  app.removeWith(gate.promise); app.render(); app.focus(); let tree = await app.settle();
  assert.equal(setting(tree).props.serverConfirmed, true);
  await setting(tree).props.onRemove(); app.alerts[0][2][1].onPress();
  tree = app.render(); assert.equal(setting(tree).props.serverConfirmed, false);
  gate.resolve(Promise.reject(Error("Synthetic local metadata cleanup failure")));
  tree = await app.settle();
  assert.equal(setting(tree).props.serverConfirmed, false); assert.doesNotMatch(text(tree), /Enabled/);
  assert.match(text(tree), /could not complete/); assert.deepEqual(app.removals, ["new"]);
  app.blur();
});
