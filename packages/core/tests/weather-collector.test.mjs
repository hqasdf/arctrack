import assert from "node:assert/strict";
import test from "node:test";
import { WeatherCollector } from "../src/weather-collector.ts";
import { WEATHER_REFRESH_MS } from "../src/weather-model.ts";

const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
function harness(overrides = {}) {
  let now = Date.parse("2026-10-16T10:00:00Z"); let nextId = 0;
  const timers = new Map(); const changes = []; const calls = { load: 0, locate: 0, capture: 0 };
  let due = null;
  const success = () => ({ ok: true, enabled: true, readings: [], nextRefreshAt: due });
  const collector = new WeatherCollector({
    load: async () => { calls.load++; return success(); },
    locate: async () => { calls.locate++; return { latitude: 1.35, longitude: 103.82 }; },
    capture: async () => { calls.capture++; due = new Date(now + WEATHER_REFRESH_MS).toISOString(); return success(); },
    random:()=>0, onChange: (state) => changes.push(state), now: () => now,
    setTimer: (callback, delay) => { timers.set(++nextId, { at: now + delay, callback }); return nextId; },
    clearTimer: (id) => timers.delete(id), ...overrides,
  });
  return { collector, changes, calls, timers, setDue: (value) => { due = value; },
    advance: async (milliseconds) => { now += milliseconds; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); } await flush(); } };
}

test("collector captures once and waits the full 30 minutes, not five or 29", async () => {
  const h = harness(); h.collector.setActive(true); await flush();
  assert.equal(h.calls.capture, 1);
  await h.advance(5 * 60_000); assert.equal(h.calls.capture, 1);
  await h.advance(24 * 60_000); assert.equal(h.calls.capture, 1);
  await h.advance(60_000); assert.equal(h.calls.capture, 2);
  h.collector.dispose(); assert.equal(h.timers.size, 0);
});

test("server eligibility is authoritative and inactive collection has no timers", async () => {
  const h = harness(); h.setDue("2026-10-16T10:30:00Z"); h.collector.setActive(true); await flush();
  assert.equal(h.calls.locate, 0); h.collector.setActive(false); assert.equal(h.timers.size, 0);
  await h.advance(40 * 60_000); assert.equal(h.calls.capture, 0);
  h.collector.setActive(true); await flush(); assert.equal(h.calls.capture, 1);
  h.collector.dispose();
});

test("disabled status loads readings without requesting location", async () => {
  let located = false;
  const h = harness({ load: async () => ({ ok: true, enabled: false, readings: [], nextRefreshAt: null }), locate: async () => { located = true; return { latitude: 0, longitude: 0 }; } });
  h.collector.setActive(true); await flush(); assert.equal(located, false); assert.equal(h.timers.size, 0);
  assert.equal(h.changes.at(-1).status, "ready"); h.collector.dispose();
});

test("failures retry with bounded backoff; denial has no timer and resumes only on a new activation", async () => {
  let attempts = 0;
  const h = harness({ locate: async () => { attempts++; throw new Error("offline"); } });
  h.collector.setActive(true); await flush(); assert.equal(h.changes.at(-1).status, "unavailable");
  await h.advance(59_000); assert.equal(attempts, 1); await h.advance(1000); assert.equal(attempts, 2);
  await h.advance(5 * 60_000); assert.equal(attempts, 3); await h.advance(15 * 60_000); assert.equal(attempts, 4);
  h.collector.dispose();
  let permissionChecks = 0;
  const denied = harness({ locate: async () => { permissionChecks++; throw Object.assign(new Error("denied"), { noRetry: true }); } });
  denied.collector.setActive(true); await flush(); assert.equal(denied.timers.size, 0);
  denied.collector.setActive(true); await flush(); assert.equal(permissionChecks, 1);
  await denied.advance(30 * 60_000); assert.equal(permissionChecks, 1);
  denied.collector.setActive(false); denied.collector.setActive(true); await flush();
  assert.equal(permissionChecks, 2); assert.equal(denied.timers.size, 0);
  assert.equal(denied.changes.at(-1).status, "unavailable");
  denied.collector.dispose();
});

test("rapid pause/resume serializes loads and ignores stale responses", async () => {
  let resolve; let loads = 0;
  const h = harness({ load: () => { loads++; return loads === 1 ? new Promise((done) => { resolve = done; }) : Promise.resolve({ ok: true, enabled: false, readings: [], nextRefreshAt: null }); } });
  h.collector.setActive(true); h.collector.setActive(false); h.collector.setActive(true);
  assert.equal(loads, 1); resolve({ ok: true, enabled: true, readings: [], nextRefreshAt: null }); await flush();
  assert.equal(loads, 2); assert.equal(h.calls.locate, 0); assert.equal(h.changes.length, 1);
  h.collector.dispose();
});

test("disposing during location lookup prevents capture and late UI updates", async () => {
  let resolve;
  const h = harness({ locate: () => new Promise((done) => { resolve = done; }) });
  h.collector.setActive(true); await flush(); const published = h.changes.length; h.collector.dispose();
  resolve({ latitude: 0, longitude: 0 }); await flush();
  assert.equal(h.calls.capture, 0); assert.equal(h.changes.length, published); assert.equal(h.timers.size, 0);
});


test("another device's pending claim is re-read at its short lease deadline without a second capture", async () => {
  let loads = 0, captures = 0;
  const reading = { id: "other-device-weather", sessionId: "session", roundId: "round", provider: "open-meteo",
    observedAt: "2026-10-16T10:00:00Z", retrievedAt: "2026-10-16T10:00:01Z", temperatureC: 29,
    windSpeedKph: 12, windGustKph: 19, windDirectionDegrees: 45, humidityPercent: 80, conditionCode: 2 };
  const h = harness({
    load: async () => ++loads === 1 ? { ok: true, enabled: true, readings: [], nextRefreshAt: null }
      : { ok: true, enabled: true, readings: [reading], nextRefreshAt: "2026-10-16T10:30:00Z" },
    capture: async () => { captures++; return { ok: true, enabled: true, readings: [], nextRefreshAt: "2026-10-16T10:00:30Z" }; },
  });
  h.collector.setActive(true); await flush(); assert.equal(captures, 1); assert.equal(loads, 1);
  await h.advance(29_000); assert.equal(loads, 1);
  await h.advance(1000); assert.equal(loads, 2); assert.equal(captures, 1);
  assert.equal(h.changes.at(-1).readings[0].id, "other-device-weather");
  h.collector.dispose();
});

test('collector exhausts its automatic retry budget and explicit Retry starts a new bounded episode',async()=>{
  const h=harness({load:async()=>{throw Error('offline');}});h.collector.setActive(true);await flush();
  for(const wait of [60000,300000,900000])await h.advance(wait);
  assert.equal(h.timers.size,0);assert.equal(h.changes.length,4);
  h.collector.retry();await flush();assert.equal(h.changes.length,5);assert.equal(h.timers.size,1);h.collector.dispose();
});
