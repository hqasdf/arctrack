import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCoachAthleteInsights, buildCoachTeamAnalytics, DEFAULT_COACH_FILTERS } from "@arc-track/core/coach-analytics";
import { summarizeCoachRound } from "@arc-track/core/coach-round";
import { coachSessionNeighbors, filterCoachDirectory } from "../src/coach-mobile-model.ts";
import ts from "typescript";

function coachNavRuntime(current = "overview") {
  const source = readFileSync(new URL("../src/coach-ui.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("coach-ui.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === "CoachNav");
  assert.ok(declaration);
  const compiled = ts.transpileModule(declaration.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const hooks = [], pushes = [];
  let cursor = 0;
  const useState = initial => {
    const slot = cursor++;
    if (!(slot in hooks)) hooks[slot] = initial;
    return [hooks[slot], next => { hooks[slot] = typeof next === "function" ? next(hooks[slot]) : next; }];
  };
  const useRef = initial => { const slot = cursor++; return hooks[slot] ?? (hooks[slot] = { current: initial }); };
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  const names = ["useAuth", "useState", "useRef", "useFocusEffect", "useCallback", "readOwnOrganizations", "router", "coachStyles", "coachPalette", "View", "Text", "ScrollView", "Pressable", "Svg", "Polyline"];
  const values = [() => ({ user: null }), useState, useRef, () => {}, fn => fn, async () => [], { push: value => pushes.push(value), replace() {} }, {}, {}, "View", "Text", "ScrollView", "Pressable", "Svg", "Polyline"];
  new Function("require", "exports", ...names, compiled)(() => ({ jsx, jsxs: jsx }), exports, ...values);
  function render() {
    cursor = 0;
    const nodes = [];
    function visit(node) { if (Array.isArray(node)) node.forEach(visit); else if (node?.props) { nodes.push(node); visit(node.props.children); } }
    visit(exports.CoachNav({ organizationId: "test-org", current }));
    return {
      scroll: nodes.find(node => node.type === "ScrollView"),
      edges: nodes.filter(node => node.props.pointerEvents === "none"),
      tabs: nodes.filter(node => node.type === "Pressable" && node.props.accessibilityState?.selected !== undefined),
    };
  }
  return { render, pushes };
}

test("Coach nav cues follow actual scroll availability and update when orientation or content width changes", () => {
  const runtime = coachNavRuntime();
  let view = runtime.render();
  assert.equal(view.edges.length, 0);
  assert.equal(view.scroll.props.horizontal, true);
  view.scroll.props.onLayout({ nativeEvent: { layout: { width: 320 } } });
  view.scroll.props.onContentSizeChange(620);
  view = runtime.render();
  assert.deepEqual(view.edges.map(edge => edge.props.style[1]), [{ right: 0 }]);
  view.scroll.props.onScroll({ nativeEvent: { contentOffset: { x: 150 } } });
  view = runtime.render();
  assert.deepEqual(view.edges.map(edge => edge.props.style[1]), [{ left: 0 }, { right: 0 }]);
  view.scroll.props.onScroll({ nativeEvent: { contentOffset: { x: 300 } } });
  view = runtime.render();
  assert.deepEqual(view.edges.map(edge => edge.props.style[1]), [{ left: 0 }]);
  assert.ok(view.edges.every(edge => edge.props.pointerEvents === "none" && edge.props.accessible === false));
  view.scroll.props.onLayout({ nativeEvent: { layout: { width: 800 } } });
  view = runtime.render();
  assert.equal(view.edges.length, 0);
  view.scroll.props.onLayout({ nativeEvent: { layout: { width: 390 } } });
  view = runtime.render();
  assert.deepEqual(view.edges.map(edge => edge.props.style[1]), [{ right: 0 }]);
  view.scroll.props.onContentSizeChange(350);
  assert.equal(runtime.render().edges.length, 0);
});

test("Coach nav keeps all six tab destinations, organisation parameters, and active styling", () => {
  const runtime = coachNavRuntime("reviews"), view = runtime.render();
  assert.equal(view.tabs.length, 6);
  assert.deepEqual(view.tabs.map(tab => tab.props.accessibilityState.selected), [false, false, true, false, false, false]);
  view.tabs.forEach(tab => tab.props.onPress());
  assert.deepEqual(runtime.pushes.map(item => item.pathname), [
    "/organization/[organizationId]", "/organization/[organizationId]/athletes",
    "/organization/[organizationId]/training-plans", "/organization/[organizationId]/analytics", "/organization/[organizationId]/settings",
  ]);
  assert.ok(runtime.pushes.every(item => item.params.organizationId === "test-org"));
});

const arrow = (id, end, arrowNumber, score, x = 0, y = 0) => ({ id, end, arrow: arrowNumber, score, plot: { x, y } });
const round = (id, score = "10") => ({ id, roundNumber: 1, name: "70 m", division: "Recurve", distanceMetres: 70, ends: 1, arrowsPerEnd: 2, faceDiameterCm: 122, faceType: "full_face",
  arrows: [arrow(id + "1",1,1,score), arrow(id + "2",1,2,"9",.1,0)] });
const athletes = [{ userId: "a", name: "Han" }, { userId: "b", name: "Mei" }];
const sessions = [
  { id: "s2", userId: "a", title: "Practice", date: "2026-09-26", sessionType: "training", arrowCount: 200, rounds: [round("r1")] },
  { id: "s1", userId: "a", title: "Open", date: "2026-09-20", sessionType: "competition", arrowCount: 72, rounds: [round("r2","X")] },
  { id: "s3", userId: "b", title: "Practice", date: "2026-09-25", sessionType: "training", arrowCount: 36, rounds: [] },
  { id: "outside", userId: "not-rostered", title: "Private", date: "2026-09-26", sessionType: "training", arrowCount: 500, rounds: [round("r3")] },
];
const view = (filters = DEFAULT_COACH_FILTERS) => buildCoachTeamAnalytics(athletes, sessions, filters, "2026-09-26");

test("mobile Overview uses shared active-roster metrics, saved scores and suggested reviews", () => {
  const result = view();
  assert.equal(result.summary.activeArchers, 2);
  assert.equal(result.summary.sessionCount, 3);
  assert.equal(result.summary.arrowCount, 308);
  assert.equal(result.summary.scoredArrowCount, 4);
  assert.equal(result.summary.trainingSessions, 2);
  assert.equal(result.summary.competitionSessions, 1);
  assert.deepEqual(result.reviewQueue.map((item) => item.session.id), ["s2","s1"]);
  assert.equal(result.recent[0].session.id, "s2");
  assert.equal(result.perAthlete.find((item) => item.userId === "a").arrowCount, 272);
});

test("mobile directory search, division and recent-activity filters stay scoped to active roster", () => {
  const rows = view().perAthlete;
  assert.deepEqual(filterCoachDirectory(rows, " ha ", "all", "all").map((item) => item.userId), ["a"]);
  assert.deepEqual(filterCoachDirectory(rows, "", "Recurve", "all").map((item) => item.userId), ["a"]);
  assert.deepEqual(filterCoachDirectory(rows, "", "all", "recent").map((item) => item.userId), ["a","b"]);
  assert.deepEqual(filterCoachDirectory(rows, "", "all", "none"), []);
});

test("mobile analytics and athlete calculations match shared filters", () => {
  assert.equal(view({ ...DEFAULT_COACH_FILTERS, sessionType: "competition" }).summary.arrowCount, 72);
  assert.equal(view({ ...DEFAULT_COACH_FILTERS, period: "7" }).summary.sessionCount, 3);
  assert.equal(view({ ...DEFAULT_COACH_FILTERS, distance: 18 }).summary.arrowCount, 308);
  assert.equal(view({ ...DEFAULT_COACH_FILTERS, distance: 18 }).summary.scoredArrowCount, 0);
  const athlete = buildCoachAthleteInsights(athletes[0], sessions, DEFAULT_COACH_FILTERS, "2026-09-26");
  assert.equal(athlete.overview.totalArrows, 4);
  assert.equal(athlete.overview.bestRound.name, "70 m");
  assert.equal(athlete.sessionTrend.length, 2);
  assert.equal(athlete.byDistance[0].distance, 70);
  assert.equal(athlete.distribution.find((item) => item.score === "X").count, 1);
  assert.equal(athlete.completedEndCount, 2);
});

test("Session navigation and Round summaries are read-only derivations", () => {
  assert.deepEqual(coachSessionNeighbors([{ id:"new" }, { id:"middle" }, { id:"old" }], "middle"), { previous: "old", next: "new" });
  assert.deepEqual(coachSessionNeighbors([{ id:"new" }], "missing"), { previous: null, next: null });
  const summary = summarizeCoachRound(round("r"));
  assert.equal(summary.total, 19);
  assert.equal(summary.arrowProgression.at(-1).cumulative, 19);
});

test("Coach Round screen and target expose no athlete scoring mutations", () => {
  const screen = readFileSync(new URL("../app/(tabs)/organization/[organizationId]/athletes/[userId]/sessions/[sessionId]/rounds/[roundId].tsx", import.meta.url), "utf8");
  const target = readFileSync(new URL("../src/coach-readonly-target.tsx", import.meta.url), "utf8");
  assert.match(screen, /CoachReadonlyTarget/);
  assert.doesNotMatch(screen + target, /saveArrow|deleteArrow|createRound|onPlot|correctScore/);
  assert.match(target, /Reset view/);
});
