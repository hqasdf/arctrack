import test from "node:test";
import assert from "node:assert/strict";
import { buildRoundUpdateArgs, canConfigureRound, mapRoundUpdateResult, sameRoundAfterUpdate } from "../src/round-update-model.ts";
import { counterWheelRangeStart, counterWheelValueFromOffset, isPositiveCounterIncrement, shouldRecenterCounterWheel, shouldTickCounterWheel, COUNTER_TOTAL_COLUMN_FLEX, COUNTER_WHEEL_COLUMN_FLEX, COUNTER_WHEEL_ROW_HEIGHT, COUNTER_WHEEL_VISIBLE_ROWS } from "../src/counter-wheel-model.ts";
import { ANALYTICS_AXIS_LABELS, verticalBarHeight } from "../src/analytics-chart-model.ts";
import { MAIN_TAB_ICONS } from "../src/navigation-model.ts";
import { PAGE_TOP_SPACING } from "../src/theme.ts";
import { addArrows, readCounter, setIncrement } from "../src/counter-model.ts";

const emptyRound = { id: "round-a", roundNumber: 4, name: "Practice", division: "Recurve", distanceMetres: 70, ends: 6, arrowsPerEnd: 6, faceDiameterCm: 122, faceType: "full_face", arrows: [] };
const settings = { name: "  Tune-up  ", division: "Compound", distanceMetres: 50, faceDiameterCm: 80, plannedEnds: 8 };

test("Configure is available only while the actual Round Arrow list is empty", () => {
  assert.equal(canConfigureRound(emptyRound), true);
  assert.equal(canConfigureRound({ ...emptyRound, arrows: [{ end: 1, arrow: 1, score: "M", plot: null }] }), false);
  assert.equal(canConfigureRound({ ...emptyRound, arrows: [{ end: 1, arrow: 1, score: "9", plot: null }] }), false);
});

test("Round settings map only approved fields and retain the Round id", () => {
  const args = buildRoundUpdateArgs("round-a", 6, settings);
  assert.deepEqual(args, { p_round_id: "round-a", p_name: "Tune-up", p_division: "Compound", p_distance_metres: 50, p_face_diameter_cm: 80, p_planned_ends: 8 });
  assert.equal(sameRoundAfterUpdate("round-a", "round-a"), true);
  assert.equal("p_face_type" in args, false);
  assert.equal("p_arrows_per_end" in args, false);
});

test("Round update RPC result must confirm the same Round and requested End count", () => {
  assert.deepEqual(mapRoundUpdateResult("round-a", 8, { round_id: "round-a", planned_ends: 8 }, null), { roundId: "round-a", plannedEnds: 8 });
  assert.throws(() => mapRoundUpdateResult("round-a", 8, { round_id: "other-round", planned_ends: 8 }, null), /could not be saved/);
  assert.throws(() => mapRoundUpdateResult("round-a", 8, { round_id: "round-a", planned_ends: 6 }, null), /could not be saved/);
  assert.throws(() => mapRoundUpdateResult("round-a", 8, null, { message: "database details" }), /could not be saved/);
});

test("Round settings reject End decreases and invalid measurements", () => {
  assert.throws(() => buildRoundUpdateArgs("round-a", 6, { ...settings, plannedEnds: 5 }));
  assert.throws(() => buildRoundUpdateArgs("round-a", 6, { ...settings, distanceMetres: 0 }));
  assert.throws(() => buildRoundUpdateArgs("round-a", 6, { ...settings, faceDiameterCm: -1 }));
});

test("counter wheel maps its centred snapped row to a positive whole increment", () => {
  assert.equal(counterWheelValueFromOffset(3 * COUNTER_WHEEL_ROW_HEIGHT, 20, 520, 20), 23);
  assert.equal(counterWheelValueFromOffset(-300, 20, 520, 20), 20);
  assert.equal(counterWheelValueFromOffset(100_000, 20, 520, 20), 520);
  assert.equal(counterWheelRangeStart(1), 1);
  assert.equal(counterWheelRangeStart(10_000), 9_750);
  assert.equal(shouldRecenterCounterWheel(2, 1, 501), true);
  assert.equal(shouldRecenterCounterWheel(250, 1, 501), false);
  assert.equal(isPositiveCounterIncrement(1), true);
  assert.equal(isPositiveCounterIncrement(0), false);
  assert.equal(isPositiveCounterIncrement(-2), false);
  assert.equal(isPositiveCounterIncrement(1.5), false);
});

test("counter increment selection does not alter total and supports varied values", () => {
  const state = readCounter({ version: 2, totalArrows: 190, increment: 6, history: [6, 10] });
  const selected = setIncrement(state, 14);
  assert.equal(selected.increment, 14);
  assert.equal(selected.totalArrows, 190);
  assert.deepEqual(addArrows(selected, "2026-10-25T05:00:00.000Z"), { ...selected, totalArrows: 204, history: [...state.history, { amount: 14, addedAt: "2026-10-25T05:00:00.000Z" }] });
});

test("haptic tick condition is discrete selection change only", () => {
  assert.equal(shouldTickCounterWheel(14, 14), false);
  assert.equal(shouldTickCounterWheel(14, 15), true);
  assert.equal(shouldTickCounterWheel(14, 0), false);
});

test("mobile analytics axes match the existing metrics and volume bars rise vertically", () => {
  assert.equal(ANALYTICS_AXIS_LABELS.trendX, "Session date");
  assert.equal(ANALYTICS_AXIS_LABELS.trendY, "Avg score / Arrow");
  assert.equal(ANALYTICS_AXIS_LABELS.volumeY, "Arrow count");
  assert.equal(ANALYTICS_AXIS_LABELS.volumeX.daily, "Session date");
  assert.equal(verticalBarHeight(50, 100, 102), 51);
  assert.equal(verticalBarHeight(0, 100, 102), 3);
});

test("each primary bottom tab has an icon and page spacing is an additive forty points", () => {
  assert.deepEqual(Object.keys(MAIN_TAB_ICONS), ["sessions", "analytics", "counter", "organization", "profile"]);
  assert.equal(PAGE_TOP_SPACING, 40);
});

test("Counter total and increment wheel use a responsive shared horizontal row", () => {
  assert.equal(COUNTER_TOTAL_COLUMN_FLEX / (COUNTER_TOTAL_COLUMN_FLEX + COUNTER_WHEEL_COLUMN_FLEX), 0.525);
  assert.equal(COUNTER_WHEEL_COLUMN_FLEX / (COUNTER_TOTAL_COLUMN_FLEX + COUNTER_WHEEL_COLUMN_FLEX), 0.475);
  assert.equal(COUNTER_WHEEL_ROW_HEIGHT * COUNTER_WHEEL_VISIBLE_ROWS, 220);
});
