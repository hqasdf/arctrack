import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const fixtureModule = { exports: {} };
const source = readFileSync(new URL("../src/passkeys/service.ts", import.meta.url), "utf8");
new Function("require", "module", "exports", ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText)(require, fixtureModule, fixtureModule.exports);
const { createPreparedPasskeyService } = fixtureModule.exports;

test("verified adoption transfers session ownership without diagnostic revocation", async t => {
  let accepted = null;
  const r = runtime(t, { adoptVerifiedSession: async session => { accepted = session; }, ownsAdoptedSession: session => accepted === session });
  assert.deepEqual(await r.service.authenticate(), { userId: alice });
  assert.equal(accepted.user.id, alice);
  assert.equal(r.revoked.length, 0);
});

test("failed adoption cleans up its candidate only", async t => {
  const r = runtime(t, { adoptVerifiedSession: async () => { throw Error("Synthetic stale attempt"); }, ownsAdoptedSession: () => false });
  await assert.rejects(r.service.authenticate(), /Synthetic stale attempt/);
  assert.equal(r.revoked.length, 1);
  assert.notEqual(r.revoked[0], r.initial.access_token);
});

test("accepted ownership is retained if a later continuation reports supersession", async t => {
  let accepted = null;
  const r = runtime(t, { adoptVerifiedSession: async session => { accepted = session; throw Error("Synthetic late supersession"); },
    ownsAdoptedSession: session => accepted === session });
  await assert.rejects(r.service.authenticate(), /Synthetic late supersession/);
  assert.equal(r.revoked.length, 0);
});

test("logout during verification prevents adoption and cleans up the issued candidate", async t => {
  let adoptions = 0;
  const r = runtime(t, { adoptVerifiedSession: async () => { adoptions++; }, ownsAdoptedSession: () => false });
  r.controls.verifyGate = deferred();
  const result = outcome(r.service.authenticate());
  await r.controls.verifyStarted.promise;
  r.invalidate(); r.controls.verifyGate.resolve();
  assert.equal((await result).error.code, "stale");
  assert.equal(adoptions, 0); assert.equal(r.revoked.length, 1);
});
const alice = "11111111-1111-4111-8111-111111111111", bob = "22222222-2222-4222-8222-222222222222";
const passkeyId = "33333333-3333-4333-8333-333333333333";
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const outcome = promise => promise.then(value => ({ value }), error => ({ error }));
const user = id => ({ id, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-10-20T00:00:00Z" });
const credential = { id: "c3ludGhldGlj", rawId: "c3ludGhldGlj", type: "public-key", clientExtensionResults: {},
  response: { clientDataJSON: "c3ludGhldGlj", authenticatorData: "c3ludGhldGlj", signature: "c3ludGhldGlj" } };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: {
  "Content-Type": "application/json", "X-Supabase-Api-Version": "2024-01-01",
} });

