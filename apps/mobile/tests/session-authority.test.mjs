import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const fixture = { exports: {} };
const source = readFileSync(new URL("../src/session-authority.ts", import.meta.url), "utf8");
new Function("module", "exports", ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText)(fixture, fixture.exports);
const { createSessionAuthority } = fixture.exports;
const authorityKey = "authority.synthetic", sessionKey = "session.synthetic";
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const outcome = promise => promise.then(value => ({ value }), error => ({ error }));
function session(id = "athlete-a", serial = "one") {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return { access_token: `${encode({ alg: "HS256" })}.${encode({ sub: id, session_id: `${id}-${serial}`, exp })}.synthetic`,
    refresh_token: `synthetic-${id}-${serial}`, token_type: "bearer", expires_at: exp, expires_in: 3600,
    user: { id, aud: "authenticated" } };
}
function memory(initial = {}) {
  const values = new Map(Object.entries(initial)), calls = [];
  return { values, calls, async getItem(key) { calls.push(["get", key]); return values.get(key) ?? null; },
    async setItem(key, value) { calls.push(["set", key]); values.set(key, value); },
    async removeItem(key) { calls.push(["remove", key]); values.delete(key); } };
}
function runtime(previous = null, initial = {}) {
  const records = memory(initial), legacy = memory(previous ? { [sessionKey]: JSON.stringify(previous) } : {});
  let cleanupFailures = 0;
  const create = () => createSessionAuthority({ authorityKey, sessionKey, records, legacy,
    legacyRecovery: async () => false, reportCleanupFailure: () => cleanupFailures++ });
  return { records, legacy, create, authority: create(), get cleanupFailures() { return cleanupFailures; } };
}
async function adopt(authority, candidate, kind = "password") {
  const ticket = await authority.begin(kind);
  await authority.withCandidate(ticket, candidate, () => authority.storage.setItem(sessionKey, JSON.stringify(candidate)));
  return ticket;
}

test("SDK expiry estimates may differ from JWT expiry without changing identity binding", async () => {
  const r = runtime(), candidate = { ...session(), expires_at: Math.floor(Date.now() / 1000) + 3598 };
  await adopt(r.authority, candidate);
  assert.equal(r.authority.allowsSession(candidate), true);
});

test("an accepted candidate grant cannot reapply recovery purpose on a later SDK save", async () => {
  const r = runtime(), candidate = session();
  const ticket = await r.authority.begin("recovery");
  await r.authority.withCandidate(ticket, candidate, async () => {
    await r.authority.storage.setItem(sessionKey, JSON.stringify(candidate));
    await r.authority.completeRecovery(ticket.epoch);
    await r.authority.storage.setItem(sessionKey, JSON.stringify(candidate));
  });
  assert.equal(r.authority.snapshot().accepted.mode, "normal");
});

test("refresh cannot change an established Supabase session binding", async () => {
  const previous = session(), r = runtime(previous); await r.authority.ready();
  const lease = r.authority.requestLease(previous.access_token, previous.refresh_token);
  assert.throws(() => lease.grantRefresh(session(previous.user.id, "unrelated-session")), error => error.code === "invalid_session");
  assert.equal(r.authority.allowsSession(previous), true);
});

test("legacy session migrates once and remains signed in across ordinary restart", async () => {
  const previous = session(), r = runtime(previous);
  await r.authority.ready();
  assert.equal(r.authority.allowsSession(previous), true);
  assert.equal(r.legacy.values.has(sessionKey), false);
  assert.equal(JSON.parse(r.records.values.get(authorityKey)).version, 1);
  const restarted = r.create(); await restarted.ready();
  assert.deepEqual(JSON.parse(await restarted.storage.getItem(sessionKey)), previous);
});

test("valid signed-out authority prevents all legacy fallback", async () => {
  const r = runtime(session(), { [authorityKey]: JSON.stringify({ version: 1, epoch: 7, phase: "signedOut", accepted: null }) });
  await r.authority.ready();
  assert.equal(await r.authority.storage.getItem(sessionKey), null);
  assert.equal(r.legacy.calls.some(([operation]) => operation === "get"), false);
});

test("corrupt authority fails closed and does not revive legacy credentials", async () => {
  const r = runtime(session(), { [authorityKey]: "{broken" });
  await assert.rejects(r.authority.ready(), error => error.code === "corrupt");
  assert.equal(r.authority.snapshot().accepted, null);
  assert.equal(r.legacy.calls.some(([operation]) => operation === "get"), false);
  assert.equal(r.legacy.values.has(sessionKey), true);
});

