import test from "node:test";
import assert from "node:assert/strict";
import { calculateArrowVolume, calculateDistancePerformance, calculateOverview, calculateTargetGroupings, calculateTrainingCompetitionComparison, calculateTrend, filterAnalyticsRounds, filterComparisonRounds, formatAnalyticsDate, formatAnalyticsWeekRange, getAvailableFilters } from "../src/analytics-model.ts";

function arrow(id, score, plot = null) { return { id, end: 1, arrow: Number(id.replace(/\D/g, "")) || 1, score, plot, syncState: "saved" }; }
function round(id, overrides = {}) { return { id, roundNumber: 1, name: id, division: "Recurve", distanceMetres: 70, ends: 1, arrowsPerEnd: 3, faceDiameterCm: 122, faceType: "full_face", arrows: [], ...overrides }; }
function session(id, sessionType, date, rounds, arrowCount = 0) { return { id, title: id, date, sessionType, arrowCount, rounds }; }

const completed = round("completed", { arrows: [arrow("a1", "X", { x: 0, y: 0 }), arrow("a2", "10", { x: .08, y: 0 }), arrow("a3", "8", { x: .25, y: 0 })] });
const incompletePerfect = round("incomplete-perfect", { arrows: [arrow("b1", "X", { x: 0, y: 0 })] });
const competition = round("competition", { division: "Compound", distanceMetres: 50, faceDiameterCm: 80, faceType: "six_ring", arrows: [arrow("c1", "9", { x: .15, y: 0 }), arrow("c2", "M"), arrow("c3", "10", { x: .09, y: 0 })] });
const triple = round("triple", { distanceMetres: 18, faceDiameterCm: 40, faceType: "triple_face", arrowsPerEnd: 2, arrows: [arrow("d1", "8", { x: .2, y: .1, faceIndex: 0 }), arrow("d2", "7", { x: -.2, y: 0 })] });
const sessions = [
  session("training-new", "training", "2026-09-23", [completed, incompletePerfect, triple], 200),
  session("training-same-day", "training", "2026-09-23", [], 72),
  session("competition-old", "competition", "2026-08-01", [competition], 18),
];
const allFilters = { sessionType: "all", dateRange: "all", distance: "all", division: "all", targetFace: "all" };

test("Session volume 120 stays separate from 36 scored Arrows", () => {
  const saved = session("mismatch", "training", "2026-09-23", [round("scored", {
    ends: 6, arrowsPerEnd: 6,
    arrows: Array.from({ length: 36 }, (_, index) => arrow(`m${index + 1}`, "9")),
  })], 120);
  assert.equal(calculateArrowVolume([saved], allFilters, "2026-09-23", "daily")[0].arrowCount, 120);
  const overview = calculateOverview(filterAnalyticsRounds([saved], allFilters, "2026-09-23"));
  assert.equal(overview.totalArrows, 36);
  assert.equal(overview.averagePerArrow, 9);
});

test("Training, Competition and All filters select the expected Rounds", () => {
  assert.equal(filterAnalyticsRounds(sessions, { ...allFilters, sessionType: "training" }, "2026-09-23").length, 3);
  assert.equal(filterAnalyticsRounds(sessions, { ...allFilters, sessionType: "competition" }, "2026-09-23").length, 1);
  assert.equal(filterAnalyticsRounds(sessions, allFilters, "2026-09-23").length, 4);
});

test("7-day, 30-day and all-time filters use Session dates", () => {
  assert.equal(filterAnalyticsRounds(sessions, { ...allFilters, dateRange: "7" }, "2026-09-23").length, 3);
  assert.equal(filterAnalyticsRounds(sessions, { ...allFilters, dateRange: "30" }, "2026-09-23").length, 3);
  assert.equal(filterAnalyticsRounds(sessions, allFilters, "2026-09-23").length, 4);
});

test("Distance, division and target-face filters use saved Round snapshots", () => {
  assert.equal(filterAnalyticsRounds(sessions, { ...allFilters, distance: 50 }, "2026-09-23")[0].round.id, "competition");
  assert.equal(filterAnalyticsRounds(sessions, { ...allFilters, division: "Compound" }, "2026-09-23").length, 1);
  assert.equal(filterAnalyticsRounds(sessions, { ...allFilters, targetFace: "40:triple_face" }, "2026-09-23")[0].round.id, "triple");
  const available = getAvailableFilters(sessions, { sessionType: "training", dateRange: "all" }, "2026-09-23");
  assert.deepEqual(available.distances, [18, 70]);
  assert.deepEqual(available.targetFaces.map((item) => item.value).sort(), ["122:full_face", "40:triple_face"]);
});

test("Overview uses saved Arrows and counts X and ordinary 10 correctly", () => {
  const rounds = filterAnalyticsRounds(sessions, { ...allFilters, sessionType: "training" }, "2026-09-23");
  const result = calculateOverview(rounds);
  assert.equal(result.totalArrows, 6);
  assert.equal(result.averagePerArrow, 53 / 6);
  assert.equal(result.xCount, 2);
  assert.equal(result.xPercentage, 2 / 6 * 100);
  assert.equal(result.tenPlusXPercentage, 3 / 6 * 100);
});

