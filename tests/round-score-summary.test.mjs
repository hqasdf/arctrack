import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { summarizeRoundScores } from "../packages/core/src/scoring-model.ts";

const workspaceSource = await readFile(new URL("../src/features/sessions/components/scoring-workspace.tsx", import.meta.url), "utf8");
const targetSource = await readFile(new URL("../src/features/sessions/components/target-face.tsx", import.meta.url), "utf8");

test("web score card uses plotted Arrow state and renders planned End scores plus total", () => {
  assert.match(workspaceSource, /summarizeRoundScores\(round\.arrows,round\.ends\)/);
  assert.match(workspaceSource, /summary\.ends\.map\(\(\{end,score\}\)/);
  assert.match(workspaceSource, /score===null\?"—":score/);
  assert.match(workspaceSource, /summary\.total/);
  assert.match(workspaceSource, /endTotal\(round\.arrows,slot\.end\)/);
  assert.match(workspaceSource, /roundTotal\(round\.arrows\)/);
});

test("web End score card sits between the interactive target and Round insights", () => {
  const target = workspaceSource.indexOf("<TargetFace ");
  const card = workspaceSource.indexOf("<RoundScoreCard summary={scoreSummary}/>");
  const insights = workspaceSource.indexOf("<RoundInsights round={round}/>");
  assert.ok(target >= 0 && target < card && card < insights);
  assert.ok(targetSource.indexOf("{children}") < targetSource.indexOf("<GroupPositionSummary"));
});

test("web partial End, empty planned End, and Round total share one score derivation", () => {
  const arrows = [
    { id: "a1", end: 1, arrow: 1, score: "10", plot: null },
    { id: "a2", end: 1, arrow: 2, score: "9", plot: null },
    { id: "a3", end: 3, arrow: 1, score: "M", plot: null },
  ];
  const summary = summarizeRoundScores(arrows, 3);
  assert.deepEqual(summary.ends.map((end) => end.score), [19, null, 0]);
  assert.equal(summary.total, 19);
});
