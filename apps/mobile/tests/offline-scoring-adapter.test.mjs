import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import * as store from "../src/offline-scoring-store.ts";
import { deviceScoringOwner } from "../src/offline-scoring-access.ts";

const owner = "00000000-0000-4000-8000-000000000001", roundId = "00000000-0000-4000-8000-000000000002";
const loaded = { session: { id: "00000000-0000-4000-8000-000000000003", title: "Practice", date: "2026-10-29", sessionType: "training", arrowCount: 0, rounds: [] },
  round: { id: roundId, name: "9 × 4", roundNumber: 1, division: "Recurve", distanceMetres: 18, faceDiameterCm: 40, faceType: "full_face", ends: 1, arrowsPerEnd: 2, arrows: [] } };
const entry = { id: "device", end: 1, arrow: 1, score: "9", plot: { x: .15, y: 0 } };
function runtime() {
  const configuration = structuredClone(loaded);
  const disk = new Map(), timers = new Map(), listeners = new Set(), server = new Map();
  let epoch = 1, account = owner, nativeState = "active", requests = 0, reads = 0, counter = 0, online = true, badDisk = false;
  const authority = { snapshot: () => ({ ready: true, retiring: false, error: null, accepted: account && { accountId: account, epoch, mode: "normal" } }) };
  const deps = {
    "@react-native-async-storage/async-storage": { __esModule: true, default: {
      getItem: async key => disk.get(key) ?? null, setItem: async (key, value) => { if (badDisk) throw Error("native storage unavailable"); disk.set(key, value); }, getAllKeys: async () => [...disk.keys()],
    } },
    "react-native": { AppState: { get currentState() { return nativeState; }, addEventListener: (_event, listener) => { listeners.add(listener); return { remove: () => listeners.delete(listener) }; } } },
    "./supabase": { sessionAuthority: authority },
    "./sessions": { readOwnRound: async () => { reads++; if (!online) throw Error("offline"); return structuredClone(configuration); } },
    "./arrow-writes": { readRoundEndIds: async () => new Map([[1, "00000000-0000-4000-8000-000000000004"]]),
      readMobileArrowSnapshot: async slot => { requests++; if (!online) throw Error("offline"); return server.get(`${slot.end}-${slot.arrow}`) ?? { revision: "00000000-0000-4000-8000-000000000005", arrow: null }; },
      writeMobileArrowSnapshot: async (slot, _end, desired, expected, id) => { requests++; if (!online) throw Error("offline");
        const key = `${slot.end}-${slot.arrow}`, previous = server.get(key);
        if (previous && previous.revision !== expected && previous.revision !== id) throw Error("conflict");
        const result = { revision: id, arrow: desired && { ...desired, id: randomUUID() } }; server.set(key, result); return result; },
    },
    "./offline-scoring-store": store,
  };
  const code = ts.transpileModule(readFileSync(new URL("../src/offline-scoring.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("require", "exports", "setTimeout", "clearTimeout", code)(name => {
    assert.ok(name in deps, `Unexpected dependency ${name}`); return deps[name];
  }, exports, callback => { timers.set(++counter, callback); return counter; }, id => timers.delete(id));
  return { api: exports, disk, server, timers, authority, get requests() { return requests; }, get reads() { return reads; },
    set online(value) { online = value; }, switchAccount(value) { account = value; epoch++; },
    set badDisk(value) { badDisk = value; },
    set faceType(value) { configuration.round.faceType = value; },
    state(value) { nativeState = value; for (const listener of listeners) listener(value); },
    async tick() { const callbacks = [...timers.values()]; timers.clear(); for (const callback of callbacks) await callback(); await new Promise(setImmediate); },
  };
}
const setup = async f => { const r = await f.api.openOfflineScoring(owner, roundId); r.stop(); };
// Native Expo's UUID hook is injected exactly as the production adapter expects.
globalThis.expo ??= { uuidv4: randomUUID };

test("offline adapter: uncached device-only mode makes no network requests", async () => {
  const f = runtime(); await assert.rejects(f.api.openOfflineScoring(owner, roundId, undefined, true), /not prepared/);
  assert.equal(f.requests, 0); assert.equal(f.reads, 0);
});
test("offline adapter: cached local-only restart supports scoring without authenticated routes or uploads", async () => {
  const f = runtime(); await setup(f); const requests = f.requests, reads = f.reads; f.online = false;
  const r = await f.api.openOfflineScoring(owner, roundId, undefined, true);
  r.start(() => {}); await r.save(entry); await r.retry(); await r.synchronize();
  assert.equal(r.view().pending, 1); assert.equal(f.requests, requests); assert.equal(f.reads, reads); r.stop();
  assert.equal(f.timers.size, 0);
});
test("offline adapter: foreground scheduler recovers journals outside the scoring screen and cleans up", async () => {
  const f = runtime(); await setup(f);
  const local = await f.api.openOfflineScoring(owner, roundId, undefined, true);
  await local.save(entry); local.stop(); const stop = f.api.startOfflineScoringSync(owner);
  await new Promise(setImmediate); await new Promise(setImmediate);
  assert.equal(f.server.get("1-1").arrow.score, "9");
  f.state("background"); assert.equal(f.timers.size, 0); stop(); assert.equal(f.timers.size, 0);
});
test("offline adapter: account changes cannot read, sync or list the previous account's journal", async () => {
  const f = runtime(); await setup(f); const r = await f.api.openOfflineScoring(owner, roundId, undefined, true);
  await r.save(entry); f.switchAccount("00000000-0000-4000-8000-000000000099");
  assert.throws(() => r.view(), /account changed/);
  await assert.rejects(f.api.listOfflineScoring(owner), /Sign in/);
  const list = await f.api.listOfflineScoring("00000000-0000-4000-8000-000000000099"); assert.equal(list.rounds.length, 0);
  const count = f.requests; await assert.rejects(r.retry(), /account changed/); await r.synchronize(); assert.equal(f.requests, count); r.stop();
});
test("offline adapter: device catalogue lists real Round IDs and pending state without unrelated storage", async () => {
  const f = runtime(); await setup(f); f.disk.set("unrelated-auth-key", "not-json-do-not-read");
  const r = await f.api.openOfflineScoring(owner, roundId, undefined, true); await r.save(entry); r.stop();
  const list = await f.api.listOfflineScoring(owner); assert.equal(list.rounds[0].id, roundId); assert.equal(list.rounds[0].pending, 1);
  assert.equal(list.damaged, 0); assert.equal(f.disk.get("unrelated-auth-key"), "not-json-do-not-read");
});
test("offline access: secure accepted normal identity is required; recovery, retiring and corrupt state never unlock", () => {
  const snapshot = { ready: true, retiring: false, error: null, accepted: { accountId: owner, mode: "normal" } };
  assert.equal(deviceScoringOwner(snapshot), owner);
  for (const patch of [{ ready: false }, { retiring: true }, { error: Error("storage") }, { accepted: null }, { accepted: { accountId: owner, mode: "recovery" } }]) {
    assert.equal(deviceScoringOwner({ ...snapshot, ...patch }), null);
  }
});

test("offline adapter: same-account logout/login retires old writers but recovers durable intentions", async () => {
  const f = runtime(); await setup(f); const old = await f.api.openOfflineScoring(owner, roundId, undefined, true);
  await old.save(entry); f.switchAccount(owner);
  assert.throws(() => old.view(), /account changed/); old.stop();
  const restored = await f.api.openOfflineScoring(owner, roundId); restored.start(() => {});
  await restored.synchronize(); assert.equal(restored.view().pending, 0); restored.stop();
});

test("offline adapter: failed device edits survive screen reopening in memory until a verified retry", async () => {
  const f = runtime(); await setup(f); const r = await f.api.openOfflineScoring(owner, roundId, undefined, true);
  f.badDisk = true; await assert.rejects(r.save(entry), /Device save/); r.stop();
  const reopened = await f.api.openOfflineScoring(owner, roundId, undefined, true);
  assert.equal(reopened.view().arrows[0].score, "9"); assert.equal(reopened.view().status, "failed");
  const requests = f.requests; f.badDisk = false; await reopened.retry(); reopened.stop();
  assert.equal(f.requests, requests);
  const durable = await f.api.openOfflineScoring(owner, roundId, undefined, true);
  assert.equal(durable.view().pending, 1); durable.stop();
});

test("offline adapter: conflict choice cannot rebase recorded shots onto a changed target configuration", async () => {
  const f = runtime(); await setup(f);
  const local = await f.api.openOfflineScoring(owner, roundId, undefined, true); await local.save(entry); local.stop();
  f.server.set("1-1", { revision: "00000000-0000-4000-8000-000000000099", arrow: { ...entry, score: "8" } });
  const normal = await f.api.openOfflineScoring(owner, roundId); normal.start(() => {}); await normal.synchronize();
  assert.equal(normal.view().status, "conflict"); f.faceType = "triple_face";
  await assert.rejects(normal.resolve(entry, "device"), /configuration changed/);
  assert.equal(f.server.get("1-1").arrow.score, "8"); assert.equal(normal.view().pending, 1); normal.stop();
});
