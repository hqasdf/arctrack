import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as weather from "@arc-track/core/weather";
import { WeatherCollector } from "@arc-track/core/weather-collector";

function load(file, dependencies) {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } });
  const module = { exports: {} };
  new Function("require", "module", "exports", "__DEV__", outputText)(name => {
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (!(name in dependencies)) throw new Error(`Unmocked dependency ${name}`);
    return dependencies[name];
  }, module, module.exports, false);
  return module.exports;
}
const apiModel = load("weather-api.ts", { "./supabase": { supabase: null } });
const now = Date.now();
const snapshot = { id: "reading", sessionId: "session", roundId: "round", provider: "open-meteo",
  observedAt: new Date(now).toISOString(), retrievedAt: new Date(now).toISOString(),
  temperatureC: 0, windSpeedKph: 0, windGustKph: null, windDirectionDegrees: 0, humidityPercent: 0, conditionCode: 0 };
const result = { ok: true, enabled: true, readings: [snapshot], nextRefreshAt: new Date(now + weather.WEATHER_REFRESH_MS).toISOString() };
const nativeWeather = { View: ({ children }) => React.createElement("div", null, children), Text: ({ children }) => React.createElement("span", null, children),
  Pressable: ({ children }) => React.createElement("button", null, children), StyleSheet: { create: value => value }, Linking: { openURL: async () => {} } };
const svgWeather = { __esModule: true, default: "svg", Circle: "circle", G: "g", Path: "path", Text: "text" };

test("weather transport allows HTTPS origins and development-only local HTTP", () => {
  assert.equal(apiModel.weatherApiOrigin("https://arc-track.example/", false), "https://arc-track.example");
  for (const value of [undefined, "http://example.com", "https://u:p@example.com", "https://example.com/path", "https://example.com/?token=x", "javascript:alert(1)"])
    assert.equal(apiModel.weatherApiOrigin(value, true), null);
  assert.equal(apiModel.weatherApiOrigin("http://192.168.1.4:3000", false), null);
  assert.equal(apiModel.weatherApiOrigin("http://192.168.1.4:3000", true), "http://192.168.1.4:3000");
});

test("mobile authenticated weather transport preserves zeros, sends only lookup location, and never client measurements", async () => {
  const calls = [];
  const api = apiModel.createWeatherApi({ origin: "https://arc-track.example", accessToken: async () => "test-token", request: async (url, options) => {
    calls.push({ url, options }); return { ok: true, json: async () => result };
  } });
  assert.deepEqual(await api.load("session"), result);
  await api.capture("session", "round", { latitude: 1.3, longitude: 103.85 });
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-token");
  assert.equal(calls[0].options.method, "GET");
  assert.deepEqual(JSON.parse(calls[1].options.body), { roundId: "round", location: { latitude: 1.3, longitude: 103.85 } });
  assert.equal(calls[1].options.method, "POST");
});

test("weather transport fails closed without an origin or token and rejects cross-Session/malformed responses", async () => {
  let requests = 0;
  const request = async () => { requests++; return { ok: true, json: async () => result }; };
  await assert.rejects(apiModel.createWeatherApi({ origin: null, accessToken: async () => "token", request }).load("session"), error => error.noRetry === true);
  await assert.rejects(apiModel.createWeatherApi({ origin: "https://example.com", accessToken: async () => null, request }).load("session"), error => error.noRetry === true);
  assert.equal(requests, 0);
  const api = apiModel.createWeatherApi({ origin: "https://example.com", accessToken: async () => "token", request });
  await assert.rejects(api.load("other-session"), /unavailable/);
  const bad = apiModel.createWeatherApi({ origin: "https://example.com", accessToken: async () => "token", request: async () => ({ ok: true, json: async () => ({ ...result, nextRefreshAt: "invalid" }) }) });
  await assert.rejects(bad.load("session"), /unavailable/);
});

