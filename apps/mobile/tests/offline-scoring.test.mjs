import test from "node:test";
import assert from "node:assert/strict";
import { createOfflineRound } from "../src/offline-scoring-store.ts";

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = uuid(1), roundId = uuid(2), endId = uuid(3);
const arrow = (score = "9", n = 1) => ({ id: `local-1-${n}`, end: 1, arrow: n, score, plot: { x: .15, y: 0 } });
const loaded = { session: { id: uuid(4), title: "Training", date: "2026-10-29", sessionType: "training", arrowCount: 0, rounds: [] },
  round: { id: roundId, roundNumber: 1, name: "Custom", division: "Recurve", distanceMetres: 18, faceDiameterCm: 40, faceType: "full_face", ends: 1, arrowsPerEnd: 2, arrows: [] } };
function fixture() {
  const disk = new Map(), server = new Map([["1-1", { revision: uuid(10), arrow: null }], ["1-2", { revision: uuid(11), arrow: null }]]);
  const calls = [], writes = [];
  let sequence = 100, signedIn = true, network = true, lost = false, failDisk = false, diskAckLost = false, diskWrites = 0, gate;
  const storage = { async getItem(k) { return disk.get(k) ?? null; }, async setItem(k, v) {
    diskWrites++;
    if (failDisk) throw Error("full"); disk.set(k, v); if (diskAckLost) { diskAckLost = false; throw Error("lost"); }
  } };
  const make = () => createOfflineRound({ owner, roundId, storage, current: () => signedIn, requestId: () => uuid(sequence++),
    async read(slot) { calls.push(slot); if (!network) throw Error("offline"); return structuredClone(server.get(`${slot.end}-${slot.arrow}`)); },
    async write(slot, _end, desired, expected, id) {
      if (!network) throw Error("offline"); if (gate) await gate;
      const key = `${slot.end}-${slot.arrow}`, actual = server.get(key);
      if (actual.revision !== expected && actual.revision !== id) throw Error("stale");
      const value = { revision: id, arrow: desired && { ...desired, id: uuid(900 + writes.length), syncState: "saved" } };
      server.set(key, structuredClone(value)); writes.push({ id, desired, expected });
      if (lost) { lost = false; throw Error("response lost"); } return value;
    },
  });
  return { make, server, disk, writes, calls,
    get diskWrites() { return diskWrites; },
    set network(v) { network = v; }, set signedIn(v) { signedIn = v; }, set lost(v) { lost = v; },
    set failDisk(v) { failDisk = v; }, set diskAckLost(v) { diskAckLost = v; }, set gate(v) { gate = v; } };
}
async function prepared(f) { const r = f.make(); await r.prepare(loaded, new Map([[1, endId]])); r.start(); return r; }
const tick = () => new Promise(resolve => setImmediate(resolve));

