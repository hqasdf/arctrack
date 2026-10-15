import assert from "node:assert/strict";
import test from "node:test";
import { BiometricLock, BIOMETRIC_BACKGROUND_MS, biometricPreferenceKey } from "../src/biometric-lock-model.ts";

const flush = () => new Promise(setImmediate);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function setup({ enabled = false, native, identity = "valid", storageFailure = false, write } = {}) {
  const preferences = new Map(enabled ? [[biometricPreferenceKey("A"), "1"]] : []);
  let time = 0, nativeCalls = 0, identityCalls = 0, signOutCalls = 0;
  const lock = new BiometricLock({
    readPreference: async key => { if (storageFailure) throw Error("private storage detail"); return preferences.get(key) ?? null; },
    writePreference: async (key, value) => { if (write) await write(); preferences.set(key, value); },
    removePreference: async key => { preferences.delete(key); },
    authenticate: async () => { nativeCalls++; return native ? native() : { success: true }; },
    verifySession: async id => { identityCalls++; assert.equal(id, lock.getSnapshot().userId); return identity; },
    onInvalidSession: async () => { signOutCalls++; await lock.signedOut(); },
    now: () => time,
  });
  return { lock, preferences, nativeCalls: () => nativeCalls, identityCalls: () => identityCalls,
    signOutCalls: () => signOutCalls, tick: ms => { time += ms; } };
}

