import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

// Execute the real TSX and hooks with mocked native primitives and Auth transport.
// These checks cover component contracts/state, not native text drawing or keyboard geometry.
const mobile = fileURLToPath(new URL("..", import.meta.url));
function runtime({ platform = "android", recovery = null, pendingSignup = null } = {}) {
  let palette = null;
  let dimensions = { width: 390, height: 844 };
  let insets = { top: 24, right: 0, bottom: 34, left: 0 };
  let owner = "", cursor = 0;
  const hooks = new Map(), modules = new Map(), calls = [], effects = [];
  const hooksFor = () => { if (!hooks.has(owner)) hooks.set(owner, []); return hooks.get(owner); };
  const react = {
    useState(initial) {
      const slots = hooksFor(), i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
    },
    useEffect(effect, deps) {
      const slots = hooksFor(), i = cursor++;
      if (!slots[i] || !deps?.every((value, index) => Object.is(value, slots[i].deps[index]))) {
        slots[i]?.cleanup?.();
        const state = slots[i] = { deps };
        effects.push(() => { state.cleanup = effect(); });
      }
    },
  };
  const auth = {
    configError: null, recovery, recoveryRequired: recovery?.stage === "password",
    signIn: async (...args) => { calls.push(["signIn", ...args]); },
    signOut: async () => { calls.push(["signOut"]); },
    setRecovery: async next => { auth.recovery = next; auth.recoveryRequired = next?.stage === "password"; },
  };
  const request = name => async (...args) => { calls.push([name, ...args]); return { data: {}, error: null }; };
  const mocks = {
    react, "react/jsx-runtime": jsx,
    "react-native": {
      ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", ScrollView: "ScrollView",
      Text: "Text", TextInput: "TextInput", View: "View", Platform: { OS: platform },
      StyleSheet: { create: value => value, hairlineWidth: 1 }, useWindowDimensions: () => dimensions,
    },
    "react-native-safe-area-context": { useSafeAreaInsets: () => insets },
    "react-native-svg": { __esModule: true, default: "Svg", Path: "Path" },
    "expo-router": { router: { push: route => calls.push(["push", route]), replace: route => calls.push(["replace", route]) } },
    "@react-native-async-storage/async-storage": { __esModule: true, default: {
      getItem: async () => pendingSignup,
      setItem: async () => {}, removeItem: async () => {},
    } },
  };
  function load(relative) {
    const filename = path.resolve(mobile, relative);
    if (modules.has(filename)) return modules.get(filename);
    const exports = {}; modules.set(filename, exports);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    new Function("require", "exports", code)(name => {
      if (name in mocks) return mocks[name];
      if (name.endsWith("/appearance")) return { useAppearance: () => ({ colors: palette ?? load("src/theme.ts").colors }), createThemedStyles: factory => () => factory(palette ?? load("src/theme.ts").colors) };
      if (name.endsWith("/auth")) return { useAuth: () => auth };
      if (name.endsWith("/supabase")) return { configError: null, mobileAuthentication: {
        signUp: request("signUp"), verifyOtp: request("verifyOtp"),
      }, supabase: { auth: {
        signUp: request("signUp"), verifyOtp: request("verifyOtp"), resend: request("resend"), resetPasswordForEmail: request("resetPassword"),
      } } };
      if (name.endsWith("/profile")) return { changeMobilePassword: async (...args) => calls.push(["changePassword", ...args]) };
      if (name.endsWith("/privacy-policy-link")) return { PrivacyPolicyLink: () => jsx.jsx("Text", { children: "Privacy Policy" }) };
      assert.ok(name.startsWith("."), `Unexpected import ${name}`);
      const base = path.resolve(path.dirname(filename), name);
      if (/\.tsx?$/.test(base)) return load(base);
      let extension;
      for (const candidate of [".tsx", ".ts"]) { try { readFileSync(base + candidate); extension = candidate; break; } catch {} }
      assert.ok(extension, `Missing module ${name}`);
      return load(base + extension);
    }, exports);
    return exports;
  }
  function expand(node, key = "root") {
    if (Array.isArray(node)) return node.map((item, i) => expand(item, `${key}.${i}`));
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function") {
      owner = `${key}:${node.type.name}`; cursor = 0;
      return expand(node.type(node.props), `${key}.render`);
    }
    return { ...node, props: { ...node.props, children: expand(node.props.children, `${key}.children`) } };
  }
  return {
    calls, load,
    setPalette(next) { palette = next; },
    render(relative, props) {
      const tree = expand(jsx.jsx(typeof relative === "string" ? load(relative).default : relative, props ?? {}));
      effects.splice(0).forEach(effect => effect());
      return tree;
    },
    resize(width, height, nextInsets = insets) { dimensions = { width, height }; insets = nextInsets; },
    async settle() { await new Promise(setImmediate); },
  };
}
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object") return [];
  return [node, ...nodes(node.props?.children)];
}
const find = (tree, type) => nodes(tree).find(node => node.type === type);
const text = node => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : node ? text(node.props?.children) : "";
const input = (tree, label) => nodes(tree).find(node => node.type === "TextInput" && node.props.accessibilityLabel === label);
const action = (tree, label) => nodes(tree).find(node => node.type === "Pressable" && text(node) === label);
const style = value => Object.assign({}, ...[value].flat(Infinity).filter(item => typeof item === "object" && item));

