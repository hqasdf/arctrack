import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as model from "../packages/core/src/weather-model.ts";
import { WeatherCollector } from "../packages/core/src/weather-collector.ts";

const require = createRequire(import.meta.url);
const script = ts.transpileModule(readFileSync(new URL("../src/features/weather/components/session-weather.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };

function runtime() {
  const slots = []; let cursor = 0, effects = [], layouts = [], focused = true, instances = 0, locationCalls = 0, captureCalls = 0, permission;
  const states = [], activations = [], timers = new Map();
  const document = new EventTarget(); document.visibilityState = "visible"; document.hasFocus = () => focused;
  const window = new EventTarget();
  const same = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  function effect(callback, deps, queue) {
    const index = cursor++;
    if (!same(slots[index]?.deps, deps)) {
      const previous = slots[index]; slots[index] = { deps };
      queue.push(() => { previous?.cleanup?.(); slots[index].cleanup = callback(); });
    }
  }
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; states.push(slots[index]); }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(callback, deps) { effect(callback, deps, effects); },
    useLayoutEffect(callback, deps) { effect(callback, deps, layouts); },
    useSyncExternalStore(subscribe, getSnapshot) { hooks.useEffect(() => subscribe(() => {}), [subscribe]); return getSnapshot(); },
  };
  class Collector extends WeatherCollector {
    constructor(deps) {
      super({ ...deps, setTimer: (callback, delay) => { const key = {}; timers.set(key, { callback, delay }); return key; }, clearTimer: key => timers.delete(key) });
      instances++;
    }
    setActive(active) { activations.push(active); super.setActive(active); }
  }
  const result = nextRefreshAt => ({ ok: true, enabled: true, readings: [], nextRefreshAt });
  const modules = {
    react: hooks, "react/jsx-runtime": require("react/jsx-runtime"),
    "@arc-track/core/weather": model, "@arc-track/core/weather-collector": { WeatherCollector: Collector },
    "./session-weather.module.css": { __esModule: true, default: {} },
    "../location.client": { locateForWeather: allowed => {
      locationCalls++;
      if (locationCalls === 1) return new Promise((resolve, reject) => {
        permission = () => allowed() ? resolve({ latitude: 1.35, longitude: 103.82 })
          : reject(Object.assign(new Error("Paused before permission resolved"), { noRetry: true }));
      });
      assert.equal(allowed(), true); return Promise.resolve({ latitude: 1.35, longitude: 103.82 });
    } },
  };
  const exports = {};
  new Function("require", "exports", "document", "window", "fetch", script)(name => {
    assert.ok(name in modules, name); return modules[name];
  }, exports, document, window, async (_url, options) => {
    if (options.method === "POST") { captureCalls++; return Response.json(result(new Date(Date.now() + model.WEATHER_REFRESH_MS).toISOString())); }
    return Response.json(result(null));
  });
  let round = { id: "round", distanceMetres: 70, ends: 1, arrowsPerEnd: 6, arrows: [] };
  function render() {
    cursor = 0;
    const panel = exports.ScoringWeather({ sessionId: "session", sessionDate: model.weatherToday(Date.now()), round, collecting: true });
    panel.type(panel.props);
    const pendingLayouts = layouts; layouts = []; pendingLayouts.forEach(run => run());
    const pendingEffects = effects; effects = []; pendingEffects.forEach(run => run());
  }
  return {
    render, activations, timers, states,
    blur() { focused = false; window.dispatchEvent(new Event("blur")); },
    focus() { focused = true; window.dispatchEvent(new Event("focus")); },
    resolvePermission: () => permission(), instances: () => instances, locationCalls: () => locationCalls, captures: () => captureCalls,
    updateArrows() { round = { ...round, arrows: [{ id: "arrow", end: 1, arrow: 1, score: "9", plot: null }] }; },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test("web blur pauses synchronously before pending permission resolves; focus resumes without recreating collector on Arrow updates", async () => {
  const h = runtime();
  try {
    h.render(); await flush(); assert.equal(h.locationCalls(), 1); assert.equal(h.instances(), 1);
    h.blur(); // Deliberately do not rerender or run React passive effects yet.
    assert.equal(h.activations.at(-1), false, "browser blur must synchronously pause the existing collector");
    h.resolvePermission(); await flush();
    assert.equal(h.captures(), 0); assert.equal(h.timers.size, 0);
    assert.equal(h.states.some(state => state?.status === "unavailable"), false, "stale pause error cannot poison permission state");
    h.focus(); await flush(); h.render(); await flush();
    assert.equal(h.locationCalls(), 2); assert.equal(h.captures(), 1); assert.equal(h.timers.size, 1);
    h.updateArrows(); h.render(); await flush();
    assert.equal(h.instances(), 1, "Arrow updates must not recreate the weather collector");
    assert.equal(h.captures(), 1, "an Arrow update cannot trigger a second weather capture");
  } finally { h.dispose(); }
  assert.equal(h.timers.size, 0);
});
