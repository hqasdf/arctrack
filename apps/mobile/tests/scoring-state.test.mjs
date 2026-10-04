import test from "node:test";
import assert from "node:assert/strict";
import { arrowKey, roundTotal } from "@arc-track/core/scoring";
import {
  plotFromNativeTouch, plotFromTransformedNativeTouch, shouldCommitNativeTap, zoomAndPanViewport,
  initialViewport,
} from "../src/native-target-geometry.ts";
import { scoreRoundHref } from "../src/round-navigation.ts";
import { arrowWriteFields } from "../src/arrow-write-model.ts";
import {
  applyArrowSaveResult, clearArrowPlot, correctArrowScore, deleteSelectedArrow, firstEmptySlot, latestScore, nextEmptySlot,
  plotCurrentArrow, previousPlottedArrow, restoreDeletedArrow,
} from "../src/scoring-state.ts";

const round = {
  id: "round", roundNumber: 1, name: "Practice", division: "Recurve", distanceMetres: 70,
  ends: 2, arrowsPerEnd: 3, faceDiameterCm: 122, faceType: "full_face", arrows: [],
};

test("manual score correction preserves the plot; clearing marker preserves the score", () => {
  const plotted = plotCurrentArrow(round, [], { end: 1, arrow: 1 }, { x: 0.15, y: 0 }).entry;
  const corrected = correctArrowScore(plotted, "10");
  assert.deepEqual(corrected.plot, plotted.plot);
  assert.equal(corrected.score, "10");
  const cleared = clearArrowPlot(corrected);
  assert.equal(cleared.plot, null);
  assert.equal(cleared.score, "10");
  const moved = plotCurrentArrow(round, [corrected], { end: 1, arrow: 1 }, { x: 0.25, y: 0 });
  assert.equal(moved.entry.score, "8");
  assert.deepEqual(moved.slot, { end: 1, arrow: 1 });
});

test("next empty slot and new Arrow auto-advance across the End boundary", () => {
  let arrows = [];
  let slot = firstEmptySlot(round, arrows);
  assert.deepEqual(slot, { end: 1, arrow: 1 });
  for (let index = 0; index < 4; index++) {
    const result = plotCurrentArrow(round, arrows, slot, { x: 0.15, y: 0 });
    assert.equal(result.isNew, true);
    assert.equal(result.entry.score, "9");
    arrows = result.arrows;
    slot = result.slot;
  }
  assert.deepEqual(slot, { end: 2, arrow: 2 });
  assert.equal(roundTotal(arrows), 36);
  assert.deepEqual(nextEmptySlot(round, arrows, { end: 1, arrow: 1 }), { end: 2, arrow: 2 });
});

test("the final planned Arrow stays selected after the Round fills", () => {
  let arrows = [];
  let slot = firstEmptySlot(round, arrows);
  for (let index = 0; index < round.ends * round.arrowsPerEnd; index++) {
    const result = plotCurrentArrow(round, arrows, slot, { x: .15, y: 0 });
    arrows = result.arrows;
    slot = result.slot;
  }
  assert.deepEqual(slot, { end: 2, arrow: 3 });
});

test("moving an existing Arrow recalculates its score and keeps the selection", () => {
  const first = plotCurrentArrow(round, [], { end: 1, arrow: 1 }, { x: 0.15, y: 0 });
  const moved = plotCurrentArrow(round, first.arrows, { end: 1, arrow: 1 }, { x: 0.01, y: 0 });
  assert.equal(moved.isNew, false);
  assert.deepEqual(moved.slot, { end: 1, arrow: 1 });
  assert.equal(moved.entry.score, "X");
  assert.deepEqual(moved.entry.plot, { x: 0.01, y: 0 });
  assert.equal(roundTotal(moved.arrows), 10);
});

test("moving an Arrow into the 0.01 allowance updates its score and keeps its stored position", () => {
  const first = plotCurrentArrow(round, [], { end: 1, arrow: 1 }, { x: 0.15, y: 0 });
  const moved = plotCurrentArrow(round, first.arrows, { end: 1, arrow: 1 }, { x: 0.108, y: 0 });
  assert.equal(moved.entry.score, "10");
  assert.deepEqual(moved.entry.plot, { x: 0.108, y: 0 });
  assert.deepEqual(moved.slot, { end: 1, arrow: 1 });
});

