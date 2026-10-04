import assert from "node:assert/strict";
import test from "node:test";
import { endTotal, points, roundTotal, scoreFromPlot, summarizeRoundScores, xCount } from "../src/scoring-model.ts";

test("scoring boundary allowance awards the higher ring without changing coordinates", () => {
  for (const [radius, expected] of [
    [0.06, "X"], [0.061, "10"], [0.11, "10"], [0.111, "9"],
    [0.21, "9"], [0.211, "8"], [0.31, "8"], [0.311, "7"],
    [0.41, "7"], [0.411, "6"], [0.51, "6"], [0.511, "5"],
    [0.61, "5"], [0.611, "4"], [0.71, "4"], [0.711, "3"],
    [0.81, "3"], [0.811, "2"], [0.91, "2"], [0.911, "1"],
    [1.01, "1"], [1.011, "M"],
  ]) {
    assert.equal(scoreFromPlot({ x: radius, y: 0 }), expected);
  }
  assert.equal(scoreFromPlot({ x: 0.058, y: 0 }), "X");
  assert.equal(scoreFromPlot({ x: 0.108, y: 0 }), "10");
  assert.equal(scoreFromPlot({ x: 0.115, y: 0 }), "9");
  assert.equal(scoreFromPlot({ x: 0.208, y: 0 }), "9");
  assert.equal(scoreFromPlot({ x: 0.218, y: 0 }), "8");
  const plot = Object.freeze({ x: 0.084, y: 0.067, faceIndex: 2 });
  assert.equal(scoreFromPlot(plot), "10");
  assert.deepEqual(plot, { x: 0.084, y: 0.067, faceIndex: 2 });
});

test("full faces share normalized boundaries and limited layouts keep only their scoring rings", () => {
  for (const faceDiameterCm of [122, 80, 40]) {
    assert.equal(scoreFromPlot({ x: 0.108, y: 0 }), "10", `${faceDiameterCm} cm full face`);
  }
  assert.equal(scoreFromPlot({ x: 0.06, y: 0 }, "six_ring"), "X");
  assert.equal(scoreFromPlot({ x: 0.61, y: 0 }, "six_ring"), "5");
  assert.equal(scoreFromPlot({ x: 0.611, y: 0 }, "six_ring"), "M");
  assert.equal(scoreFromPlot({ x: 0.70, y: 0 }, "six_ring"), "M");
  assert.equal(scoreFromPlot({ x: 0.51, y: 0, faceIndex: 0 }, "triple_face"), "6");
  assert.equal(scoreFromPlot({ x: 0.511, y: 0, faceIndex: 0 }, "triple_face"), "M");
  assert.equal(scoreFromPlot({ x: 0.30, y: 0, faceIndex: 2 }, "triple_face"), "8");
});

test("round score summary lists planned Ends in order, with partial, empty, and total scores", () => {
  const arrows = [
    { id: "a1", end: 1, arrow: 1, score: "X", plot: null },
    { id: "a2", end: 1, arrow: 2, score: "9", plot: null },
    { id: "a3", end: 3, arrow: 1, score: "M", plot: null },
    { id: "a4", end: 4, arrow: 1, score: "7", plot: null },
    { id: "a5", end: 4, arrow: 2, score: "8", plot: null },
  ];
  assert.deepEqual(summarizeRoundScores(arrows, 4), {
    ends: [
      { end: 1, score: 19 },
      { end: 2, score: null },
      { end: 3, score: 0 },
      { end: 4, score: 15 },
    ],
    total: 34,
  });
  assert.deepEqual(summarizeRoundScores([], 2), {
    ends: [{ end: 1, score: null }, { end: 2, score: null }], total: 0,
  });
});

test("X contributes ten points and End totals use only their own arrows", () => {
  const arrows = [
    { end: 1, arrow: 1, score: "X" },
    { end: 1, arrow: 2, score: "9" },
    { end: 2, arrow: 1, score: "M" },
  ];
  assert.equal(points("X"), 10);
  assert.equal(roundTotal(arrows), 19);
  assert.equal(endTotal(arrows, 1), 19);
  assert.equal(endTotal(arrows, 2), 0);
  assert.equal(xCount(arrows), 1);
});
