import assert from "node:assert/strict";
import test from "node:test";
import { newestRoundsFirst } from "../src/round-order-model.ts";

test("Rounds display newest first by round number without renumbering or mutating source data", () => {
  const rounds = [1, 2, 3].map((roundNumber) => ({ roundNumber, edited: false }));
  const result = newestRoundsFirst(rounds);
  assert.deepEqual(result.map((round) => round.roundNumber), [3, 2, 1]);
  assert.deepEqual(rounds.map((round) => round.roundNumber), [1, 2, 3]);

  const withGaps = [{ roundNumber: 1 }, { roundNumber: 3 }, { roundNumber: 5 }];
  assert.deepEqual(newestRoundsFirst(withGaps).map((round) => round.roundNumber), [5, 3, 1]);

  withGaps[0].edited = true;
  assert.deepEqual(newestRoundsFirst(withGaps).map((round) => round.roundNumber), [5, 3, 1]);
  const afterAdding = [...withGaps, { roundNumber: 6 }];
  assert.deepEqual(newestRoundsFirst(afterAdding).map((round) => round.roundNumber), [6, 5, 3, 1]);
  assert.deepEqual(afterAdding.map((round) => round.roundNumber), [1, 3, 5, 6]);
});
