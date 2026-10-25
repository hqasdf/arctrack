import test from "node:test";
import assert from "node:assert/strict";
import * as web from "../src/features/arrow-counter/counter-model.ts";
import * as mobile from "../apps/mobile/src/counter-model.ts";
import * as core from "../packages/core/src/counter-model.ts";

test("web and mobile adapters use the identical shared Counter functions, storage key and version-3 schema", () => {
  for (const name of Object.keys(core)) {
    assert.equal(web[name], core[name], `web ${name}`);
    assert.equal(mobile[name], core[name], `mobile ${name}`);
  }
  const legacy = { version: 2, totalArrows: 80, increment: 12, history: [6, 12] };
  for (const model of [web, mobile]) {
    const old = model.readCounter(legacy);
    const next = model.addArrows(old, "2026-10-25T05:00:00.000Z");
    assert.equal(next.totalArrows, 92);
    assert.equal(next.history[0].addedAt, null);
    assert.deepEqual(model.undoLastAddition(next), old);
    assert.deepEqual(model.setIncrement(next, 7).history, next.history);
    assert.deepEqual(model.readCounter(JSON.parse(JSON.stringify(next))), next);
    assert.equal(model.resetCounter(next).history.length, 0);
  }
});
