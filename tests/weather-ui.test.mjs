import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as model from "../packages/core/src/weather-model.ts";
import * as collector from "../packages/core/src/weather-collector.ts";
import nextConfig from "../next.config.ts";
const require = createRequire(import.meta.url);
const source = await readFile(new URL("../src/features/weather/components/session-weather.tsx", import.meta.url), "utf8");
const script = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(state) {
  let hookCalls = 0;
  const fakeReact = { ...React, useState: value => { hookCalls++; return [typeof value === "function" ? value() : state, () => {}]; },
    useEffect() {}, useLayoutEffect() {}, useRef: value => ({ current: value }), useSyncExternalStore: () => false };
  const mocks = name => name === "react" ? fakeReact : name === "@arc-track/core/weather" ? model
    : name === "@arc-track/core/weather-collector" ? collector
    : name === "../location.client" ? { locateForWeather: () => { throw new Error("Unexpected location call during rendering"); } }
    : name.endsWith(".css") ? { __esModule: true, default: new Proxy({}, { get: (_, name) => name }) } : require(name);
  const loaded = { exports: {} };
  new Function("require", "module", "exports", script)(mocks, loaded, loaded.exports);
  return { ...loaded.exports, hooks: () => hookCalls };
}
const round = { id: "round", distanceMetres: 70, ends: 6, arrowsPerEnd: 6, arrows: [] };
const reading = { id: "weather", sessionId: "session", roundId: "round", provider: "open-meteo", observedAt: "2026-01-01T00:00:00Z", retrievedAt: "2026-01-01T00:01:00Z", temperatureC: 0, windSpeedKph: 0, windGustKph: null, windDirectionDegrees: 0, humidityPercent: 0, conditionCode: 0 };

test("18m scoring mounts no weather hooks, panels, requests or timers", () => {
  const ui = load({ status: "loading", readings: [], enabled: false, nextRefreshAt: null });
  const html = renderToStaticMarkup(React.createElement(ui.ScoringWeather, { sessionId: "session", sessionDate: "2026-01-01", round: { ...round, distanceMetres: 18 }, collecting: true }));
  assert.equal(html, ""); assert.equal(ui.hooks(), 0);
});
test("Shooting Conditions retains zeros, missing gusts, source direction and stale timestamps", () => {
  const ui = load({ status: "ready", readings: [reading], enabled: true, nextRefreshAt: null });
  const html = renderToStaticMarkup(React.createElement(ui.ScoringWeather, { sessionId: "session", sessionDate: "2026-01-01", round, collecting: true }));
  assert.match(html, /Shooting Conditions/); assert.ok(html.includes("0\u00b0C")); assert.match(html, /class="windSpeed">0 km\/h/);
  assert.ok(html.includes("From N \u00b7 toward S")); assert.ok(html.includes("Gusts</span><strong>\u2014"));
  assert.ok(html.includes("Humidity</span><strong>0%")); assert.ok(html.includes("2026-01-01 08:00 SGT")); assert.match(html, /not current/);
  assert.match(html, /Estimated local weather/); assert.match(html, /Weather data by Open-Meteo/);
  assert.doesNotMatch(html, /<input|<form|Start weather|End weather/);
});
test("saved Session weather is compact and collapsible; no reading means no empty history", () => {
  const ui = load({ status: "ready", readings: [{ ...reading, roundId: null }, { ...reading, id: "older" }], enabled: false, nextRefreshAt: null });
  const html = renderToStaticMarkup(React.createElement(ui.SessionWeatherHistory, { sessionId: "session" }));
  assert.match(html, /<details[^>]*>/); assert.match(html, /<summary><strong>Saved weather<\/strong>/);
  assert.match(html, /Observed/); assert.match(html, /Open-Meteo/);
  const empty = load({ status: "unavailable", readings: [], enabled: false, nextRefreshAt: null });
  assert.equal(renderToStaticMarkup(React.createElement(empty.SessionWeatherHistory, { sessionId: "session" })), "");
});
test("wind arrow points downwind for all eight compass directions", () => {
  const rotations = [180, 225, 270, 315, 0, 45, 90, 135];
  const directions = [["N", "S"], ["NE", "SW"], ["E", "W"], ["SE", "NW"], ["S", "N"], ["SW", "NE"], ["W", "E"], ["NW", "SE"]];
  for (let index = 0; index < rotations.length; index++) {
    const ui = load({ status: "ready", readings: [{ ...reading, windDirectionDegrees: index * 45 }], enabled: true, nextRefreshAt: null });
    const html = renderToStaticMarkup(React.createElement(ui.ScoringWeather, { sessionId: "session", sessionDate: "2026-01-01", round, collecting: true }));
    assert.ok(html.includes(`rotate(${rotations[index]} 36 36)`), `rotation ${rotations[index]}`);
    assert.ok(html.includes(`From ${directions[index][0]} · toward ${directions[index][1]}`));
  }
});
test("only the existing web scoring route permits first-party location; other security headers stay restricted", async () => {
  const rules = await nextConfig.headers();
  const global = rules.find(item => item.source === "/:path*");
  assert.equal(global.headers.find(item => item.key === "Permissions-Policy").value, "camera=(), microphone=(), geolocation=()");
  const exceptions = rules.filter(item => item.headers.some(header => header.value.includes("geolocation=(self)")));
  assert.equal(exceptions.length, 1); assert.equal(exceptions[0].source, "/sessions");
  assert.equal(exceptions[0].headers[0].value, "camera=(), microphone=(), geolocation=(self)");
});
