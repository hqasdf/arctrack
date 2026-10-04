import test from "node:test";
import assert from "node:assert/strict";
import { roundTotal, xCount } from "@arc-track/core/scoring";
import { mapSessionDetail } from "../src/session-mapper.ts";

test("saved Session hierarchy maps scored and plotted Arrows for native read-only views", () => {
  const session = mapSessionDetail({
    id: "s1", title: "Practice", session_date: "2026-09-26", session_type: "training", arrow_count: 72,
    session_rounds: [{
      id: "r1", round_number: 1, name: "70 m", division: "Recurve", distance_metres: 70,
      face_diameter_cm: 122, face_type: "full_face", planned_ends: 2, arrows_per_end: 2,
      session_ends: [
        { end_number: 2, arrows: [{ id: "a3", arrow_number: 1, score_points: 0, is_x: false, plot_x: null, plot_y: null, face_index: null }] },
        { end_number: 1, arrows: [
          { id: "a2", arrow_number: 2, score_points: 10, is_x: true, plot_x: 0.02, plot_y: -0.03, face_index: null },
          { id: "a1", arrow_number: 1, score_points: 9, is_x: false, plot_x: 0.12, plot_y: 0.01, face_index: null },
        ] },
      ],
    }],
  });
  assert.equal(session.arrowCount, 72);
  assert.deepEqual(session.rounds[0].arrows.map((arrow) => [arrow.end, arrow.arrow, arrow.score]), [[1, 1, "9"], [1, 2, "X"], [2, 1, "M"]]);
  assert.deepEqual(session.rounds[0].arrows[1].plot, { x: 0.02, y: -0.03 });
  assert.equal(roundTotal(session.rounds[0].arrows), 19);
  assert.equal(xCount(session.rounds[0].arrows), 1);
});

test("empty Rounds and triple-face plot indexes remain available after reload", () => {
  const session = mapSessionDetail({
    id: "s2", title: "Indoor", session_date: "2026-09-25", session_type: "competition", arrow_count: 30,
    session_rounds: [
      { id: "r2", round_number: 2, name: "Empty", division: "Recurve", distance_metres: 18, face_diameter_cm: 40, face_type: "full_face", planned_ends: 5, arrows_per_end: 6, session_ends: [] },
      { id: "r1", round_number: 1, name: "Triple", division: "Compound", distance_metres: 18, face_diameter_cm: 40, face_type: "triple_face", planned_ends: 1, arrows_per_end: 3,
        session_ends: [{ end_number: 1, arrows: [{ id: "a1", arrow_number: 1, score_points: 10, is_x: false, plot_x: -0.1, plot_y: 0.2, face_index: 2 }] }] },
    ],
  });
  assert.deepEqual(session.rounds.map((round) => round.name), ["Empty", "Triple"]);
  assert.deepEqual(session.rounds[1].arrows[0].plot, { x: -0.1, y: 0.2, faceIndex: 2 });
  assert.equal(session.rounds[0].arrows.length, 0);
  assert.equal(roundTotal(session.rounds[0].arrows), 0);
});

test("Session Round display uses descending canonical numbers with gaps and ignores editing", () => {
  const base = {
    title: "Practice", session_date: "2026-09-26", session_type: "training", arrow_count: 0,
    session_rounds: [1, 3, 5].map((round_number) => ({
      id: `r${round_number}`, round_number, name: `Round ${round_number}`, division: "Recurve",
      distance_metres: 70, face_diameter_cm: 122, face_type: "full_face", planned_ends: 1,
      arrows_per_end: 1, session_ends: [],
    })),
  };
  const loaded = mapSessionDetail({ id: "s3", ...base });
  assert.deepEqual(loaded.rounds.map((round) => [round.name, round.roundNumber]), [
    ["Round 5", 5], ["Round 3", 3], ["Round 1", 1],
  ]);
  loaded.rounds[2].name = "Edited Round 1";
  assert.deepEqual(loaded.rounds.map((round) => round.roundNumber), [5, 3, 1]);
  const withNewRound = mapSessionDetail({ id: "s4", ...base,
    session_rounds: [...base.session_rounds, { ...base.session_rounds[0], id: "r6", round_number: 6, name: "Round 6" }],
  });
  assert.deepEqual(withNewRound.rounds.map((round) => round.roundNumber), [6, 5, 3, 1]);
});