test("offline: edits are durable before notification and never labeled server-saved", async () => {
  const f = fixture(), r = await prepared(f); f.network = false;
  await r.enqueue(arrow(), arrow());
  assert.equal(f.writes.length, 0); assert.equal(r.view().status, "device");
  assert.equal(r.view().arrows[0].syncState, "saving");
  const restored = f.make(); await restored.load(); assert.equal(restored.view().arrows[0].score, "9");
  await r.sync(); assert.equal(r.view().status, "waiting");
});
test("offline: restart drains corrections in order using stable requests and revisions", async () => {
  const f = fixture(), r = await prepared(f);
  await r.enqueue(arrow(), arrow()); await r.enqueue(arrow("8"), arrow("8"));
  r.stop(); const restored = f.make(); await restored.load(); restored.start(); await restored.sync();
  assert.deepEqual(f.writes.map(m => m.desired.score), ["9", "8"]);
  assert.equal(f.writes[1].expected, f.writes[0].id);
  assert.equal(restored.view().status, "synced");
});
test("offline: server commit with lost response is reconciled after termination without duplicate mutation", async () => {
  const f = fixture(), r = await prepared(f); await r.enqueue(arrow(), arrow()); f.lost = true;
  await r.sync(); assert.equal(r.view().pending, 1); r.stop();
  const restored = f.make(); await restored.load(); restored.start(); await restored.sync();
  assert.equal(f.writes.length, 1); assert.equal(restored.view().pending, 0);
  assert.equal(restored.view().arrows[0].syncState, "saved");
});
test("offline: deletion survives restart and cannot be recreated by an earlier saved response", async () => {
  const f = fixture(), r = await prepared(f); await r.enqueue(arrow(), arrow()); await r.sync();
  f.network = false; await r.enqueue(arrow(), null); assert.equal(r.view().arrows.length, 0);
  r.stop(); const restored = f.make(); await restored.load(); restored.start(); f.network = true; await restored.sync();
  assert.equal(f.server.get("1-1").arrow, null); assert.equal(restored.view().pending, 0);
});
test("offline: another-device revision is explicit conflict even for equal scores", async () => {
  const f = fixture(), r = await prepared(f); await r.enqueue(arrow(), arrow());
  f.server.set("1-1", { revision: uuid(999), arrow: arrow() }); await r.sync();
  assert.equal(r.view().status, "conflict"); assert.equal(f.writes.length, 0);
  await r.resolveConflict(arrow(), "device"); await r.sync();
  assert.equal(f.writes[0].expected, uuid(999));
  const stored = JSON.parse([...f.disk.values()][0]); assert.equal(stored.review.length, 1);
  assert.equal(stored.review[0].mutations[0].desired.score, "9");
});
test("offline: choosing server preserves device recovery history and does not write", async () => {
  const f = fixture(), r = await prepared(f); await r.enqueue(arrow(), arrow());
  f.server.set("1-1", { revision: uuid(999), arrow: arrow("7") }); await r.sync();
  await r.resolveConflict(arrow(), "server"); assert.equal(r.view().arrows[0].score, "7");
  assert.equal(f.writes.length, 0); assert.equal(JSON.parse([...f.disk.values()][0]).review[0].mutations[0].desired.score, "9");
});
test("offline: conflicted slots cannot starve other arrows", async () => {
  const f = fixture(), r = await prepared(f); await r.enqueue(arrow(), arrow()); await r.enqueue(arrow("8", 2), arrow("8", 2));
  f.server.set("1-1", { revision: uuid(999), arrow: null }); await r.sync();
  assert.equal(f.server.get("1-2").arrow.score, "8"); assert.equal(r.view().conflicts.length, 1);
});
test("offline: failed native writes are never confirmed and preserve the prior journal", async () => {
  const f = fixture(), r = await prepared(f), before = [...f.disk.values()][0]; f.failDisk = true;
  await assert.rejects(r.enqueue(arrow(), arrow()), /Device save/);
  assert.equal([...f.disk.values()][0], before); assert.equal(f.writes.length, 0);
  f.failDisk = false; await r.enqueue(arrow(), arrow()); await r.sync(); assert.equal(r.view().pending, 0);
});
test("offline: native commit with lost acknowledgment is verified by readback", async () => {
  const f = fixture(), r = await prepared(f); f.diskAckLost = true;
  await r.enqueue(arrow(), arrow()); assert.equal(r.view().pending, 1);
});
test("offline: corrupt or future-version records are preserved without reset", async () => {
  for (const raw of ["broken", '{"version":2}']) {
    const f = fixture(); await prepared(f); const key = [...f.disk.keys()][0]; f.disk.set(key, raw);
    await assert.rejects(f.make().load(), /preserved/); assert.equal(f.disk.get(key), raw);
  }
});
test("offline: owner changes block reads, edits and late synchronization confirmations", async () => {
  const f = fixture(), r = await prepared(f); await r.enqueue(arrow(), arrow());
  let release; f.gate = new Promise(resolve => { release = resolve; }); const job = r.sync(); await tick();
  f.signedIn = false; release(); await job;
  assert.throws(() => r.view(), /account changed/); await assert.rejects(r.enqueue(arrow(), arrow()), /account changed/);
  f.signedIn = true; const restored = f.make(); await restored.load(); restored.start(); await restored.sync();
  assert.equal(f.writes.length, 1); assert.equal(restored.view().pending, 0);
});
test("offline: edits remain responsive during a slow upload and survive half-round sync", async () => {
  const f = fixture(), r = await prepared(f); await r.enqueue(arrow(), arrow());
  let release; f.gate = new Promise(resolve => { release = resolve; }); const upload = r.sync(); await tick();
  await r.enqueue(arrow("7", 2), arrow("7", 2)); assert.equal(r.view().pending, 2);
  r.stop(); release(); await upload;
  const restored = f.make(); await restored.load(); restored.start(); await restored.sync();
  assert.equal(restored.view().pending, 0); assert.equal(f.server.get("1-2").arrow.score, "7");
});
test("offline: missing baselines and changed preparation metadata fail before any cache is committed", async () => {
  const f = fixture(), r = f.make();
  await assert.rejects(r.enqueue(arrow(), arrow()), /storage/);
  await assert.rejects(r.prepare(loaded, new Map([[1, endId]]), undefined, async () => { throw Error("configuration changed"); }), /configuration changed/);
  assert.equal(f.disk.size, 0);
});
test("offline: idle refresh cannot overwrite newly queued offline edits", async () => {
  const f = fixture(), r = await prepared(f);
  await r.enqueue(arrow(), arrow());
  await r.prepare(loaded, new Map([[1, endId]])); assert.equal(r.view().pending, 1);
});

