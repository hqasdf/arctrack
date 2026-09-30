import assert from "node:assert/strict";
import test from "node:test";
import { buildCoachAthleteInsights, buildCoachTeamAnalytics, coachChartInterval, coachFilterOptions, coachPeriodScoreChange, DEFAULT_COACH_FILTERS } from "../src/coach-analytics-model.ts";

const athletes = [{ userId: "a", name: "Ada" }, { userId: "b", name: "Bo" }];
const arrow = (score, n) => ({ id: `a${n}`, end: 1, arrow: n, score, plot: null });
const round = (id, distance, scores, division = "Recurve", faceType = "full_face") => ({
  id, roundNumber: 1, name: `${distance}m`, distanceMetres: distance, division, faceDiameterCm: 122,
  faceType, ends: 1, arrowsPerEnd: 6, arrows: scores.map(arrow),
});
const session = (id, userId, date, sessionType, rounds, arrowCount = 200) => ({ id, userId, date, sessionType, title: id, rounds, arrowCount });
const sessions = [
  session("s1", "a", "2026-09-25", "training", [round("r1", 70, ["X", "10", "9", "M"])]),
  session("s2", "a", "2026-09-25", "competition", [round("r2", 50, ["8", "10"])]),
  session("s3", "b", "2026-09-26", "training", [round("r3", 70, ["X", "9"])]),
  session("former", "former", "2026-09-26", "training", [round("r4", 70, ["X"])]),
  session("other-org", "other", "2026-09-26", "training", [round("r5", 70, ["X"])]),
  session("old", "a", "2026-05-01", "training", [round("r6", 18, ["1"])]),
];
const today = "2026-09-27";
const data = (filters = DEFAULT_COACH_FILTERS) => buildCoachTeamAnalytics(athletes, sessions, filters, today);

test("summary keeps keyed Session Arrow volume separate from scored Arrows", () => {
  const result = data();
  assert.deepEqual(result.summary, { activeArchers: 2, activeThisPeriod: 2, sessionCount: 3, arrowCount: 600, scoredArrowCount: 8, trainingSessions: 2, competitionSessions: 1 });
  assert.equal(result.perAthlete[0].arrowCount, 400);
  assert.equal(result.perAthlete[0].scoredArrowCount, 6);
  assert.equal(result.perAthlete[1].arrowCount, 200);
  assert.equal(result.recent.some(({ session }) => session.id === "former" || session.id === "other-org" || session.id === "old"), false);
});

test("daily team volume and Session activity sum multiple Sessions and use normalized score", () => {
  const result = data();
  assert.deepEqual(result.series.map((point) => [point.startDate, point.arrowCount, point.scoredArrowCount, point.sessionCount]), [["2026-09-25", 400, 6, 2], ["2026-09-26", 200, 2, 1]]);
  assert.equal(result.series[0].scoreAverage, 47 / 6);
  assert.ok(Math.abs(result.series[0].xRate - 100 / 6) < 0.000001);
  assert.equal(result.series[0].tenPlusXRate, 50);
});

test("120 keyed Session Arrows remain 120 with only 36 scored records", () => {
  const scored = round("mismatch-round", 70, Array.from({ length: 36 }, () => "9"));
  const result = buildCoachTeamAnalytics([{ userId: "a", name: "Ada" }],
    [session("mismatch", "a", "2026-09-26", "training", [scored], 120)], DEFAULT_COACH_FILTERS, today);
  assert.equal(result.summary.arrowCount, 120);
  assert.equal(result.summary.scoredArrowCount, 36);
  assert.equal(result.series[0].arrowCount, 120);
  assert.equal(result.series[0].scoredArrowCount, 36);
  assert.equal(result.series[0].scoreAverage, 9);
  const athlete = buildCoachAthleteInsights({ userId: "a", name: "Ada" },
    [session("mismatch", "a", "2026-09-26", "training", [scored], 120)], DEFAULT_COACH_FILTERS, today);
  assert.equal(athlete.summary.arrowCount, 120);
  assert.equal(athlete.summary.scoredArrowCount, 36);
  assert.equal(athlete.overview.totalArrows, 36);
  assert.equal(athlete.overview.averagePerArrow, 9);
});

