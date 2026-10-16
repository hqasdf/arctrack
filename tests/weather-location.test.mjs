import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as weather from "../packages/core/src/weather-model.ts";
import { WeatherCollector } from "../packages/core/src/weather-collector.ts";

const script = ts.transpileModule(readFileSync(new URL("../src/features/weather/location.client.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function browser(permissions) {
  const calls = []; let result = "success";
  const navigator = { ...(permissions === undefined ? {} : { permissions }), geolocation: {
    getCurrentPosition(success, failure, options) {
      calls.push(options);
      if (result === "success") success({ coords: { latitude: 1.35217, longitude: 103.81987 } });
      else failure({ code: result });
    },
  } };
  const exports = {};
  new Function("require", "exports", "navigator", script)(name => {
    assert.equal(name, "@arc-track/core/weather"); return weather;
  }, exports, navigator);
  return { locate: exports.locateForWeather, calls, fail: code => { result = code; } };
}

test("successful weather location refreshes without a Permissions API or supported geolocation query", async () => {
  for (const permissions of [undefined, { query: async () => { throw new Error("unsupported"); } }, { query: () => { throw new Error("unsupported"); } }]) {
    const h = browser(permissions);
    assert.deepEqual(await h.locate(() => true), { latitude: 1.35, longitude: 103.82 });
    assert.deepEqual(await h.locate(() => true), { latitude: 1.35, longitude: 103.82 });
    assert.equal(h.calls.length, 2);
    assert.deepEqual(h.calls[0], { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  }
});

test("denied geolocation never repeatedly prompts when Permissions API is unavailable", async () => {
  const h = browser(); h.fail(1);
  await assert.rejects(h.locate(() => true), error => error.noRetry === true);
  await assert.rejects(h.locate(() => true), error => error.noRetry === true);
  assert.equal(h.calls.length, 1);
});

test("known expired Allow Once grant does not prompt again, while an existing grant can refresh", async () => {
  let state = "prompt";
  const h = browser({ query: async () => ({ state }) });
  await h.locate(() => true); state = "granted"; await h.locate(() => true);
  state = "prompt"; await assert.rejects(h.locate(() => true), error => error.noRetry === true);
  assert.equal(h.calls.length, 2);
});

test("known denied permission, inactive screens and transition during permission query request no fix", async () => {
  const denied = browser({ query: async () => ({ state: "denied" }) });
  await assert.rejects(denied.locate(() => true), error => error.noRetry === true); assert.equal(denied.calls.length, 0);
  const inactive = browser(); await assert.rejects(inactive.locate(() => false)); assert.equal(inactive.calls.length, 0);
  let active = true;
  const blurred = browser({ query: async () => { active = false; return { state: "granted" }; } });
  await assert.rejects(blurred.locate(() => active)); assert.equal(blurred.calls.length, 0);
});

test("a later denial clears the unsupported-Permissions success fallback", async () => {
  const h = browser(); await h.locate(() => true); h.fail(1);
  await assert.rejects(h.locate(() => true), error => error.noRetry === true);
  await assert.rejects(h.locate(() => true), error => error.noRetry === true);
  assert.equal(h.calls.length, 2);
});


test("collector resumes after a denied browser permission becomes granted without recreating the scoring screen", async () => {
  let permission = "denied", captures = 0;
  const h = browser({ query: async () => ({ state: permission }) });
  const changes = [];
  const collector = new WeatherCollector({
    load: async () => ({ ok: true, enabled: true, readings: [], nextRefreshAt: null }),
    locate: () => h.locate(() => true),
    capture: async () => { captures++; return { ok: true, enabled: true, readings: [], nextRefreshAt: new Date(Date.now() + weather.WEATHER_REFRESH_MS).toISOString() }; },
    onChange: state => changes.push(state), setTimer: () => 1, clearTimer: () => {},
  });
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  try {
    collector.setActive(true); await flush();
    assert.equal(h.calls.length, 0, "known denial never triggers a native prompt");
    assert.equal(changes.at(-1).status, "unavailable");
    collector.setActive(false); collector.setActive(true); await flush();
    assert.equal(h.calls.length, 0, "foreground resume while still denied cannot force a prompt");
    permission = "granted";
    collector.setActive(false); collector.setActive(true); await flush();
    assert.equal(h.calls.length, 1, "the new grant must be checked on foreground resume");
    assert.equal(captures, 1);
    assert.equal(changes.at(-1).status, "ready");
  } finally { collector.dispose(); }
});
