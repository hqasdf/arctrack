import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToString } from "react-dom/server";
import ts from "typescript";
import * as flow from "../../src/auth-flow.ts";
import * as state from "../../src/auth-state.ts";

const require = createRequire(import.meta.url);
const mobileRoot = new URL("../../", import.meta.url);
const { getRoutes } = require("expo-router/build/getRoutesCore");
const { StackRouter } = require("expo-router/build/react-navigation/routers/StackRouter");
const { sortRoutesWithInitial } = require("expo-router/build/sortRoutes");

function evaluate(source, dependencies) {
  const module = { exports: {} };
  const localRequire = (name) => {
    if (name in dependencies) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    throw new Error(`Unmocked native dependency: ${name}`);
  };
  new Function("require", "module", "exports", "__DEV__", source)(localRequire, module, module.exports, false);
  return module.exports;
}

function loadTs(relative, dependencies) {
  const source = readFileSync(new URL(relative, mobileRoot), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } });
  return evaluate(outputText, dependencies);
}

// Test the real provider with in-memory hooks and mocked native I/O. No account,
// network or production data is involved; route transitions use Expo's real router below.
export function providerRuntime({ storedRecovery = null, restoredUser = null, removeItem } = {}) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let listener;
  let getUserCalls = 0;
  const storage = new Map(storedRecovery ? [[flow.RECOVERY_STORAGE_KEY, storedRecovery]] : []);
  const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useCallback(callback, dependencies) {
      const index = cursor++;
      if (!same(slots[index]?.dependencies, dependencies)) slots[index] = { callback, dependencies };
      return slots[index].callback;
    },
    useEffect(callback, dependencies) {
      const index = cursor++;
      if (!same(slots[index]?.dependencies, dependencies)) {
        const previous = slots[index];
        slots[index] = { dependencies };
        effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = callback(); });
      }
    },
  };
  const auth = {
    onAuthStateChange(callback) { listener = callback; return { data: { listener: undefined, subscription: { unsubscribe() {} } } }; },
    async getUser() { getUserCalls++; return { data: { user: restoredUser }, error: null }; },
    async signInWithPassword() { throw new Error("Provide a test sign-in result"); },
    async signOut() { listener("SIGNED_OUT", null); return { error: null }; },
  };
  const { AuthProvider } = loadTs("src/auth.tsx", {
    react: hooks,
    "@react-native-async-storage/async-storage": {
      getItem: async (key) => storage.get(key) ?? null,
      setItem: async (key, value) => { storage.set(key, value); },
      removeItem: async (key) => { if (removeItem) await removeItem(key); storage.delete(key); },
    },
    "./supabase": { configError: null, supabase: { auth } },
    "./auth-flow": flow,
    "./auth-state": state,
  });
  function render() {
    cursor = 0;
    const value = AuthProvider({ children: null }).props.value;
    const pending = effects;
    effects = [];
    pending.forEach((effect) => effect());
    return value;
  }
  render();
  return {
    auth, storage, render,
    emit: (event, session) => listener(event, session),
    getUserCalls: () => getUserCalls,
    async settle() { await new Promise(setImmediate); return render(); },
  };
}

export function routingRuntime(authState) {
  let stack;
  function Stack(props) { stack = props; return null; }
  Stack.Screen = () => null;
  Stack.Protected = () => null;
  const auth = { useAuth: () => authState, AuthProvider: ({ children }) => children };
  const router = { Stack, usePathname: () => "/sign-in", Redirect: () => null };
  const { default: RootLayout } = loadTs("app/_layout.tsx", {
    react: React,
    "expo-router": router,
    "expo-status-bar": { StatusBar: () => null },
    "react-native": { ActivityIndicator: () => null, Pressable: ({ children }) => children, Text: ({ children }) => children, View: ({ children }) => children },
    "../src/auth": auth,
    "../src/biometric-lock": { BiometricLockProvider: ({ children }) => children },
    "../src/auth-flow": flow,
    "../src/theme": { colors: {} },
  });
  renderToString(React.createElement(RootLayout));
  if (!stack) return { blocked: true };
  const keys = readdirSync(new URL("app/", mobileRoot), { recursive: true })
    .filter((file) => /\.[tj]sx?$/.test(file)).map((file) => `./${file.replaceAll("\\", "/")}`);
  const context = () => ({ default: () => null });
  context.keys = () => keys;
  const node = getRoutes(context, { platform: "ios", ignoreEntryPoints: true, skipGenerated: true });
  const memoReact = { ...React, useMemo: (callback) => callback() };
  const filterModule = readFileSync(require.resolve("expo-router/build/layouts/withLayoutContext"), "utf8");
  const { useFilterScreenChildren } = evaluate(filterModule, {
    react: memoReact, "../Route": {}, "../useScreens": {}, "./IsWithinLayoutContext": {},
    "../native-tabs/NativeTabTrigger": { isNativeTabTrigger: () => false },
    "../views/Protected": { isProtectedReactElement: (child) => React.isValidElement(child) && child.type === Stack.Protected },
    "../views/Screen": { isScreen: (child) => React.isValidElement(child) && child.type === Stack.Screen },
  });
  const { screens, protectedScreens } = useFilterScreenChildren(stack.children);
  const sortModule = readFileSync(require.resolve("expo-router/build/useScreens"), "utf8");
  const dependencies = Object.fromEntries([...sortModule.matchAll(/require\("([^"]+)"\)/g)].map((match) => [match[1], {}]));
  Object.assign(dependencies, {
    react: memoReact, "react/jsx-runtime": require("react/jsx-runtime"),
    "./Route": { useRouteNode: () => node, sortRoutesWithInitial },
    "./primitives": { Screen: Stack.Screen },
  });
  const { useSortedScreens } = evaluate(sortModule, dependencies);
  const routeNames = useSortedScreens(screens, protectedScreens).map((screen) => screen.props.name);
  return {
    routeNames, declaredNames: [...screens.map((s) => s.name), ...protectedScreens], node,
    router: StackRouter({ initialRouteName: stack.initialRouteName }),
    indexDestination() {
      const { default: Index } = loadTs("app/index.tsx", {
        "expo-router": router, "../src/auth": auth, "../src/auth-flow": flow,
      });
      return Index().props.href;
    },
  };
}

export function transitionFrom(currentRoute, before, after) {
  const initial = before.router.getInitialState({ routeNames: before.routeNames, routeParamList: {} });
  const current = { ...initial, routes: [{ name: currentRoute, key: "current" }], index: 0 };
  return after.router.getStateForRouteNamesChange(current, { routeNames: after.routeNames, routeParamList: {}, routeKeyChanges: [] });
}