test("biometrics are absent by default; ordinary launch makes no native or extra identity request", async () => {
  const s = setup(); s.lock.setUser("A"); assert.equal(s.lock.getSnapshot().locked, true);
  await flush(); assert.equal(s.lock.getSnapshot().enabled, false); assert.equal(s.lock.getSnapshot().locked, false);
  assert.equal(s.nativeCalls(), 0); assert.equal(s.identityCalls(), 0);
});
test("explicit opt-in authenticates, checks the current Supabase identity and persists only a scoped preference", async () => {
  const s = setup(); s.lock.setUser("A"); await flush(); await s.lock.setEnabled(true);
  assert.equal(s.nativeCalls(), 1); assert.equal(s.identityCalls(), 1);
  assert.deepEqual([...s.preferences], [[biometricPreferenceKey("A"), "1"]]);
  assert.equal(s.lock.getSnapshot().enabled, true); assert.equal(s.lock.getSnapshot().locked, false);
  await s.lock.setEnabled(false); assert.equal(s.preferences.size, 0); assert.equal(s.lock.getSnapshot().enabled, false);
});
for (const result of [{ success: false }, { success: false, message: "Cancelled" }, { success: false, message: "Unavailable" }]) {
  test(`failed/cancelled/unavailable opt-in remains disabled (${result.message ?? "rejected"})`, async () => {
    const s = setup({ native: () => result }); s.lock.setUser("A"); await flush(); await s.lock.setEnabled(true);
    assert.equal(s.lock.getSnapshot().enabled, false); assert.equal(s.preferences.size, 0); assert.equal(s.identityCalls(), 0);
  });
}
test("cold restore never unlocks protected content before a successful native result and identity check", async () => {
  const prompt = deferred(), s = setup({ enabled: true, native: () => prompt.promise }); s.lock.setUser("A");
  assert.equal(s.lock.getSnapshot().loaded, false); assert.equal(s.lock.getSnapshot().locked, true);
  await flush(); assert.equal(s.lock.getSnapshot().locked, true); assert.equal(s.lock.getSnapshot().busy, true);
  await s.lock.unlock(); await s.lock.retry(); assert.equal(s.nativeCalls(), 1);
  prompt.resolve({ success: true }); await flush(); assert.equal(s.lock.getSnapshot().locked, false);
});
test("cancelled restore stays locked; retry can unlock, with no auto retry loop", async () => {
  let result = { success: false }; const s = setup({ enabled: true, native: () => result });
  s.lock.setUser("A"); await flush(); assert.equal(s.lock.getSnapshot().locked, true); assert.equal(s.nativeCalls(), 1);
  await flush(); assert.equal(s.nativeCalls(), 1);
  await s.lock.setEnabled(false); assert.equal(s.lock.getSnapshot().enabled, true, "Cannot disable from a locked UI");
  result = { success: true }; await s.lock.retry(); assert.equal(s.lock.getSnapshot().locked, false);
});
test("settings read failures and corrupted stored preferences fail closed", async () => {
  const s = setup({ storageFailure: true }); s.lock.setUser("A"); await flush();
  assert.equal(s.lock.getSnapshot().locked, true); assert.match(s.lock.getSnapshot().error, /could not be read/);
  assert.doesNotMatch(s.lock.getSnapshot().error, /private/);
  const t = setup(); t.preferences.set(biometricPreferenceKey("A"), "corrupted"); t.lock.setUser("A"); await flush();
  assert.equal(t.lock.getSnapshot().locked, true);
});
test("expired/revoked/deleted identity cannot be unlocked and normal sign-out clears the preference", async () => {
  const s = setup({ enabled: true, identity: "signed-out" }); s.lock.setUser("A"); await flush();
  assert.equal(s.signOutCalls(), 1); assert.equal(s.lock.getSnapshot().userId, null); assert.equal(s.preferences.size, 0);
});
test("network failure during identity validation remains locked without discarding the session", async () => {
  const s = setup({ enabled: true, identity: "unavailable" }); s.lock.setUser("A"); await flush();
  assert.equal(s.lock.getSnapshot().locked, true); assert.equal(s.signOutCalls(), 0); assert.match(s.lock.getSnapshot().error, /connection/);
});
test("sign-out invalidates an in-flight prompt; account B inherits neither preference nor unlock", async () => {
  const prompt = deferred(), s = setup({ enabled: true, native: () => prompt.promise }); s.lock.setUser("A"); await flush();
  await s.lock.signedOut(); s.lock.setUser("B"); await flush(); prompt.resolve({ success: true }); await flush();
  assert.equal(s.lock.getSnapshot().userId, "B"); assert.equal(s.lock.getSnapshot().enabled, false);
  assert.equal(s.identityCalls(), 0); assert.equal(s.preferences.has(biometricPreferenceKey("A")), false);
});
test("a delayed enable write cannot recreate a signed-out preference", async () => {
  const pending = deferred(), s = setup({ write: () => pending.promise }); s.lock.setUser("A"); await flush();
  const enable = s.lock.setEnabled(true); await flush(); const logout = s.lock.signedOut();
  pending.resolve(); await enable; await logout; assert.equal(s.preferences.size, 0); assert.equal(s.lock.getSnapshot().userId, null);
});
test("brief app switching hides content but resumes without another prompt; 60 seconds relocks", async () => {
  const s = setup({ enabled: true }); s.lock.setUser("A"); await flush(); assert.equal(s.nativeCalls(), 1);
  s.lock.appStateChanged("inactive"); s.lock.appStateChanged("background"); assert.equal(s.lock.getSnapshot().obscured, true);
  s.tick(BIOMETRIC_BACKGROUND_MS - 1); s.lock.appStateChanged("active"); await flush();
  assert.equal(s.lock.getSnapshot().locked, false); assert.equal(s.nativeCalls(), 1);
  s.lock.appStateChanged("background"); s.tick(BIOMETRIC_BACKGROUND_MS); s.lock.appStateChanged("active"); await flush();
  assert.equal(s.nativeCalls(), 2); assert.equal(s.lock.getSnapshot().locked, false);
});
test("native prompt inactive/active interruptions do not create another prompt or relock loop", async () => {
  const prompt = deferred(), s = setup({ enabled: true, native: () => prompt.promise }); s.lock.setUser("A"); await flush();
  s.lock.appStateChanged("inactive"); s.tick(90_000); s.lock.appStateChanged("active"); assert.equal(s.nativeCalls(), 1);
  prompt.resolve({ success: true }); await flush(); assert.equal(s.lock.getSnapshot().locked, false); assert.equal(s.nativeCalls(), 1);
});
test("a native result after actual backgrounding is stale and cannot unlock", async () => {
  const prompt = deferred(), s = setup({ enabled: true, native: () => prompt.promise }); s.lock.setUser("A"); await flush();
  s.lock.appStateChanged("background"); prompt.resolve({ success: true }); await flush();
  assert.equal(s.lock.getSnapshot().locked, true); assert.equal(s.identityCalls(), 0);
});
test("backgrounding during opt-in persistence keeps the new preference locked", async () => {
  const pending = deferred(), s = setup({ write: () => pending.promise }); s.lock.setUser("A"); await flush();
  const enable = s.lock.setEnabled(true); await flush(); s.lock.appStateChanged("background"); pending.resolve(); await enable;
  assert.equal(s.lock.getSnapshot().enabled, true); assert.equal(s.lock.getSnapshot().locked, true);
});
test("ordinary navigation / same user and token-refresh identity updates do not reprompt", async () => {
  const s = setup({ enabled: true }); s.lock.setUser("A"); await flush();
  for (let i = 0; i < 10; i++) s.lock.setUser("A"); await flush(); assert.equal(s.nativeCalls(), 1);
});
test("disposed controller rejects pending native results and removes subscriptions", async () => {
  const prompt = deferred(), s = setup({ enabled: true, native: () => prompt.promise }); let updates = 0;
  s.lock.subscribe(() => updates++); s.lock.setUser("A"); await flush(); s.lock.dispose(); const before = updates;
  prompt.resolve({ success: true }); await flush(); assert.equal(updates, before); assert.equal(s.identityCalls(), 0);
});

test("late identity results cannot unlock a newly selected account", async () => {
  const pending = deferred(); let checks = 0;
  const lock = new BiometricLock({
    readPreference: async () => "1", writePreference: async () => {}, removePreference: async () => {},
    authenticate: async () => ({ success: true }), verifySession: async () => { checks++; return pending.promise; }, onInvalidSession: async () => assert.fail("Must not sign out a newer account"),
  });
  lock.setUser("A"); await flush(); assert.equal(checks, 1);
  lock.setUser("B"); pending.resolve("signed-out"); await flush();
  assert.equal(lock.getSnapshot().userId, "B"); assert.equal(lock.getSnapshot().locked, true);
});
test("failed preference write never enables biometric unlock or exposes private errors", async () => {
  const s = setup({ write: async () => { throw Error("private native detail"); } });
  s.lock.setUser("A"); await flush(); await s.lock.setEnabled(true);
  assert.equal(s.lock.getSnapshot().enabled, false); assert.equal(s.preferences.size, 0);
  assert.doesNotMatch(s.lock.getSnapshot().error, /private/); assert.equal(s.lock.getSnapshot().busy, false);
});
