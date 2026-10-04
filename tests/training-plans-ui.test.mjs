import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("web Coach navigation places Training Plans between Reviews and Analytics", () => {
  const nav = read("src/features/organizations/components/coach-navigation.tsx");
  const labels = [...nav.matchAll(/label: "([^"]+)"/g)].map((item) => item[1]);
  assert.deepEqual(labels.slice(0, 6), ["Overview", "Athletes", "Reviews", "Training Plans", "Analytics", "Settings"]);
});

test("Coach and athlete Training Plan routes exist without a new main tab", () => {
  for (const path of [
    "src/app/(platform)/organization/[organizationId]/training-plans/page.tsx",
    "src/app/(platform)/organization/[organizationId]/training-plans/new/page.tsx",
    "src/app/(platform)/organization/[organizationId]/training-plans/[planId]/page.tsx",
    "src/app/(platform)/organization/[organizationId]/training-plans/[planId]/edit/page.tsx",
    "src/app/(platform)/sessions/training-plans/[planId]/page.tsx",
  ]) assert.ok(existsSync(join(root, path)), path);
});

test("plan writes use only guarded RPCs and athlete detail has no write controls", () => {
  const actions = read("src/features/organizations/training-plans-actions.ts");
  assert.match(actions, /rpc\("save_training_plan"/);
  assert.match(actions, /rpc\("delete_training_plan"/);
  assert.doesNotMatch(actions, /\.from\("training_plans"\)\.(insert|update|delete)/);
  const athlete = read("src/app/(platform)/sessions/training-plans/[planId]/page.tsx");
  assert.doesNotMatch(athlete, /saveTrainingPlan|deleteTrainingPlan|CoachPlanForm/);
});

test("Coach form has active-athlete selection and explicit shared-edit and delete confirmations", () => {
  const ui = read("src/features/organizations/components/training-plan-ui.tsx");
  assert.match(ui, /Search athletes/);
  assert.match(ui, /Select All/);
  assert.match(ui, /Clear All/);
  assert.match(ui, /Changes will apply to everyone assigned to this plan/);
  assert.match(ui, /Athlete Sessions, Rounds, Arrows and scores will be unaffected/);
  assert.match(ui, /No Training Plans yet/);
});

test("web athlete Sessions keeps a ring for each active plan and Coach uses the same progress model", () => {
  const ui = read("src/features/organizations/components/training-plan-ui.tsx");
  const sessions = read("src/app/(platform)/sessions/page.tsx");
  const reader = read("src/features/organizations/training-plans-read.server.ts");
  assert.match(sessions, /<AthletePlanCard plans=\{plans\}/);
  assert.match(ui, /active\.map\(\(\{ plan, progress \}\)/);
  assert.match(ui, /<GoalRing week=\{displayedWeek\(progress, today\)\}/);
  assert.match(ui, /<GoalRing week=\{displayedWeek\(selected\.progress, today\)\}/);
  assert.match(reader, /calculateTrainingPlanProgress\(plan, athlete\.userId, sessions, asOfDate\)/);
  assert.match(reader, /arrow_count/);
});

test("web scoring refreshes server-rendered Training Plan progress only after Arrow saves flush", () => {
  const scoring = read("src/features/sessions/components/scoring-workspace.tsx");
  const workspace = read("src/features/sessions/components/sessions-workspace.tsx");
  const flush = scoring.indexOf("const settled=await queue.flush()");
  const guard = scoring.indexOf("if (settled)", flush);
  const back = scoring.indexOf("destination()", guard);
  const refresh = workspace.indexOf("router.refresh()", workspace.indexOf("onBack="));
  assert.ok(flush >= 0 && guard > flush && back > guard, "back navigation must follow a successful queue flush");
  assert.ok(refresh >= 0, "return to Session must request fresh server-rendered Training Plan progress");
  assert.match(workspace, /onBack=\{\(\)=>\{setView\("session"\);router\.refresh\(\);\}\}/);
});
