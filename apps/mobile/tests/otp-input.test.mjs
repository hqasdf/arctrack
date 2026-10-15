import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

function input(platform, props) {
  const source = readFileSync(new URL("../src/otp-input.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(name => name === "react-native" ? { Platform: { OS: platform }, TextInput: "input" } : jsx, exports);
  return exports.OtpInput(props).props;
}
for (const platform of ["ios", "android"]) {
  test(`${platform}: one editable OTP input accepts typing, paste/autofill, leading zeros and deletion without submitting`, () => {
    const changes = [];
    const field = input(platform, { value: "", accessibilityLabel: "Verification code", onChangeText: value => changes.push(value) });
    assert.equal(field.keyboardType, "number-pad"); assert.equal(field.maxLength, 6);
    assert.equal(field.autoCapitalize, "none"); assert.equal(field.autoCorrect, false);
    if (platform === "ios") { assert.equal(field.textContentType, "oneTimeCode"); assert.equal(field.autoComplete, undefined); }
    else { assert.equal(field.autoComplete, "one-time-code"); assert.equal(field.textContentType, undefined); assert.equal(field.importantForAutofill, "yes"); }
    for (const value of ["1", "12", "", "012345", "01234", "654321"]) field.onChangeText(value);
    assert.deepEqual(changes, ["1", "12", "", "012345", "01234", "654321"]);
    assert.equal(field.onSubmitEditing, undefined);
  });
}
test("signup and recovery retain their existing validation, busy guards, resend and Supabase OTP types", () => {
  for (const [path, type] of [["../app/(auth)/sign-up.tsx", "email"], ["../app/recover.tsx", "recovery"]]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /<OtpInput/); assert.match(source, /if \(!supabase \|\| busy\) return/);
    assert.ok(source.includes('/^\\d{6}$/.test(code.trim())'));
    assert.ok(source.includes(`type: "${type}"`)); assert.match(source, /setCooldown\(60\)/);
  }
});
test("web email and recovery verification already expose the single-field one-time-code hints", () => {
  const source = readFileSync(new URL("../../../src/features/auth/components/verification-form.tsx", import.meta.url), "utf8");
  assert.match(source, /inputMode="numeric" autoComplete="one-time-code"/);
  assert.match(source, /pattern="\[0-9\]\{6\}" maxLength=\{6\} minLength=\{6\}/);
  assert.match(source, /fieldset disabled=\{pending \|\| !configured\}/);
});
