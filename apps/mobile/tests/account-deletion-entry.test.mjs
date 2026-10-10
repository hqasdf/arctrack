import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

function profile(openURL) {
  const errors = [];
  const modules = {
    "expo-router": { useFocusEffect() {} },
    react: { useCallback: fn => fn, useState: initial => [initial, value => errors.push(value)] },
    "react/jsx-runtime": jsx,
    "react-native": { Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View", StyleSheet: { create: value => value }, Linking: { openURL } },
    "../../src/auth": { useAuth: () => ({ user: { id: "owner", email: "owner@example.invalid" }, signOut() {} }) },
    "../../src/auth-flow": { safeAuthMessage: () => "safe error" },
    "../../src/profile": { EMPTY_PROFILE: {}, DIVISIONS: [], EXPERIENCE_LEVELS: [], SHOOTING_HANDS: [] },
    "../../src/password-field": { PasswordField: "PasswordField" },
    "../../src/theme": { colors: {}, PAGE_TOP_SPACING: 0 },
  };
  const source = readFileSync(new URL("../app/(tabs)/profile.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(name => { assert.ok(name in modules, name); return modules[name]; }, exports);
  function find(node) {
    if (!node || typeof node !== "object") return null;
    if (node.type === "Pressable" && node.props.children?.props.children === "Delete Account") return node;
    for (const child of [node.props?.children].flat(Infinity)) { const result = find(child); if (result) return result; }
    return null;
  }
  return { button: find(exports.default()), errors };
}

test("Expo Delete Account opens only the shared canonical web resource without user IDs or credentials", async () => {
  const calls = [], screen = profile(async url => { calls.push(url); });
  assert.equal(screen.button.props.accessibilityRole, "link");
  screen.button.props.onPress(); await Promise.resolve();
  assert.deepEqual(calls, ["https://archery-website.vercel.app/delete-account"]);
  assert.deepEqual(screen.errors, []);
});

test("browser-open failure shows a safe retry error without changing Auth or counter state", async () => {
  const screen = profile(async () => { throw new Error("private native detail"); });
  screen.button.props.onPress(); await Promise.resolve();
  assert.deepEqual(screen.errors, ["The account deletion page could not be opened. Please try again."]);
});
