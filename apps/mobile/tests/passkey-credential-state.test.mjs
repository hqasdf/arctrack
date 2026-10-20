import assert from "node:assert/strict";
import test from "node:test";
import { createDeviceCredentialState } from "../src/passkeys/credential-state.ts";

const alice = "11111111-1111-4111-8111-111111111111", bob = "22222222-2222-4222-8222-222222222222";
const first = { id: "33333333-3333-4333-8333-333333333333", created_at: "2026-10-20T00:00:00Z", friendly_name: "Synced provider" };
const other = { ...first, id: "44444444-4444-4444-8444-444444444444", friendly_name: "Other registration" };
const scope = { ownerId: alice, supabaseUrl: "https://credential-state.invalid", relyingPartyId: "rp.invalid" };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const outcome = promise => promise.then(value => ({ value }), error => ({ error }));

function runtime() {
  const values = new Map(), calls = [], removals = [];
  let credentials = [], revision = 0, current = true, registrations = 0;
  const controls = { listError: false, readError: false, storageError: false, corruptWrite: false, forgetRegistration: false,
    removalFails: false, readGate: null, registerGate: null, writeGate: null, removeGate: null };
  const storage = {
    async getItem(key) { calls.push(["read", key]); if (controls.readGate) await controls.readGate.promise;
      if (controls.readError) throw Error("Synthetic keychain read failure"); return values.get(key) ?? null; },
    async setItem(key, value) { calls.push(["write", key]); if (controls.writeGate) await controls.writeGate.promise;
      if (controls.storageError) throw Error("Synthetic storage failure"); values.set(key, controls.corruptWrite ? "corrupt" : value); },
    async removeItem(key) { calls.push(["remove", key]); if (controls.storageError) throw Error("Synthetic storage failure"); values.delete(key); },
  };
  const server = {
    async list() { if (controls.listError) throw Error("Synthetic network failure"); return [...credentials]; },
    async register() { registrations++; if (controls.registerGate) await controls.registerGate.promise;
      if (!controls.forgetRegistration) credentials = [...credentials, first]; return first; },
    async remove(id) { removals.push(id); if (controls.removeGate) await controls.removeGate.promise;
      if (!controls.removalFails) credentials = credentials.filter(item => item.id !== id); },
  };
  const create = (selected = scope) => createDeviceCredentialState({ scope: selected, storage, server,
    revision: () => revision, isCurrent: () => current });
  return { create, values, calls, removals, controls, get registrations() { return registrations; },
    setCredentials(value) { credentials = value; }, get credentials() { return credentials; },
    invalidate() { revision++; }, dispose() { current = false; }, get key() { return [...values.keys()][0]; } };
}

test("registration stores only scoped credential metadata after server confirmation", async () => {
  const r = runtime(), state = await r.create().register();
  assert.equal(state.registeredHere, first.id);
  assert.deepEqual(state.credentials, [first]); assert.equal(r.registrations, 1);
  assert.deepEqual(JSON.parse(r.values.get(r.key)), { version: 1, ownerId: alice, origin: scope.supabaseUrl,
    relyingPartyId: scope.relyingPartyId, credentialId: first.id });
  assert.doesNotMatch(r.values.get(r.key), /token|password|private|enabled/i);
});

test("a fresh controller simulates restart and re-confirms persisted enrollment with Supabase", async () => {
  const r = runtime(); await r.create().register();
  assert.equal((await r.create().reconcile()).registeredHere, first.id);
  assert.equal(r.registrations, 1, "Restoration never creates another credential");
  r.controls.listError = true;
  await assert.rejects(r.create().reconcile(), /network/);
  assert.equal(r.values.size, 1, "A network failure does not erase remembered metadata");
});

test("a credential registered elsewhere or synced into a provider is not inferred to be local", async () => {
  const r = runtime(); r.setCredentials([first, other]);
  assert.deepEqual(await r.create().reconcile(), { credentials: [first, other], registeredHere: null });
  assert.deepEqual(r.removals, []); assert.equal(r.values.size, 0);
});

test("remembered state is isolated by owner, project and approved relying party", async () => {
  const r = runtime(); await r.create().register();
  for (const selected of [{ ...scope, ownerId: bob }, { ...scope, supabaseUrl: "https://other-project.invalid" },
    { ...scope, relyingPartyId: "other-rp.invalid" }]) {
    assert.equal((await r.create(selected).reconcile()).registeredHere, null);
  }
  assert.equal((await r.create().reconcile()).registeredHere, first.id);
});

test("changing account does not revoke the previous account's remembered credential", async () => {
  const r = runtime(); await r.create().register(); r.setCredentials([other]);
  assert.equal((await r.create({ ...scope, ownerId: bob }).reconcile()).registeredHere, null);
  assert.deepEqual(r.removals, []); assert.equal(r.values.size, 1);
  r.setCredentials([first]); assert.equal((await r.create().reconcile()).registeredHere, first.id);
});

test("repeat Enable reconciles the bound credential instead of registering duplicates", async () => {
  const r = runtime(); await r.create().register();
  await r.create().register(); assert.equal(r.registrations, 1);
});

test("missing server credential clears only the remembered metadata", async () => {
  const r = runtime(); await r.create().register(); r.setCredentials([other]);
  assert.deepEqual(await r.create().reconcile(), { credentials: [other], registeredHere: null });
  assert.equal(r.values.size, 0); assert.deepEqual(r.removals, []);
});