test("delete selects next plotted Arrow repeatedly, then previous, then empty", () => {
  const a1 = { id: "a1", end: 1, arrow: 1, score: "9", plot: { x: 0.15, y: 0 } };
  const a2 = { id: "a2", end: 1, arrow: 2, score: "10", plot: { x: 0.08, y: 0 } };
  const a3 = { id: "a3", end: 2, arrow: 1, score: "8", plot: { x: 0.25, y: 0 } };
  const first = deleteSelectedArrow(round, [a1, a2, a3], a1);
  assert.deepEqual(first.slot, { end: 1, arrow: 2 });
  const second = deleteSelectedArrow(round, first.arrows, a2);
  assert.deepEqual(second.slot, { end: 2, arrow: 1 });
  const third = deleteSelectedArrow(round, second.arrows, a3);
  assert.deepEqual(third.slot, { end: 1, arrow: 1 });
  assert.equal(third.arrows.length, 0);
  assert.deepEqual(deleteSelectedArrow(round, [a1, a2, a3], a3).slot, { end: 1, arrow: 2 });
});

test("latest score stays on the last plot after auto-advance and falls back on reload", () => {
  const first = plotCurrentArrow(round, [], { end: 1, arrow: 1 }, { x: 0.08, y: 0 });
  assert.equal(first.entry.score, "10");
  assert.deepEqual(first.slot, { end: 1, arrow: 2 });
  assert.equal(latestScore(first.arrows, arrowKey(1, 1)), "10");
  assert.equal(latestScore(first.arrows, null), "10");
});

test("native touch geometry preserves normalized full, six-ring, and triple-face plots", () => {
  assert.deepEqual(plotFromNativeTouch(105, 105, 210, 210, "full_face"), { x: 0, y: 0 });
  assert.deepEqual(plotFromNativeTouch(65, 65, 130, 130, "six_ring"), { x: 0, y: 0 });
  const top = plotFromNativeTouch(58, 58, 116, 336, "triple_face");
  const bottom = plotFromNativeTouch(58, 278, 116, 336, "triple_face");
  assert.deepEqual(top, { x: 0, y: 0, faceIndex: 0 });
  assert.deepEqual(bottom, { x: 0, y: 0, faceIndex: 2 });
  const triple = { ...round, faceType: "triple_face" };
  const tripleEntry = plotCurrentArrow(triple, [], { end: 1, arrow: 1 }, bottom).entry;
  assert.deepEqual(tripleEntry.plot, bottom);
  assert.equal(tripleEntry.score, "X");
  const six = { ...round, faceType: "six_ring" };
  assert.equal(plotCurrentArrow(six, [], { end: 1, arrow: 1 }, { x: .65, y: 0 }).entry.score, "M");
});

test("a two-finger or moved target gesture cannot plot", () => {
  assert.equal(shouldCommitNativeTap({ moved: false, hadMultiTouch: false, changedTouchCount: 1 }), true);
  assert.equal(shouldCommitNativeTap({ moved: false, hadMultiTouch: true, changedTouchCount: 1 }), false);
  assert.equal(shouldCommitNativeTap({ moved: true, hadMultiTouch: false, changedTouchCount: 1 }), false);
  assert.equal(shouldCommitNativeTap({ moved: false, hadMultiTouch: false, changedTouchCount: 2 }), false);
});

test("failed optimistic delete restores the Arrow without replacing a newer entry", () => {
  const removed = { id: "a1", end: 1, arrow: 1, score: "9", plot: { x: 0.15, y: 0 } };
  assert.deepEqual(restoreDeletedArrow([], removed), [removed]);
  const replacement = { ...removed, id: "new-a1", score: "X" };
  assert.deepEqual(restoreDeletedArrow([replacement], removed), [replacement]);
});