function locationRuntime(overrides = {}) {
  const calls = [];
  const native = {
    Accuracy: { Low: 2 },
    hasServicesEnabledAsync: async () => true,
    getForegroundPermissionsAsync: async () => ({ granted: true }),
    requestForegroundPermissionsAsync: async () => ({ granted: true }),
    getCurrentPositionAsync: async options => { calls.push(options); return { coords: { latitude: 1.304123, longitude: 103.851234 } }; },
    ...overrides,
  };
  return { ...load("weather-location.ts", { "expo-location": native, "@arc-track/core/weather": weather }), calls };
}

test("weather location requests one low-accuracy fix and rounds before returning", async () => {
  const location = locationRuntime();
  assert.deepEqual(await location.locateForWeather(() => true), { latitude: 1.3, longitude: 103.85 });
  assert.deepEqual(location.calls, [{ accuracy: 2, mayShowUserSettingsDialog: false }]);
});

test("inactive/denied weather location never obtains a fix and does not repeatedly prompt", async () => {
  let permissions = 0;
  const location = locationRuntime({
    getForegroundPermissionsAsync: async () => ({ granted: false, status: "undetermined", canAskAgain: true }),
    requestForegroundPermissionsAsync: async () => { permissions++; return { granted: false }; },
  });
  await assert.rejects(location.locateForWeather(() => false), error => error.noRetry === true);
  assert.equal(permissions, 0);
  await assert.rejects(location.locateForWeather(() => true), error => error.noRetry === true);
  await assert.rejects(location.locateForWeather(() => true), error => error.noRetry === true);
  assert.equal(permissions, 1);
  assert.equal(location.calls.length, 0);
});

test("leaving while native permission is pending prevents the location fix", async () => {
  let active = true;
  const location = locationRuntime({ getForegroundPermissionsAsync: async () => { active = false; return { granted: true }; } });
  await assert.rejects(location.locateForWeather(() => active), error => error.noRetry === true);
  assert.equal(location.calls.length, 0);
});

