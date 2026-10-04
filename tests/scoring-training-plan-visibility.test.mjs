import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Training Plan content belongs to non-scoring Sessions views, not the scoring return", async () => {
  const page = await readFile(new URL("../src/app/(platform)/sessions/page.tsx", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../src/features/sessions/components/sessions-workspace.tsx", import.meta.url), "utf8");
  const scoring = await readFile(new URL("../src/features/sessions/components/scoring-workspace.tsx", import.meta.url), "utf8");
  assert.match(page, /readOwnTrainingPlanProgress\(today\)/);
  assert.match(page, /SessionsWorkspace initialSessions={sessions} trainingPlanContent=/);
  assert.match(page, /AthletePlanCard plans={plans} today={today}/);
  const scoringBranch = workspace.slice(workspace.indexOf('if (view==="scoring"'), workspace.indexOf('return <>{trainingPlanContent}'));
  assert.match(scoringBranch, /return <ScoringWorkspace/);
  assert.doesNotMatch(scoringBranch, /trainingPlanContent|AthletePlanCard/);
  assert.doesNotMatch(scoring, /AthletePlanCard|readOwnTrainingPlanProgress/);
  assert.match(scoring, /const settled=await queue.flush\(\)/);
  assert.match(scoringBranch, /onBack={\(\)=>{setView\("session"\);router.refresh\(\);}}/);
});
