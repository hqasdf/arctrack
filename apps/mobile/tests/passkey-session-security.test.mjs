import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
import { createAuthStorage } from "../src/auth-storage.ts";
import { providerRuntime, routingRuntime } from "./helpers/auth-runtime.mjs";

// Process boundaries here are deterministic models: fresh adapters/SDK clients,
// abandoned JS continuations and controlled native-I/O completion. No Android
// force-stop, flash durability, real Auth endpoint or real credential is tested.
const key = "sb-passkey-boundary-auth-token";
const alice = "11111111-1111-4111-8111-111111111111", bob = "22222222-2222-4222-8222-222222222222";
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
function session(id) {
  const expires_at = Math.floor(Date.now() / 1000) + 3600;
  return { access_token: `${encode({ alg: "HS256" })}.${encode({ sub: id, exp: expires_at })}.c3ludGhldGlj`,
    refresh_token: `synthetic-refresh-${id}`, expires_at, expires_in: 3600, token_type: "bearer",
    user: { id, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-10-20T00:00:00Z" } };
}
const json = value => new Response(JSON.stringify(value), { status: 200, headers: {
  "Content-Type": "application/json", "X-Supabase-Api-Version": "2024-01-01",
} });
function store() {
  const secureValues = new Map(), legacyValues = new Map();
  const operations = [];
  const secure = {
    async getItem(key) { return secureValues.get(key) ?? null; },
    async setItem(key, value) { operations.push("secure-write"); secureValues.set(key, value); },
    async removeItem(key) { operations.push("secure-remove"); secureValues.delete(key); },
  };
  const legacy = {
    async getItem(key) { return legacyValues.get(key) ?? null; },
    async setItem() { throw Error("Tokens must never be written to legacy storage"); },
    async removeItem(key) { operations.push("legacy-remove"); legacyValues.delete(key); },
  };
  return { secure, legacy, secureValues, legacyValues, operations,
    restart: () => createAuthStorage(secure, legacy, () => {}) };
}
function client(storage, fetch, persistent = true) {
  return createClient("https://passkey-boundary.invalid", "sb_publishable_synthetic", {
    auth: { storageKey: key, ...(persistent ? { storage } : {}), persistSession: persistent,
      autoRefreshToken: false, detectSessionInUrl: false, experimental: { passkey: true } },
    global: { fetch: async (input, init) => {
      assert.equal(new URL(input).hostname, "passkey-boundary.invalid", "No real Auth traffic");
      return fetch(new URL(input), init);
    } },
  });
}
function coordinator() {
  const exports = {}, feature = {};
  for (const [file, target] of [["feature.ts", feature], ["coordinator.ts", exports]]) {
    const code = ts.transpileModule(readFileSync(new URL(`../src/passkeys/${file}`, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function("require", "exports", code)(name => { assert.equal(name, "./feature"); return feature; }, target);
  }
  let factories = 0;
  const prepared = exports.createPasskeyOperationCoordinator({ assertAllowed() {}, getOwnerId: () => null,
    createService() { factories++; throw Error("No verification or persistence while blocked"); } });
  return { prepared, get factories() { return factories; } };
}

test("NEGATIVE CONTROL: persistent SDK verification can recreate a session after completed logout", async () => {
  const s = store(), started = deferred(), response = deferred(), a = session(alice);
  const unsafe = client(s.restart(), async url => {
    if (url.pathname.endsWith("/authentication/verify")) { started.resolve(); await response.promise; return json(a); }
    if (url.pathname.endsWith("/logout")) return json({});
    throw Error(`Unexpected mocked path ${url.pathname}`);
  });
  await unsafe.auth.getSession();
  try {
    const pending = unsafe.auth.passkey.verifyAuthentication({ challengeId: "synthetic", credential: {} });
    await started.promise; assert.equal((await unsafe.auth.signOut({ scope: "local" })).error, null);
    assert.equal(await s.restart().getItem(key), null);
    response.resolve(); assert.equal((await pending).error, null);
    assert.equal(JSON.parse(await s.restart().getItem(key)).user.id, alice,
      "Expected unsafe negative control, not an approved app adoption path");
  } finally { unsafe.auth.dispose(); }
});

for (const next of ["logout", "password-switch"]) {
  test(`ephemeral verification cannot overwrite persistent ${next}, including fresh-client restoration`, async () => {
    const s = store(), started = deferred(), response = deferred(), a = session(alice), b = session(bob);
    const fetch = async url => {
      if (url.pathname.endsWith("/authentication/verify")) { started.resolve(); await response.promise; return json(a); }
      if (url.pathname.endsWith("/logout")) return json({});
      if (url.pathname.endsWith("/token")) return json(b);
      throw Error(`Unexpected mocked path ${url.pathname}`);
    };
    const main = client(s.restart(), fetch), verifier = client(null, fetch, false);
    try {
      await main.auth.getSession(); await verifier.auth.getSession();
      const pending = verifier.auth.passkey.verifyAuthentication({ challengeId: "synthetic", credential: {} });
      await started.promise;
      if (next === "logout") await main.auth.signOut({ scope: "local" });
      else assert.equal((await main.auth.signInWithPassword({ email: "synthetic@example.invalid", password: "synthetic" })).error, null);
      response.resolve(); assert.equal((await pending).data.user.id, alice);
      await verifier.auth.signOut({ scope: "local" });
      const restarted = client(s.restart(), fetch);
      try { assert.equal((await restarted.auth.getSession()).data.session?.user.id ?? null, next === "logout" ? null : bob); }
      finally { restarted.auth.dispose(); }
    } finally { main.auth.dispose(); verifier.auth.dispose(); }
  });
}

test("completed normal password logout remains cleared after a fresh storage/SDK instance", async () => {
  const s = store(), a = session(alice); s.secureValues.set(key, JSON.stringify(a));
  const auth = client(s.restart(), async () => json({}));
  try { await auth.auth.getSession(); assert.equal((await auth.auth.signOut({ scope: "local" })).error, null); }
  finally { auth.auth.dispose(); }
  assert.equal(await s.restart().getItem(key), null);
  assert.equal(s.legacyValues.size, 0);
});

test("LIMITATION: interrupted, unacknowledged logout has no durable intent before secure deletion completes", async () => {
  const s = store(), a = session(alice), started = deferred(); s.secureValues.set(key, JSON.stringify(a));
  // The abandoned operation never resumes its JS. It has not completed logout.
  s.secure.removeItem = async () => { started.resolve(); await new Promise(() => {}); };
  void s.restart().removeItem(key); await started.promise;
  assert.equal(JSON.parse(await s.restart().getItem(key)).user.id, alice,
    "A new storage instance cannot know the old instance intended logout");
});

test("LIMITATION: interrupted legacy cleanup can retain both old session copies", async () => {
  const s = store(), a = JSON.stringify(session(alice)), started = deferred();
  s.secureValues.set(key, a); s.legacyValues.set(key, a);
  const originalRemove = s.legacy.removeItem;
  s.legacy.removeItem = async () => { started.resolve(); await new Promise(() => {}); };
  void s.restart().removeItem(key); await started.promise;
  s.legacy.removeItem = originalRemove;
  assert.equal(JSON.parse(await s.restart().getItem(key)).user.id, alice);
});

test("ADVERSARIAL MODEL: a cross-instance late native write is not fenced by the per-instance JS queue", async () => {
  const s = store(), a = JSON.stringify(session(alice)), b = JSON.stringify(session(bob)), started = deferred();
  let finishOldNativeWrite;
  const oldSecure = { ...s.secure, async setItem(key, value) {
    finishOldNativeWrite = () => s.secureValues.set(key, value);
    started.resolve(); await new Promise(() => {});
  } };
  void createAuthStorage(oldSecure, s.legacy, () => {}).setItem(key, a); await started.promise;
  const restarted = s.restart(); await restarted.setItem(key, b);
  assert.equal(JSON.parse(await restarted.getItem(key)).user.id, bob);
  finishOldNativeWrite();
  assert.equal(JSON.parse(await restarted.getItem(key)).user.id, alice,
    "This is a modeled API-guarantee gap, not a real Android process-kill result");
});

test("LIMITATION: existing legacy migration fallback also needs a future durable acceptance fence", async () => {
  const s = store(), a = JSON.stringify(session(alice)); s.legacyValues.set(key, a);
  s.secure.setItem = async () => { throw Error("Synthetic keystore write failure"); };
  assert.equal(await s.restart().getItem(key), a,
    "Preserve existing migration behavior; do not silently bypass it in a new adopter");
});

test("cold and recreated coordinators cannot adopt or perform storage/native side effects", async () => {
  const s = store(), before = structuredClone([...s.secureValues]);
  const attempt = coordinator(); await assert.rejects(attempt.prepared.authenticate(), /not been enabled/);
  attempt.prepared.invalidate(); attempt.prepared.dispose();
  const fresh = coordinator(); await assert.rejects(fresh.prepared.authenticate(), /not been enabled/);
  assert.equal(attempt.factories + fresh.factories, 0);
  assert.deepEqual([...s.secureValues], before); assert.deepEqual(s.operations, []);
});

test("a blocked biometric attempt cannot reveal protected routes or add identity checks", async () => {
  const app = providerRuntime(); await app.settle(); await app.settle();
  await assert.rejects(coordinator().prepared.authenticate());
  assert.equal(app.render().user, null);
  assert.ok(!routingRuntime(app.render()).routeNames.includes("(tabs)"));
  assert.equal(app.getUserCalls(), 1);
});

test("password fallback remains functional and persists normally after blocked biometric sign-in", async () => {
  const s = store(), a = session(alice), attempt = coordinator();
  await assert.rejects(attempt.prepared.authenticate());
  const normal = client(s.restart(), async url => {
    assert.ok(url.pathname.endsWith("/token")); return json(a);
  });
  try {
    assert.equal((await normal.auth.signInWithPassword({ email: "synthetic@example.invalid", password: "synthetic" })).data.user.id, alice);
    assert.equal(JSON.parse(await s.restart().getItem(key)).user.id, alice);
  } finally { normal.auth.dispose(); }
});
