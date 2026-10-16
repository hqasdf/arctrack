import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as weather from "../packages/core/src/weather-model.ts";

const sessionId = "123e4567-e89b-42d3-a456-426614174000";
const roundId = "223e4567-e89b-42d3-a456-426614174000";
const userId = "323e4567-e89b-42d3-a456-426614174000";
const now = Date.parse("2026-10-16T10:00:00Z");
class Clock extends Date { static now() { return now; } }

function load(file, modules, globals = {}) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("require", "exports", "process", "fetch", "AbortSignal", "Date", compiled)(name => {
    assert.ok(name in modules, `unexpected dependency ${name}`); return modules[name];
  }, exports, globals.process ?? process, globals.fetch ?? fetch, globals.AbortSignal ?? AbortSignal, globals.Date ?? Clock);
  return exports;
}
const http = load("../src/features/weather/http.server.ts", { "server-only": {} });

function serviceHarness(options = {}) {
  const queries = [], authCalls = [], rpcCalls = [], createdClients = []; let cookieClients = 0, providerCalls = 0;
  const rows = {
    sessions: options.owner === false ? null : { id: sessionId, session_date: options.sessionDate ?? "2026-10-16" },
    session_rounds: { id: roundId, session_id: sessionId, distance_metres: options.distance ?? 70 },
    session_weather_snapshots: [{ id: "weather-id", session_id: sessionId, round_id: roundId, observed_at: "2026-10-16T09:45:00Z", retrieved_at: "2026-10-16T10:00:00Z", temperature_c: 0, wind_speed_kph: 0, wind_gust_kph: null, wind_direction_degrees: 0, humidity_percent: 80, condition_code: 0 }],
  };
  const client = {
    auth: { getUser: async token => { authCalls.push(token); return { data: { user: options.signedOut ? null : { id: userId, email_confirmed_at: options.unconfirmed ? null : "2026-01-01T00:00:00Z" } }, error: options.authError ?? null }; } },
    from(table) {
      const call = { table, filters: [] }; queries.push(call);
      const result = () => ({ data: rows[table], error: table === "session_weather_snapshots" ? options.readError ?? null : null });
      const query = { select: () => query, eq: (key, value) => { call.filters.push([key, value]); return query; },
        order: () => query, limit: async () => result(), maybeSingle: async () => result() };
      return query;
    },
    rpc: () => { throw new Error("Weather coordination RPCs are server-only."); },
  };
  function rpc(name, args) {
    rpcCalls.push({ name, args });
    let result;
    if (name === "claim_session_weather_refresh") result = { data: { claimed: options.claimed !== false, claim_id: options.claimed === false ? null : "claim-id", session_id: sessionId, next_refresh_at: "2026-10-16T10:30:00Z" }, error: null };
    else if (name === "save_session_weather_snapshot") result = { data: !options.saveFailure, error: options.saveFailure ? { code: "unavailable" } : null };
    else result = { data: { next_refresh_at: "2026-10-16T10:30:00Z" }, error: null };
    return Object.assign(Promise.resolve(result), { single: async () => result, maybeSingle: async () => result });
  }
  const writer = { rpc };
  const exports = load("../src/features/weather/service.server.ts", {
    "server-only": {}, "@arc-track/core/weather": weather,
    "@supabase/supabase-js": { createClient: (url, key, config) => { createdClients.push({ url, key, config }); return key === "server-test-key" ? writer : client; } },
    "@/lib/auth/config": { getAuthConfig: () => options.noConfig ? null : { url: "https://project.example", publishableKey: "public-test-key" } },
    "@/lib/supabase/server": { createAuthClient: async () => { cookieClients++; return client; } },
    "./provider.server": { weatherProviderConfig: () => options.disabled ? null : { endpoint: "https://provider.example" }, fetchCurrentWeather: async () => {
      providerCalls++; if (options.providerFailure) throw new Error("secret provider error");
      return { temperatureC: 29, windSpeedKph: 12, windGustKph: 19, windDirectionDegrees: 45, humidityPercent: 80, conditionCode: 2, observedAt: "2026-10-16T10:00:00Z" };
    } },
  }, { process: { env: { SUPABASE_SECRET_KEY: options.noSecret ? "" : "server-test-key" } } });
  return { exports, queries, authCalls, rpcCalls, createdClients, identity: { client, userId }, cookieClients: () => cookieClients, providerCalls: () => providerCalls };
}
function route(service) {
  return load("../src/app/api/session-weather/route.ts", {
    "@arc-track/core/weather": weather, "@/features/weather/http.server": http,
    "@/features/weather/service.server": service,
  });
}
function post(body = { roundId, location: { latitude: 1.35217, longitude: 103.81987 } }, headers = {}) {
  return new Request("https://arc.example/api/session-weather", { method: "POST", headers: { origin: "https://arc.example", "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
function privateResponse(response) { assert.match(response.headers.get("cache-control"), /private.*no-store/); }

test("weather verifies cookie identity and confirmed email without a second authentication system", async () => {
  const h = serviceHarness();
  assert.equal((await h.exports.weatherIdentity(new Request("https://arc.example"))).userId, userId);
  assert.equal(h.cookieClients(), 1); assert.deepEqual(h.authCalls, [undefined]);
  for (const options of [{ unconfirmed: true }, { signedOut: true }, { authError: { message: "invalid" } }, { noConfig: true }]) {
    assert.equal(await serviceHarness(options).exports.weatherIdentity(new Request("https://arc.example")), null);
  }
});

test("Expo Bearer authentication verifies token and never falls back to a cookie identity", async () => {
  const h = serviceHarness();
  assert.equal((await h.exports.weatherIdentity(new Request("https://arc.example", { headers: { authorization: "Bearer fake-token" } }))).userId, userId);
  assert.equal(h.cookieClients(), 0); assert.deepEqual(h.authCalls, ["fake-token"]);
  assert.equal(h.createdClients[0].config.global.headers.Authorization, "Bearer fake-token");
  assert.deepEqual(h.createdClients[0].config.auth, { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  for (const authorization of ["Basic abc", "Bearer token with spaces", "Bearer "+"x".repeat(8193)]) {
    const denied = serviceHarness(); assert.equal(await denied.exports.weatherIdentity(new Request("https://arc.example", { headers: { authorization } })), null);
    assert.equal(denied.cookieClients(), 0); assert.equal(denied.authCalls.length, 0);
  }
});

test("weather reads explicitly scope owner and preserve zero/missing snapshot measurements", async () => {
  const h = serviceHarness(); const result = await h.exports.readSessionWeather(h.identity, sessionId);
  assert.deepEqual(h.queries[0], { table: "sessions", filters: [["id", sessionId], ["user_id", userId]] });
  assert.equal(result.readings[0].temperatureC, 0); assert.equal(result.readings[0].windSpeedKph, 0); assert.equal(result.readings[0].windGustKph, null);
  assert.equal(result.readings[0].sessionId, sessionId); assert.equal(result.readings[0].provider, "open-meteo");
  assert.deepEqual(h.rpcCalls[0], { name: "read_session_weather_refresh", args: { p_user_id: userId, p_session_id: sessionId } });
});

test("coach-visible or other-user Sessions cannot authorize weather capture", async () => {
  const h = serviceHarness({ owner: false });
  await assert.rejects(h.exports.captureSessionWeather(h.identity, roundId, { latitude: 1, longitude: 103 }));
  assert.equal(h.providerCalls(), 0); assert.equal(h.rpcCalls.length, 0);
  assert.deepEqual(h.queries.find(item => item.table === "sessions").filters, [["id", sessionId], ["user_id", userId]]);
});

test("18m and historical Sessions never fetch current weather; missing migration/config remains optional", async () => {
  for (const options of [{ distance: 18 }, { sessionDate: "2026-10-15" }]) {
    const h = serviceHarness(options); await assert.rejects(h.exports.captureSessionWeather(h.identity, roundId, { latitude: 1, longitude: 103 }));
    assert.equal(h.providerCalls(), 0); assert.equal(h.rpcCalls.length, 0);
  }
  for (const options of [{ disabled: true }, { noSecret: true }]) {
    const h = serviceHarness(options); const result = await h.exports.captureSessionWeather(h.identity, roundId, { latitude: 1, longitude: 103 });
    assert.equal(result.enabled, false); assert.equal(h.providerCalls(), 0); assert.equal(h.rpcCalls.length, 0);
  }
  const h = serviceHarness({ readError: { code: "42P01" } });
  assert.equal((await h.exports.readSessionWeather(h.identity, sessionId)).enabled, false);
});

test("capture claims before provider access and writes only normalized provider values as verified owner", async () => {
  const h = serviceHarness(); await h.exports.captureSessionWeather(h.identity, roundId, { latitude: 1.35, longitude: 103.82 });
  assert.equal(h.providerCalls(), 1); assert.equal(h.rpcCalls[0].name, "claim_session_weather_refresh");
  assert.deepEqual(h.rpcCalls[0].args, { p_user_id: userId, p_round_id: roundId });
  const save = h.rpcCalls.find(item => item.name === "save_session_weather_snapshot");
  assert.equal(save.args.p_user_id, userId); assert.equal(save.args.p_temperature_c, 29);
  assert.equal(save.args.p_claim_id, "claim-id"); assert.equal("latitude" in save.args, false);
  const writer = h.createdClients.find(item => item.key === "server-test-key");
  assert.equal(writer.config.global, undefined, "privileged writer cannot inherit caller bearer header");
  const alreadyClaimed = serviceHarness({ claimed: false });
  await alreadyClaimed.exports.captureSessionWeather(alreadyClaimed.identity, roundId, { latitude: 1, longitude: 103 });
  assert.equal(alreadyClaimed.providerCalls(), 0);
});

test("provider/save failures release only the matching claim and return sanitized failure", async () => {
  for (const options of [{ providerFailure: true }, { saveFailure: true }]) {
    const h = serviceHarness(options);
    await assert.rejects(h.exports.captureSessionWeather(h.identity, roundId, { latitude: 1, longitude: 103 }), { message: "Weather unavailable" });
    assert.deepEqual(h.rpcCalls.at(-1), { name: "release_session_weather_refresh", args: { p_user_id: userId, p_round_id: roundId, p_claim_id: "claim-id" } });
  }
});

test("actual weather route accepts same-origin cookie and native Bearer requests", async () => {
  for (const native of [false, true]) {
    const h = serviceHarness(); const request = post();
    if (native) { request.headers.delete("origin"); request.headers.set("authorization", "Bearer fake-token"); }
    const response = await route(h.exports).POST(request); assert.equal(response.status, 200); privateResponse(response);
    assert.equal(h.providerCalls(), 1);
  }
});

test("weather route denies cross-site requests and unauthenticated/unconfirmed users", async () => {
  for (const headers of [{ origin: "https://evil.example" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }]) {
    const h = serviceHarness(); const response = await route(h.exports).POST(post(undefined, headers));
    assert.equal(response.status, 403); privateResponse(response); assert.equal(h.authCalls.length, 0); assert.equal(h.providerCalls(), 0);
  }
  const missingOrigin = post(); missingOrigin.headers.delete("origin");
  assert.equal((await route(serviceHarness().exports).POST(missingOrigin)).status, 403);
  for (const options of [{ signedOut: true }, { unconfirmed: true }]) {
    const h = serviceHarness(options); assert.equal((await route(h.exports).POST(post())).status, 401); assert.equal(h.providerCalls(), 0);
  }
});

test("weather route rejects forged measurements, user IDs, nested extras and invalid positions", async () => {
  const payloads = [
    { roundId, userId, location: { latitude: 1, longitude: 103 } },
    { roundId, temperatureC: 99, location: { latitude: 1, longitude: 103 } },
    { roundId, location: { latitude: 1, longitude: 103, provider: "evil" } },
    { roundId, location: { latitude: "1", longitude: 103 } },
    { roundId, location: { latitude: 91, longitude: 103 } }, [], null, "{bad JSON",
  ];
  for (const payload of payloads) {
    const h = serviceHarness(); const response = await route(h.exports).POST(post(payload));
    assert.equal(response.status, 400); privateResponse(response); assert.equal(h.providerCalls(), 0); assert.equal(h.rpcCalls.length, 0);
  }
});

test("weather route bounds chunked/incorrect Content-Length bodies and enforces JSON media type", async () => {
  for (const headers of [{}, { "content-length": "1" }, { "content-length": "9999" }]) {
    const h = serviceHarness(); const response = await route(h.exports).POST(post(JSON.stringify({ roundId, padding: "x".repeat(3000) }), headers));
    assert.equal(response.status, 400); assert.equal(h.providerCalls(), 0);
  }
  const h = serviceHarness(); assert.equal((await route(h.exports).POST(post({}, { "content-type": "text/plain" }))).status, 415);
  const badUtf8 = new Response(new Uint8Array([0xff, 0xfe])); await assert.rejects(http.readWeatherJson(badUtf8, 2048));
});

test("weather GET rejects foreign origins, missing IDs and failed owner checks without leaking details", async () => {
  const h = serviceHarness(); const response = await route(h.exports).GET(new Request(`https://arc.example/api/session-weather?sessionId=${sessionId}`));
  assert.equal(response.status, 200); privateResponse(response);
  assert.equal((await route(h.exports).GET(new Request(`https://arc.example/api/session-weather?sessionId=${sessionId}`, { headers: { origin: "https://evil.example" } }))).status, 403);
  assert.equal((await route(h.exports).GET(new Request("https://arc.example/api/session-weather?sessionId=bad"))).status, 400);
  const denied = await route(serviceHarness({ owner: false }).exports).GET(new Request(`https://arc.example/api/session-weather?sessionId=${sessionId}`));
  assert.deepEqual(await denied.json(), { ok: false, message: "Weather unavailable" });
});

function providerHarness(env, response, thrown = null) {
  const requests = [], timeouts = [];
  const exports = load("../src/features/weather/provider.server.ts", {
    "server-only": {}, "@arc-track/core/weather": weather, "./http.server": http,
  }, { process: { env }, fetch: async (url, options) => { requests.push({ url: new URL(url), options }); if (thrown) throw thrown; return response; }, AbortSignal: { timeout: ms => { timeouts.push(ms); return AbortSignal.abort(); } } });
  return { exports, requests, timeouts };
}
function observation() {
  return { current: { time: now / 1000, temperature_2m: 29, relative_humidity_2m: 80, weather_code: 2, wind_speed_10m: 12, wind_direction_10m: 45, wind_gusts_10m: 19 }, current_units: { time: "unixtime", temperature_2m: "\u00b0C", relative_humidity_2m: "%", weather_code: "wmo code", wind_speed_10m: "km/h", wind_direction_10m: "\u00b0", wind_gusts_10m: "km/h" } };
}

test("free provider configuration works only in explicitly enabled development, never production", () => {
  assert.equal(providerHarness({ ARC_TRACK_WEATHER_ENABLED: "true", ARC_TRACK_WEATHER_MODE: "development", NODE_ENV: "production" }).exports.weatherProviderConfig(), null);
  assert.equal(providerHarness({ ARC_TRACK_WEATHER_MODE: "development", NODE_ENV: "development" }).exports.weatherProviderConfig(), null);
  assert.equal(providerHarness({ ARC_TRACK_WEATHER_ENABLED: "true", ARC_TRACK_WEATHER_MODE: "commercial", NODE_ENV: "production" }).exports.weatherProviderConfig(), null);
  assert.equal(providerHarness({ ARC_TRACK_WEATHER_ENABLED: "true", ARC_TRACK_WEATHER_MODE: "development", NODE_ENV: "development" }).exports.weatherProviderConfig().endpoint, "https://api.open-meteo.com/v1/forecast");
});

test("commercial provider request uses fixed host, approximate coordinates, explicit units and timeout", async () => {
  const h = providerHarness({ ARC_TRACK_WEATHER_ENABLED: "true", ARC_TRACK_WEATHER_MODE: "commercial", OPEN_METEO_API_KEY: "provider-test-key", NODE_ENV: "production" }, Response.json(observation()));
  const result = await h.exports.fetchCurrentWeather({ latitude: 1.35217, longitude: 103.81987 });
  assert.equal(result.temperatureC, 29); assert.deepEqual(h.timeouts, [8000]);
  const { url, options } = h.requests[0]; assert.equal(url.origin, "https://customer-api.open-meteo.com");
  assert.equal(url.searchParams.get("latitude"), "1.35"); assert.equal(url.searchParams.get("longitude"), "103.82");
  assert.equal(url.searchParams.get("wind_speed_unit"), "kmh"); assert.equal(url.searchParams.get("timeformat"), "unixtime");
  assert.equal(options.cache, "no-store"); assert.equal(options.redirect, "error");
  for (const key of ["userId", "sessionId", "email", "title"]) assert.equal(url.searchParams.has(key), false);
});

test("provider rejects HTTP errors, oversized responses, incorrect units and transport timeout", async () => {
  const env = { ARC_TRACK_WEATHER_ENABLED: "true", ARC_TRACK_WEATHER_MODE: "development", NODE_ENV: "development" };
  const wrongUnits = observation(); wrongUnits.current_units.wind_speed_10m = "m/s";
  for (const response of [new Response("unavailable", { status: 503 }), Response.json({ padding: "x".repeat(33 * 1024) }), Response.json(wrongUnits)]) {
    await assert.rejects(providerHarness(env, response).exports.fetchCurrentWeather({ latitude: 1, longitude: 103 }));
  }
  await assert.rejects(providerHarness(env, null, new DOMException("Timeout", "TimeoutError")).exports.fetchCurrentWeather({ latitude: 1, longitude: 103 }));
});