test("failed saves stay visible and older responses cannot overwrite a newer edit", () => {
  const plotted = plotCurrentArrow(round, [], { end: 1, arrow: 1 }, { x: .15, y: 0 }).arrows;
  const failed = applyArrowSaveResult(plotted, arrowKey(1, 1), 1, 1, { failed: true });
  assert.equal(failed[0].syncState, "failed");
  assert.equal(failed[0].score, "9");
  const moved = plotCurrentArrow(round, failed, { end: 1, arrow: 1 }, { x: .08, y: 0 }).arrows;
  assert.strictEqual(applyArrowSaveResult(moved, arrowKey(1, 1), 1, 2, { id: "stale-id" }), moved);
  const saved = applyArrowSaveResult(moved, arrowKey(1, 1), 2, 2, { id: "saved-id" });
  assert.equal(saved[0].id, "saved-id");
  assert.equal(saved[0].score, "10");
  assert.equal(saved[0].syncState, "saved");
});

test("Arrow writes preserve X points, misses, coordinates, and triple-face index", () => {
  assert.deepEqual(arrowWriteFields({ id: "a1", end: 1, arrow: 1, score: "X", plot: { x: 0.02, y: -0.03, faceIndex: 2 } }), {
    score_points: 10, is_x: true, plot_x: 0.02, plot_y: -0.03, face_index: 2,
  });
  assert.deepEqual(arrowWriteFields({ id: "a2", end: 1, arrow: 2, score: "M", plot: null }), {
    score_points: 0, is_x: false, plot_x: null, plot_y: null, face_index: null,
  });
});

test("existing and newly created Rounds navigate directly to native scoring", () => {
  assert.deepEqual(scoreRoundHref("round-id"), {
    pathname: "/rounds/[roundId]/score", params: { roundId: "round-id" },
  });
});

test("Delete targets the previous plotted Arrow without selecting it, including across Ends", () => {
  const a1 = { id: "a1", end: 1, arrow: 1, score: "9", plot: { x: .15, y: 0 } };
  const a2 = { id: "a2", end: 1, arrow: 2, score: "10", plot: { x: .08, y: 0 } };
  const a3 = { id: "a3", end: 1, arrow: 3, score: "8", plot: { x: .25, y: 0 } };
  assert.equal(previousPlottedArrow([], { end: 1, arrow: 1 }), null);
  assert.equal(previousPlottedArrow([a1], { end: 1, arrow: 2 }), a1);
  assert.equal(previousPlottedArrow([a1, a2], { end: 1, arrow: 3 }), a2);
  assert.equal(previousPlottedArrow([a1, a2, a3], { end: 2, arrow: 1 }), a3);
  const remaining = [a1, a3];
  assert.deepEqual({ end: a2.end, arrow: a2.arrow }, { end: 1, arrow: 2 });
  assert.equal(roundTotal(remaining), 17);
  assert.equal(previousPlottedArrow(remaining, { end: 1, arrow: 2 }), a1);
  assert.equal(latestScore(remaining, arrowKey(1, 2)), "8");
});

test("zoom and pan invert to the same normalized plot for full, six, and triple faces", () => {
  const viewport = zoomAndPanViewport(initialViewport, { x: 105, y: 105 }, { x: 120, y: 95 }, 2, 210, 210);
  assert.equal(viewport.scale, 2);
  assert.deepEqual(plotFromTransformedNativeTouch(120, 95, 210, 210, "full_face", viewport), { x: 0, y: 0 });
  const six = zoomAndPanViewport(initialViewport, { x: 65, y: 65 }, { x: 80, y: 70 }, 3, 130, 130);
  assert.deepEqual(plotFromTransformedNativeTouch(80, 70, 130, 130, "six_ring", six), { x: 0, y: 0 });
  const triple = zoomAndPanViewport(initialViewport, { x: 58, y: 58 }, { x: 75, y: 88 }, 2, 116, 336);
  assert.deepEqual(plotFromTransformedNativeTouch(75, 88, 116, 336, "triple_face", triple), { x: 0, y: 0, faceIndex: 0 });
  const bottom = zoomAndPanViewport(initialViewport, { x: 58, y: 278 }, { x: 75, y: 308 }, 2, 116, 336);
  assert.deepEqual(plotFromTransformedNativeTouch(75, 308, 116, 336, "triple_face", bottom), { x: 0, y: 0, faceIndex: 2 });
});