test("pending attempt restart retains only the previous accepted account", async () => {
  const previous = session(), r = runtime(previous);
  await r.authority.ready(); await r.authority.begin("passkey");
  const pending = JSON.parse(r.records.values.get(authorityKey));
  assert.equal(pending.phase, "pending");
  const restarted = r.create(); await restarted.ready();
  assert.equal(restarted.allowsSession(previous), true);
  assert.equal(JSON.parse(r.records.values.get(authorityKey)).phase, "accepted");
  assert.ok(JSON.parse(r.records.values.get(authorityKey)).epoch > pending.epoch);
});

test("pending restart without a predecessor stays signed out", async () => {
  const r = runtime(); await r.authority.ready(); await r.authority.begin("passkey");
  const restarted = r.create(); await restarted.ready();
  assert.equal(await restarted.storage.getItem(sessionKey), null);
  assert.equal(JSON.parse(r.records.values.get(authorityKey)).phase, "signedOut");
});

test("failed migration acknowledgment preserves legacy and never authorizes UI", async () => {
  const r = runtime(session());
  r.records.setItem = async () => { throw Error("Synthetic failed commit"); };
  await assert.rejects(r.authority.ready(), error => error.code === "storage");
  assert.equal(r.authority.snapshot().accepted, null);
  assert.equal(r.legacy.values.has(sessionKey), true);
});

test("failed legacy cleanup does not discard successfully committed authority", async () => {
  const previous = session(), r = runtime(previous);
  r.legacy.removeItem = async () => { throw Error("Synthetic cleanup failure"); };
  await r.authority.ready();
  assert.equal(r.authority.allowsSession(previous), true);
  assert.equal(r.cleanupFailures, 1);
});

test("candidate requires explicit grant and stale candidate never changes accepted account", async () => {
  const previous = session(), candidate = session("athlete-b"), r = runtime(previous);
  await r.authority.ready();
  await assert.rejects(r.authority.storage.setItem(sessionKey, JSON.stringify(candidate)), error => error.code === "stale");
  const old = await r.authority.begin("passkey"); await r.authority.begin("password");
  await assert.rejects(r.authority.withCandidate(old, candidate, () => r.authority.storage.setItem(sessionKey, JSON.stringify(candidate))), error => error.code === "stale");
  assert.equal(r.authority.allowsSession(previous), true);
});

test("accepted password and recovery candidates bind UI to exact accepted tokens", async () => {
  const r = runtime(), candidate = session(); await r.authority.ready();
  await adopt(r.authority, candidate, "recovery");
  assert.equal(r.authority.allowsSession(candidate), true);
  assert.equal(r.authority.allowsSession(session("athlete-a", "other")), false);
  assert.equal(r.authority.snapshot().accepted.mode, "recovery");
  await r.authority.completeRecovery(r.authority.snapshot().accepted.epoch);
  assert.equal(r.authority.snapshot().accepted.mode, "normal");
});

test("logout fences UI synchronously and queues tombstone after already-issued write", async () => {
  const previous = session(), r = runtime(previous); await r.authority.ready();
  const entered = deferred(), released = deferred(), original = r.records.setItem;
  r.records.setItem = async (...args) => { entered.resolve(); await released.promise; return original(...args); };
  const write = r.authority.storage.setItem(sessionKey, JSON.stringify(previous));
  await entered.promise;
  const logout = r.authority.retire();
  assert.equal(r.authority.snapshot().accepted, null);
  released.resolve(); await write; await logout;
  assert.equal(JSON.parse(r.records.values.get(authorityKey)).phase, "signedOut");
  const restarted = r.create(); await restarted.ready();
  assert.equal(await restarted.storage.getItem(sessionKey), null);
});

test("failed logout acknowledgment does not authorize UI or falsely report logout success", async () => {
  const r = runtime(session()); await r.authority.ready();
  r.records.setItem = async () => { throw Error("Synthetic commit failure"); };
  await assert.rejects(r.authority.retire(), error => error.code === "storage");
  assert.equal(r.authority.snapshot().accepted, null);
  assert.equal(r.authority.snapshot().error.code, "storage");
});

