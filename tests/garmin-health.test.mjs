import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
async function load(path, dependencies = {}, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("require", "exports", ...Object.keys(globals), code)((name) => {
    if (name in dependencies) return dependencies[name];
    if (name === "server-only") return {};
    if (name.startsWith("node:")) return require(name);
    throw new Error(`Unexpected Garmin health dependency: ${name}`);
  }, exports, ...Object.values(globals));
  return exports;
}
const model = await load("src/features/health/model.ts");
const { normalizeGarminPush, GarminHealthPayloadError } = await load("src/features/garmin/health/normalize.server.ts", { "@/features/health/model": model });
const { garminHealthDataset } = await load("src/features/garmin/health/dashboard.ts", { "@/features/health/model": model });
const http = await load("src/features/garmin/health/http.server.ts", {
  "next/server": { after: () => { throw new Error("Must not schedule production work"); } },
  "./config.server": { garminHealthEnabled: () => true, garminHealthTestUsers: () => ["owner-id"] },
  "./normalize.server": { normalizeGarminPush, GarminHealthPayloadError },
  "../service.server": { configuredGarminService: () => null },
  "./store.server": { createGarminHealthInbox: () => { throw new Error("Must not access production storage"); } },
});

// Fictional identifiers and measurements using the actual field names/types from
// Garmin Health API 2.0 §§4/6 and Activity API 2.0 §§4/6. Not captured deliveries.
const daily = (overrides = {}) => ({ userId: "synthetic-provider", summaryId: "synthetic-daily", calendarDate: "2026-10-23",
  startTimeInSeconds: 1792713600, startTimeOffsetInSeconds: 28800, durationInSeconds: 86400,
  steps: 450, restingHeartRateInBeatsPerMinute: 54, averageStressLevel: -1, activeTimeInSeconds: 3600, ...overrides });
const request = (value, headers = {}) => new Request("https://arc.example/api/integrations/garmin/health/push", {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(value),
});
function receiver(overrides = {}) {
  const calls = [], scheduled = [];
  const inbox = { stage: async (...args) => { calls.push(["stage", ...args]); }, process: async (...args) => { calls.push(["process", ...args]); return 1; } };
  const handle = http.createGarminPushReceiver({ enabled: true, verifier: async () => { calls.push(["verify"]); return true; },
    inbox: () => inbox, schedule: (work) => scheduled.push(work), ...overrides });
  return { handle, calls, scheduled, inbox };
}

test("documented daily units and sentinel values normalize without invented measurements", () => {
  const [event] = normalizeGarminPush({ dailies: [daily({ bodyBatteryChargedValue: 32, bodyBatteryDrainedValue: 27, startingLatitudeInDegree: 1.23 })] });
  assert.equal(event.garminUserId, "synthetic-provider");
  assert.deepEqual(event.values, { restingHeartRate: 54, steps: 450, stress: null, activeSeconds: 3600 });
  assert.equal(event.calendarDate, "2026-10-23");
  assert.match(event.hash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(event), /Latitude|Charged|Drained/);
});

test("missing metrics remain null and legitimate zero steps/active duration are preserved", () => {
  const [event] = normalizeGarminPush({ dailies: [daily({ steps: 0, activeTimeInSeconds: 0, restingHeartRateInBeatsPerMinute: undefined })] });
  assert.equal(event.values.steps, 0);
  assert.equal(event.values.activeSeconds, 0);
  assert.equal(event.values.restingHeartRate, null);
});

test("sleep duration and known stages retain original seconds and missing REM stays missing", () => {
  const base = daily({ durationInSeconds: 27000, deepSleepDurationInSeconds: 5000, lightSleepDurationInSeconds: 22000, awakeDurationInSeconds: 600 });
  const [event] = normalizeGarminPush({ sleeps: [base] });
  assert.deepEqual(event.values, { sleepSeconds: 27000, lightSeconds: 22000, deepSeconds: 5000, remSeconds: null, awakeSeconds: 600 });
});

test("Body Battery uses the latest actual sample, never daily charged/drained values", () => {
  const [event] = normalizeGarminPush({ stressDetails: [daily({ durationInSeconds: 540, timeOffsetBodyBatteryValues: { 360: 59, 0: 55, 180: 56 } })] });
  assert.equal(event.values.bodyBattery, 59);
  assert.equal(event.values.bodyBatteryTime, daily().startTimeInSeconds + 360);
  assert.equal(normalizeGarminPush({ stressDetails: [daily({ timeOffsetBodyBatteryValues: undefined })] })[0].values.bodyBattery, null);
});

