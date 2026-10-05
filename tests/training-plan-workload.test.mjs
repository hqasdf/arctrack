import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { trainingPlanWorkloadSupported, MAX_TRAINING_PLAN_DAYS, MAX_TRAINING_PLAN_ASSIGNMENTS }
  from "../src/features/organizations/training-plan-workload.ts";

const input = { title: "Plan", startDate: "2028-01-01", endDate: "2028-01-01",
  weeklyArrowTarget: "1000", note: "", days: [], athleteUserIds: ["athlete"] };

test("Training Plan workload preflight permits normal and inclusive leap-year maximum ranges", () => {
  assert.equal(trainingPlanWorkloadSupported(input), true);
  assert.equal(trainingPlanWorkloadSupported({ ...input, endDate: "2028-01-07" }), true);
  assert.equal(trainingPlanWorkloadSupported({ ...input, endDate: "2028-12-31" }), true);
  assert.equal(trainingPlanWorkloadSupported({ ...input,
    athleteUserIds: Array.from({ length: 1000 }, (_, i) => String(i)) }), true);
});

test("Training Plan workload preflight rejects oversized dates before any calendar allocation", () => {
  for (const dates of [
    { startDate: "2028-01-01", endDate: "2029-01-01" },
    { startDate: "0001-01-01", endDate: "9999-12-31" },
    { startDate: "-infinity", endDate: "infinity" },
    { startDate: "2028-02-30", endDate: "2028-03-01" },
    { startDate: "2028-01-02", endDate: "2028-01-01" },
    { startDate: "0000-01-01", endDate: "0000-01-02" },
  ]) assert.equal(trainingPlanWorkloadSupported({ ...input, ...dates }), false);
});

test("Training Plan workload preflight rejects oversized and malformed arrays", () => {
  assert.equal(trainingPlanWorkloadSupported({ ...input, days: Array(367).fill({}) }), false);
  assert.equal(trainingPlanWorkloadSupported({ ...input, athleteUserIds: Array(1001).fill("athlete") }), false);
  assert.equal(trainingPlanWorkloadSupported({ ...input, days: null }), false);
  assert.equal(trainingPlanWorkloadSupported({ ...input, athleteUserIds: null }), false);
  assert.equal(trainingPlanWorkloadSupported(null), false);
});

test("web preflight precedes shared preparation and mirrors the proposed database bounds", async () => {
  const action = await readFile(new URL("../src/features/organizations/training-plans-actions.ts", import.meta.url), "utf8");
  assert.ok(action.indexOf("if (!trainingPlanWorkloadSupported(input))") < action.indexOf("const prepared = prepareTrainingPlanInput(input)"));
  const sql = await readFile(new URL("../supabase/proposals/backend_abuse_protection.sql", import.meta.url), "utf8");
  assert.ok(sql.includes("p_end_date - p_start_date + 1 > " + MAX_TRAINING_PLAN_DAYS));
  assert.ok(sql.includes("pg_catalog.jsonb_array_length(p_days) > " + MAX_TRAINING_PLAN_DAYS));
  assert.ok(sql.includes("not between 1 and " + MAX_TRAINING_PLAN_ASSIGNMENTS));
});