function runtime(t, adoption = {}) {
  let allowed = true, current = true, serial = 0, factories = 0, nativeCalls = 0;
  const requests = [], clients = [], disposed = [], tokens = new Map(), revoked = [];
  const controls = { wrongIdentity: false, expiredOwner: false, wrongRp: false, missingOptions: false, failVerify: false,
    confirmRegistration: true, removalWorks: true, failLogout: false, nativeError: null,
    nativeGate: null, nativeStarted: deferred(), verifyGate: null, verifyStarted: deferred(),
    identityGate: null, identityStarted: deferred(), failFactory: false, expiredCandidate: false, logoutStatus: null };
  const issue = (id, expired = false) => {
    const expires_at = Math.floor(Date.now() / 1000) + (expired ? -60 : 3600);
    const access_token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: id, exp: expires_at, serial: ++serial })}.c3ludGhldGlj`;
    const session = { access_token, refresh_token: `synthetic-refresh-${serial}`, expires_at,
      expires_in: 3600, token_type: "bearer", user: user(id) };
    tokens.set(access_token, session); return session;
  };
  const initial = issue(alice);
  let owner = { userId: alice, accessToken: initial.access_token, refreshToken: initial.refresh_token };
  const registered = { id: passkeyId, friendly_name: "Development credential", created_at: "2026-10-20T00:00:00Z" };
  const server = { credentials: [] };
  const fetch = async (input, init = {}) => {
    const url = new URL(input); assert.equal(url.hostname, "passkey-service.invalid", "No real network is permitted");
    const token = new Headers(init.headers).get("authorization")?.replace(/^Bearer /, "");
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ path: url.pathname, method: init.method ?? "GET", token, body, scope: url.searchParams.get("scope") });
    if (url.pathname.endsWith("/user")) {
      controls.identityStarted.resolve(); if (controls.identityGate) await controls.identityGate.promise;
      const selected = tokens.get(token); assert.ok(selected, "Only issued synthetic tokens are accepted");
      return json(user(controls.wrongIdentity ? bob : selected.user.id));
    }
    if (controls.missingOptions && url.pathname.endsWith("/options")) return json({ challenge_id: "synthetic-challenge" });
    if (url.pathname.endsWith("/registration/options")) return json({ challenge_id: "registration-challenge",
      options: { challenge: "c3ludGhldGlj", rp: { id: controls.wrongRp ? "wrong.invalid" : "example.invalid", name: "Test" },
        user: { id: "c3ludGhldGlj", name: "test@example.invalid", displayName: "Test" }, pubKeyCredParams: [{ type: "public-key", alg: -7 }] } });
    if (url.pathname.endsWith("/registration/verify")) {
      controls.verifyStarted.resolve(); if (controls.verifyGate) await controls.verifyGate.promise;
      if (controls.failVerify) return json({ msg: "Synthetic rejection", code: "webauthn_verification_failed" }, 400);
      if (controls.confirmRegistration) server.credentials = [registered];
      return json(registered);
    }
    if (url.pathname.endsWith("/authentication/options")) return json({ challenge_id: "authentication-challenge",
      options: { challenge: "c3ludGhldGlj", rpId: controls.wrongRp ? "wrong.invalid" : "example.invalid", userVerification: "required" } });
    if (url.pathname.endsWith("/authentication/verify")) {
      controls.verifyStarted.resolve(); if (controls.verifyGate) await controls.verifyGate.promise;
      if (controls.failVerify) return json({ msg: "Synthetic rejection", code: "webauthn_verification_failed" }, 400);
      return json(issue(alice, controls.expiredCandidate));
    }
    if (url.pathname === "/auth/v1/passkeys") return json(server.credentials);
    if (url.pathname === `/auth/v1/passkeys/${passkeyId}` && init.method === "DELETE") {
      if (controls.removalWorks) server.credentials = server.credentials.filter(item => item.id !== passkeyId);
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith("/logout")) {
      if (controls.logoutStatus) return json({ msg: "Synthetic already-invalid credential" }, controls.logoutStatus);
      if (controls.failLogout) return json({ msg: "Synthetic logout failure" }, 503);
      revoked.push(token); return json({});
    }
    throw Error(`Unexpected mocked endpoint ${url.pathname}`);
  };
  const environment = { supabaseUrl: "https://passkey-service.invalid", publishableKey: "sb_publishable_synthetic",
    relyingPartyId: "example.invalid", assertAllowed() { if (!allowed) throw Error("Feature disabled"); } };
  const native = {
    isSupported: () => true,
    async create() { nativeCalls++; controls.nativeStarted.resolve(); if (controls.nativeGate) await controls.nativeGate.promise;
      if (controls.nativeError) throw controls.nativeError;
      return { ...credential, response: { clientDataJSON: "c3ludGhldGlj", attestationObject: "c3ludGhldGlj" } };
    },
    async get() { nativeCalls++; controls.nativeStarted.resolve(); if (controls.nativeGate) await controls.nativeGate.promise;
      if (controls.nativeError) throw controls.nativeError; return credential;
    },
  };
  const factory = (url, key, options) => {
    factories++; if (controls.failFactory) throw Error("Synthetic client creation failure");
    assert.equal(options.auth.persistSession, false); assert.equal(options.auth.autoRefreshToken, false);
    assert.equal(options.auth.detectSessionInUrl, false); assert.equal(options.auth.storage, undefined);
    const client = createClient(url, key, options);
    const dispose = client.auth.dispose.bind(client.auth);
    client.auth.dispose = async () => { disposed.push(client); await dispose(); };
    clients.push(client); return client;
  };
  const service = createPreparedPasskeyService({ environment, native, fetch, createClient: factory,
    currentOwner: () => owner, isCurrent: () => current, ...adoption });
  t.after(() => { service.dispose(); for (const client of clients) client.auth.dispose(); });
  return { service, environment, native, controls, requests, revoked, clients, disposed, server, registered, initial,
    get factories() { return factories; }, get nativeCalls() { return nativeCalls; },
    disable() { allowed = false; }, invalidate() { current = false; }, clearOwner() { owner = null; },
    switchInPlace() { const next = issue(bob); Object.assign(owner, { userId: bob, accessToken: next.access_token, refreshToken: next.refresh_token }); },
    expireOwner() { const next = issue(alice, true); owner = { userId: alice, accessToken: next.access_token, refreshToken: next.refresh_token }; },
  };
}

test("service creation is idle and public sign-in rejects adoption before HTTP, native or client creation", async t => {
  const r = runtime(t); assert.equal(r.factories, 0);
  await assert.rejects(r.service.authenticate(), error => error.code === "adoption_disabled");
  assert.equal(r.factories, 0); assert.equal(r.nativeCalls, 0); assert.equal(r.requests.length, 0);
});

test("disabled and malformed endpoint guards run before client/native creation", async t => {
  const r = runtime(t); r.disable(); await assert.rejects(r.service.list(), /disabled/);
  assert.equal(r.factories, 0);
  for (const url of ["http://passkey-service.invalid", "https://user:secret@passkey-service.invalid", "https://passkey-service.invalid/path", "https://passkey-service.invalid?x=1"]) {
    const s = runtime(t); s.environment.supabaseUrl = url;
    await assert.rejects(s.service.list(), error => error.code === "blocked");
    assert.equal(s.factories, 0); assert.equal(s.requests.length, 0); assert.equal(s.nativeCalls, 0);
  }
});

test("registration requires authenticated server identity and returns only confirmed server metadata", async t => {
  const r = runtime(t), result = await r.service.register();
  assert.deepEqual(result, r.registered); assert.equal(r.nativeCalls, 1);
  assert.ok(r.requests.some(v => v.path.endsWith("/user")));
  assert.ok(r.requests.some(v => v.path.endsWith("/registration/verify")));
  assert.ok(r.requests.some(v => v.path === "/auth/v1/passkeys"));
  assert.equal(r.revoked.length, 0, "Borrowed password session must not be revoked");
  assert.equal("access_token" in result, false);
});

test("registration never reports enabled when server confirmation is absent", async t => {
  const r = runtime(t); r.controls.confirmRegistration = false;
  await assert.rejects(r.service.register(), error => error.code === "invalid_response");
  assert.equal(r.server.credentials.length, 0);
});

test("unauthenticated, wrong-user and expired owner sessions cannot register or rotate refresh tokens", async t => {
  const missing = runtime(t); missing.clearOwner();
  await assert.rejects(missing.service.register(), error => error.code === "authentication_required");
  assert.equal(missing.factories, 0);
  const wrong = runtime(t); wrong.controls.wrongIdentity = true;
  await assert.rejects(wrong.service.register(), error => error.code === "authentication_required");
  assert.equal(wrong.nativeCalls, 0);
  const expired = runtime(t); expired.expireOwner();
  await assert.rejects(expired.service.register()); assert.equal(expired.nativeCalls, 0);
  assert.equal(expired.requests.some(v => v.path.endsWith("/token")), false);
});

test("owner snapshot rejects in-place account mutation while identity checking is pending", async t => {
  const r = runtime(t); r.controls.identityGate = deferred();
  const pending = outcome(r.service.register()); await r.controls.identityStarted.promise;
  r.switchInPlace(); r.controls.identityGate.resolve();
  assert.equal((await pending).error.code, "stale"); assert.equal(r.nativeCalls, 0);
});

for (const kind of ["register", "verifyAuthenticationWithoutAdoption"]) {
  test(`${kind} binds server RP to the explicit approved development RP before native prompt`, async t => {
    const r = runtime(t); r.controls.wrongRp = true;
    await assert.rejects(r.service[kind](), error => error.code === "blocked");
    assert.equal(r.nativeCalls, 0);
  });
  test(`${kind} cancellation never reaches server verification`, async t => {
    const r = runtime(t); r.controls.nativeError = Error("Synthetic native cancellation");
    await assert.rejects(r.service[kind](), /cancellation/);
    assert.equal(r.requests.some(v => v.path.endsWith("/verify")), false);
  });
}

test("registration invalidated during the native prompt cannot submit or publish stale attestation", async t => {
  const r = runtime(t); r.controls.nativeGate = deferred();
  const pending = outcome(r.service.register()); await r.controls.nativeStarted.promise;
  r.service.invalidate(); r.controls.nativeGate.resolve();
  assert.equal((await pending).error.code, "stale");
  assert.equal(r.requests.some(v => v.path.endsWith("/registration/verify")), false);
});

test("management lists and removes only a server-owned credential and confirms its removal", async t => {
  const r = runtime(t); r.server.credentials = [r.registered];
  assert.deepEqual(await r.service.list(), [r.registered]); await r.service.remove(passkeyId);
  assert.deepEqual(r.server.credentials, []); assert.equal(r.revoked.length, 0);
  await assert.rejects(r.service.remove(passkeyId), error => error.code === "not_found");
  assert.equal(r.requests.filter(v => v.method === "DELETE").length, 1);
});

test("removal failure cannot be represented as a locally disabled credential", async t => {
  const r = runtime(t); r.server.credentials = [r.registered]; r.controls.removalWorks = false;
  await assert.rejects(r.service.remove(passkeyId), error => error.code === "invalid_response");
  assert.equal(r.server.credentials.length, 1);
});

test("removing one explicitly selected credential leaves other devices' credentials intact", async t => {
  const r = runtime(t);
  const other = { ...r.registered, id: "44444444-4444-4444-8444-444444444444", friendly_name: "Other device" };
  r.server.credentials = [r.registered, other];
  await r.service.remove(passkeyId);
  assert.deepEqual(r.server.credentials, [other]);
  assert.equal(r.requests.filter(item => item.method === "DELETE").length, 1);
  assert.equal(r.revoked.length, 0);
});

test("verification-only development flow uses a new ephemeral session and revokes it without returning tokens", async t => {
  const r = runtime(t), result = await r.service.verifyAuthenticationWithoutAdoption();
  assert.deepEqual(result, { userId: alice }); assert.equal(r.nativeCalls, 1);
  assert.equal(r.revoked.length, 1); assert.notEqual(r.revoked[0], r.initial.access_token);
  assert.equal(r.requests.find(v => v.path.endsWith("/logout")).scope, "local");
  assert.ok(r.disposed.includes(r.clients[0]));
});

test("expired abandoned candidate cleanup calls JWT logout directly without refreshing", async t => {
  const r = runtime(t); r.controls.expiredCandidate = true;
  assert.deepEqual(await r.service.verifyAuthenticationWithoutAdoption(), { userId: alice });
  assert.equal(r.requests.filter(item => item.path.endsWith("/logout")).length, 1);
  assert.equal(r.requests.some(item => item.path.endsWith("/token")), false);
  assert.equal(r.requests.find(item => item.path.endsWith("/logout")).scope, "local");
  assert.ok(r.disposed.includes(r.clients[0]));
});

for (const status of [401, 403, 404]) {
  test(`already-invalid cleanup status ${status} does not replace the authentication result`, async t => {
    const r = runtime(t); r.controls.logoutStatus = status;
    assert.deepEqual(await r.service.verifyAuthenticationWithoutAdoption(), { userId: alice });
    assert.equal(r.requests.filter(item => item.path.endsWith("/logout")).length, 1);
  });
}

for (const reason of ["invalidate", "dispose", "externalInvalidation"]) {
  test(`late verification after ${reason} is rejected and its newly issued session is revoked`, async t => {
    const r = runtime(t); r.controls.verifyGate = deferred();
    const pending = outcome(r.service.verifyAuthenticationWithoutAdoption()); await r.controls.verifyStarted.promise;
    if (reason === "externalInvalidation") r.invalidate(); else r.service[reason]();
    r.controls.verifyGate.resolve(); assert.equal((await pending).error.code, "stale");
    assert.equal(r.revoked.length, 1); assert.notEqual(r.revoked[0], r.initial.access_token);
  });
}

test("verification and cleanup errors do not return an accepted result", async t => {
  const failed = runtime(t); failed.controls.failVerify = true;
  await assert.rejects(failed.service.verifyAuthenticationWithoutAdoption(), error => error.code === "server_error");
  const cleanup = runtime(t); cleanup.controls.failLogout = true;
  await assert.rejects(cleanup.service.verifyAuthenticationWithoutAdoption(), error => error.code === "cleanup_failed");
});

test("client factory failure releases the native-operation gate for a safe retry", async t => {
  const r = runtime(t); r.controls.failFactory = true;
  await assert.rejects(r.service.verifyAuthenticationWithoutAdoption(), /client creation/);
  r.controls.failFactory = false;
  assert.deepEqual(await r.service.verifyAuthenticationWithoutAdoption(), { userId: alice });
});

test("competing ceremonies cannot trigger a second native prompt", async t => {
  const r = runtime(t); r.controls.nativeGate = deferred();
  const first = r.service.verifyAuthenticationWithoutAdoption(); await r.controls.nativeStarted.promise;
  await assert.rejects(r.service.register(), error => error.code === "blocked");
  assert.equal(r.nativeCalls, 1); r.controls.nativeGate.resolve(); await first;
});

for (const kind of ["register", "verifyAuthenticationWithoutAdoption"]) {
  test(`${kind} rejects malformed server options safely before any native prompt`, async t => {
    const r = runtime(t); r.controls.missingOptions = true;
    await assert.rejects(r.service[kind](), error => error.code === "blocked");
    assert.equal(r.nativeCalls, 0);
  });
}
