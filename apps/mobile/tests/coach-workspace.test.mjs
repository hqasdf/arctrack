import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCoachAthleteInsights, buildCoachTeamAnalytics, DEFAULT_COACH_FILTERS } from "@arc-track/core/coach-analytics";
import { summarizeCoachRound } from "@arc-track/core/coach-round";
import { coachSessionNeighbors, filterCoachDirectory } from "../src/coach-mobile-model.ts";

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
  assert.equal(result.summary.arrowCount, 4);
  assert.equal(result.summary.trainingSessions, 2);
  assert.equal(result.summary.competitionSessions, 1);
  assert.deepEqual(result.reviewQueue.map((item) => item.session.id), ["s2","s1"]);
  assert.equal(result.recent[0].session.id, "s2");
  assert.equal(result.perAthlete.find((item) => item.userId === "a").arrowCount, 4);
});

test("mobile directory search, division and recent-activity filters stay scoped to active roster", () => {
  const rows = view().perAthlete;
  assert.deepEqual(filterCoachDirectory(rows, " ha ", "all", "all").map((item) => item.userId), ["a"]);
  assert.deepEqual(filterCoachDirectory(rows, "", "Recurve", "all").map((item) => item.userId), ["a"]);
  assert.deepEqual(filterCoachDirectory(rows, "", "all", "recent").map((item) => item.userId), ["a","b"]);
  assert.deepEqual(filterCoachDirectory(rows, "", "all", "none"), []);
});

test("mobile analytics and athlete calculations match shared filters", () => {
  assert.equal(view({ ...DEFAULT_COACH_FILTERS, sessionType: "competition" }).summary.arrowCount, 2);
  assert.equal(view({ ...DEFAULT_COACH_FILTERS, period: "7" }).summary.sessionCount, 3);
  assert.equal(view({ ...DEFAULT_COACH_FILTERS, distance: 18 }).summary.arrowCount, 0);
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
  const screen = readFileSync(new URL("../app/organization/[organizationId]/athletes/[userId]/sessions/[sessionId]/rounds/[roundId].tsx", import.meta.url), "utf8");
  const target = readFileSync(new URL("../src/coach-readonly-target.tsx", import.meta.url), "utf8");
  assert.match(screen, /CoachReadonlyTarget/);
  assert.doesNotMatch(screen + target, /saveArrow|deleteArrow|createRound|onPlot|correctScore/);
  assert.match(target, /Reset view/);
});