test("shared auth shell scrolls with one safe-area and keyboard adjustment across window sizes", () => {
  for (const platform of ["android", "ios"]) {
    const app = runtime({ platform });
    const { AuthScreen } = app.load("src/auth-ui.tsx");
    for (const [width, height] of [[320, 480], [360, 640], [390, 844], [430, 932], [820, 430]]) {
      app.resize(width, height, { top: 24, right: 44, bottom: 34, left: 44 });
      const tree = app.render(AuthScreen, { title: "Create account", children: jsx.jsx("Text", { children: "Form content" }) });
      const scroll = find(tree, "ScrollView"), padding = style(scroll.props.contentContainerStyle);
      assert.equal(scroll.props.keyboardShouldPersistTaps, "handled");
      assert.equal(scroll.props.keyboardDismissMode, "on-drag");
      assert.equal(scroll.props.automaticallyAdjustKeyboardInsets, platform === "ios");
      assert.equal(scroll.props.contentInsetAdjustmentBehavior, "never");
      assert.equal(scroll.props.automaticallyAdjustContentInsets, false);
      assert.equal(find(tree, "KeyboardAvoidingView"), undefined);
      assert.equal(padding.paddingTop, 24 + (height < 600 ? 16 : 24));
      assert.equal(padding.paddingBottom, 50);
      assert.equal(padding.paddingLeft, 56);
      assert.equal(padding.paddingRight, 56);
      assert.notEqual(padding.justifyContent, "center");
      assert.match(text(tree), /Create account.*Form content/);
    }
    const header = app.render(AuthScreen, { title: "Recovery", nativeHeader: true });
    assert.equal(style(find(header, "ScrollView").props.contentContainerStyle).paddingTop, 16);
  }
});

test("shared field captions remain visible with empty and populated inputs", () => {
  const app = runtime(), { AuthField } = app.load("src/auth-ui.tsx");
  for (const value of ["", "synthetic@example.test"]) {
    const tree = app.render(AuthField, { label: "Email", hint: "Use your account email", children: jsx.jsx("TextInput", { value }) });
    assert.match(text(tree), /Email.*Use your account email/);
    assert.equal(find(tree, "TextInput").props.value, value);
  }
});

test("shared actions expose readable labels and busy/disabled state without calling transport", () => {
  const app = runtime(), { AuthAction } = app.load("src/auth-ui.tsx");
  let presses = 0;
  const onPress = () => { presses++; };
  let tree = app.render(AuthAction, { label: "Create account", busy: false, onPress });
  assert.match(text(tree), /Create account/);
  find(tree, "Pressable").props.onPress();
  assert.equal(presses, 1);
  for (const props of [{ busy: true }, { disabled: true }, { busy: true, secondary: true }]) {
    tree = app.render(AuthAction, { label: "Create account", onPress, ...props });
    assert.equal(find(tree, "Pressable").props.disabled, true);
    assert.equal(find(tree, "Pressable").props.accessibilityLabel, "Create account");
    assert.equal(find(tree, "Pressable").props.accessibilityState.disabled, true);
  }
  assert.deepEqual(app.calls, []);
});

