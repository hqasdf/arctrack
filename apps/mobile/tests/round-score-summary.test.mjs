import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const source = await readFile(new URL("../app/rounds/[roundId]/score.tsx", import.meta.url), "utf8");
const target = await readFile(new URL("../src/native-target.tsx", import.meta.url), "utf8");
test("Expo removes normal End-summary card while retaining End history and live totals", () => {
  assert.doesNotMatch(source, /scoreSummary/);
  assert.match(source, /endTotal\(arrows, slot\.end\)/);
  assert.match(source, /roundTotal\(arrows\)/);
  assert.match(source, /End history/);
});
test("Expo Group Position is a sibling following NativeTarget outside its responder", () => {
  assert.ok(source.indexOf("<NativeTarget ") < source.indexOf("<RoundGroupPosition "));
  assert.doesNotMatch(target, /RoundGroupPosition|GroupingExport/);
  assert.match(source, /showGroupPosition={false}/);
});
test("Expo exports the current Arrow snapshot after Group Position and before insights", async () => {
  assert.ok(source.indexOf("<RoundGroupPosition ") < source.indexOf("<GroupingExportButton "));
  assert.ok(source.indexOf("<GroupingExportButton ") < source.indexOf("<RoundInsights "));
  assert.match(source, /GroupingExportButton round={{\s*\.\.\.round,\s*arrows\s*}}/);
  const exporter = await readFile(new URL("../src/grouping-export.tsx", import.meta.url), "utf8");
  assert.match(exporter, /createGroupingExport\(round, context\)/);
  assert.match(exporter, /renderMobileGroupingExport\(report\)/);
  assert.match(exporter, /Sharing\.shareAsync\(file/);
  assert.match(exporter, /pointerEvents: "none"/);
  assert.doesNotMatch(exporter, /supabase|scoreFromPlot/);
});
