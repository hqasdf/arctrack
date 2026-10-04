import assert from "node:assert/strict";
import test from "node:test";
import { roundTotal } from "@arc-track/core/scoring";
import { WebArrowQueue } from "../src/features/sessions/web-arrow-queue.ts";

const arrow = (score = "8", arrowNumber = 1, plot = { x: .25, y: 0, faceIndex: 1 }) => ({
  id: `saved-${arrowNumber}`, end: 1, arrow: arrowNumber, score, plot, syncState: "saved",
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function harness(initial, save) {
  const changes = [];
  let queue;
  queue = new WebArrowQueue(initial, save, async () => ({ ok: true }), () => {
    changes.push({ desired: queue.desiredArrows(), confirmed: queue.confirmedArrows() });
  });
  return { queue, changes };
}

test("normal correction confirms the returned server Arrow and both totals", async () => {
  const { queue } = harness([arrow()], async (entry) => ({ ok: true, data: { ...entry, id: "server-id" } }));
  queue.edit({ ...arrow(), score: "10" });
  assert.equal(await queue.flush(), true);
  assert.equal(queue.confirmedArrows()[0].id, "server-id");
  assert.equal(queue.desiredArrows()[0].syncState, "saved");
  assert.equal(roundTotal(queue.confirmedArrows()), 10);
  assert.equal(roundTotal(queue.desiredArrows()), 10);
});

test("audit regression: failed correction retains 8 in confirmed total and 10 as failed desired", async () => {
  let succeed = false;
  const { queue } = harness([arrow()], async (entry) => succeed
    ? { ok: true, data: { ...entry, id: "server-id" } }
    : { ok: false, message: "Offline" });
  queue.edit({ ...arrow(), score: "10" });
  assert.equal(await queue.flush(), false);
  assert.equal(roundTotal(queue.confirmedArrows()), 8);
  assert.equal(roundTotal(queue.desiredArrows()), 10);
  assert.equal(queue.desiredArrows()[0].syncState, "failed");
  assert.equal(queue.firstError(), "Offline");
  succeed = true;
  queue.retry("1-1");
  assert.equal(await queue.flush(), true);
  assert.equal(roundTotal(queue.confirmedArrows()), 10);
  assert.equal(queue.desiredArrows()[0].syncState, "saved");
});

test("8 to 9 to 10 serializes one Arrow and old response cannot replace desired 10", async () => {
  const first = deferred();
  const calls = [];
  const { queue } = harness([arrow()], async (entry) => {
    calls.push(entry.score);
    return calls.length === 1 ? first.promise : { ok: true, data: entry };
  });
  queue.edit({ ...arrow(), score: "9" });
  queue.edit({ ...arrow(), score: "10" });
  assert.deepEqual(calls, ["9"]);
  first.resolve({ ok: true, data: { ...arrow("9"), id: "first-response" } });
  assert.equal(await queue.flush(), true);
  assert.deepEqual(calls, ["9", "10"]);
  assert.equal(queue.desiredArrows()[0].score, "10");
  assert.equal(queue.confirmedArrows()[0].score, "10");
});

test("failure followed by a newer edit saves the newer value; retry never replays stale 9", async () => {
  const calls = [];
  const { queue } = harness([arrow()], async (entry) => {
    calls.push(entry.score);
    return calls.length === 1 ? { ok: false, message: "Network failed" } : { ok: true, data: entry };
  });
  queue.edit({ ...arrow(), score: "9" });
  assert.equal(await queue.flush(), false);
  queue.edit({ ...queue.desiredAt("1-1"), score: "10" });
  assert.equal(await queue.flush(), true);
  assert.deepEqual(calls, ["9", "10"]);
  assert.equal(queue.confirmedArrows()[0].score, "10");
});

test("a failed in-flight old edit automatically sends the newest desired state", async () => {
  const first = deferred();
  const calls = [];
  const { queue } = harness([arrow()], async (entry) => {
    calls.push(entry.score);
    return calls.length === 1 ? first.promise : { ok: true, data: entry };
  });
  queue.edit({ ...arrow(), score: "9" });
  queue.edit({ ...queue.desiredAt("1-1"), score: "10" });
  first.resolve({ ok: false, message: "Old request failed" });
  assert.equal(await queue.flush(), true);
  assert.deepEqual(calls, ["9", "10"]);
  assert.equal(queue.confirmedArrows()[0].score, "10");
  assert.equal(queue.firstError(), null);
});

test("many rapid edits coalesce to final X with its latest coordinates and face index", async () => {
  const first = deferred();
  const calls = [];
  const { queue } = harness([arrow()], async (entry) => {
    calls.push({ score: entry.score, plot: entry.plot });
    return calls.length === 1 ? first.promise : { ok: true, data: entry };
  });
  queue.edit({ ...arrow(), score: "1" });
  for (const score of ["2", "3", "4", "5", "6", "7", "8", "9", "10"])
    queue.edit({ ...queue.desiredAt("1-1"), score });
  queue.edit({ ...queue.desiredAt("1-1"), plot: { x: .1, y: -.2, faceIndex: 2 } });
  queue.edit({ ...queue.desiredAt("1-1"), score: "X", plot: { x: .02, y: .03, faceIndex: 0 } });
  first.resolve({ ok: true, data: arrow("1") });
  assert.equal(await queue.flush(), true);
  assert.equal(calls.length, 2);
  assert.deepEqual(queue.confirmedArrows()[0], {
    ...arrow("X"), plot: { x: .02, y: .03, faceIndex: 0 }, syncState: "saved",
  });
  assert.equal(roundTotal(queue.confirmedArrows()), 10);
});

test("1 through 10 stress: delayed old response, final failure, retry, and final confirmed 10", async () => {
  const first = deferred();
  const calls = [];
  let retry = false;
  const { queue } = harness([arrow()], async (entry) => {
    calls.push(entry.score);
    if (calls.length === 1) return first.promise;
    return retry ? { ok: true, data: entry } : { ok: false, message: "Temporary failure" };
  });
  for (const score of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"])
    queue.edit({ ...queue.desiredAt("1-1"), score });
  assert.deepEqual(calls, ["1"]);
  first.resolve({ ok: true, data: arrow("1") });
  assert.equal(await queue.flush(), false);
  assert.deepEqual(calls, ["1", "10"]);
  assert.equal(queue.confirmedArrows()[0].score, "1");
  assert.equal(queue.desiredArrows()[0].score, "10");
  assert.equal(queue.desiredArrows()[0].syncState, "failed");
  retry = true;
  queue.retry("1-1");
  assert.equal(await queue.flush(), true);
  assert.deepEqual(calls, ["1", "10", "10"]);
  assert.equal(queue.confirmedArrows()[0].score, "10");
});

test("confirmed state comes from the server response and is reconciled before saved", async () => {
  const calls = [];
  const { queue } = harness([arrow()], async (entry) => {
    calls.push(entry.score);
    return calls.length === 1
      ? { ok: true, data: { ...entry, score: "9" } }
      : { ok: true, data: entry };
  });
  queue.edit({ ...arrow(), score: "10" });
  assert.equal(await queue.flush(), true);
  assert.deepEqual(calls, ["10", "10"]);
  assert.equal(queue.confirmedArrows()[0].score, "10");
});

test("double precision coordinate round-trip confirms after one write instead of resaving forever", async () => {
  const precise = { x: -0.7904165747857863, y: 0.12345678901234567 };
  const rounded = { x: Number(precise.x.toPrecision(15)), y: Number(precise.y.toPrecision(15)) };
  const calls = [];
  const { queue } = harness([], async (entry) => {
    calls.push(entry);
    return { ok: true, data: { ...entry, plot: calls.length === 1 ? rounded : precise } };
  });
  queue.edit({ id: "1-1", end: 1, arrow: 1, score: "8", plot: precise, syncState: "saving" });
  assert.equal(await queue.flush(), true);
  assert.equal(calls.length, 1);
  assert.equal(queue.hasUnconfirmed(), false);
  assert.deepEqual(queue.confirmedArrows()[0].plot, rounded);
});

test("a real plotted movement larger than database float noise is still persisted", async () => {
  const initial = arrow("8");
  const moved = { ...initial, plot: { x: initial.plot.x + 1e-10, y: initial.plot.y } };
  const calls = [];
  const { queue } = harness([initial], async (entry) => {
    calls.push(entry.plot.x);
    return { ok: true, data: calls.length === 1 ? initial : entry };
  });
  queue.edit(moved);
  assert.equal(await queue.flush(), true);
  assert.deepEqual(calls, [moved.plot.x, moved.plot.x]);
  assert.equal(queue.confirmedArrows()[0].plot.x, moved.plot.x);
});

test("score-only and marker-only changes preserve the rest of the complete Arrow", async () => {
  const calls = [];
  const { queue } = harness([arrow()], async (entry) => { calls.push(entry); return { ok: true, data: entry }; });
  queue.edit({ ...arrow(), score: "10" });
  await queue.flush();
  assert.deepEqual(queue.confirmedArrows()[0].plot, arrow().plot);
  queue.edit({ ...queue.desiredAt("1-1"), plot: { x: -.3, y: .2, faceIndex: 0 } });
  await queue.flush();
  assert.equal(queue.confirmedArrows()[0].score, "10");
  assert.deepEqual(queue.confirmedArrows()[0].plot, { x: -.3, y: .2, faceIndex: 0 });
  assert.equal(calls.length, 2);
});

test("three Arrows save independently; slow Arrow 1 does not block 2 or 3", async () => {
  const slow = deferred();
  const calls = [];
  const { queue } = harness([arrow("8", 1), arrow("8", 2), arrow("8", 3)], async (entry) => {
    calls.push(entry.arrow);
    return entry.arrow === 1 ? slow.promise : { ok: true, data: entry };
  });
  for (const number of [1, 2, 3]) queue.edit({ ...arrow("10", number) });
  await tick();
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(queue.confirmedArrows().find((entry) => entry.arrow === 2)?.score, "10");
  assert.equal(queue.confirmedArrows().find((entry) => entry.arrow === 3)?.score, "10");
  assert.equal(queue.confirmedArrows().find((entry) => entry.arrow === 1)?.score, "8");
  slow.resolve({ ok: true, data: arrow("10", 1) });
  assert.equal(await queue.flush(), true);
  assert.equal(roundTotal(queue.confirmedArrows()), 30);
});

test("six different Arrows start saves concurrently", async () => {
  const pending = deferred();
  const started = [];
  const { queue } = harness(Array.from({ length: 6 }, (_, i) => arrow("8", i + 1)), async (entry) => {
    started.push(entry.arrow);
    return pending.promise.then(() => ({ ok: true, data: entry }));
  });
  for (let number = 1; number <= 6; number++) queue.edit({ ...arrow("10", number) });
  await tick();
  assert.deepEqual(started, [1, 2, 3, 4, 5, 6]);
  pending.resolve();
  assert.equal(await queue.flush(), true);
  assert.equal(roundTotal(queue.confirmedArrows()), 60);
});

test("corrections on different Arrows remain concurrent and preserve their plots", async () => {
  const initial = Array.from({ length: 6 }, (_, i) => arrow("8", i + 1, { x: i / 10, y: -.2 }));
  const pending = deferred();
  const started = [];
  const { queue } = harness(initial, async (entry) => {
    started.push(entry.arrow);
    return pending.promise.then(() => ({ ok: true, data: entry }));
  });
  for (const number of [2, 4, 6]) queue.edit({ ...queue.desiredAt(`1-${number}`), score: "X" });
  await tick();
  assert.deepEqual(started, [2, 4, 6]);
  pending.resolve();
  assert.equal(await queue.flush(), true);
  assert.equal(roundTotal(queue.confirmedArrows()), 54);
  assert.deepEqual(queue.confirmedArrows().map((entry) => entry.plot?.x), [0, .1, .2, .3, .4, .5]);
});

test("36 Arrows entered at a steady pace all drain with independent slot saves", async () => {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const { queue } = harness([], async (entry) => {
    active++;
    maxActive = Math.max(maxActive, active);
    calls.push(entry);
    await new Promise((resolve) => setTimeout(resolve, 8));
    active--;
    return { ok: true, data: entry };
  });
  for (let index = 0; index < 36; index++) {
    const end = Math.floor(index / 6) + 1;
    const number = (index % 6) + 1;
    queue.edit({ id: `${end}-${number}`, end, arrow: number, score: "9", plot: { x: index / 100, y: 0 }, syncState: "saving" });
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal(await queue.flush(), true);
  assert.equal(calls.length, 36);
  assert.ok(maxActive > 1);
  assert.equal(queue.confirmedArrows().length, 36);
  assert.equal(roundTotal(queue.confirmedArrows()), 324);
});

test("flush waits for pending save and refuses unresolved failure before navigation", async () => {
  const pending = deferred();
  const { queue } = harness([arrow()], async () => pending.promise);
  queue.edit({ ...arrow(), score: "10" });
  let left = false;
  const leave = queue.flush().then((settled) => { if (settled) left = true; return settled; });
  await tick();
  assert.equal(left, false);
  pending.resolve({ ok: false, message: "Offline" });
  assert.equal(await leave, false);
  assert.equal(left, false);
  assert.equal(roundTotal(queue.confirmedArrows()), 8);
});

test("partial Round retains a saved miss as zero rather than treating it as absent", async () => {
  const { queue } = harness([arrow("M")], async (entry) => ({ ok: true, data: entry }));
  assert.equal(queue.confirmedArrows().length, 1);
  assert.equal(roundTotal(queue.confirmedArrows()), 0);
  queue.edit({ ...arrow("X") });
  assert.equal(await queue.flush(), true);
  assert.equal(roundTotal(queue.confirmedArrows()), 10);
});

test("delete waits behind a same-slot save, while other Arrow saves remain independent", async () => {
  const pending = deferred();
  const calls = [];
  let queue;
  queue = new WebArrowQueue([arrow("8", 1), arrow("8", 2)], async (entry) => {
    calls.push(`save-${entry.arrow}`);
    return entry.arrow === 1 ? pending.promise : { ok: true, data: entry };
  }, async (entry) => { calls.push(`delete-${entry.arrow}`); return { ok: true }; }, () => {});
  queue.edit({ ...arrow("9", 1) });
  queue.delete("1-1");
  queue.edit({ ...arrow("10", 2) });
  await tick();
  assert.deepEqual(calls, ["save-1", "save-2"]);
  pending.resolve({ ok: true, data: arrow("9", 1) });
  assert.equal(await queue.flush(), true);
  assert.deepEqual(calls, ["save-1", "save-2", "delete-1"]);
  assert.deepEqual(queue.confirmedArrows().map((entry) => entry.arrow), [2]);
});

test("failed delete restores the confirmed Arrow and blocks navigation until retried", async () => {
  let fail = true;
  const queue = new WebArrowQueue([arrow()], async (entry) => ({ ok: true, data: entry }),
    async () => fail ? { ok: false, message: "Delete failed" } : { ok: true }, () => {});
  queue.delete("1-1");
  assert.equal(await queue.flush(), false);
  assert.equal(roundTotal(queue.confirmedArrows()), 8);
  assert.equal(roundTotal(queue.desiredArrows()), 8);
  fail = false;
  queue.delete("1-1");
  assert.equal(await queue.flush(), true);
  assert.equal(queue.confirmedArrows().length, 0);
});