test("offline: a second server correction requires a fresh review instead of applying a stale choice", async () => {
  const f = fixture(), r = await prepared(f); await r.enqueue(arrow(), arrow());
  f.server.set("1-1", { revision: uuid(999), arrow: arrow("7") }); await r.sync();
  f.server.set("1-1", { revision: uuid(998), arrow: arrow("6") });
  await assert.rejects(r.resolveConflict(arrow(), "device"), /changed again/);
  assert.equal(r.view().conflicts[0].server.score, "6"); assert.equal(f.writes.length, 0);
});

test("offline: caller mutation cannot change already acknowledged device data", async () => {
  const f = fixture(), r = await prepared(f), value = arrow(); await r.enqueue(value, value);
  value.plot.x = .99;
  assert.equal(r.view().arrows[0].plot.x, .15);
  const restored = f.make(); await restored.load(); assert.equal(restored.view().arrows[0].plot.x, .15);
});

test("offline: an unrelated upload acknowledgment cannot erase a failed device edit", async () => {
  const f = fixture(), r = await prepared(f); await r.enqueue(arrow(), arrow());
  let release; f.gate = new Promise(resolve => { release = resolve; }); const job = r.sync(); await tick();
  f.failDisk = true; await assert.rejects(r.enqueue(arrow("8", 2), arrow("8", 2)), /Device save/);
  f.failDisk = false; release(); await job;
  assert.equal(r.view().arrows.find(a => a.arrow === 2).syncState, "failed");
  assert.equal(r.hasUnstored(), true);
  await r.load(); assert.equal(r.view().arrows.find(a => a.arrow === 2).score, "8");
  await r.retryDevice(); await r.sync();
  assert.equal(r.hasUnstored(), false); assert.equal(f.server.get("1-2").arrow.score, "8");
});

test("offline: deletion queued during an uncertain earlier save wins after restart", async () => {
  const f = fixture(), r = await prepared(f); await r.enqueue(arrow(), arrow());
  let release; f.gate = new Promise(resolve => { release = resolve; }); const first = r.sync(); await tick();
  await r.enqueue(arrow(), null); r.stop(); release(); await first;
  const restored = f.make(); await restored.load(); restored.start(); await restored.sync();
  assert.equal(f.server.get("1-1").arrow, null); assert.equal(restored.view().pending, 0);
  assert.deepEqual(f.writes.map(m => !!m.desired), [true, false]);
});

test("offline: failed network attempts retain the same durable mutation identity", async () => {
  const f = fixture(), r = await prepared(f); await r.enqueue(arrow(), arrow());
  const id = JSON.parse([...f.disk.values()][0]).queue[0].id;
  f.network = false; await r.sync(); const written = f.diskWrites; await r.sync();
  assert.equal(f.diskWrites, written, "network retries must not rewrite an unchanged device journal");
  f.network = true; await r.sync();
  assert.equal(f.writes[0].id, id); assert.equal(r.view().status, "synced");
});

test("offline: parseable accidental score corruption is detected without modifying the stored bytes", async () => {
  const f = fixture(), r = await prepared(f); await r.enqueue(arrow(), arrow());
  const key = [...f.disk.keys()][0], damaged = f.disk.get(key).replace('"score":"9"', '"score":"8"');
  f.disk.set(key, damaged); await assert.rejects(f.make().load(), /damaged/);
  assert.equal(f.disk.get(key), damaged);
});
