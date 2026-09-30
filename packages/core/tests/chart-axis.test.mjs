import assert from "node:assert/strict";
import test from "node:test";
import { chartAxis, chartTick } from "../src/chart-axis.ts";

test("score trends use a labelled padded range without changing values", () => {
  const axis = chartAxis([8.2, 8.4, 8.5, 8.3], "score");
  assert.ok(axis.min > 0 && axis.min < 8.2);
  assert.ok(axis.max > 8.5 && axis.max <= 10);
  assert.ok(axis.ticks.every((value) => value >= axis.min && value <= axis.max));
});

test("quantity bars retain zero and whole-number ticks", () => {
  const axis = chartAxis([120, 300], "count", true);
  assert.equal(axis.min, 0);
  assert.ok(axis.max >= 300);
  assert.ok(axis.ticks.every(Number.isInteger));
  const smallAxis = chartAxis([1, 2], "count", true);
  assert.ok(smallAxis.ticks.every(Number.isInteger));
  assert.equal(new Set(smallAxis.ticks.map((tick) => chartTick(tick, "count"))).size, smallAxis.ticks.length);
  assert.equal(chartTick(40, "percentage"), "40%");
});
