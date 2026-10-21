import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

// Render the actual screen with persistent hook slots and native layout inputs.
// This verifies resize does not replace its input/submit state; it is not native layout QA.
function screenRuntime(platform = "android") {
  let height = 844;
  let width = 390;
  let insets = { top: 24, right: 0, bottom: 0, left: 0 };
  let cursor = 0;
  const slots = [];
  const calls = [];
  const source = readFileSync(new URL("../app/(auth)/sign-in.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const dependencies = {
    "react/jsx-runtime": jsx,
    react: { useState(initial) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = initial;
      return [slots[slot], value => { slots[slot] = value; }];
    } },
    "react-native": {
      ActivityIndicator: "ActivityIndicator", KeyboardAvoidingView: "KeyboardAvoidingView", Pressable: "Pressable",
      ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View",
      Platform: { OS: platform }, StyleSheet: { create: value => value }, useWindowDimensions: () => ({ height, width }),
    },
    "react-native-safe-area-context": { useSafeAreaInsets: () => insets },
    "expo-router": { router: { push() {} } },
    "../../src/auth": { useAuth: () => ({ configError: null, signIn: async (...args) => { calls.push(args); } }) },
    "../../src/auth-flow": { safeAuthMessage: () => "Unable to sign in" },
    "../../src/theme": { colors: {}, PAGE_TOP_SPACING: 40 },
    "./theme": { colors: {} },
    "./appearance": { useAppearance: () => ({ colors: {} }), createThemedStyles: factory => () => factory({}) },
    "../../src/appearance": { useAppearance: () => ({ colors: {} }) },
    "../../src/password-field": { PasswordField: "PasswordField" },
    "../../src/privacy-policy-link": { PrivacyPolicyLink: "PrivacyPolicyLink" },
    "../../src/passkeys/screen-controls": { SignInBiometricControl: () => null },
  };
  const shared = {};
  const sharedCode = ts.transpileModule(readFileSync(new URL("../src/auth-ui.tsx", import.meta.url), "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function("require", "exports", sharedCode)(name => {
    assert.ok(name in dependencies, `Unexpected shared auth dependency ${name}`);
    return dependencies[name];
  }, shared);
  dependencies["../../src/auth-ui"] = shared;
  const exports = {};
  new Function("require", "exports", compiled)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);
  return {
    calls,
    resize(nextHeight, nextInsets = insets, nextWidth = width) { height = nextHeight; insets = nextInsets; width = nextWidth; },
    render() { cursor = 0; return expand(exports.default()); },
  };
}

function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object") return node;
  if (typeof node.type === "function") return expand(node.type(node.props));
  return { ...node, props: { ...node.props, children: expand(node.props?.children) } };
}

function nodes(node) {
  if (!node || typeof node !== "object") return [];
  const children = [node.props?.children].flat(Infinity);
  return [node, ...children.flatMap(nodes)];
}
const find = (tree, type) => nodes(tree).find(node => node.type === type);

test("sign-in uses the shared top-aligned scrollable/inset-aware shell in short or landscape windows", () => {
  const screen = screenRuntime();
  let tree = screen.render();
  const scroll = find(tree, "ScrollView");
  assert.equal(scroll.props.keyboardShouldPersistTaps, "handled");
  assert.equal(scroll.props.keyboardDismissMode, "on-drag");
  const style = value => Object.assign({}, ...[value].flat(Infinity).filter(Boolean));
  assert.equal(style(scroll.props.contentContainerStyle).flexGrow, 1);
  assert.notEqual(style(scroll.props.contentContainerStyle).justifyContent, "center");
  assert.equal(style(scroll.props.contentContainerStyle).paddingTop, 48);
  assert.ok(nodes(tree).some(node => style(node.props?.style).maxWidth === 480));
  for (const height of [320, 360, 390, 430]) {
    screen.resize(height, { top: 0, right: 44, bottom: 24, left: 44 });
    tree = screen.render();
    const padding = style(find(tree, "ScrollView").props.contentContainerStyle);
    assert.equal(padding.paddingTop, 16);
    assert.equal(padding.paddingBottom, 40);
    assert.equal(padding.paddingLeft, 56);
    assert.equal(padding.paddingRight, 56);
    assert.equal(find(tree, "KeyboardAvoidingView"), undefined);
  }
  assert.equal(find(screenRuntime("ios").render(), "ScrollView").props.automaticallyAdjustKeyboardInsets, true);
});

test("resizing preserves entered credentials and the existing sign-in validation/submission", async () => {
  const screen = screenRuntime();
  let tree = screen.render();
  find(tree, "TextInput").props.onChangeText(" athlete@example.com ");
  find(tree, "PasswordField").props.onChangeText("entered-password");
  screen.resize(360);
  tree = screen.render();
  assert.equal(find(tree, "TextInput").props.value, " athlete@example.com ");
  assert.equal(find(tree, "PasswordField").props.value, "entered-password");
  await find(tree, "Pressable").props.onPress();
  assert.deepEqual(screen.calls, [["athlete@example.com", "entered-password"]]);
  screen.resize(844);
  tree = screen.render();
  assert.equal(find(tree, "TextInput").props.value, " athlete@example.com ");
  assert.equal(find(tree, "PasswordField").props.value, "entered-password");
  find(tree, "PasswordField").props.onChangeText("");
  tree = screen.render();
  assert.equal(find(tree, "Pressable").props.disabled, true);
  await find(tree, "Pressable").props.onPress();
  assert.equal(screen.calls.length, 1);
});
