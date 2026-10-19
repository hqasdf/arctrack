import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

// Render the actual screen with persistent hook slots and native layout inputs.
// This verifies resize does not replace its input/submit state; it is not native layout QA.
function screenRuntime(platform = "android") {
  let height = 844;
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
      Platform: { OS: platform }, StyleSheet: { create: value => value }, useWindowDimensions: () => ({ height }),
    },
    "react-native-safe-area-context": { useSafeAreaInsets: () => insets },
    "expo-router": { router: { push() {} } },
    "../../src/auth": { useAuth: () => ({ configError: null, signIn: async (...args) => { calls.push(args); } }) },
    "../../src/auth-flow": { safeAuthMessage: () => "Unable to sign in" },
    "../../src/theme": { colors: {}, PAGE_TOP_SPACING: 40 },
    "../../src/password-field": { PasswordField: "PasswordField" },
    "../../src/privacy-policy-link": { PrivacyPolicyLink: "PrivacyPolicyLink" },
  };
  const exports = {};
  new Function("require", "exports", compiled)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);
  return {
    calls,
    resize(nextHeight, nextInsets = insets) { height = nextHeight; insets = nextInsets; },
    render() { cursor = 0; return exports.default(); },
  };
}

function nodes(node) {
  if (!node || typeof node !== "object") return [];
  const children = [node.props?.children].flat(Infinity);
  return [node, ...children.flatMap(nodes)];
}
const find = (tree, type) => nodes(tree).find(node => node.type === type);

test("sign-in remains centered on phones and scrollable/inset-aware in short or landscape windows", () => {
  const screen = screenRuntime();
  let tree = screen.render();
  const scroll = find(tree, "ScrollView");
  assert.equal(scroll.props.keyboardShouldPersistTaps, "handled");
  assert.equal(scroll.props.keyboardDismissMode, "on-drag");
  assert.equal(scroll.props.contentContainerStyle[0].flexGrow, 1);
  assert.equal(scroll.props.contentContainerStyle[0].justifyContent, "center");
  assert.equal(scroll.props.contentContainerStyle[1].paddingTop, 64);
  assert.equal(find(tree, "View").props.style.maxWidth, 440);
  for (const height of [320, 360, 390, 430]) {
    screen.resize(height, { top: 0, right: 44, bottom: 24, left: 44 });
    tree = screen.render();
    const padding = find(tree, "ScrollView").props.contentContainerStyle[1];
    assert.equal(padding.paddingTop, 24);
    assert.equal(padding.paddingBottom, 36);
    assert.equal(padding.paddingLeft, 60);
    assert.equal(padding.paddingRight, 60);
    assert.equal(find(tree, "KeyboardAvoidingView").props.behavior, undefined);
  }
  assert.equal(find(screenRuntime("ios").render(), "KeyboardAvoidingView").props.behavior, "padding");
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
