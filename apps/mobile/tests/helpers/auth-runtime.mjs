import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToString } from "react-dom/server";
import ts from "typescript";
import * as flow from "../../src/auth-flow.ts";
import * as state from "../../src/auth-state.ts";
import * as passkeyLifecycle from "../../src/passkeys/lifecycle.ts";
import { deviceScoringOwner } from "../../src/offline-scoring-access.ts";

const require = createRequire(import.meta.url);
const mobileRoot = new URL("../../", import.meta.url);
const { getRoutes } = require("expo-router/build/getRoutesCore");
const { StackRouter } = require("expo-router/build/react-navigation/routers/StackRouter");
const { sortRoutesWithInitial } = require("expo-router/build/sortRoutes");
const routeNode = require("expo-router/build/routeNode");

function evaluate(source, dependencies) {
  const evaluatedModule = { exports: {} };
  const localRequire = (name) => {
    if (name in dependencies) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    throw new Error(`Unmocked native dependency: ${name}`);
  };
  new Function("require", "module", "exports", "__DEV__", source)(localRequire, evaluatedModule, evaluatedModule.exports, false);
  return evaluatedModule.exports;
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
export function providerRuntime({ storedRecovery = null, restoredUser = null, removeItem, secureValues = new Map(), deleteSecureItem, acceptedMode } = {}) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let listener;
  let getUserCalls = 0;
  const storage = new Map(storedRecovery ? [[flow.RECOVERY_STORAGE_KEY, storedRecovery]] : []);
  const secureDeletes = [];
  let accepted = restoredUser ? { user: restoredUser } : null, retiring = false, acceptedEpoch = 0;
  let mode = acceptedMode ?? (flow.recoveryBlocksApp(restoredUser, flow.parseRecoveryContext(storedRecovery)) ? "recovery" : "normal");
  const authorityListeners = new Set();
  const notifyAuthority = () => { for (const callback of authorityListeners) callback(); };
  const sessionAuthority = {
    snapshot: () => ({ accepted: accepted ? { epoch: acceptedEpoch, accountId: accepted.user.id, mode, session: accepted } : null,
      ready: true, retiring, error: null }),
    allowsUser: user => !!user && !retiring && accepted?.user.id === user.id,
    allowsSession: session => !!session && !retiring && accepted?.user.id === session.user.id &&
      (!accepted.access_token || accepted.access_token === session.access_token),
    subscribe(callback) { authorityListeners.add(callback); return () => authorityListeners.delete(callback); },
  };
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
    async signOut() { accepted = null; listener("SIGNED_OUT", null); return { error: null }; },
  };
  const mobileAuthentication = {
    async signInWithPassword(...args) {
      const result = await auth.signInWithPassword(...args);
      if (result.data?.session && !result.error) {
        accepted = result.data.session; acceptedEpoch++; mode = "normal"; notifyAuthority();
      }
      return result;
    },
    async signOut() {
      retiring = true; accepted = null; notifyAuthority();
      const result = await auth.signOut();
      retiring = false; notifyAuthority();
      if (result.error) throw result.error;
    },
  };
  const { AuthProvider } = loadTs("src/auth.tsx", {
    react: hooks,
    "@react-native-async-storage/async-storage": {
      getItem: async (key) => storage.get(key) ?? null,
      setItem: async (key, value) => { storage.set(key, value); },
      removeItem: async (key) => { if (removeItem) await removeItem(key); storage.delete(key); },
    },
    "./supabase": { configError: null, supabase: { auth }, mobileAuthentication, sessionAuthority },
    "expo-secure-store": { deleteItemAsync: async key => {
      secureDeletes.push(key);
      if (deleteSecureItem) await deleteSecureItem(key);
      secureValues.delete(key);
    } },
    "./auth-flow": flow,
    "./auth-state": state,
    "./passkeys/lifecycle": passkeyLifecycle,
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
    auth, storage, render, secureDeletes, secureValues,
    emitRaw: (event, session) => listener(event, session),
    accept(session, purpose = "normal") { accepted = session; acceptedEpoch++; mode = purpose; notifyAuthority(); },
    emit: (event, session) => {
      if (event === "SIGNED_OUT") accepted = null;
      else if (session) {
        accepted = session;
        mode = flow.recoveryBlocksApp(session.user, flow.parseRecoveryContext(storage.get(flow.RECOVERY_STORAGE_KEY) ?? null)) ? "recovery" : "normal";
      }
      notifyAuthority(); listener(event, session);
    },
    getUserCalls: () => getUserCalls,
    async settle() { await new Promise(setImmediate); return render(); },
  };
}

