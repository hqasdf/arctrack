import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as analytics from "../packages/core/src/coach-analytics-model.ts";
import * as dates from "../packages/core/src/date.ts";
import * as coach from "../src/features/organizations/coach-model.ts";

const require = createRequire(import.meta.url);
const source = await readFile(new URL("../src/features/organizations/components/coach-dashboard.tsx", import.meta.url), "utf8");
const script = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
function render(props) {
  const charts = [], reads = [];
  const chart = kind => function ChartStub(chartProps) { charts.push({ kind, ...chartProps }); return createElement("figure", { "data-chart": kind, "aria-label": chartProps.yLabel }); };
  const mocks = name => {
    if (name === "next/link") return { __esModule: true, default: ({ href, children, ...rest }) => createElement("a", { ...rest, href }, children) };
    if (name === "@arc-track/core/coach-analytics") return { ...analytics, buildCoachTeamAnalytics: (...args) => { reads.push(args); return analytics.buildCoachTeamAnalytics(...args); } };
    if (name === "@arc-track/core/dates") return dates;
    if (name === "../coach-model") return coach;
    if (name === "./coach-charts") return { CoachLineChart: chart("line"), VerticalBarChart: chart("bar") };
    if (name.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, property) => property }) };
    return require(name);
  };
  const loaded = { exports: {} };
  new Function("module", "exports", "require", script)(loaded, loaded.exports, mocks);
  const html = renderToStaticMarkup(createElement(loaded.exports.CoachDashboard, props));
  return { html, charts, reads };
}
const athletes = ["a", "b", "c"].map((userId, index) => ({ userId, displayName: `Archer ${index + 1}`, joinedAt: "2026-09-01" }));
function session(id, userId, date, arrowCount, sessionType, scores) {
  return { id, userId, date, arrowCount, sessionType, title: `Session ${id}`, rounds: [{
    id: `round-${id}`, roundNumber: 1, name: "70m", division: "Recurve", distanceMetres: 70,
    ends: 1, arrowsPerEnd: scores.length, faceDiameterCm: 122, faceType: "full_face",
    arrows: scores.map((score, index) => ({ id: `${id}-${index}`, end: 1, arrow: index + 1, score, plot: null })),
  }] };
}
const sessions = [session("recent-a", "a", "2026-10-14", 200, "training", ["X", "10", "9", "M"]),
  session("recent-b", "b", "2026-10-13", 72, "competition", ["8", "7"]),
  session("old-a", "a", "2026-08-01", 1000, "training", ["1"])];
const props = { organization: { id: "org", name: "Test club" }, athletes, sessions, today: "2026-10-15", period: "30" };
function section(html, label) {
  const marker = `aria-label="${label}"`;
  const start = html.indexOf(marker);
  assert.ok(start >= 0, `Missing ${label}`);
  return html.slice(start, html.indexOf("</section>", start)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

test("Coach Overview retains score, 10+X, activity context and separate keyed/scored Arrow counts", () => {
  const { html, reads } = render(props);
  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0][0], athletes.map(athlete => ({ userId: athlete.userId, name: coach.athleteName(athlete) })));
  assert.equal(reads[0][1], sessions);
  assert.equal(reads[0][2].period, "30");
  const headline = section(html, "Team scoring headline");
  assert.match(headline, /Average score \/ Arrow 7\.33/);
  assert.match(headline, /10\+X rate 33\.3%/);
  assert.match(headline, /Active this period 2 of 3 active Archers/);
  const summary = section(html, "Organisation summary");
  assert.match(summary, /2 Sessions/);
  assert.match(summary, /272 Total Session Arrows/);
  assert.match(summary, /6 Scored Arrows/);
  assert.match(html, /16\.7%/);
  assert.match(html, /1 Training.*1 Competition Sessions/);
});

test("Overview keeps all sections, read-only review destinations and recent athlete/Session links", () => {
  const { html } = render(props);
  for (const heading of ["Team performance", "Team Performance", "Suggested Reviews", "On target", "Arrow Volume", "Score Distribution", "Athlete Spotlight", "Recent Sessions"]) assert.ok(html.includes(heading), heading);
  for (const path of ["/organization/org/analytics", "/organization/org/reviews", "/organization/org/athletes", "/organization/org/athletes/a", "/organization/org/athletes/b", "/organization/org/athletes/a/sessions/recent-a", "/organization/org/athletes/b/sessions/recent-b"]) assert.ok(html.includes(`href="${path}"`), path);
  assert.match(html, /Review status is not stored/);
  assert.match(html, /Review Session/);
  assert.doesNotMatch(html, /<form|Mark reviewed|Delete Session|Edit Session/);
});

test("all period choices and chart data, units and tooltip content remain unchanged", () => {
  for (const period of ["7", "30", "90", "all"]) {
    const { html, charts, reads } = render({ ...props, period });
    assert.equal(reads[0][2].period, period);
    for (const href of ["/organization/org?period=7", "/organization/org", "/organization/org?period=90", "/organization/org?period=all"]) assert.ok(html.includes(`href="${href}"`));
    const expected = analytics.buildCoachTeamAnalytics(athletes.map(athlete => ({ userId: athlete.userId, name: coach.athleteName(athlete) })), sessions, { ...analytics.DEFAULT_COACH_FILTERS, period }, props.today);
    assert.deepEqual(charts.find(chart => chart.kind === "line").points, expected.series.filter(point => point.scoreAverage !== null).map(point => ({ label: point.label, value: point.scoreAverage, tooltip: `${point.label}: ${point.scoreAverage?.toFixed(2)} avg/Arrow \u00b7 ${point.scoredArrowCount} scored Arrows` })));
    assert.deepEqual(charts.find(chart => chart.yLabel === "Arrows").points, expected.series.filter(point => point.arrowCount).map(point => ({ label: point.label, value: point.arrowCount, tooltip: `${point.label}: ${point.arrowCount} Session Arrows \u00b7 ${point.sessionCount} Sessions` })));
    assert.deepEqual(charts.find(chart => chart.yLabel === "Scored Arrows").points, expected.distribution.map(item => ({ label: item.score, value: item.count, tooltip: `${item.score}: ${item.count} scored Arrows \u00b7 ${item.percentage.toFixed(1)}%` })));
  }
});

test("empty scoring retains every empty state, known activity counts and unavailable averages", () => {
  const { html, charts } = render({ ...props, sessions: [] });
  assert.equal(charts.length, 0);
  assert.match(section(html, "Team scoring headline"), /Average score \/ Arrow \u2014/);
  assert.match(section(html, "Team scoring headline"), /10\+X rate \u2014/);
  assert.match(section(html, "Team scoring headline"), /Active this period 0 of 3 active Archers/);
  for (const message of ["No scored Arrows in this period.", "No Session Arrow Volume in this period.", "No Sessions suggested for review.", "No athlete Sessions in this period."]) assert.ok(html.includes(message));
  assert.doesNotMatch(html, /NaN|Infinity/);
});
