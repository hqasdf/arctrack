import test from "node:test";
import assert from "node:assert/strict";
import { addArrows, DEFAULT_COUNTER, readCounter, resetCounter, setIncrement, undoLastAddition } from "../src/features/arrow-counter/counter-model.ts";

test("selected increments add their full amount and can vary each time", () => {
  let state = addArrows(DEFAULT_COUNTER);
  assert.equal(state.totalArrows, 6);
  state = addArrows(setIncrement(state, 14));
  assert.equal(state.totalArrows, 20);
  assert.deepEqual(state.history.map(entry => entry.amount), [6, 14]);
  state = addArrows(setIncrement(state, 6));
  assert.equal(state.totalArrows, 26);
  assert.deepEqual(state.history.map(entry => entry.amount), [6, 14, 6]);
});

test("multiple Undo actions subtract each last addition in reverse order", () => {
  let state = addArrows(setIncrement(DEFAULT_COUNTER, 14));
  state = addArrows(setIncrement(state, 6));
  state = addArrows(setIncrement(state, 3));
  assert.equal(state.totalArrows, 23);
  state = undoLastAddition(state);
  assert.equal(state.totalArrows, 20);
  state = undoLastAddition(state);
  assert.equal(state.totalArrows, 14);
  state = undoLastAddition(state);
  assert.equal(state.totalArrows, 0);
  assert.equal(undoLastAddition(state), state);
});

test("any positive whole-number increment is accepted and invalid values are ignored", () => {
  const selected = setIncrement(DEFAULT_COUNTER, 437);
  assert.equal(selected.increment, 437);
  assert.equal(setIncrement(selected, 0), selected);
  assert.equal(setIncrement(selected, 1.5), selected);
  assert.equal(setIncrement(selected, Number.MAX_SAFE_INTEGER + 1), selected);
});

test("Reset clears total and undo history while keeping the selected increment", () => {
  const state = addArrows(setIncrement(DEFAULT_COUNTER, 14));
  assert.deepEqual(resetCounter(state), { version: 3, totalArrows: 0, increment: 14, history: [] });
});

test("saved counter and undo history survive reload; legacy totals are preserved", () => {
  const saved = addArrows(setIncrement(addArrows(DEFAULT_COUNTER), 14));
  assert.deepEqual(readCounter(JSON.parse(JSON.stringify(saved))), saved);
  assert.deepEqual(readCounter({ version: 1, arrowsPerEnd: 50, totalArrows: 151 }), { ...DEFAULT_COUNTER, totalArrows: 151 });
  assert.throws(() => readCounter({ version: 2, totalArrows: 10, increment: 6, history: [14] }));
  assert.throws(() => readCounter({ version: 2, totalArrows: -1, increment: 6, history: [] }));
});