test("activity IDs accept both documented strings and numeric JSON examples without losing precision", () => {
  for (const activityId of [5001968355, "5001968355"]) {
    const [event] = normalizeGarminPush({ activities: [daily({ activityId, activityType: "TRAIL_RUNNING", distanceInMeters: 5200.5, averageHeartRateInBeatsPerMinute: 142 })] });
    assert.equal(event.recordKey, "5001968355");
    assert.equal(event.values.distanceMeters, 5200.5);
  }
  assert.throws(() => normalizeGarminPush({ activities: [daily({ activityId: Number.MAX_SAFE_INTEGER + 1, activityType: "RUNNING" })] }), GarminHealthPayloadError);
});

test("manually updated activity shares the same normalized identity and hash when its values are identical", () => {
  const activity = daily({ activityId: "activity-one", activityType: "RUNNING" });
  assert.deepEqual(normalizeGarminPush({ activities: [activity] }), normalizeGarminPush({ manuallyUpdatedActivities: [activity] }));
});

test("invalid timestamps, calendar dates, units, values and unsupported event types are rejected", () => {
  for (const change of [{ startTimeInSeconds: 1792713600000 }, { startTimeInSeconds: "1792713600" }, { calendarDate: "2026-02-30" },
    { calendarDate: "2026-99-99" }, { durationInSeconds: -1 }, { steps: -1 }, { steps: 1.5 }, { activeTimeInSeconds: 90000 },
    { averageStressLevel: -2 }, { restingHeartRateInBeatsPerMinute: 600 }, { startTimeOffsetInSeconds: 999999 }]) {
    assert.throws(() => normalizeGarminPush({ dailies: [daily(change)] }), GarminHealthPayloadError);
  }
  for (const body of [{}, { epochs: [daily()] }, { dailies: "wrong" }, { dailies: [] }, { dailies: Array.from({ length: 101 }, () => daily()) }]) assert.throws(() => normalizeGarminPush(body), GarminHealthPayloadError);
  assert.throws(() => normalizeGarminPush({ stressDetails: [daily({ timeOffsetBodyBatteryValues: { 90000: 55 } })] }), GarminHealthPayloadError);
});

test("permission and deregistration notification schemas use only documented fields", () => {
  const [permissions, deregistration] = normalizeGarminPush({ userPermissionsChange: [{ userId: "synthetic-provider", summaryId: "permission-one", permissions: ["HEALTH_EXPORT", "ACTIVITY_EXPORT", "HEALTH_EXPORT"], changeTimeInSeconds: 1792800000 }], deregistrations: [{ userId: "synthetic-provider" }] });
  assert.deepEqual(permissions.permissions, ["ACTIVITY_EXPORT", "HEALTH_EXPORT"]);
  assert.equal(permissions.changeTimeInSeconds, 1792800000);
  assert.equal(deregistration.startTimeInSeconds, null);
});

test("valid mocked verification stages durably before HTTP 200 and processes only after response scheduling", async () => {
  const { handle, calls, scheduled } = receiver();
  const result = await handle(request({ dailies: [daily()] }));
  assert.equal(result.status, 200);
  assert.deepEqual(calls.map((call) => call[0]), ["verify", "stage"]);
  assert.equal(calls[1].length, 2); // Events only; account eligibility is database-owned.
  assert.equal(scheduled.length, 1);
  await scheduled[0]();
  assert.equal(calls.at(-1)[0], "process");
  assert.match(result.headers.get("cache-control"), /no-store/);
  assert.equal(await result.text(), "");
});

test("unverified or disabled receivers fail closed before any persistence", async () => {
  for (const options of [{ enabled: false }, { verifier: null }]) {
    const { handle, calls } = receiver(options);
    assert.equal((await handle(request({ dailies: [daily()] }))).status, 503);
    assert.equal(calls.length, 0);
  }
  const denied = receiver({ verifier: async () => false });
  assert.equal((await denied.handle(request({ dailies: [daily()] }))).status, 401);
  assert.equal(denied.calls.length, 0);
});

test("actual configured endpoints cannot be activated without a reviewed provider verifier", async () => {
  assert.equal(http.configuredGarminNotificationVerifier(), null);
  assert.equal((await http.garminHealthPush(request({ dailies: [daily()] }))).status, 503);
  assert.equal((await http.garminHealthWorker(new Request("https://arc.example/api/internal/garmin-health/process"))).status, 503);
});

