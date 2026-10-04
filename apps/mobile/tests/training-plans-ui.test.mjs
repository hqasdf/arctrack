import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { calculateTrainingPlanProgress } from "@arc-track/core/training-plan";
import { singleTrainingPlanRouteParam } from "../src/training-plan-route-params.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

test("Coach Training Plan routes remain nested under the Organization tab", () => {
  for (const path of [
    "app/(tabs)/organization/[organizationId]/training-plans/index.tsx",
    "app/(tabs)/organization/[organizationId]/training-plans/new.tsx",
    "app/(tabs)/organization/[organizationId]/training-plans/[planId]/index.tsx",
    "app/(tabs)/organization/[organizationId]/training-plans/[planId]/edit.tsx",
  ]) assert.ok(existsSync(join(root, path)), path);
  const tabs = read("app/(tabs)/_layout.tsx");
  assert.deepEqual([...tabs.matchAll(/<Tabs\.Screen name="([^"]+)"/g)].map((match) => match[1]),
    ["sessions", "counter", "analytics", "organization", "profile"]);
});

test("mobile write wrapper calls guarded RPCs, and athlete plan route has no edit control", () => {
  const write = read("src/training-plans-write.ts");
  assert.match(write, /rpc\("save_training_plan"/);
  assert.match(write, /rpc\("delete_training_plan"/);
  assert.doesNotMatch(write, /\.from\("training_plans"\)\.(insert|update|delete)/);
  const athlete = read("app/sessions/training-plans/[planId].tsx");
  assert.doesNotMatch(athlete, /saveMobileTrainingPlan|deleteMobileTrainingPlan|MobileTrainingPlanForm/);
});

test("mobile editor exposes multi-select, daily targets, and shared-plan confirmation", () => {
  const ui = read("src/training-plans-ui.tsx");
  assert.match(ui, /Search athletes/);
  assert.match(ui, /Select All/);
  assert.match(ui, /Clear All/);
  assert.match(ui, /Scored Rounds · optional/);
  assert.match(ui, /Changes will apply to everyone assigned to this plan/);
});

test("mobile athlete Sessions refreshes on focus and shows each active plan's ring", () => {
  const sessions = read("app/(tabs)/sessions.tsx");
  const coach = read("app/(tabs)/organization/[organizationId]/training-plans/[planId]/index.tsx");
  const reader = read("src/training-plans-read.ts");
  assert.match(sessions, /useFocusEffect\(useCallback\(\(\) => \{ void loadPlans\(\); \}/);
  assert.match(sessions, /activePlans\.map\(\(\{ plan, progress \}\)/);
  assert.match(sessions, /<TrainingGoalRing week=\{visibleTrainingWeek\(progress, today\)\} compact\/>/);
  assert.match(coach, /<TrainingGoalRing week=\{week\} coach\/>/);
  assert.match(reader, /calculateTrainingPlanProgress\(plan, athlete\.userId, sessions, asOfDate\)/);
  assert.match(reader, /arrow_count/);
});

test("Training Plan route params are normalized before IDs reach readers", () => {
  const params = read("src/training-plan-route-params.ts");
  assert.match(params, /typeof value === "string" && value.length > 0/);
  for (const path of [
    "app/sessions/training-plans/[planId].tsx",
    "app/(tabs)/organization/[organizationId]/training-plans/index.tsx",
    "app/(tabs)/organization/[organizationId]/training-plans/new.tsx",
    "app/(tabs)/organization/[organizationId]/training-plans/[planId]/index.tsx",
    "app/(tabs)/organization/[organizationId]/training-plans/[planId]/edit.tsx",
    "app/(tabs)/organization/[organizationId]/athletes/[userId].tsx",
  ]) {
    const source = read(path);
    assert.match(source, /singleTrainingPlanRouteParam\(/, path);
    assert.match(source, /useLocalSearchParams<\{[\s\S]*string \| string\[\]/, path);
  }
  const athleteDetail = read("app/sessions/training-plans/[planId].tsx");
  assert.match(athleteDetail, /plan\.id === planId/);
  assert.match(athleteDetail, /readMobileOwnTrainingPlanProgress\(user\.id/);
  const coachDetail = read("app/(tabs)/organization/[organizationId]/training-plans/[planId]/index.tsx");
  assert.match(coachDetail, /readMobileCoachTrainingPlanProgress\(user\.id, organizationId, planId/);
  assert.doesNotMatch(read("app/(tabs)/organization/[organizationId]/training-plans/index.tsx"), /training-plans\/\[planId\]\/index/);
  assert.doesNotMatch(coachDetail, /training-plans\/index/);
});

test("single Training Plan route params reject missing or repeated values", () => {
  assert.equal(singleTrainingPlanRouteParam("plan-a"), "plan-a");
  assert.equal(singleTrainingPlanRouteParam(undefined), null);
  assert.equal(singleTrainingPlanRouteParam([]), null);
  assert.equal(singleTrainingPlanRouteParam(["plan-a", "plan-b"]), null);
});

test("Sessions links each card to its own plan ID and focus reloads the list", () => {
  const sessions = read("app/(tabs)/sessions.tsx");
  assert.match(sessions, /router\.push\(\{ pathname: "\/sessions\/training-plans\/\[planId\]", params: \{ planId: plan\.id \} \}\)/);
  assert.match(sessions, /readMobileOwnTrainingPlanProgress\(user\.id, singaporeToday\(new Date\(\)\)\)/);
  assert.match(sessions, /useFocusEffect\(useCallback\(\(\) => \{ void loadPlans\(\); \}/);
});

test("athlete and coach Training Plan details refresh on focus and render zero progress", () => {
  const athlete = read("app/sessions/training-plans/[planId].tsx");
  const coach = read("app/(tabs)/organization/[organizationId]/training-plans/[planId]/index.tsx");
  const goalRing = read("src/training-plans-ui.tsx");
  for (const source of [athlete, coach]) {
    assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{ void load\(\); \}/);
    assert.match(source, /finally \{ setLoading\(false\); \}/);
  }
  assert.match(goalRing, /\{week\.arrowsCompleted\} \/ \{week\.arrowTarget\}/);
  assert.doesNotMatch(goalRing, /if \(!week\.arrowsCompleted\)/);
});

test("mobile progress inputs preserve zero and sum only the selected athlete's in-plan Sessions", () => {
  const plan = { id: "plan-a", startDate: "2026-09-29", endDate: "2026-10-05",
    weeklyArrowTarget: 1000, days: [] };
  const athlete = "athlete-a";
  const session = (id, userId, date, arrowCount) => ({ id, userId, date, arrowCount, rounds: [] });
  const empty = calculateTrainingPlanProgress(plan, athlete, [], "2026-10-01");
  assert.equal(empty.currentWeek.arrowsCompleted, 0);
  const loaded = calculateTrainingPlanProgress(plan, athlete, [
    session("one", athlete, "2026-09-29", 120),
    session("two", athlete, "2026-09-30", 150),
    session("three", athlete, "2026-10-02", 180),
    session("out-of-range", athlete, "2026-09-28", 900),
    session("other-athlete", "athlete-b", "2026-09-30", 500),
  ], "2026-10-01");
  assert.equal(loaded.currentWeek.arrowsCompleted, 450);
  assert.equal(loaded.currentWeek.arrowsRemaining, 550);
  const refreshed = calculateTrainingPlanProgress(plan, athlete,
    [session("one", athlete, "2026-09-29", 120), session("two", athlete, "2026-09-30", 180)], "2026-10-01");
  assert.equal(refreshed.currentWeek.arrowsCompleted, 300);
});
