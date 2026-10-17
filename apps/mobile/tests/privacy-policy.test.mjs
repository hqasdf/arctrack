import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";

async function privacyLink(openURL) {
  let error = null;
  const modules = {
    react: { useState: () => [error, value => { error = value; }] },
    "react/jsx-runtime": jsx,
    "react-native": { Pressable: "Pressable", Text: "Text", View: "View", StyleSheet: { create: value => value }, Linking: { openURL } },
    "./theme": { colors: {} },
  };
  const source = await readFile(new URL("../src/privacy-policy-link.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const componentExports = {};
  new Function("require", "exports", compiled)(name => { assert.ok(name in modules, name); return modules[name]; }, componentExports);
  return { render: () => componentExports.PrivacyPolicyLink(), url: componentExports.PRIVACY_POLICY_URL };
}

test("Expo Privacy Policy opens the public HTTPS URL without credentials or an app route", async () => {
  const calls = [], component = await privacyLink(async url => { calls.push(url); });
  const link = component.render().props.children[0];
  assert.equal(link.props.accessibilityRole, "link");
  assert.equal(link.props.accessibilityLabel, "Privacy Policy");
  assert.equal(link.props.style.minHeight, 44);
  link.props.onPress(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ["https://archery-website.vercel.app/privacy"]);
  assert.equal(component.render().props.children[1], null);
});

test("external-link failure displays a safe local retry message", async () => {
  const component = await privacyLink(async () => { throw new Error("private provider detail"); });
  component.render().props.children[0].props.onPress();
  await new Promise(resolve => setImmediate(resolve));
  const alert = component.render().props.children[1];
  assert.equal(alert.props.accessibilityRole, "alert");
  assert.equal(alert.props.children, "The Privacy Policy could not be opened. Please try again.");
});

test("Privacy Policy is available before account entry and from the existing Profile screen", async () => {
  for (const route of ["(auth)/sign-in.tsx", "(auth)/sign-up.tsx", "(tabs)/profile.tsx"]) {
    const source = await readFile(new URL(`../app/${route}`, import.meta.url), "utf8");
    assert.match(source, /import { PrivacyPolicyLink } from "\.\.\/\.\.\/src\/privacy-policy-link"/);
    assert.match(source, /<PrivacyPolicyLink \/>/);
  }
});
