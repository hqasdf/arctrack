import assert from "node:assert/strict";
import test from "node:test";
import { trainingPlanDates, trainingPlanStatus } from "../src/training-plan-model.ts";
import { prepareTrainingPlanInput } from "../src/training-plan-input.ts";

const input = (changes = {}) => ({
  title: " Competition Preparation ", startDate: "2026-09-29", endDate: "2026-10-05",
  weeklyArrowTarget: "700", note: " Focus on shot process. ", athleteUserIds: ["a", "b"],
  days: [{ date: "2026-09-29", arrowTarget: "150", scoredRoundTarget: "3", coachNote: " Technique " }],
  ...changes,
});

test("date-only prescriptions include every calendar day and retain exact boundaries", () => {
  assert.deepEqual(trainingPlanDates("2028-02-28", "2028-03-01"), ["2028-02-28", "2028-02-29", "2028-03-01"]);
  assert.equal(trainingPlanStatus("2026-09-29", "2026-10-05", "2026-09-28"), "Upcoming");
  assert.equal(trainingPlanStatus("2026-09-29", "2026-10-05", "2026-10-05"), "Active");
  assert.equal(trainingPlanStatus("2026-09-29", "2026-10-05", "2026-10-06"), "Ended");
});

test("editor preserves blank requirements as null and prepares all dates for one shared plan", () => {
  const result = prepareTrainingPlanInput(input());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.title, "Competition Preparation");
  assert.equal(result.data.weeklyArrowTarget, 700);
  assert.deepEqual(result.data.athleteUserIds, ["a", "b"]);
  assert.deepEqual(result.data.days[0], { date: "2026-09-29", arrow_target: 150, scored_round_target: 3, coach_note: "Technique" });
  assert.deepEqual(result.data.days[1], { date: "2026-09-30", arrow_target: null, scored_round_target: null, coach_note: null });
  assert.equal(result.data.days.length, 7);
});

test("optional weekly and daily targets remain null, never zero", () => {
  const result = prepareTrainingPlanInput(input({ weeklyArrowTarget: "", days: [] }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.weeklyArrowTarget, null);
  assert.ok(result.data.days.every((day) => day.arrow_target === null && day.scored_round_target === null));
});

test("invalid title, dates, targets, and assignment sets are rejected before RPC", () => {
  for (const changes of [
    { title: "  " }, { startDate: "2026-10-06" }, { startDate: "2026-02-30" },
    { athleteUserIds: [] }, { athleteUserIds: ["a", "a"] },
    { weeklyArrowTarget: "0" }, { weeklyArrowTarget: "1.5" },
    { days: [{ date: "2026-09-29", arrowTarget: "-1", scoredRoundTarget: "", coachNote: "" }] },
    { days: [{ date: "2026-09-29", arrowTarget: "", scoredRoundTarget: "0", coachNote: "" }] },
  ]) assert.equal(prepareTrainingPlanInput(input(changes)).ok, false, JSON.stringify(changes));
});