test("zero keyed Session count never falls back to saved scoring rows", () => {
  const result = buildCoachTeamAnalytics([{ userId: "a", name: "Ada" }],
    [session("unkeyed", "a", "2026-09-26", "training", [round("r", 70, ["X", "10"])], 0)], DEFAULT_COACH_FILTERS, today);
  assert.equal(result.summary.arrowCount, 0);
  assert.equal(result.summary.scoredArrowCount, 2);
  assert.equal(result.series[0].scoreAverage, 10);
});

test("athlete comparisons, type split, distance and X distribution use the same filtered Arrows", () => {
  const result = data({ ...DEFAULT_COACH_FILTERS, distance: 70, sessionType: "training" });
  assert.deepEqual(result.summary, { activeArchers: 2, activeThisPeriod: 2, sessionCount: 2, arrowCount: 400, scoredArrowCount: 6, trainingSessions: 2, competitionSessions: 0 });
  assert.deepEqual(result.byDistance.map((item) => [item.distance, item.arrowCount, item.athleteCount]), [[70, 6, 2]]);
  assert.deepEqual(result.distribution.filter((item) => item.count).map((item) => [item.score, item.count]), [["X", 2], ["10", 1], ["9", 2], ["M", 1]]);
  assert.equal(result.perAthlete[0].tenPlusXRate, 50);
  assert.equal(result.perAthlete[1].xRate, 50);
});

test("division and face filters are dynamic and do not attribute unmatched Round Arrows", () => {
  const options = coachFilterOptions(sessions, today, DEFAULT_COACH_FILTERS);
  assert.deepEqual(options.distances, [50, 70]);
  assert.equal(options.targetFaces.length, 1);
  const result = data({ ...DEFAULT_COACH_FILTERS, targetFace: "40:triple_face" });
  assert.equal(result.summary.sessionCount, 0);
  assert.equal(result.summary.arrowCount, 600);
  assert.equal(result.summary.scoredArrowCount, 0);
  assert.equal(result.series.reduce((sum, point) => sum + point.arrowCount, 0), 600);
});

test("90-day and all-time buckets use weekly/monthly periods without fake empty buckets", () => {
  assert.equal(coachChartInterval("90", []), "weekly");
  assert.equal(coachChartInterval("all", ["2025-01-01", "2026-09-27"]), "monthly");
  const result = data({ ...DEFAULT_COACH_FILTERS, period: "90" });
  assert.equal(result.interval, "weekly");
  assert.equal(result.series.length, 1);
  assert.equal(result.series[0].sessionCount, 3);
});

test("review queue is recent completed or Competition Sessions, never a stored unread state", () => {
  const result = data();
  assert.deepEqual(result.reviewQueue.map(({ session }) => session.id), ["s2"]);
  assert.equal(result.reviewQueue[0].average, 9);
  assert.equal(result.reviewQueue[0].tenPlusXCount, 1);
});

test("period comparison requires enough scored Arrows in both equivalent windows", () => {
  assert.equal(coachPeriodScoreChange(sessions, "a", "30", today), null);
  const current = session("current", "a", "2026-09-20", "training", [round("current-round", 70, Array(12).fill("10"))]);
  const previous = session("previous", "a", "2026-08-20", "training", [round("previous-round", 70, Array(12).fill("9"))]);
  assert.equal(coachPeriodScoreChange([current, previous], "a", "30", today), 1);
});

test("athlete insights use completed Ends and comparable plotted grouping only", () => {
  const plotted = (id, date, distance) => session(id, "a", date, "training", [{ ...round(`${id}-round`, distance, ["X", "9", "8"]), arrows: [
    { ...arrow("X", 1), plot: { x: 0, y: 0 } }, { ...arrow("9", 2), plot: { x: .1, y: 0 } }, { ...arrow("8", 3), plot: { x: 0, y: .1 } },
  ] }]);
  const result = buildCoachAthleteInsights(athletes[0], [plotted("one", "2026-09-24", 70), plotted("two", "2026-09-26", 70)], DEFAULT_COACH_FILTERS, today);
  assert.equal(result.overview.totalArrows, 6);
  assert.equal(result.groupingTrend?.points.length, 2);
  assert.equal(result.endVariation, null);
  assert.equal(result.sessionTrend.length, 2);
});
