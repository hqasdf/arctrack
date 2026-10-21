import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { organizationEntry } from "@arc-track/core/organization-entry";
import { organizationAppearance } from "../src/organization-appearance.ts";

const source = readFileSync(new URL("../app/(tabs)/organization/index.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
} }).outputText;
const archer = { id: "club-a", name: "A long organisation name that remains fully visible", role: "archer", joinCode: null };
const coach = { ...archer, id: "club-b", role: "head_coach" };
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];
const text = node => typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join(" ") : node?.props ? text(node.props.children) : "";

function runtime({ memberships = [], scheme = "light", manageMode = false, readError, joinError, joinResult = "joined", createError, joinWait } = {}) {
  const slots = [], reads = [], joins = [], creates = [], navigation = [];
  let cursor = 0, focus, currentMemberships = memberships, failure = readError, currentScheme = scheme;
  const mocks = {
    react: { useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; }, useCallback: fn => fn },
    "react/jsx-runtime": jsx,
    "expo-router": { useFocusEffect(fn) { focus = fn; }, router: {
      push(value) { navigation.push({ kind: "push", value }); }, replace(value) { navigation.push({ kind: "replace", value }); },
    } },
    "@arc-track/core/organization-entry": { organizationEntry },
    "react-native": { ...Object.fromEntries(["ActivityIndicator", "KeyboardAvoidingView", "Pressable", "ScrollView", "Text", "TextInput", "View"].map(name => [name, name])),
      StyleSheet: { create: styles => styles }, Platform: { OS: "ios" }, useColorScheme: () => currentScheme },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 20, bottom: 34 }) },
    "../../../src/auth": { useAuth: () => ({ user: { id: "current-athlete" } }) },
    "../../../src/theme": { PAGE_TOP_SPACING: 40 },
    "../../../src/appearance": { useAppearance: () => ({ resolvedTheme: currentScheme }) },
    "../../../src/organization-appearance": { organizationAppearance },
    "../../../src/organizations": {
      async readOwnOrganizations(id) { reads.push(id); if (failure) throw Error(failure); return currentMemberships; },
      async joinOrganization(code) { joins.push(code); if (joinWait) await joinWait; if (joinError) throw Error(joinError); if (joinResult === "joined") currentMemberships = [...memberships, archer]; return joinResult; },
      async createOrganization(id, name) { creates.push({ id, name }); if (createError) throw Error(createError); return coach; },
    },
  };
  const exports = {};
  new Function("require", "exports", compiled)(name => { assert.ok(name in mocks, name); return mocks[name]; }, exports);
  function render() { cursor = 0; return exports.default({ manageMode }); }
  return { render, reads, joins, creates, navigation,
    setScheme(value) { currentScheme = value; },
    focus() { focus(); }, retryReads() { failure = null; },
    async settle() { await new Promise(setImmediate); return render(); },
    input(tree, label, value) { nodes(tree).find(node => node.type === "TextInput" && node.props.accessibilityLabel === label).props.onChangeText(value); },
    press(tree, label) { const node = nodes(tree).find(node => node.type === "Pressable" && text(node) === label); assert.ok(node, label); node.props.onPress(); },
  };
}

async function ready(options) { const app = runtime(options); app.render(); app.focus(); return { app, tree: await app.settle() }; }

test("empty workspace contains the website's three grouped cards, visible labels and real controlled inputs", async () => {
  const { app, tree } = await ready();
  for (const label of ["Your organisations", "You have not joined an organisation yet.", "Join an organisation", "Create an organisation", "You become its first Head Coach."]) assert.ok(text(tree).includes(label), label);
  const panels = nodes(tree).filter(node => node.type === "View" && node.props.style?.borderRadius === 16);
  assert.equal(panels.length, 3);
  app.input(tree, "Join code", "ABCDEFGH"); app.input(tree, "Organisation name", "Actual club");
  const inputs = nodes(app.render()).filter(node => node.type === "TextInput");
  assert.deepEqual(inputs.map(node => node.props.value), ["ABCDEFGH", "Actual club"]);
  assert.ok(inputs.every(node => node.props.placeholderTextColor && node.props.accessibilityLabelledBy));
});

test("successful join uses the current controlled code, refreshes the current account, and opens the real membership", async () => {
  const { app, tree } = await ready(); app.input(tree, "Join code", "ABCDEFGH"); app.press(app.render(), "Join");
  await app.settle();
  assert.deepEqual(app.joins, ["ABCDEFGH"]); assert.ok(app.reads.every(id => id === "current-athlete"));
  assert.deepEqual(app.navigation.at(-1).value, { pathname: "/organization/member/[organizationId]", params: { organizationId: archer.id } });
});

test("invalid join keeps the entered code and exposes the actual safe validation error", async () => {
  const { app, tree } = await ready({ joinError: "Enter a valid 8-character join code." });
  app.input(tree, "Join code", "bad"); app.press(app.render(), "Join"); const next = await app.settle();
  assert.ok(text(next).includes("Enter a valid 8-character join code."));
  assert.equal(nodes(next).find(node => node.type === "TextInput" && node.props.accessibilityLabel === "Join code").props.value, "bad");
  assert.equal(app.navigation.length, 0);
});

