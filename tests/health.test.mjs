import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
async function load(path, dependencies = {}, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function("require", "exports", ...Object.keys(globals), compiled)((name) => {
    if (name in dependencies) return dependencies[name];
    if (name === "server-only") return {};
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    if (name.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
    throw new Error(`Unexpected Health dependency: ${name}`);
  }, exports, ...Object.values(globals));
  return exports;
}
const model = await load("src/features/health/model.ts");
const healthMapping = await load("src/features/garmin/health/dashboard.ts", { "@/features/health/model": model });
const healthReadDependencies = {
  "@/features/garmin/health/config.server": { garminHealthEnabled: () => false },
  "@/features/garmin/health/read.server": { readGarminHealth: async () => ({ records: [], sync: null, unavailable: false }) },
  "@/features/garmin/health/dashboard": healthMapping,
};
const fixture = await load("src/features/health/demo.server.ts", { "./model": model });
const icon = await load("src/components/ui/icon.tsx");
const chart = await load("src/features/health/components/health-chart.tsx", { "../model": model });
const cards = await load("src/features/health/components/health-cards.tsx", {
  "../model": model, "@/components/ui/icon": icon,
  "next/link": { __esModule: true, default: (props) => React.createElement("a", props) },
});
const dashboardDeps = { "../model": model, "@/components/ui/icon": icon, "./health-cards": cards, "./health-chart": chart };
const { HealthDashboard } = await load("src/features/health/components/health-dashboard.tsx", dashboardDeps);
const connection = { available: false, canConnect: false, status: "disconnected", permissions: [], authorizedAt: null, checkedAt: "2026-10-23T02:00:00Z", expiresAt: null, error: null };
const empty = { kind: "empty", days: [], activities: [], lastSyncedAt: null };
const data = (dataset = empty, overrides = {}) => ({ dataset, connection: { ...connection, ...overrides }, today: "2026-10-23" });
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));

test("Health route verifies the signed-in owner before reading data, including demo", async () => {
  const calls = [];
  const page = await load("src/app/(platform)/health/page.tsx", {
    "@/lib/auth/session.server": { requireUser: async () => { calls.push("auth"); return { id: "owner-id" }; } },
    "next/headers": { headers: async () => ({ get: () => "localhost:3000" }) },
    "@/features/health/read.server": { readHealthDashboard: async (...args) => { calls.push(args); return data(); } },
    "@/features/health/components/health-dashboard": { HealthDashboard },
  });
  const html = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({ preview: "demo" }) }));
  assert.deepEqual(calls, ["auth", ["owner-id", "localhost:3000", "demo"]]);
  assert.match(html, /Health Overview/);
});

