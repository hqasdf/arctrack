import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { summarizeRoundScores } from "../../../packages/core/src/scoring-model.ts";

const source = await readFile(new URL("../app/rounds/[roundId]/score.tsx", import.meta.url), "utf8");

test("Expo score card renders all planned End scores, partial scores, empty dashes, and total", () => {
  const summary = summarizeRoundScores([
    { id: "a1", end: 1, arrow: 1, score: "X", plot: null },
    { id: "a2", end: 1, arrow: 2, score: "9", plot: null },
    { id: "a3", end: 3, arrow: 1, score: "M", plot: null },
  ], 3);
  assert.deepEqual(summary.ends.map((end) => end.score), [19, null, 0]);
  assert.equal(summary.total, 19);
  assert.match(source, /scoreSummary\.ends\.map\(\(\{ end, score \}\)/);
  assert.match(source, /score === null \? "—" : score/);
  assert.match(source, /scoreSummary\.total/);
});

test("Expo score card follows the main target and precedes Round insights", () => {
  const target = source.indexOf("<NativeTarget ");
  const card = source.indexOf('<View style={styles.scoreSummary}');
  const insights = source.indexOf("<RoundInsights round={{ ...round, arrows }} />");
  assert.ok(target >= 0 && target < card && card < insights);
});

test("Expo card and score totals use the same live Arrow state as the score labels", () => {
  assert.match(source, /summarizeRoundScores\(arrows, round\.ends\)/);
  assert.match(source, /endTotal\(arrows, slot\.end\)/);
  assert.match(source, /roundTotal\(arrows\)/);
  assert.match(source, /const arrow = arrows\.find/);
});