test("duplicate join displays existing-membership feedback without inventing a new membership", async () => {
  const { app, tree } = await ready({ memberships: [archer], manageMode: true, joinResult: "already_member" });
  app.press(tree, "Join another organisation"); app.input(app.render(), "Join code", "ABCDEFGH"); app.press(app.render(), "Join");
  assert.ok(text(await app.settle()).includes("You are already a member.")); assert.equal(app.navigation.length, 0);
});

test("creation forwards current account and name, then navigates to the server-returned organisation", async () => {
  const { app, tree } = await ready(); app.input(tree, "Organisation name", "Actual club"); app.press(app.render(), "Create organisation"); await app.settle();
  assert.deepEqual(app.creates, [{ id: "current-athlete", name: "Actual club" }]);
  assert.deepEqual(app.navigation.at(-1).value, { pathname: "/organization/[organizationId]", params: { organizationId: coach.id } });
});

test("creation failures leave the user's input intact and do not navigate", async () => {
  const { app, tree } = await ready({ createError: "The organisation could not be created." });
  app.input(tree, "Organisation name", "Actual club"); app.press(app.render(), "Create organisation");
  const next = await app.settle(); assert.ok(text(next).includes("The organisation could not be created."));
  assert.equal(nodes(next).find(node => node.type === "TextInput" && node.props.accessibilityLabel === "Organisation name").props.value, "Actual club");
  assert.equal(app.navigation.length, 0);
});

test("actual role controls navigation, and manage mode retains both membership types", async () => {
  for (const membership of [archer, coach]) {
    const { app } = await ready({ memberships: [membership] });
    assert.equal(app.navigation[0].value.pathname, membership.role === "archer" ? "/organization/member/[organizationId]" : "/organization/[organizationId]");
  }
  const { app, tree } = await ready({ memberships: [archer, coach], manageMode: true });
  assert.equal(app.navigation.length, 0); assert.ok(text(tree).includes(archer.name));
  app.press(tree, "Settings"); assert.equal(app.navigation[0].value.params.organizationId, coach.id);
  app.press(tree, "Open membership"); assert.equal(app.navigation[1].value.params.organizationId, archer.id);
});

test("loading errors resolve to retry and a successful retry renders the workspace", async () => {
  const app = runtime({ readError: "offline" }); assert.equal(app.render().props.children.type, "ActivityIndicator");
  app.focus(); const tree = await app.settle(); assert.ok(text(tree).includes("Organisations could not be loaded."));
  app.retryReads(); app.press(tree, "Retry"); assert.ok(text(await app.settle()).includes("Your organisations"));
});

test("light/dark presentation retains input state, flexible cards, touch targets and keyboard-safe scrolling", async () => {
  for (const scheme of ["light", "dark"]) {
    const { tree } = await ready({ scheme }); const palette = organizationAppearance(scheme);
    assert.equal(tree.type, "KeyboardAvoidingView"); assert.equal(tree.props.behavior, "padding");
    const scroll = nodes(tree).find(node => node.type === "ScrollView"); assert.equal(scroll.props.keyboardShouldPersistTaps, "handled");
    assert.ok(scroll.props.contentContainerStyle[1].paddingBottom >= 34);
    for (const node of nodes(tree).filter(node => node.type === "Pressable")) assert.ok(node.props.style({ pressed: false })[0].minHeight >= 44);
    for (const node of nodes(tree).filter(node => node.type === "TextInput")) { assert.equal(node.props.style.color, palette.text); assert.equal(node.props.style.minWidth, 0); }
  }
  const { app, tree } = await ready(); app.input(tree, "Organisation name", "Unsubmitted club"); app.setScheme("dark");
  assert.equal(nodes(app.render()).find(node => node.type === "TextInput" && node.props.accessibilityLabel === "Organisation name").props.value, "Unsubmitted club");
});

test("an in-flight join disables actions and inputs and shows accessible busy state", async () => {
  let resolve; const joinWait = new Promise(done => { resolve = done; });
  const { app, tree } = await ready({ joinWait }); app.input(tree, "Join code", "ABCDEFGH"); app.press(app.render(), "Join");
  const next = app.render();
  assert.ok(nodes(next).filter(node => node.type === "TextInput").every(node => node.props.editable === false));
  assert.ok(nodes(next).filter(node => node.type === "Pressable").every(node => node.props.disabled && node.props.accessibilityState.busy));
  assert.deepEqual(app.joins, ["ABCDEFGH"]); resolve(); await app.settle();
});

test("organisation appearances preserve readable contrast in both website palettes", () => {
  function luminance(hex) { return hex.match(/[\da-f]{2}/gi).map(part => parseInt(part, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0); }
  for (const scheme of ["light", "dark"]) for (const coach of [false, true]) {
    const p = organizationAppearance(scheme, coach);
    for (const [fg, bg] of [[p.text, p.surface], [p.muted, p.control], [p.onPrimary, p.primary]]) {
      const a = luminance(fg), b = luminance(bg); assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${scheme} ${coach}: ${fg}/${bg}`);
    }
  }
});