test("a newer attempt during issued candidate write cannot inherit the abandoned candidate", async () => {
  const previous = session(), candidate = session("athlete-b"), r = runtime(previous);
  await r.authority.ready(); const first = await r.authority.begin("passkey");
  const entered = deferred(), released = deferred(), original = r.records.setItem;
  let firstWrite = true;
  r.records.setItem = async (...args) => { if (firstWrite) { firstWrite = false; entered.resolve(); await released.promise; } return original(...args); };
  const observed = [];
  r.authority.subscribe(() => observed.push(r.authority.snapshot().accepted?.accountId ?? null));
  const firstResult = outcome(r.authority.withCandidate(first, candidate, () => r.authority.storage.setItem(sessionKey, JSON.stringify(candidate))));
  await entered.promise;
  const next = r.authority.begin("password"); released.resolve();
  assert.equal((await firstResult).error?.code, "stale"); await next;
  assert.equal(r.authority.allowsSession(previous), true);
  assert.equal(r.authority.allowsSession(candidate), false);
  assert.equal(observed.includes(candidate.user.id), false);
  const restarted = r.create(); await restarted.ready();
  assert.equal(restarted.allowsSession(previous), true);
});

test("failed stale-write compensation freezes authority and rejects the newer attempt", async () => {
  const previous = session(), candidate = session("athlete-b"), r = runtime(previous);
  await r.authority.ready(); const first = await r.authority.begin("passkey");
  const entered = deferred(), released = deferred(), original = r.records.setItem;
  let writes = 0;
  r.records.setItem = async (...args) => {
    writes++;
    if (writes === 1) { entered.resolve(); await released.promise; return original(...args); }
    throw Error("Synthetic failed compensation acknowledgment");
  };
  const firstResult = outcome(r.authority.withCandidate(first, candidate, () => r.authority.storage.setItem(sessionKey, JSON.stringify(candidate))));
  await entered.promise;
  const next = outcome(r.authority.begin("password")); released.resolve();
  assert.equal((await firstResult).error?.code, "storage");
  assert.equal((await next).error?.code, "storage");
  assert.equal(r.authority.snapshot().accepted, null);
  assert.equal(r.authority.snapshot().error.code, "storage");
});

test("pending login preserves accepted refresh lease; logout invalidates it", async () => {
  const previous = session(), r = runtime(previous); await r.authority.ready();
  const lease = r.authority.requestLease(previous.access_token, previous.refresh_token);
  await r.authority.begin("passkey");
  assert.doesNotThrow(() => lease.current());
  const refreshed = { ...previous, refresh_token: "synthetic-rotated-refresh", expires_in: 3500 };
  lease.grantRefresh(refreshed);
  await r.authority.storage.setItem(sessionKey, JSON.stringify(refreshed));
  assert.equal(r.authority.allowsSession(refreshed), true);
  assert.equal(r.authority.allowsSession(previous), false);
  await r.authority.retire();
  assert.throws(() => lease.current(), error => error.code === "stale");
  await assert.rejects(r.authority.storage.setItem(sessionKey, JSON.stringify(refreshed)), error => error.code === "stale");
});

test("old account request lease cannot grant refresh after account switch", async () => {
  const previous = session(), r = runtime(previous); await r.authority.ready();
  const lease = r.authority.requestLease(previous.access_token, previous.refresh_token);
  const next = session("athlete-b"); await adopt(r.authority, next);
  assert.throws(() => lease.grantRefresh(previous), error => error.code === "stale");
  assert.equal(r.authority.allowsSession(next), true);
});

test("unacknowledged write may persist physically but never grants current UI acceptance", async () => {
  const previous = session(), candidate = session("athlete-b"), r = runtime(previous);
  await r.authority.ready(); const ticket = await r.authority.begin("password");
  const original = r.records.setItem;
  r.records.setItem = async (...args) => { await original(...args); throw Error("Synthetic uncertain acknowledgment"); };
  await assert.rejects(r.authority.withCandidate(ticket, candidate, () => r.authority.storage.setItem(sessionKey, JSON.stringify(candidate))), error => error.code === "storage");
  assert.equal(r.authority.snapshot().accepted, null);
  assert.equal(r.authority.allowsSession(candidate), false);
  // Restart sees the actual surviving durable record. A rejected acknowledgment
  // cannot establish whether a native write reached disk before termination.
  assert.equal(JSON.parse(r.records.values.get(authorityKey)).accepted.accountId, candidate.user.id);
});
