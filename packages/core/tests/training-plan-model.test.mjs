import assert from "node:assert/strict";
import test from "node:test";
import { calculateTrainingPlanProgress, isTrainingPlanScoredRoundComplete } from "../src/training-plan-model.ts";

const athlete = "athlete-a";
const plan = (changes = {}) => ({
  id: "plan-1", startDate: "2026-09-29", endDate: "2026-10-05",
  weeklyArrowTarget: 700, days: [], ...changes,
});
const session = (date, arrowCount, rounds = [], userId = athlete, sessionType = "training") => ({
  id: `${userId}-${date}-${sessionType}`, userId, date, arrowCount, rounds, sessionType,
});
const round = (counts) => ({
  id: `round-${counts.join("-")}`, plannedEnds: counts.length, arrowsPerEnd: 6,
  ends: counts.map((count, index) => ({ endNumber: index + 1,
    savedArrowIds: Array.from({ length: count }, (_, arrow) => `${index + 1}-${arrow + 1}`) })),
});

test("weekly goal shows actual, remaining, and capped ring progress", () => {
  const under = calculateTrainingPlanProgress(plan(), athlete, [session("2026-09-29", 486)], "2026-09-29");
  assert.equal(under.currentWeek.arrowsCompleted, 486);
  assert.equal(under.currentWeek.arrowsRemaining, 214);
  assert.equal(under.currentWeek.goalReached, false);
  assert.equal(under.currentWeek.progressRatio, 486 / 700);
  const over = calculateTrainingPlanProgress(plan(), athlete, [session("2026-09-29", 782)], "2026-09-29");
  assert.equal(over.currentWeek.progressRatio, 782 / 700);
  assert.equal(over.currentWeek.visualRatio, 1);
  assert.equal(over.currentWeek.arrowsRemaining, 0);
  assert.equal(over.currentWeek.amountAboveGoal, 82);
  assert.equal(over.currentWeek.goalReached, true);
});

test("arrow volume uses Session arrow_count, never saved scored Arrow rows", () => {
  const scored36 = round([6, 6, 6, 6, 6, 6]);
  const result = calculateTrainingPlanProgress(plan(), athlete,
    [session("2026-09-29", 120, [scored36])], "2026-09-29");
  assert.equal(result.days[0].arrowsCompleted, 120);
  assert.equal(result.days[0].scoredRoundsCompleted, 1);
  assert.equal(result.currentWeek.arrowsCompleted, 120);
});

test("null Session arrow_count is unknown and never falls back to scored rows", () => {
  const result = calculateTrainingPlanProgress(plan(), athlete,
    [session("2026-09-29", null, [round([6, 6, 6, 6, 6, 6])])], "2026-09-29");
  assert.equal(result.days[0].arrowsCompleted, 0);
  assert.equal(result.days[0].unknownArrowCountSessions, 1);
  assert.equal(result.currentWeek.arrowsCompleted, 0);
  assert.equal(result.currentWeek.unknownArrowCountSessions, 1);
  assert.equal(result.days[0].scoredRoundsCompleted, 1);
});

test("all non-null daily requirements must be met; no requirement is not complete", () => {
  const daily = plan({ days: [{ date: "2026-09-29", arrowTarget: 150,
    scoredRoundTarget: 3, coachNote: "Focus" }] });
  const completeRound = round([6, 6, 6, 6, 6, 6]);
  const two = calculateTrainingPlanProgress(daily, athlete,
    [session("2026-09-29", 150, [completeRound, completeRound])], "2026-09-29");
  assert.equal(two.days[0].arrowComplete, true);
  assert.equal(two.days[0].scoredRoundComplete, false);
  assert.equal(two.days[0].dayComplete, false);
  const three = calculateTrainingPlanProgress(daily, athlete,
    [session("2026-09-29", 150, [completeRound, completeRound, completeRound])], "2026-09-29");
  assert.equal(three.days[0].dayComplete, true);
  assert.equal(three.days[0].coachNote, "Focus");
  assert.equal(three.days[1].noTrackedRequirement, true);
  assert.equal(three.days[1].dayComplete, false);
});

test("Training Plan completion requires every planned End to have exactly six saved Arrows", () => {
  assert.equal(isTrainingPlanScoredRoundComplete(round([6, 6, 6, 6, 6, 6])), true);
  assert.equal(isTrainingPlanScoredRoundComplete(round([7, 5, 6, 6, 6, 6])), false);
  assert.equal(isTrainingPlanScoredRoundComplete(round([6, 6, 6, 6, 6, 5])), false);
  assert.equal(isTrainingPlanScoredRoundComplete(round([0, 0, 0, 0, 0, 0])), false);
  const missing = round([6, 6, 6, 6, 6, 6]);
  missing.ends.pop();
  assert.equal(isTrainingPlanScoredRoundComplete(missing), false);
});

test("daily scored-Round progress moves from 0/2 to 1/2 only after a Round is complete", () => {
  const daily = plan({ days: [{ date: "2026-09-29", arrowTarget: null,
    scoredRoundTarget: 2, coachNote: null }] });
  const incomplete = round([6, 6, 6, 6, 6, 5]);
  const complete = round([6, 6, 6, 6, 6, 6]);
  const before = calculateTrainingPlanProgress(daily, athlete,
    [session("2026-09-29", 36, [incomplete])], "2026-09-29");
  const after = calculateTrainingPlanProgress(daily, athlete,
    [session("2026-09-29", 36, [complete])], "2026-09-29");
  assert.equal(before.days[0].scoredRoundTarget, 2);
  assert.equal(before.days[0].scoredRoundsCompleted, 0);
  assert.equal(after.days[0].scoredRoundTarget, 2);
  assert.equal(after.days[0].scoredRoundsCompleted, 1);
});