test("Incomplete high-scoring Round cannot beat a completed Round", () => {
  const result = calculateOverview(filterAnalyticsRounds(sessions, { ...allFilters, sessionType: "training", targetFace: "122:full_face" }, "2026-09-23"));
  assert.equal(result.bestRound?.id, "completed");
  assert.equal(result.bestRound?.arrowCount, 3);
  assert.equal(result.bestRound?.total, 28);
  assert.equal(result.bestRound?.average, 28 / 3);
  const noComplete = calculateOverview([{ sessionId: "s", sessionTitle: "s", sessionType: "training", date: "2026-09-23", round: incompletePerfect }]);
  assert.equal(noComplete.bestRound, null);
});

test("Trend compares average score per Arrow rather than raw totals", () => {
  const trend = calculateTrend(filterAnalyticsRounds(sessions, { ...allFilters, sessionType: "training", targetFace: "122:full_face" }, "2026-09-23"));
  assert.deepEqual(trend.map((point) => [point.id, point.average, point.arrowCount]), [["completed", 28 / 3, 3], ["incomplete-perfect", 10, 1]]);
});

test("Distance performance includes Arrow and Round context", () => {
  const results = calculateDistancePerformance(filterAnalyticsRounds(sessions, allFilters, "2026-09-23"));
  assert.deepEqual(results.map((item) => [item.distance, item.arrowCount, item.roundCount]), [[18, 2, 1], [50, 3, 1], [70, 4, 2]]);
});

test("Grouping supports all layouts and safely excludes missing or unassigned plots", () => {
  const groups = calculateTargetGroupings(filterAnalyticsRounds(sessions, allFilters, "2026-09-23"));
  assert.deepEqual(groups.map((group) => group.faceType), ["full_face", "six_ring", "triple_face"]);
  const full = groups[0], six = groups[1], tripleGroup = groups[2];
  assert.equal(full.arrows.length, 4);
  assert.equal(six.arrows.length, 2);
  assert.equal(six.missingPlotCount, 1);
  assert.equal(tripleGroup.arrows.length, 1);
  assert.equal(tripleGroup.arrows[0].faceIndex, 0);
  assert.equal(tripleGroup.unassignedTripleCount, 1);
});

test("Daily Arrow volume sums Session Arrow counts rather than saved scoring Arrows", () => {
  assert.deepEqual(calculateArrowVolume(sessions, allFilters, "2026-09-23", "daily"), [
    { key: "2026-08-01", startDate: "2026-08-01", endDate: "2026-08-01", arrowCount: 18 },
    { key: "2026-09-23", startDate: "2026-09-23", endDate: "2026-09-23", arrowCount: 272 },
  ]);
});

test("Weekly Arrow volume uses Monday through Sunday and only applies primary filters", () => {
  assert.deepEqual(calculateArrowVolume(sessions, { ...allFilters, sessionType: "competition" }, "2026-09-23", "weekly"), [
    { key: "2026-07-27", startDate: "2026-07-27", endDate: "2026-08-02", arrowCount: 18 },
  ]);
  assert.deepEqual(calculateArrowVolume(sessions, { ...allFilters, sessionType: "training", distance: 70 }, "2026-09-23", "weekly"), [
    { key: "2026-09-21", startDate: "2026-09-21", endDate: "2026-09-27", arrowCount: 272 },
  ]);
  assert.deepEqual(calculateArrowVolume(sessions, { ...allFilters, dateRange: "7" }, "2026-09-23", "daily"), [
    { key: "2026-09-23", startDate: "2026-09-23", endDate: "2026-09-23", arrowCount: 272 },
  ]);
});

test("Analytics date labels are deterministic across server and browser runtimes", () => {
  assert.equal(formatAnalyticsDate("2026-09-22"), "22 Sep 2026");
  assert.equal(formatAnalyticsDate("2026-09-22", false), "22 Sep");
  assert.equal(formatAnalyticsWeekRange("2026-09-21", "2026-09-27"), "21–27 Sep");
  assert.equal(formatAnalyticsWeekRange("2026-09-28", "2026-10-04"), "28 Sep–4 Oct");
});

test("Training vs Competition uses both types under the same format filters", () => {
  const selected = filterComparisonRounds(sessions, { ...allFilters, sessionType: "training", distance: 50 }, "2026-09-23");
  assert.equal(selected.length, 1);
  assert.equal(selected[0].sessionType, "competition");
  const mixed = calculateTrainingCompetitionComparison(filterComparisonRounds(sessions, { ...allFilters, sessionType: "training" }, "2026-09-23"));
  assert.equal(mixed.context, "Comparison includes mixed formats");
  assert.equal(mixed.training.arrowCount, 6);
  assert.equal(mixed.competition.arrowCount, 3);
  assert.equal(mixed.training.spread, null);
});