test("signed-out Health requests stop at the existing redirect boundary before status or fixture reads", async () => {
  let reads = 0;
  const page = await load("src/app/(platform)/health/page.tsx", {
    "@/lib/auth/session.server": { requireUser: async () => { throw new Error("NEXT_REDIRECT:/sign-in"); } },
    "next/headers": { headers: async () => { throw new Error("must not read"); } },
    "@/features/health/read.server": { readHealthDashboard: async () => { reads++; } },
    "@/features/health/components/health-dashboard": { HealthDashboard },
  });
  await assert.rejects(page.default({ searchParams: Promise.resolve({ preview: "demo" }) }), /NEXT_REDIRECT:\/sign-in/);
  assert.equal(reads, 0);
  const layout = await readFile(new URL("../src/app/(platform)/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /await requireUser\(\)/);
  const proxy = await readFile(new URL("../src/proxy.ts", import.meta.url), "utf8");
  assert.match(proxy, /"\/health\/:path\*"/);
});

test("Health navigation is signed-in only on desktop and mobile and marks the active route", async () => {
  const navigation = await load("src/components/layout/navigation.tsx", {
    "react": { ...React, useState: () => [false, () => {}], useEffect: () => {}, useRef: () => ({ current: null }) },
    "next/navigation": { usePathname: () => "/health" },
    "next/link": { __esModule: true, default: (props) => React.createElement("a", props) },
    "@/components/theme/theme-control": { ThemeSelector: () => null },
    "@/components/ui/icon": icon,
    "@/features/auth/components/sign-out-button": { SignOutButton: () => null },
  });
  const signedIn = render(navigation.Navigation, { authenticated: true });
  assert.equal((signedIn.match(/href="\/health"/g) ?? []).length, 2);
  assert.equal((signedIn.match(/aria-current="page"/g) ?? []).length, 2);
  assert.doesNotMatch(render(navigation.Navigation, { authenticated: false }), /href="\/health"/);
});

test("demo gate rejects production, remote hosts, missing and array parameters", () => {
  for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) assert.equal(model.canPreviewHealth("development", host, "demo"), true);
  for (const args of [["production", "localhost:3000", "demo"], ["development", "archery-website.vercel.app", "demo"], ["development", "localhost.evil.test", "demo"], ["development", "localhost", ["demo"]], ["development", "localhost", undefined]]) assert.equal(model.canPreviewHealth(...args), false);
});

test("normal reader reuses Garmin owner status and never returns fictional health records", async () => {
  const ids = [];
  const reader = await load("src/features/health/read.server.ts", {
    ...healthReadDependencies,
    "./model": model,
    "@/features/garmin/service.server": { readGarminStatus: async (id) => { ids.push(id); return connection; } },
  }, { process: { env: { NODE_ENV: "production" } } });
  const result = await reader.readHealthDashboard("owner-id", "localhost:3000", "demo");
  assert.deepEqual(ids, ["owner-id"]);
  assert.deepEqual(result.dataset, empty);
  assert.deepEqual(result.connection, connection);
});

test("explicit local preview reads only the fixed fixture, not a user account or provider", async () => {
  let statusReads = 0;
  const reader = await load("src/features/health/read.server.ts", {
    ...healthReadDependencies,
    "./model": model, "./demo.server": fixture,
    "@/features/garmin/service.server": { readGarminStatus: async () => { statusReads++; return connection; } },
  }, { process: { env: { NODE_ENV: "development" } } });
  const result = await reader.readHealthDashboard("owner-id", "localhost:3000", "demo");
  assert.equal(statusReads, 0);
  assert.deepEqual(result.dataset, fixture.createHealthDemo());
  assert.equal(result.dataset.lastSyncedAt, null);
  const source = await readFile(new URL("../src/features/health/demo.server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /supabase|fetch\(|\.insert\(|\.rpc\(/);
});

test("all four connection states are honest and do not treat an OAuth check as health synchronization", () => {
  for (const [overrides, expected] of [[{}, "New Garmin connections are currently unavailable"], [{ available: true, canConnect: true }, "Connect Garmin from Profile"], [{ status: "connected" }, "Health import is next"], [{ status: "reauthorization_required" }, "needs attention"]]) {
    const html = render(HealthDashboard, { data: data(empty, overrides) });
    assert.match(html, new RegExp(expected));
    assert.match(html, /No data available/);
    assert.doesNotMatch(html, /Last health sync:|7h 42m|8,432|Demo Data/);
    assert.match(html, /href="\/profile"/);
  }
});

test("future stored measurements expose only actual health freshness, not awaiting-import copy", () => {
  const stored = { ...fixture.createHealthDemo(), kind: "stored", lastSyncedAt: "2026-10-23T02:00:00Z", activities: [] };
  const html = render(HealthDashboard, { data: data(stored, { status: "connected" }) });
  assert.match(html, /Last health sync:/);
  assert.match(html, /Showing imported records/);
  assert.doesNotMatch(html, /Health import is next|health import is not yet active|Demo Data/);
});

test("sync status distinguishes waiting, failed import, permission revocation and reconciliation without changing the dashboard", () => {
  for (const [state, copy] of [["waiting", "Waiting for the first measurements"], ["error", "Health import needs attention"],
    ["permission_revoked", "Some Garmin sharing permissions are missing or were revoked"], ["reconciliation_required", "Imports are paused pending connection verification"]]) {
    const value = { ...data(empty, { status: "connected" }), sync: { state, lastReceivedAt: null, lastProcessedAt: null } };
    const html = render(HealthDashboard, { data: value });
    assert.ok(html.includes(copy), state);
    assert.match(html, /Your daily snapshot/);
    assert.doesNotMatch(html, /Last health sync:|Demo Data|7h 42m/);
  }
});

test("demo is deterministic, explicitly fictional and never displayed as Garmin-synced", () => {
  assert.deepEqual(fixture.createHealthDemo(), fixture.createHealthDemo());
  const html = render(HealthDashboard, { data: data(fixture.createHealthDemo()) });
  for (const text of ["Demo Data", "Fictional, local design preview", "7h 42m", "8,432", "Body Battery", "not your health records"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Last health sync:|Garmin connected|Recovery Score/);
});

test("date ranges are inclusive, do not mutate records and preserve missing-day gaps", () => {
  const days = fixture.createHealthDemo().days;
  const original = JSON.stringify(days);
  assert.equal(model.periodDays(days, "2026-10-23", 7).length, 7);
  assert.equal(model.periodDays(days, "2026-10-22", 7).at(-1).date, "2026-10-22");
  assert.equal(model.supportsRange(days, "2026-10-23", 30), true);
  assert.equal(model.supportsRange(days, "2026-10-23", 90), false);
  const gap = model.chartDays(days.filter((day) => day.date !== "2026-10-20"), "2026-10-23", 7);
  assert.equal(gap.length, 7);
  assert.equal(gap[3].restingHeartRate, null);
  assert.equal(model.supportsRange(days, "2026-10-10", 30), false);
  assert.equal(JSON.stringify(days), original);
});

test("averages exclude unknown measurements but preserve genuine zero values", () => {
  const base = fixture.createHealthDemo().days[0];
  assert.equal(model.average([{ ...base, stress: null }, { ...base, stress: 0 }, { ...base, stress: 30 }], "stress"), 15);
  assert.equal(model.average([{ ...base, stress: null }], "stress"), null);
  assert.equal(model.formatMetric("steps", 0), "0");
  assert.equal(model.formatMetric("sleepMinutes", 462), "7h 42m");
});

test("Singapore day matching handles UTC midnight boundaries independently of host timezone", () => {
  assert.equal(model.singaporeDate(new Date("2026-10-22T16:01:00Z")), "2026-10-23");
  assert.equal(model.singaporeDate(new Date("2026-10-22T15:59:00Z")), "2026-10-22");
  assert.equal(model.dateBefore("2026-03-01", 1), "2026-02-28");
});

test("activities filter and sort real source fields without mixing scoring Sessions", () => {
  const activities = fixture.createHealthDemo().activities;
  assert.equal(model.filterActivities(activities, "Walking", "newest", "2026-10-23").length, 2);
  assert.equal(model.filterActivities(activities, "all", "duration", "2026-10-23")[0].type, "Cycling");
  assert.equal(model.filterActivities(activities, "all", "oldest", "2026-10-23")[0].id, "demo-5");
  assert.equal(model.filterActivities(activities, "all", "newest", "2026-10-20").length, 2);
  assert.equal(model.filterActivities(activities, "Swimming", "newest", "2026-10-23").length, 0);
});

test("chart missing stages stay unavailable, zero values stay visible and keyboard points have labels", () => {
  const days = model.chartDays(fixture.createHealthDemo().days, "2026-10-23", 7);
  const html = render(chart.HealthChart, { days, metric: "sleepMinutes", label: "Sleep", tone: "lavender", stacked: true });
  assert.match(html, /19 October: 7h 50m, sleep stages unavailable/);
  assert.match(html, /stageUnknown/);
  const line = render(chart.HealthChart, { days: [{ ...days[0], stress: 0 }, { ...days[1], stress: null }], metric: "stress", label: "Stress", tone: "amber" });
  assert.match(line, /tabindex="0" role="button" aria-label="17 October: 0\/100"/);
  assert.equal((line.match(/class="point"/g) ?? []).length, 1);
});

test("Health tabs, date selection, trend range and activity controls render their selected state", async () => {
  for (const view of ["Overview", "Trends", "Activities"]) {
    let index = 0;
    const values = [view, "2026-10-23", 30, "Walking", "newest"];
    const component = await load("src/features/health/components/health-dashboard.tsx", { ...dashboardDeps, react: { ...React, useState: () => [values[index++], () => {}] } });
    const html = render(component.HealthDashboard, { data: data(fixture.createHealthDemo()) });
    assert.match(html, new RegExp(`aria-pressed="true">${view}`));
    if (view === "Trends") {
      assert.match(html, /disabled=""[^>]*>90 days/);
      assert.match(html, /aria-pressed="true"[^>]*>30 days/);
      assert.equal((html.match(/period average/g) ?? []).length, 5);
    }
    if (view === "Activities") {
      assert.match(html, /Walking/);
      assert.doesNotMatch(html, /<h3>Strength<\/h3>|<h3>Running<\/h3>/);
      assert.match(html, /HR unavailable/);
    }
  }
});

test("wellness summaries are descriptive and disclose missing data without medical inference", () => {
  assert.match(model.wellnessSummary([]), /Connecting Garmin alone does not import health data/);
  assert.match(model.wellnessSummary(fixture.createHealthDemo().days), /not a readiness or medical assessment/);
});

test("date change updates the selected day and resets unsupported trend ranges without changing records", async () => {
  let index = 0;
  const values = ["Trends", "2026-10-23", 30, "all", "newest"];
  const component = await load("src/features/health/components/health-dashboard.tsx", { ...dashboardDeps, react: { ...React, useState: () => {
    const slot = index++;
    return [values[slot], (value) => { values[slot] = value; }];
  } } });
  const dataset = fixture.createHealthDemo();
  const before = JSON.stringify(dataset);
  const element = component.HealthDashboard({ data: data(dataset) });
  function find(node, predicate) {
    if (!node || typeof node !== "object") return null;
    if (predicate(node)) return node;
    for (const child of React.Children.toArray(node.props?.children)) {
      const result = find(child, predicate);
      if (result) return result;
    }
    return null;
  }
  const input = find(element, (node) => node.type === "input");
  input.props.onChange({ target: { value: "2026-10-20" } });
  assert.equal(values[1], "2026-10-20");
  assert.equal(values[2], 7);
  input.props.onChange({ target: { value: "" } });
  assert.equal(values[1], "2026-10-20");
  assert.equal(JSON.stringify(dataset), before);
});

test("Health loading and safe error views render without health values or error details", async () => {
  const loading = await load("src/app/(platform)/health/loading.tsx");
  const error = await load("src/app/(platform)/health/error.tsx");
  assert.match(render(loading.default, {}), /aria-busy="true" role="status"/);
  const html = render(error.default, { reset: () => {} });
  assert.match(html, /role="alert"/);
  assert.match(html, /Try again/);
  assert.doesNotMatch(html, /7h 42m|token|exception|stack/);
});

test("responsive Health surface, missing-stage styling and reduced-motion support stay scoped to Health", async () => {
  const css = await readFile(new URL("../src/features/health/components/health.module.css", import.meta.url), "utf8");
  assert.match(css, /color-scheme: light/);
  assert.match(css, /repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css, /max-width: 800px/);
  assert.match(css, /max-width: 540px/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /repeating-linear-gradient/);
  assert.doesNotMatch(css, /body\s*\{/);
  for (const selector of css.matchAll(/([^{}]+)\{/g)) {
    if (selector[1].includes(":global")) {
      assert.match(selector[1], /:global\(:root\[data-theme="(?:dark|system)"\]\) \.dashboard\s*$/);
    }
  }
});
