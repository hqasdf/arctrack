import assert from "node:assert/strict";
import test from "node:test";
import { createGroupingExport, renderGroupingExport } from "../src/grouping-export.ts";
import { calculateGroupingForArrows } from "../src/session-insights-model.ts";

const round = { id: "round", roundNumber: 3, name: 'Round <one> & "two"', division: "Recurve",
  distanceMetres: 70, ends: 3, arrowsPerEnd: 6, faceDiameterCm: 122, faceType: "full_face",
  arrows: [
    { id: "a2", end: 1, arrow: 2, score: "9", plot: { x: .208, y: 0 } },
    { id: "a1", end: 1, arrow: 1, score: "X", plot: { x: .058, y: 0 } },
    { id: "a3", end: 1, arrow: 3, score: "8", plot: { x: .218, y: .1 } },
    { id: "m", end: 3, arrow: 1, score: "M", plot: null },
  ] };

test("export includes all planned Ends, ordered Arrow values, X/M, partial/empty scores and total", () => {
  const report = createGroupingExport(round, "Practice");
  assert.deepEqual(report.ends.map((end) => end.end), [1, 2, 3]);
  assert.deepEqual(report.ends.map((end) => end.score), [27, null, 0]);
  assert.deepEqual(report.ends[0].arrows.map((arrow) => arrow.label), ["10X", "9", "8"]);
  assert.deepEqual(report.ends[2].arrows, [{ number: 1, label: "M" }]);
  assert.equal(report.total, 27); assert.equal(report.xCount, 1);
});

test("export is one detached snapshot and preserves raw coordinates and authoritative corrected scores", () => {
  const input = structuredClone(round);
  const report = createGroupingExport(input);
  input.arrows[0].score = "10"; input.arrows[0].plot.x = .9;
  assert.equal(report.ends[0].arrows[1].label, "9");
  assert.equal(report.grouping.arrows[0].x, .208);
  assert.equal(report.total, 27);
  assert.deepEqual(report.grouping, calculateGroupingForArrows(round.arrows, round.faceType, round.faceDiameterCm));
});

test("static report safely escapes text and excludes interactive UI", () => {
  const { svg, width, height } = renderGroupingExport(createGroupingExport(round));
  assert.equal(width, 800); assert.ok(height > 600);
  assert.match(svg, /Round &lt;one&gt; &amp; &quot;two&quot;/);
  assert.match(svg, /10X · 9 · 8/); assert.match(svg, /END 2/); assert.match(svg, /27 pts/);
  assert.doesNotMatch(svg, /onClick|Retry|Reset zoom|selectedHalo|foreignObject/);
});

test("all layouts keep original plot coordinates, and triple markers stay on their local faces", () => {
  for (const faceType of ["full_face", "six_ring", "triple_face"]) {
    const input = structuredClone(round); input.faceType = faceType;
    input.arrows[0].plot.faceIndex = 0; input.arrows[1].plot.faceIndex = 2; input.arrows[2].plot.faceIndex = 1;
    const report = createGroupingExport(input);
    assert.deepEqual(report.round.arrows, input.arrows);
    assert.equal(report.grouping.arrows.length, 3);
    const { svg } = renderGroupingExport(report);
    if (faceType === "triple_face") { assert.match(svg, /cy="-110"/); assert.match(svg, /cy="110"/); }
  }
});

test("large Ends retain every entered Arrow rather than truncating to one report row", () => {
  const input = { ...round, ends: 1, arrows: Array.from({ length: 50 }, (_, i) => ({ id: String(i),
    end: 1, arrow: i + 1, score: "X", plot: null })) };
  const report = createGroupingExport(input);
  assert.equal(report.ends[0].arrows.length, 50); assert.equal(report.total, 500);
  assert.equal((renderGroupingExport(report).svg.match(/10X/g) ?? []).length, 50);
});