test("athlete progress is independent and both Session types contribute", () => {
  const sessions = [
    session("2026-09-29", 120, [round([6, 6])], athlete, "training"),
    session("2026-09-30", 80, [round([6, 6])], athlete, "competition"),
    session("2026-09-29", 400, [round([6, 6])], "athlete-b", "training"),
  ];
  const a = calculateTrainingPlanProgress(plan(), athlete, sessions, "2026-09-30");
  const b = calculateTrainingPlanProgress(plan(), "athlete-b", sessions, "2026-09-30");
  assert.equal(a.currentWeek.arrowsCompleted, 200);
  assert.equal(a.days[0].scoredRoundsCompleted, 1);
  assert.equal(a.days[1].scoredRoundsCompleted, 1);
  assert.equal(b.currentWeek.arrowsCompleted, 400);
  assert.equal(b.days[1].scoredRoundsCompleted, 0);
});

test("seven-day targets restart from plan start, using date-only arithmetic", () => {
  const multi = plan({ startDate: "2026-09-28", endDate: "2026-10-11" });
  const result = calculateTrainingPlanProgress(multi, athlete, [
    session("2026-10-04", 600), session("2026-10-05", 100),
  ], "2026-10-05");
  assert.deepEqual(result.weeks.map(({ startDate, endDate, arrowTarget, arrowsCompleted }) =>
    [startDate, endDate, arrowTarget, arrowsCompleted]), [
    ["2026-09-28", "2026-10-04", 700, 600],
    ["2026-10-05", "2026-10-11", 700, 100],
  ]);
  assert.equal(result.currentWeek.startDate, "2026-10-05");
  assert.equal(result.days.find((day) => day.date === "2026-10-04").arrowsCompleted, 600);
  assert.equal(result.days.find((day) => day.date === "2026-10-05").arrowsCompleted, 100);
  assert.equal(calculateTrainingPlanProgress(multi, athlete, [], "2026-10-12").currentWeek, null);
});

test("calendar arithmetic preserves leap day and year boundary without timezone conversion", () => {
  const leap = calculateTrainingPlanProgress(plan({ startDate: "2028-02-28", endDate: "2028-03-01" }),
    athlete, [session("2028-02-29", 8)], "2028-02-29");
  assert.deepEqual(leap.days.map(({ date, arrowsCompleted }) => [date, arrowsCompleted]), [
    ["2028-02-28", 0], ["2028-02-29", 8], ["2028-03-01", 0],
  ]);
  const year = calculateTrainingPlanProgress(plan({ startDate: "2026-12-31", endDate: "2027-01-01" }),
    athlete, [session("2027-01-01", 5)], "2027-01-01");
  assert.deepEqual(year.days.map((day) => day.date), ["2026-12-31", "2027-01-01"]);
  assert.equal(year.days[1].arrowsCompleted, 5);
});

test("an absent weekly target yields no goal judgement", () => {
  const result = calculateTrainingPlanProgress(plan({ weeklyArrowTarget: null }),
    athlete, [session("2026-09-29", 20)], "2026-09-29");
  assert.equal(result.currentWeek.progressRatio, null);
  assert.equal(result.currentWeek.visualRatio, null);
  assert.equal(result.currentWeek.goalReached, null);
  assert.equal(result.currentWeek.arrowsRemaining, null);
});

test("current Session rows drive weekly and daily progress after edits and deletion", () => {
  const todayPlan = plan({ days: [{ date: "2026-09-29", arrowTarget: 150,
    scoredRoundTarget: 1, coachNote: null }] });
  const monday = session("2026-09-29", 100, [round([6, 6, 6, 6, 6, 6])]);
  const secondMonday = { ...session("2026-09-29", 50), id: "second-session" };
  const tuesday = session("2026-09-30", 150);
  const thursday = session("2026-10-02", 180);
  const initial = calculateTrainingPlanProgress(todayPlan, athlete,
    [monday, secondMonday, tuesday, thursday], "2026-09-29");
  assert.equal(initial.currentWeek.arrowsCompleted, 480);
  assert.equal(initial.days[0].arrowsCompleted, 150);
  assert.equal(initial.days[0].scoredRoundsCompleted, 1);
  const edited = calculateTrainingPlanProgress(todayPlan, athlete,
    [{ ...monday, arrowCount: 140 }, secondMonday, tuesday, thursday], "2026-09-29");
  assert.equal(edited.currentWeek.arrowsCompleted, 520);
  assert.equal(edited.days[0].arrowsCompleted, 190);
  const deleted = calculateTrainingPlanProgress(todayPlan, athlete,
    [{ ...monday, arrowCount: 140 }, tuesday, thursday], "2026-09-29");
  assert.equal(deleted.currentWeek.arrowsCompleted, 470);
  assert.equal(deleted.days[0].arrowsCompleted, 140);
});

test("three dated Sessions count 450, while out-of-plan Sessions and other athletes do not", () => {
  const result = calculateTrainingPlanProgress(plan(), athlete, [
    session("2026-09-28", 1000),
    session("2026-09-29", 120),
    session("2026-09-30", 150, [], athlete, "competition"),
    session("2026-10-02", 180),
    session("2026-10-05", 0),
    session("2026-10-06", 1000),
    session("2026-09-30", 500, [], "another-athlete"),
  ], "2026-10-02");
  assert.equal(result.currentWeek.arrowsCompleted, 450);
  assert.equal(result.currentWeek.arrowsRemaining, 250);
  assert.deepEqual(result.days.filter((day) => day.arrowsCompleted > 0)
    .map((day) => [day.date, day.arrowsCompleted]), [
      ["2026-09-29", 120], ["2026-09-30", 150], ["2026-10-02", 180],
    ]);
});