function hookRuntime() {
  const slots = []; let cursor = 0; let effects = []; let focused = true; let appListener;
  let user = { id: "owner" };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(callback, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { callback, deps }; return slots[index].callback; },
    useEffect(callback, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) { const previous = slots[index]; slots[index] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = callback(); }); } },
  };
  const calls = []; const timers = new Map();
  class Collector extends WeatherCollector {
    constructor(deps) { super({ ...deps, setTimer: (fn, delay) => { const key = {}; timers.set(key, { fn, delay }); return key; }, clearTimer: key => timers.delete(key) }); }
  }
  const api = { available: true,
    load: async id => { calls.push(["load", id]); return { ok: true, enabled: true, readings: [], nextRefreshAt: null }; },
    capture: async (id, roundId) => { calls.push(["capture", id, roundId]); return { ...result, readings: [{ ...snapshot, sessionId: id, roundId }] }; },
  };
  const { useSessionWeather } = load("use-session-weather.ts", {
    react: hooks, "@arc-track/core/weather": weather, "@arc-track/core/weather-collector": { WeatherCollector: Collector },
    "expo-router": { useFocusEffect: callback => hooks.useEffect(() => focused ? callback() : undefined, [callback, focused]) },
    "react-native": { AppState: { currentState: "active", addEventListener: (_event, callback) => { appListener = callback; return { remove() {} }; } } },
    "./auth": { useAuth: () => ({ user }) },
    "./weather-api": { mobileWeatherApi: api },
    "./weather-location": { locateForWeather: async allowed => { assert.equal(allowed(), true); calls.push(["locate"]); return { latitude: 1.3, longitude: 103.85 }; } },
  });
  const session = { id: "session", date: weather.weatherToday(Date.now()) };
  let round = { id: "round", distanceMetres: 70, ends: 1, arrowsPerEnd: 6 }; let arrows = [];
  function render() { cursor = 0; const value = useSessionWeather(session, round, arrows); const pending = effects; effects = []; pending.forEach(effect => effect()); return value; }
  return { calls, timers, render,
    setDate: value => { session.date = value; }, setRound: value => { round = value; }, setArrows: value => { arrows = value; },
    setFocus: value => { focused = value; }, setUser: value => { user = value; },
    background: () => appListener("background"), foreground: () => appListener("active"),
    async settle() { render(); await new Promise(setImmediate); render(); await new Promise(setImmediate); return render(); },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test("weather hook captures eligible focused scoring, pauses on blur/background, and activates a changed Round", async () => {
  const runtime = hookRuntime();
  try {
    const state = await runtime.settle();
    assert.equal(state.readings.length, 1);
    assert.equal(runtime.calls.filter(call => call[0] === "capture").length, 1);
    assert.equal(runtime.timers.size, 1);
    runtime.setFocus(false); await runtime.settle(); assert.equal(runtime.timers.size, 0);
    runtime.setFocus(true); await runtime.settle();
    runtime.background(); await runtime.settle(); assert.equal(runtime.timers.size, 0);
    runtime.foreground(); await runtime.settle();
    runtime.setRound({ id: "round-two", distanceMetres: 50, ends: 1, arrowsPerEnd: 6 }); await runtime.settle();
    assert.ok(runtime.calls.some(call => call[0] === "capture" && call[2] === "round-two"));
  } finally { runtime.dispose(); }
});

test("weather hook needs authentication, starts after sign-in without an app lock, and pauses on sign-out", async () => {
  const runtime = hookRuntime();
  try {
    runtime.setUser(null); await runtime.settle();
    assert.equal(runtime.calls.length, 0);
    runtime.setUser({ id: "owner" }); await runtime.settle();
    assert.equal(runtime.calls.filter(call => call[0] === "capture").length, 1);
    assert.equal(runtime.timers.size, 1);
    runtime.setUser(null); await runtime.settle();
    assert.equal(runtime.timers.size, 0);
    assert.equal(runtime.calls.filter(call => call[0] === "capture").length, 1);
  } finally { runtime.dispose(); }
});

test("18m, old Sessions, and fully keyed Rounds cannot request location or capture; history remains readable", async () => {
  const runtime = hookRuntime();
  try {
    runtime.setRound({ id: "round", distanceMetres: 18, ends: 1, arrowsPerEnd: 6 }); await runtime.settle();
    assert.equal(runtime.calls.some(call => call[0] === "locate"), false);
    assert.equal(runtime.calls.some(call => call[0] === "load"), true);
    runtime.setRound({ id: "round", distanceMetres: 70, ends: 1, arrowsPerEnd: 1 });
    runtime.setArrows([{ end: 1, arrow: 1 }]); await runtime.settle();
    assert.equal(runtime.calls.some(call => call[0] === "capture"), false);
    runtime.setArrows([]); runtime.setDate("2000-01-01"); await runtime.settle();
    assert.equal(runtime.calls.some(call => call[0] === "locate"), false);
  } finally { runtime.dispose(); }
});

test("Shooting Conditions preserve zero values and show the visual wind direction", () => {
  const ui = load("session-weather.tsx", { react: React, "react-native-svg": svgWeather, "@arc-track/core/weather": weather, "react-native": nativeWeather,
    "./theme": { colors: {} }, "./use-session-weather": { useSessionWeather: () => ({ status: "ready", ...result }) } });
  assert.equal(ui.ScoringWeather({ session: {}, round: { distanceMetres: 18 }, arrows: [] }), null);
  const markup = renderToStaticMarkup(React.createElement(ui.ScoringWeather, { session: {}, round: { distanceMetres: 70 }, arrows: [] }));
  for (const value of ["0\u00b0C", "WIND", "0 km/h", "GUSTS", "HUMIDITY", "From N \u00b7 toward S", "Open-Meteo"]) assert.ok(markup.includes(value), value);
  assert.ok(markup.includes('rotation="180"'));
});

test("Expo wind arrow points downwind for all eight compass directions", () => {
  const directions = [["N", "S"], ["NE", "SW"], ["E", "W"], ["SE", "NW"], ["S", "N"], ["SW", "NE"], ["W", "E"], ["NW", "SE"]];
  const rotations = [180, 225, 270, 315, 0, 45, 90, 135];
  for (let index = 0; index < rotations.length; index++) {
    const ui = load("session-weather.tsx", { react: React, "react-native-svg": svgWeather, "@arc-track/core/weather": weather, "react-native": nativeWeather,
      "./theme": { colors: {} }, "./use-session-weather": { useSessionWeather: () => ({ status: "ready", ...result, readings: [{ ...snapshot, windDirectionDegrees: index * 45 }] }) } });
    const markup = renderToStaticMarkup(React.createElement(ui.ScoringWeather, { session: {}, round: { distanceMetres: 70 }, arrows: [] }));
    assert.ok(markup.includes(`rotation="${rotations[index]}"`), `rotation ${rotations[index]}`);
    assert.ok(markup.includes(`From ${directions[index][0]} \u00b7 toward ${directions[index][1]}`));
  }
});

test("native weather config remains foreground-only and blocks precise/background Android permissions", () => {
  const app = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8")).expo;
  const plugin = app.plugins.find(value => Array.isArray(value) && value[0] === "expo-location")[1];
  assert.equal(plugin.isIosBackgroundLocationEnabled, false);
  assert.equal(plugin.isAndroidBackgroundLocationEnabled, false);
  assert.equal(plugin.isAndroidForegroundServiceEnabled, false);
  assert.equal(plugin.locationAlwaysPermission, false);
  assert.equal(plugin.locationAlwaysAndWhenInUsePermission, false);
  assert.ok(app.android.blockedPermissions.includes("android.permission.ACCESS_FINE_LOCATION"));
});


test("an older or unavailable saved observation is retained and clearly marked not current", () => {
  const older = { ...snapshot, observedAt: "2020-01-01T00:00:00Z" };
  const ui = load("session-weather.tsx", { react: React, "react-native-svg": svgWeather, "@arc-track/core/weather": weather, "react-native": nativeWeather,
    "./theme": { colors: {} }, "./use-session-weather": { useSessionWeather: () => ({ ...result, status: "unavailable", readings: [older] }) } });
  const markup = renderToStaticMarkup(React.createElement(ui.ScoringWeather, { session: {}, round: { distanceMetres: 70 }, arrows: [] }));
  assert.ok(markup.includes("not current"));
  assert.ok(markup.includes("2020-01-01 08:00 SGT"));
  assert.ok(markup.includes("Weather unavailable. This saved observation is retained."));
  assert.ok(markup.includes("0\u00b0C"));
});

test("real Expo config evaluates foreground-only iOS text and coarse-only Android weather permissions", () => {
  const require = createRequire(import.meta.url);
  const response = spawnSync(process.execPath, [require.resolve("expo/bin/cli"), "config", "--type", "introspect", "--json"], {
    cwd: new URL("../", import.meta.url), encoding: "utf8", maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(response.status, 0, "Expo config introspection must succeed");
  const config = JSON.parse(response.stdout.slice(response.stdout.indexOf("{")));
  const info = config._internal.modResults.ios.infoPlist;
  assert.ok(info.NSLocationWhenInUseUsageDescription.includes("approximate location"));
  for (const key of ["NSLocationAlwaysUsageDescription", "NSLocationAlwaysAndWhenInUseUsageDescription", "NSMotionUsageDescription"]) assert.equal(info[key], undefined);
  assert.ok(!info.UIBackgroundModes?.includes("location"));
  const permissions = config._internal.modResults.android.manifest.manifest["uses-permission"].map(item => item.$);
  assert.ok(permissions.some(item => item["android:name"] === "android.permission.ACCESS_COARSE_LOCATION" && item["tools:node"] !== "remove"));
  for (const name of ["ACCESS_FINE_LOCATION", "ACCESS_BACKGROUND_LOCATION", "FOREGROUND_SERVICE_LOCATION"])
    assert.ok(permissions.some(item => item["android:name"] === `android.permission.${name}` && item["tools:node"] === "remove"));
});