test("signup renders permanent captions and explicit input hint colours without changing validation", async () => {
  const app = runtime(), route = "app/(auth)/sign-up.tsx";
  let tree = app.render(route);
  const { authColors } = app.load("src/auth-ui.tsx");
  for (const label of ["Email", "Password", "Confirm password"]) {
    assert.ok(nodes(tree).some(node => node.type === "Text" && text(node) === label), `Visible ${label}`);
    assert.equal(input(tree, label).props.placeholderTextColor, authColors.muted);
  }
  input(tree, "Email").props.onChangeText("synthetic@example.test");
  input(tree, "Password").props.onChangeText("short");
  input(tree, "Confirm password").props.onChangeText("short");
  tree = app.render(route); action(tree, "Create account").props.onPress();
  await app.settle(); tree = app.render(route);
  assert.match(text(tree), /between 12 and 128/);
  assert.equal(app.calls.length, 0);
  input(tree, "Password").props.onChangeText("Synthetic-passphrase-123");
  input(tree, "Confirm password").props.onChangeText("different-passphrase");
  tree = app.render(route); action(tree, "Create account").props.onPress();
  await app.settle(); tree = app.render(route);
  assert.match(text(tree), /Passwords do not match/);
  assert.equal(app.calls.length, 0);
});

test("signup verification and every recovery stage retain visible captions and actions", async () => {
  const signup = runtime({ pendingSignup: JSON.stringify({ email: "synthetic@example.test", stage: "verify" }) });
  signup.render("app/(auth)/sign-up.tsx"); await signup.settle();
  const tree = signup.render("app/(auth)/sign-up.tsx");
  assert.match(text(tree), /Verify email.*six-digit code.*Email verification code/);
  assert.ok(input(tree, "Email verification code"));
  assert.ok(action(tree, "Verify email"));
  for (const [recovery, heading, labels, button] of [
    [null, "Reset password", ["Account email"], "Send recovery code"],
    [{ active: true, email: "synthetic@example.test", stage: "verify" }, "Verify recovery code", ["Recovery verification code"], "Verify code"],
    [{ active: true, email: "synthetic@example.test", stage: "password", userId: "synthetic-user" }, "Choose new password", ["New password", "Confirm new password"], "Update password"],
  ]) {
    const app = runtime({ recovery }), page = app.render("app/recover.tsx");
    assert.match(text(page), new RegExp(heading));
    for (const label of labels) assert.ok(nodes(page).some(node => node.type === "Text" && text(node) === label));
    assert.ok(action(page, button));
    assert.equal(style(find(page, "ScrollView").props.contentContainerStyle).paddingTop, 16);
    assert.equal(app.calls.length, 0);
  }
});

test("password reveal state and entered values survive resize on signup", () => {
  const app = runtime(), route = "app/(auth)/sign-up.tsx";
  let tree = app.render(route);
  input(tree, "Password").props.onChangeText("Synthetic-passphrase-123");
  input(tree, "Confirm password").props.onChangeText("Synthetic-passphrase-123");
  tree = app.render(route);
  assert.equal(input(tree, "Password").props.secureTextEntry, true);
  nodes(tree).find(node => node.props?.accessibilityLabel === "Show password").props.onPress();
  app.resize(820, 360);
  tree = app.render(route);
  assert.equal(input(tree, "Password").props.secureTextEntry, false);
  assert.equal(input(tree, "Password").props.value, "Synthetic-passphrase-123");
  assert.equal(input(tree, "Confirm password").props.value, "Synthetic-passphrase-123");
  nodes(tree).find(node => node.props?.accessibilityLabel === "Hide password").props.onPress();
  tree = app.render(route);
  assert.equal(input(tree, "Password").props.secureTextEntry, true);
  assert.equal(app.calls.length, 0);
});

test("signup submission still passes the existing values to mocked Auth and renders verification", async () => {
  const app = runtime(), route = "app/(auth)/sign-up.tsx";
  let tree = app.render(route);
  input(tree, "Email").props.onChangeText(" synthetic@example.test ");
  input(tree, "Password").props.onChangeText("Synthetic-passphrase-123");
  input(tree, "Confirm password").props.onChangeText("Synthetic-passphrase-123");
  tree = app.render(route);
  action(tree, "Create account").props.onPress();
  tree = app.render(route);
  assert.ok(nodes(tree).some(node => node.type === "Pressable" && node.props.accessibilityLabel === "Create account" && node.props.disabled));
  await app.settle();
  tree = app.render(route);
  assert.deepEqual(app.calls, [["signUp", { email: "synthetic@example.test", password: "Synthetic-passphrase-123" }]]);
  assert.match(text(tree), /Verify email/);
  assert.equal(input(tree, "Email verification code").props.value, "");
  assert.equal(input(tree, "Password"), undefined);
});

