import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createGroupingExport } from "../packages/core/src/grouping-export.ts";
const workspace = await readFile(new URL("../src/features/sessions/components/scoring-workspace.tsx", import.meta.url), "utf8");
const target = await readFile(new URL("../src/features/sessions/components/target-face.tsx", import.meta.url), "utf8");
test("web keeps End history and totals but removes the target score-summary card", () => {
  assert.doesNotMatch(workspace, /RoundScoreCard|scoreSummary/);
  assert.match(workspace, /endTotal\(round\.arrows,slot\.end\)/);
  assert.match(workspace, /roundTotal\(round\.arrows\)/);
  assert.match(workspace, /End history/);
});
test("Group Position follows the closed target card; export follows it outside pointer handlers", () => {
  const svgEnd = target.indexOf("</svg>");
  const position = target.indexOf("<GroupPositionSummary");
  assert.ok(svgEnd >= 0 && target.slice(svgEnd, position).includes("</div>"));
  assert.ok(workspace.indexOf("<TargetFace ") < workspace.indexOf("<GroupingExportButton "));
  assert.ok(workspace.indexOf("<GroupingExportButton ") < workspace.indexOf("<RoundInsights "));
});
test("web export receives the same current Round used by target labels and totals", () => {
  assert.match(workspace, /<GroupingExportButton round={round}/);
  const report = createGroupingExport({ id:"r",roundNumber:1,name:"Test",division:"Recurve",distanceMetres:70,
    ends:3,arrowsPerEnd:6,faceDiameterCm:122,faceType:"full_face",arrows:[
      {id:"a",end:1,arrow:1,score:"X",plot:null},{id:"b",end:1,arrow:2,score:"9",plot:null}] });
  assert.deepEqual(report.ends.map(end => end.score), [19,null,null]);
  assert.equal(report.total,19);
});
