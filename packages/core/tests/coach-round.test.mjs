import assert from "node:assert/strict";
import test from "node:test";
import { buildCoachRoundHierarchy, summarizeCoachRound } from "../src/coach-round-model.ts";

const round = { id: "r1", roundNumber: 1, name: "70m", division: "Recurve", distanceMetres: 70,
  faceDiameterCm: 122, faceType: "full_face", ends: 2, arrowsPerEnd: 2,
  arrows: [
    { id: "a2", end: 1, arrow: 2, score: "10", plot: { x: 0, y: 0 } },
    { id: "a1", end: 1, arrow: 1, score: "X", plot: { x: 0.01, y: 0.02 } },
    { id: "a3", end: 2, arrow: 1, score: "M", plot: null },
  ] };

test("coach hierarchy includes empty Ends and keeps saved Arrow order", () => {
  const session = { id: "s1", title: "Training", date: "2026-09-27", sessionType: "training", arrowCount: 24, rounds: [round] };
  const [detail] = buildCoachRoundHierarchy(session, [
    { roundId: "r1", id: "e2", endNumber: 2 }, { roundId: "r1", id: "e1", endNumber: 1 },
  ]);
  assert.deepEqual(detail.ends.map((end) => end.id), ["e1", "e2"]);
  assert.deepEqual(detail.ends[0].arrows.map((arrow) => arrow.id), ["a1", "a2"]);
  assert.deepEqual(detail.ends[1].arrows.map((arrow) => arrow.score), ["M"]);
});

test("coach score distribution and progression derive from saved arrows, including partial Ends", () => {
  const result = summarizeCoachRound(round);
  assert.equal(result.total, 20);
  assert.equal(result.average, 20 / 3);
  assert.equal(result.xCount, 1);
  assert.equal(result.tenPlusXCount, 2);
  assert.equal(result.plottedCount, 2);
  assert.equal(result.expectedArrows, 4);
  assert.deepEqual(result.distribution.filter((item) => item.count).map((item) => [item.score, item.count]), [["X", 1], ["10", 1], ["M", 1]]);
  assert.deepEqual(result.progression.map((end) => [end.endNumber, end.cumulative, end.complete]), [[1, 20, true], [2, 20, false]]);
  assert.deepEqual(result.arrowProgression.map((item) => [item.sequence, item.cumulative, item.average]), [[1, 10, 10], [2, 20, 10], [3, 20, 20 / 3]]);
});