for (const invalid of ["invalid json", "null", "true", JSON.stringify({ enabled: true }), JSON.stringify({ version: 2 }),
  JSON.stringify({ version: 1, ownerId: bob, origin: scope.supabaseUrl, relyingPartyId: scope.relyingPartyId, credentialId: first.id })]) {
  test(`malformed or unscoped local value never proves Enabled: ${invalid.slice(0, 20)}`, async () => {
    const r = runtime(); await r.create().register(); r.values.set(r.key, invalid);
    assert.equal((await r.create().reconcile()).registeredHere, null); assert.deepEqual(r.removals, []);
  });
}

test("unconfirmed server registration never writes a local binding", async () => {
  const r = runtime(); r.controls.forgetRegistration = true;
  await assert.rejects(r.create().register(), /confirmed/); assert.equal(r.values.size, 0);
});

test("unreadable metadata rejects rather than inferring local enrollment from account-wide credentials", async () => {
  const r = runtime(); await r.create().register(); r.controls.readError = true;
  await assert.rejects(r.create().reconcile(), /read failure/); assert.deepEqual(r.removals, []);
});

test("storage failure/readback mismatch rejects instead of displaying Enabled", async () => {
  for (const control of ["storageError", "corruptWrite"]) {
    const r = runtime(); r.controls[control] = true;
    await assert.rejects(r.create().register()); assert.equal(r.registrations, 1);
    assert.equal((await r.create().reconcile()).registeredHere, null);
  }
});

test("explicit removal deletes only the chosen credential and reconciles the local setting", async () => {
  const r = runtime(); await r.create().register(); r.setCredentials([first, other]);
  const state = await r.create().remove(first.id);
  assert.equal(state.registeredHere, null); assert.deepEqual(state.credentials, [other]);
  assert.deepEqual(r.removals, [first.id]); assert.equal(r.values.size, 0);
});

test("explicitly removing another registration does not clear this registration's binding", async () => {
  const r = runtime(); await r.create().register(); r.setCredentials([first, other]);
  const state = await r.create().remove(other.id);
  assert.equal(state.registeredHere, first.id); assert.deepEqual(r.removals, [other.id]);
});

test("failed removal retains server authority and never falsely reports Disabled", async () => {
  const r = runtime(); await r.create().register(); r.controls.removalFails = true;
  await assert.rejects(r.create().remove(first.id), /confirmed/);
  assert.equal((await r.create().reconcile()).registeredHere, first.id);
});

test("restart after server removal but interrupted local cleanup reconciles to Disabled", async () => {
  const r = runtime(); await r.create().register(); r.controls.storageError = true;
  await assert.rejects(r.create().remove(first.id)); assert.equal(r.values.size, 1);
  assert.deepEqual(r.credentials, []); r.controls.storageError = false;
  assert.equal((await r.create().reconcile()).registeredHere, null); assert.equal(r.values.size, 0);
});

test("logout while registration is pending prevents a later local binding", async () => {
  const r = runtime(), gate = deferred(); r.controls.registerGate = gate;
  const pending = outcome(r.create().register()); await new Promise(setImmediate);
  r.invalidate(); gate.resolve(); assert.match((await pending).error.message, /abandoned/);
  assert.equal(r.values.size, 0); assert.deepEqual(r.removals, []);
});

test("late metadata write after invalidation cannot enable UI or authenticate a session", async () => {
  const r = runtime(), gate = deferred(); r.controls.writeGate = gate;
  const pending = outcome(r.create().register()); await new Promise(setImmediate);
  r.invalidate(); gate.resolve(); assert.match((await pending).error.message, /abandoned/);
  // This is harmless metadata, not crash-atomic auth authority. A later read
  // still requires the credential to exist on the authenticated server list.
  r.setCredentials([]); assert.equal((await r.create().reconcile()).registeredHere, null);
  assert.equal(r.values.size, 0);
});

test("queued operation cannot survive an account switch while an earlier read is pending", async () => {
  const r = runtime(), gate = deferred(); r.controls.readGate = gate; const controller = r.create();
  const firstRead = outcome(controller.reconcile()), registration = outcome(controller.register());
  await new Promise(setImmediate); r.invalidate(); gate.resolve();
  assert.match((await firstRead).error.message, /abandoned/);
  assert.match((await registration).error.message, /abandoned/); assert.equal(r.registrations, 0);
});

test("in-flight registration and removal are ordered within a controller", async () => {
  const r = runtime(), gate = deferred(); r.controls.registerGate = gate; const controller = r.create();
  const registration = controller.register(), removal = controller.remove(first.id);
  gate.resolve(); assert.equal((await registration).registeredHere, first.id);
  assert.equal((await removal).registeredHere, null); assert.deepEqual(r.removals, [first.id]);
});

test("invalid scope never reads storage or contacts the server", () => {
  const r = runtime();
  for (const invalid of [{ ...scope, ownerId: "arbitrary-user" }, { ...scope, relyingPartyId: "" },
    { ...scope, relyingPartyId: "https://rp.invalid" }, { ...scope, supabaseUrl: "http://credential-state.invalid" }]) {
    assert.throws(() => r.create(invalid));
  }
  assert.deepEqual(r.calls, []); assert.equal(r.registrations, 0);
});