export function routingRuntime(authState, authoritySnapshot) {
  let stack;
  function Stack(props) { stack = props; return null; }
  Stack.Screen = function Screen() { return null; };
  Stack.Protected = function Protected() { return null; };
  const auth = { useAuth: () => authState, AuthProvider: ({ children }) => children };
  const router = { Stack, usePathname: () => "/sign-in", Redirect: () => null,
    ThemeProvider: ({ children }) => children, DarkTheme: { colors: {} }, DefaultTheme: { colors: {} } };
  const { default: RootLayout } = loadTs("app/_layout.tsx", {
    react: React,
    "expo-router": router,
    "expo-status-bar": { StatusBar: () => null },
    "react-native": { ActivityIndicator: () => null, Pressable: ({ children }) => children, Text: ({ children }) => children, View: ({ children }) => children },
    "../src/auth": auth,
    "../src/offline-scoring": { startOfflineScoringSync: () => () => {} },
    "../src/offline-rounds": { OfflineRounds: ({ deviceOwner }) => React.createElement("p", null, `Device scoring for ${deviceOwner}`) },
    "../src/offline-scoring-access": { deviceScoringOwner },
    "../src/supabase": { sessionAuthority: { snapshot: () => authoritySnapshot } },
    "../src/auth-flow": flow,
    "../src/theme": { colors: {} },
    "../src/appearance": { AppearanceProvider: ({ children }) => children, useAppearance: () => ({ colors: {}, resolvedTheme: "light" }) },
  });
  const html = renderToString(React.createElement(RootLayout));
  if (!stack) return { blocked: true, html };
  const keys = readdirSync(new URL("app/", mobileRoot), { recursive: true })
    .filter((file) => /\.[tj]sx?$/.test(file)).map((file) => `./${file.replaceAll("\\", "/")}`);
  const context = () => ({ default: () => null });
  context.keys = () => keys;
  const node = getRoutes(context, { platform: "ios", ignoreEntryPoints: true, skipGenerated: true });
  const memoReact = { ...React, useMemo: (callback) => callback() };
  const filterModule = readFileSync(require.resolve("expo-router/build/layouts/withLayoutContext"), "utf8");
  const guardApi = evaluate(readFileSync(require.resolve("expo-router/build/layouts/GuardContext"), "utf8"), { react: memoReact, "../Route": {}, "../matchers": require("expo-router/build/matchers"), "../routeNode": routeNode });
  const { useFilterScreenChildren: filterScreenChildren } = evaluate(filterModule, {
    react: memoReact, "../Route": {}, "../useScreens": {}, "./IsWithinLayoutContext": {}, "./GuardContext": guardApi,
    "../native-tabs/NativeTabTrigger": { isNativeTabTrigger: () => false },
    "../views/Protected": { isProtectedReactElement: (child) => React.isValidElement(child) && child.type === Stack.Protected },
    "../views/Screen": { isScreen: (child) => React.isValidElement(child) && child.type === Stack.Screen },
  });
  const { screens, guardedRedirects } = filterScreenChildren(stack.children);
  const sortModule = readFileSync(require.resolve("expo-router/build/useScreens"), "utf8");
  const dependencies = Object.fromEntries([...sortModule.matchAll(/require\("([^"]+)"\)/g)].map((match) => [match[1], {}]));
  Object.assign(dependencies, {
    react: memoReact, "react/jsx-runtime": require("react/jsx-runtime"),
    "./Route": { useRouteNode: () => node, sortRoutesWithInitial },
    "./primitives": { Screen: Stack.Screen }, "./routeNode": routeNode, "./layouts/GuardContext": guardApi,
  });
  const { useSortedScreens: sortScreens } = evaluate(sortModule, dependencies);
  // SDK 58 keeps registered screens and guards them through redirect metadata.
  // Project the permitted routes using the installed guard predicate, not an app mock.
  const routeNames = sortScreens(screens, guardedRedirects).map((screen) => screen.props.name).filter(name => !guardApi.isRouteGuarded(name, guardedRedirects));
  return {
    routeNames, declaredNames: [...screens.map((s) => s.name), ...guardedRedirects.keys()], node,
    router: StackRouter({ initialRouteName: "index" }),
    indexDestination() {
      const { default: Index } = loadTs("app/index.tsx", {
        "expo-router": router, "../src/auth": auth, "../src/auth-flow": flow,
      });
      return Index().props.href;
    },
  };
}

export function transitionFrom(currentRoute, before, after) {
  // SDK 58 exposes declared-route filtering rather than getInitialState /
  // getStateForRouteNamesChange. Exercise those installed router primitives.
  const current = {key:'test-stack',routeKeySeq:1,type:'stack',stale:false,routeNames:before.routeNames,routes:[{name:currentRoute,key:'current'}],index:0};
  const filtered = {...after.router.getStateForDeclaredRoutes(current, after.routeNames), routeNames:after.routeNames};
  if (filtered.routes.length) return filtered;
  const result = after.router.getStateForAction(filtered,{type:'RESET',payload:{...filtered,routeNames:after.routeNames,index:0,routes:[{name:'index'}],stale:false}},{routeNames:after.routeNames,routeParamList:{}});
  if (!result?.state) throw Error('Installed router did not resolve its declared index fallback');
  return result.state;
}