test("bounded body handling rejects oversized content-length and streamed bodies without staging", async () => {
  const a = receiver();
  assert.equal((await a.handle(request({}, { "Content-Length": "1048577" }))).status, 413);
  const b = receiver();
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(600000)); }, cancel() { cancelled = true; } });
  assert.equal((await b.handle(new Request("https://arc.example/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream, duplex: "half" }))).status, 413);
  assert.equal(cancelled, true);
  assert.equal(b.calls.length, 0);
});

test("invalid JSON, UTF-8, content types and unsupported payloads are rejected safely", async () => {
  for (const req of [request({}, { "Content-Type": "text/plain" }), request({}, { "Content-Encoding": "gzip" }),
    new Request("https://arc.example/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }),
    new Request("https://arc.example/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: new Uint8Array([255]) }), request({ epochs: [daily()] })]) {
    const { handle, calls } = receiver();
    assert.ok([400, 415].includes((await handle(req)).status));
    assert.equal(calls.filter((call) => call[0] === "stage").length, 0);
  }
});

test("database failure cannot be acknowledged as success or leak payloads", async () => {
  const { handle, scheduled } = receiver({ inbox: () => ({ stage: async () => { throw new Error("private-provider-data"); } }) });
  const response = await handle(request({ dailies: [daily()] }));
  assert.equal(response.status, 503);
  assert.equal(await response.text(), "");
  assert.equal(scheduled.length, 0);
});

test("receipt response cannot resolve before the database confirms staging", async () => {
  let release;
  const gate = new Promise((accept) => { release = accept; });
  const { handle } = receiver({ inbox: () => ({ stage: () => gate, process: async () => 1 }) });
  let resolved = false;
  const result = handle(request({ dailies: [daily()] })).then((response) => { resolved = true; return response; });
  await new Promise((accept) => setImmediate(accept));
  assert.equal(resolved, false);
  release();
  assert.equal((await result).status, 200);
});

test("Supabase returned error properties fail staging/processing without disclosing server details", async () => {
  for (const error of [null, { code: "private-detail" }]) {
    const calls = [];
    const store = await load("src/features/garmin/health/store.server.ts", {
      "@/lib/supabase/admin.server": { createAdminClient: () => ({ rpc: async (...args) => { calls.push(args); return { data: 1, error }; } }) },
    });
    const inbox = store.createGarminHealthInbox();
    const events = normalizeGarminPush({ dailies: [daily()] });
    if (error) {
      await assert.rejects(inbox.stage(events), { message: "Garmin health storage unavailable." });
      await assert.rejects(inbox.process(25), { message: "Garmin health processing unavailable." });
    } else {
      await inbox.stage(events);
      assert.equal(await inbox.process(25), 1);
      assert.deepEqual(calls[0], ["stage_garmin_health_push", { p_events: events }]);
    }
  }
});

test("scheduling or asynchronous processing failure retains successful durable receipt", async () => {
  const a = receiver({ schedule: () => { throw new Error("scheduler unavailable"); } });
  assert.equal((await a.handle(request({ dailies: [daily()] }))).status, 200);
  const b = receiver();
  b.inbox.process = async () => { throw new Error("temporary database failure"); };
  assert.equal((await b.handle(request({ dailies: [daily()] }))).status, 200);
  await assert.doesNotReject(b.scheduled[0]());
});

test("worker requires its own server credential and never uses a browser session", async () => {
  const calls = [];
  const secret = "x".repeat(40);
  const worker = http.createGarminHealthWorker({ enabled: true, verifierReady: true, secret, inbox: () => ({ process: async (...args) => { calls.push(args); return 1; } }) });
  for (const authorization of [undefined, "Bearer wrong", `Bearer ${"y".repeat(40)}`]) {
    const headers = authorization ? { authorization } : {};
    assert.equal((await worker(new Request("https://arc.example/worker", { headers }))).status, 401);
  }
  assert.equal(calls.length, 0);
  assert.equal((await worker(new Request("https://arc.example/worker", { headers: { authorization: `Bearer ${secret}` } }))).status, 200);
  assert.deepEqual(calls, [[50]]);
});

test("worker processing failures are observable as non-success without leaking private details", async () => {
  const secret = "x".repeat(40);
  const worker = http.createGarminHealthWorker({ enabled: true, verifierReady: true, secret, users: ["approved"],
    inbox: () => ({ process: async () => { throw new Error("private synthetic health data or database detail"); } }) });
  const result = await worker(new Request("https://arc.example/worker", { headers: { authorization: `Bearer ${secret}` } }));
  assert.equal(result.status, 503);
  assert.equal(await result.text(), "");
  assert.match(result.headers.get("Cache-Control"), /no-store/);
});

test("scheduled refresh is authenticated first and finishes before bounded processing", async () => {
  const calls = [], secret = "x".repeat(40);
  const worker = http.createGarminHealthWorker({ enabled: true, verifierReady: true, secret,
    refresh: async () => { calls.push("refresh"); }, inbox: () => ({ process: async limit => { calls.push(limit); return 0; } }) });
  assert.equal((await worker(new Request("https://arc.example/worker"))).status, 401);
  assert.deepEqual(calls, []);
  assert.equal((await worker(new Request("https://arc.example/worker", { headers: { authorization: `Bearer ${secret}` } }))).status, 200);
  assert.deepEqual(calls, ["refresh", 50]);
});

test("refresh maintenance selects a bounded database-owned set and isolates provider failures", async () => {
  const calls = [], refreshed = [];
  const store = await load("src/features/garmin/health/store.server.ts", {
    "@/lib/supabase/admin.server": { createAdminClient: () => ({ rpc: async (...args) => { calls.push(args); return { data: ["owner-one", "owner-two"], error: null }; } }) },
  });
  await store.createGarminHealthInbox().refreshDue(async user => { refreshed.push(user); if (user === "owner-one") throw Error("provider unavailable"); });
  assert.deepEqual(calls, [["garmin_health_refresh_candidates", { p_limit: 3 }]]);
  assert.deepEqual(refreshed, ["owner-one", "owner-two"]);
});

test("public OAuth and even an accidental Health flag cannot bypass missing Health security readiness", async () => {
  const config = await load("src/features/garmin/health/config.server.ts", {}, { process: { env: {
    GARMIN_CONNECT_ENABLED: "true", GARMIN_HEALTH_ENABLED: "true", GARMIN_TEST_USER_IDS: "approved,other",
  } } });
  assert.equal(config.garminHealthEnabled(), false);
  assert.equal(config.garminHealthTestUsers, undefined);
  assert.equal(http.configuredGarminNotificationVerifier(), null);
});

function record(kind, metrics, overrides = {}) {
  return { kind, source_id: kind, record_key: kind, calendar_date: "2026-10-23", start_seconds: 1792713600, duration_seconds: 86400,
    metrics, imported_at: "2026-10-23T01:00:00Z", updated_at: "2026-10-23T02:00:00Z", ...overrides };
}

test("documented synthetic summaries map every dashboard metric and retain historical days", () => {
  const events = normalizeGarminPush({
    dailies: [daily({ steps: 8432, restingHeartRateInBeatsPerMinute: 54, averageStressLevel: 28, activeTimeInSeconds: 3600 }),
      daily({ summaryId: "prior-day", calendarDate: "2026-10-22", startTimeInSeconds: 1792627200, steps: 500 })],
    sleeps: [daily({ durationInSeconds: 27000, lightSleepDurationInSeconds: 18000, deepSleepDurationInSeconds: 4500, remSleepInSeconds: 4500, awakeDurationInSeconds: 600 })],
    stressDetails: [daily({ timeOffsetBodyBatteryValues: { 60: 65, 540: 78 } })],
    activities: [daily({ activityId: "activity-one", activityType: "RUNNING", durationInSeconds: 1800, distanceInMeters: 5200, averageHeartRateInBeatsPerMinute: 142 })],
  });
  const rows = events.map((event) => record(event.kind, event.values, {
    source_id: event.sourceId, record_key: event.recordKey, calendar_date: event.calendarDate,
    start_seconds: event.startTimeInSeconds, duration_seconds: event.durationInSeconds,
  }));
  const dataset = garminHealthDataset(rows, "2026-10-23T03:00:00Z");
  assert.equal(dataset.kind, "stored");
  assert.deepEqual(dataset.days.map((day) => day.date), ["2026-10-22", "2026-10-23"]);
  assert.equal(dataset.days[0].steps, 500);
  assert.equal(dataset.days[0].sleepMinutes, null);
  const today = dataset.days[1];
  assert.deepEqual([today.sleepMinutes, today.restingHeartRate, today.stress, today.steps, today.bodyBattery, today.activityMinutes],
    [450, 54, 28, 8432, 78, 60]);
  assert.deepEqual(today.sleepStages, { light: 300, deep: 75, rem: 75, awake: 10 });
  assert.deepEqual(dataset.activities.map((activity) => [activity.type, activity.durationMinutes, activity.distanceKm, activity.averageHeartRate]),
    [["Running", 30, 5.2, 142]]);
  assert.equal(dataset.lastSyncedAt, "2026-10-23T03:00:00Z");
});

test("dashboard conversion preserves seconds/metres meaning, nulls and distinct Garmin activities", () => {
  const dataset = garminHealthDataset([
    record("dailies", { steps: 450, restingHeartRate: 54, stress: null, activeSeconds: 3600 }),
    record("sleeps", { sleepSeconds: 27000, lightSeconds: 18000, deepSeconds: 4500, remSeconds: 4500, awakeSeconds: 600 }),
    record("stressDetails", { bodyBattery: 78, bodyBatteryTime: 1792714140 }),
    record("activities", { activityType: "TRAIL_RUNNING", distanceMeters: 5200, averageHeartRate: 142 }, { duration_seconds: 1800 }),
  ], "2026-10-23T03:00:00Z");
  assert.equal(dataset.kind, "stored");
  assert.equal(dataset.days[0].sleepMinutes, 450);
  assert.deepEqual(dataset.days[0].sleepStages, { light: 300, deep: 75, rem: 75, awake: 10 });
  assert.equal(dataset.days[0].activityMinutes, 60); // Not 60 + workout 30.
  assert.equal(dataset.days[0].stress, null);
  assert.equal(dataset.activities[0].distanceKm, 5.2);
  assert.equal(dataset.activities[0].durationMinutes, 30);
  assert.equal(dataset.activities[0].type, "Trail Running");
  assert.equal(dataset.activities[0].source, "garmin");
  assert.equal(dataset.lastSyncedAt, "2026-10-23T03:00:00Z");
});

test("missing sleep stages are not zero or stretched over unknown sleep time", () => {
  for (const metrics of [{ sleepSeconds: 27000, lightSeconds: 20000, deepSeconds: 5000, remSeconds: null, awakeSeconds: 0 },
    { sleepSeconds: 27000, lightSeconds: 20000, deepSeconds: 5000, remSeconds: 1000, awakeSeconds: 0 }]) {
    assert.equal(garminHealthDataset([record("sleeps", metrics)], null).days[0].sleepStages, null);
  }
});

test("daily overlaps are not summed and newer receipt cannot replace a later Body Battery sample", () => {
  const rows = [record("dailies", { steps: 500 }, { duration_seconds: 86400 }), record("dailies", { steps: 300 }, { duration_seconds: 40000 }),
    record("stressDetails", { bodyBattery: 80, bodyBatteryTime: 1792714200 }),
    record("stressDetails", { bodyBattery: 60, bodyBatteryTime: 1792714000 }, { updated_at: "2026-10-23T03:00:00Z" })];
  const [day] = garminHealthDataset(rows, null).days;
  assert.equal(day.steps, 500);
  assert.equal(day.bodyBattery, 80);
});

test("empty real data never substitutes demo fixtures or an OAuth timestamp", () => {
  assert.deepEqual(garminHealthDataset([], "2026-10-23T03:00:00Z"), { kind: "empty", days: [], activities: [], lastSyncedAt: null });
});

test("activity calendar mapping uses the same Singapore day as the dashboard", () => {
  const [event] = normalizeGarminPush({ activities: [daily({ startTimeInSeconds: Date.parse("2026-10-22T17:00:00Z") / 1000, activityType: "RUNNING" })] });
  assert.equal(event.calendarDate, "2026-10-23");
});

test("owner reader uses one authenticated RLS snapshot with an explicit owner and bounded window", async () => {
  const calls = [];
  const control = { generation: "test-generation", paused: false };
  const reader = await load("src/features/garmin/health/read.server.ts", {
    "@/lib/supabase/server": { createAuthClient: async () => ({ rpc: async (...args) => { calls.push(args); return { data: { records: [], sync: null, control }, error: null }; } }) },
    "@/features/health/model": model, "./config.server": { garminHealthEnabled: () => true },
  });
  assert.deepEqual(await reader.readGarminHealth("verified-owner", "2026-10-23"), { records: [], sync: null, control, unavailable: false });
  assert.deepEqual(calls, [["read_garmin_health_dashboard", { p_user_id: "verified-owner", p_start: "2026-07-26", p_end: "2026-10-23" }]]);
});

test("reader feature-off performs no database query; storage failure returns unavailable without demo", async () => {
  for (const enabled of [false, true]) {
    let calls = 0;
    const reader = await load("src/features/garmin/health/read.server.ts", {
      "@/lib/supabase/server": { createAuthClient: async () => { calls++; throw new Error("private-detail"); } },
      "@/features/health/model": model, "./config.server": { garminHealthEnabled: () => enabled },
    });
    assert.deepEqual(await reader.readGarminHealth("owner", "2026-10-23"), { records: [], sync: null, control: null, unavailable: enabled });
    assert.equal(calls, enabled ? 1 : 0);
  }
});