test("verification codes persist across short-window resizing and invalid codes never call Auth", async () => {
  for (const [options, route, label, button] of [
    [{ pendingSignup: JSON.stringify({ email: "synthetic@example.test", stage: "verify" }) }, "app/(auth)/sign-up.tsx", "Email verification code", "Verify email"],
    [{ recovery: { active: true, email: "synthetic@example.test", stage: "verify" } }, "app/recover.tsx", "Recovery code", "Verify code"],
  ]) {
    const app = runtime(options);
    app.render(route); await app.settle();
    let tree = app.render(route);
    input(tree, label).props.onChangeText("123");
    app.resize(820, 360, { top: 0, bottom: 20, left: 44, right: 44 });
    tree = app.render(route);
    assert.equal(input(tree, label).props.value, "123");
    assert.equal(input(tree, label).props.keyboardType, "number-pad");
    assert.equal(input(tree, label).props.maxLength, 6);
    action(tree, button).props.onPress(); await app.settle();
    tree = app.render(route);
    assert.match(text(tree), /Enter the six-digit code/);
    assert.equal(input(tree, label).props.value, "123");
    assert.deepEqual(app.calls, []);
    app.resize(390, 844);
    tree = app.render(route);
    assert.equal(input(tree, label).props.value, "123");
  }
});

test("recovery request and new-password input state survive resize without transport side effects", async () => {
  const app = runtime(), route = "app/recover.tsx";
  let tree = app.render(route);
  input(tree, "Email").props.onChangeText("not-an-email");
  app.resize(320, 360);
  tree = app.render(route);
  assert.equal(input(tree, "Email").props.value, "not-an-email");
  action(tree, "Send recovery code").props.onPress(); await app.settle();
  assert.match(text(app.render(route)), /Enter a valid email address/);
  assert.deepEqual(app.calls, []);

  const password = runtime({ recovery: { active: true, email: "synthetic@example.test", stage: "password", userId: "synthetic-user" } });
  tree = password.render(route);
  input(tree, "New password").props.onChangeText("Synthetic-passphrase-123");
  input(tree, "Confirm new password").props.onChangeText("Synthetic-passphrase-123");
  password.resize(820, 360);
  tree = password.render(route);
  for (const label of ["New password", "Confirm new password"]) {
    assert.equal(input(tree, label).props.value, "Synthetic-passphrase-123");
    assert.equal(input(tree, label).props.secureTextEntry, true);
  }
  assert.deepEqual(password.calls, []);
});


test("changing appearance updates signed-out inputs, shell and busy action while preserving entered credentials", () => {
  const app = runtime();
  const route = "app/(auth)/sign-in.tsx";
  let tree = app.render(route);
  input(tree, "Email").props.onChangeText("synthetic@example.test");
  input(tree, "Password").props.onChangeText("Synthetic-passphrase-123");
  const dark = { ...app.load("src/theme.ts").colors,
    background: "#201a17", surface: "#2b2420", text: "#f4e8de", muted: "#bdaca0",
    primary: "#e6b99d", onPrimary: "#382a24", inputBorder: "#806e60" };
  app.setPalette(dark);
  tree = app.render(route);
  assert.equal(style(find(tree, "ScrollView").props.style).backgroundColor, dark.background);
  assert.equal(style(input(tree, "Email").props.style).color, dark.text);
  assert.equal(input(tree, "Email").props.placeholderTextColor, dark.muted);
  assert.equal(input(tree, "Email").props.value, "synthetic@example.test");
  assert.equal(input(tree, "Password").props.value, "Synthetic-passphrase-123");
  const { AuthAction } = app.load("src/auth-ui.tsx");
  const busy = app.render(AuthAction, { label: "Sign in", busy: true, onPress() {} });
  assert.equal(find(busy, "ActivityIndicator").props.color, dark.onPrimary);
  assert.deepEqual(app.calls, []);
});
