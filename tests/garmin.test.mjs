import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
async function load(path, dependencies = {}, globals = {}) {
  const compiled = ts.transpileModule(await source(path), { fileName: path, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  new Function("require", "exports", ...Object.keys(globals), compiled)(name => {
    if (name === "server-only") return {};
    if (name in dependencies) return dependencies[name];
    if (name.startsWith("node:") || name === "@supabase/supabase-js" || name === "react/jsx-runtime") return require(name);
    throw new Error(`Unexpected test import ${name}`);
  }, exports, ...Object.values(globals));
  return exports;
}
const crypto = await load("src/features/garmin/crypto.server.ts");
const providerModule = await load("src/features/garmin/provider.server.ts");
const storeModule = await load("src/features/garmin/store.server.ts", { "@/lib/auth/config": { getAuthConfig: () => null } });
const { GarminError, createGarminProvider } = providerModule;
const config = {
  appOrigin: "https://arc.example", redirectUri: "https://arc.example/api/integrations/garmin/callback",
  clientId: "test-client", clientSecret: "test-secret", encryptionKey: Buffer.alloc(32, 7),
  cookieName: "__Secure-arctrack-garmin", secure: true,
};
const { createGarminService, emptyGarminView, prepareGarminAccountDeletion } = await load("src/features/garmin/service.server.ts", {
  "./crypto.server": crypto, "./config.server": { getGarminConfig: () => null },
  "./provider.server": providerModule, "./store.server": storeModule,
});
const copy = value => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise(accept => { resolve = accept; }); return { promise, resolve }; };

// Models the store contract only; the separate native PostgreSQL suite tests actual
// permissions, constraints, DELETE RETURNING and row-lock/CAS concurrency.
function fixture() {
  let clock = Date.parse("2026-10-23T04:00:00Z");
  const now = () => clock;
  const rows = new Map(), transactions = new Map(), requests = [];
  let remoteId = "garmin-test-user", fail = null, gate = null, gateTarget = providerModule.GARMIN_TOKEN, beforeTransaction, requestObserver;
  let serial = 0, allowed = true;
  const store = {
    async read(userId) { return copy(rows.get(userId) ?? null); },
    async initialize(userId) {
      if (!rows.has(userId)) rows.set(userId, { user_id: userId, garmin_user_id: null, status: "disconnected", token_ciphertext: null,
        access_expires_at: null, refresh_expires_at: null, refresh_after: null, connected_at: null, authorized_at: null,
        checked_at: null, permissions: [], error_code: null, deletion_requested_at: null, deregistered_at: null, version: randomUUID(), operation: null, lease_until: null });
      return this.read(userId);
    },
    async claim(row, operation, seconds, exchange = false) {
      const current = rows.get(row.user_id);
      const valid = current && current.version === row.version && (operation === "delete"
        ? !current.operation || current.operation === "delete" && Date.parse(current.lease_until) < now()
        : !current.deletion_requested_at && (exchange
        ? current.operation === "authorize" && Date.parse(current.lease_until) > now()
        : !current.operation || Date.parse(current.lease_until) < now()));
      if (!valid) return null;
      const next = { ...current, version: randomUUID(), operation, lease_until: new Date(now() + seconds * 1000).toISOString(),
        ...(operation === "delete" ? { deletion_requested_at: current.deletion_requested_at ?? new Date(now()).toISOString() } : {}),
        ...(operation === "authorize" ? { deregistered_at: null } : {}) };
      rows.set(row.user_id, next);
      return copy(next);
    },
    async finish(row, patch, expired = false) {
      const current = rows.get(row.user_id);
      if (!current || current.version !== row.version || !(expired ? Date.parse(current.lease_until) < now() : Date.parse(current.lease_until) > now())) return false;
      if (patch.garmin_user_id && [...rows.values()].some(other => other.user_id !== row.user_id && other.garmin_user_id === patch.garmin_user_id)) throw new storeModule.GarminStorageError(true);
      rows.set(row.user_id, { ...current, ...copy(patch), operation: null, lease_until: null, version: randomUUID() });
      return true;
    },
    async checkpoint(row, patch) {
      const current = rows.get(row.user_id);
      if (!current || current.version !== row.version || Date.parse(current.lease_until) <= now()) throw new storeModule.GarminStorageError();
      rows.set(row.user_id, { ...current, ...copy(patch) });
      return this.read(row.user_id);
    },
    async saveTransaction(transaction) {
      if (beforeTransaction) await beforeTransaction();
      const row = rows.get(transaction.user_id);
      if (!row || row.deletion_requested_at || row.version !== transaction.connection_version || row.operation !== "authorize" || Date.parse(row.lease_until) <= now()) throw new storeModule.GarminStorageError();
      transactions.set(transaction.user_id, copy(transaction));
    },
    async consume(userId, stateHash, bindingHash) {
      const row = transactions.get(userId);
      if (!row || row.state_hash !== stateHash || row.binding_hash !== bindingHash || Date.parse(row.expires_at) <= now()) return null;
      transactions.delete(userId);
      return copy(row);
    },
    async invalidate(userId, version) { if (transactions.get(userId)?.connection_version === version) transactions.delete(userId); },
  };
  const fetcher = async (url, init) => {
    requests.push({ url: String(url), init });
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    if (requestObserver) requestObserver(String(url), init);
    if (gate && String(url).endsWith(gateTarget)) await gate.promise;
    if (fail && (!fail.suffix || String(url).endsWith(fail.suffix))) {
      if (fail.timeout) throw new DOMException("Synthetic timeout", "TimeoutError");
      return Response.json(fail.body ?? { error: fail.code }, { status: fail.status });
    }
    if (String(url) === providerModule.GARMIN_TOKEN) {
      serial++;
      return Response.json({ access_token: `test-access-${serial}`, refresh_token: `test-refresh-${serial}`, token_type: "Bearer", expires_in: 3600, refresh_token_expires_in: 86400 });
    }
    if (String(url).endsWith("/id")) return Response.json({ userId: remoteId });
    if (String(url).endsWith("/permissions")) return Response.json(["HEALTH_EXPORT", "ACTIVITY_EXPORT"]);
    if (String(url).endsWith("/registration") && init.method === "DELETE") return new Response(null, { status: 204 });
    throw new Error("Unexpected provider endpoint");
  };
  const service = createGarminService(config, store, fetcher, now, () => allowed);
  const begin = async (user = "athlete-a") => {
    const result = await service.start(user);
    return { ...result, state: new URL(result.url).searchParams.get("state"), user };
  };
  const complete = attempt => service.callback(attempt.user, attempt.state, attempt.binding, "test-code", false);
  return { service, store, rows, transactions, requests, now, begin, complete,
    allow: value => { allowed = value; },
    prepareDeletion: (user = "athlete-a", settings = config) => prepareGarminAccountDeletion(user, store, settings, fetcher, now),
    advance: amount => { clock += amount; }, setFailure: value => { fail = value; }, setRemoteId: value => { remoteId = value; },
    setGate: (value, target = providerModule.GARMIN_TOKEN) => { gate = value; gateTarget = target; },
    observeRequests: value => { requestObserver = value; }, setBeforeTransaction: value => { beforeTransaction = value; } };
}

test("Garmin PKCE uses the RFC 7636 S256 vector and unpredictable URL-safe values", () => {
  assert.equal(crypto.pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  assert.match(crypto.oauthNonce(), /^[A-Za-z0-9_-]{43}$/);
  assert.match(crypto.pkceVerifier(), /^[A-Za-z0-9_-]{64}$/);
  assert.notEqual(crypto.oauthNonce(), crypto.oauthNonce());
});

test("public Connect requires the exact enabled switch and accepts every verified Supabase UUID", async () => {
  const env = {}, id = "11111111-1111-4111-8111-111111111111";
  const loaded = await load("src/features/garmin/config.server.ts", { "@/lib/auth/config": { getAuthConfig: () => null } }, { process: { env } });
  assert.equal(loaded.mayConnectGarmin(id), false);
  env.GARMIN_CONNECT_ENABLED = "true";
  for (const list of [undefined, "", "*", `${id},bad`, `${id},`]) {
    env.GARMIN_TEST_USER_IDS = list;
    assert.equal(loaded.mayConnectGarmin(id), true);
    assert.equal(loaded.mayConnectGarmin("22222222-2222-4222-8222-222222222222"), true);
  }
  for (const invalid of ["", "athlete-a", "*", "user@example.com"]) assert.equal(loaded.mayConnectGarmin(invalid), false);
  for (const disabled of ["TRUE", "false", "1", " true ", undefined]) {
    env.GARMIN_CONNECT_ENABLED = disabled;
    assert.equal(loaded.mayConnectGarmin(id), false);
  }
});

test("removed eligibility blocks pending callback before token exchange while cleanup remains available", async () => {
  const f = fixture(), a = await f.begin(); f.allow(false);
  await assert.rejects(f.complete(a), { code: "access_unavailable" });
  await assert.rejects(f.begin(), { code: "access_unavailable" });
  assert.equal(f.requests.length, 0);
  const g = fixture(); await g.complete(await g.begin()); g.allow(false);
  assert.equal((await g.service.status("athlete-a")).canConnect, false);
  await g.service.disconnect("athlete-a");
  assert.equal(g.rows.get("athlete-a").token_ciphertext, null);
  await g.prepareDeletion();
  assert.ok(g.rows.get("athlete-a").deregistered_at);
});

test("disabled new connections do not block connected-account deletion or refresh", async () => {
  const f = fixture(); await f.complete(await f.begin()); f.allow(false); f.advance(3600001);
  await f.prepareDeletion();
  assert.ok(f.rows.get("athlete-a").deregistered_at);
  assert.equal(f.rows.get("athlete-a").token_ciphertext, null);
});

test("Garmin AES-GCM authenticates ciphertext, user and purpose with a fresh IV", () => {
  const a = crypto.seal({ refreshToken: "test-token" }, config.encryptionKey, "tokens:a");
  assert.notEqual(a, crypto.seal({ refreshToken: "test-token" }, config.encryptionKey, "tokens:a"));
  assert.doesNotMatch(a, /test-token/);
  assert.deepEqual(crypto.unseal(a, config.encryptionKey, "tokens:a"), { refreshToken: "test-token" });
  assert.throws(() => crypto.unseal(a, config.encryptionKey, "tokens:b"));
  assert.throws(() => crypto.unseal(a, Buffer.alloc(32, 8), "tokens:a"));
  const parts = a.split("."); parts[3] = "AA" + parts[3].slice(2);
  assert.throws(() => crypto.unseal(parts.join("."), config.encryptionKey, "tokens:a"));
});

test("Garmin configuration requires server-only credentials, canonical callback and 32-byte key", async () => {
  const env = { GARMIN_CLIENT_ID: "test-client", GARMIN_CLIENT_SECRET: "test-secret", GARMIN_REDIRECT_URI: config.redirectUri,
    GARMIN_TOKEN_ENCRYPTION_KEY: config.encryptionKey.toString("base64"), SUPABASE_SECRET_KEY: "test-service" };
  const loaded = await load("src/features/garmin/config.server.ts", { "@/lib/auth/config": { getAuthConfig: () => ({ appUrl: config.appOrigin }) } }, { process: { env } });
  assert.equal(loaded.getGarminConfig().redirectUri, config.redirectUri);
  assert.equal(loaded.getGarminConfig().secure, true);
  for (const key of Object.keys(env)) {
    const old = env[key]; delete env[key]; assert.equal(loaded.getGarminConfig(), null, key); env[key] = old;
  }
  for (const value of ["https://evil.example/api/integrations/garmin/callback", `${config.redirectUri}?next=evil`, "https://arc.example/wrong", `${config.redirectUri}#fragment`]) {
    env.GARMIN_REDIRECT_URI = value; assert.equal(loaded.getGarminConfig(), null);
  }
  env.GARMIN_REDIRECT_URI = config.redirectUri;
  env.GARMIN_TOKEN_ENCRYPTION_KEY = "bad-key";
  assert.equal(loaded.getGarminConfig(), null);
});

test("Garmin authorization stores encrypted verifier and hashed state/browser binding; no invented scopes", async () => {
  const f = fixture(), a = await f.begin(), url = new URL(a.url), transaction = f.transactions.get(a.user);
  assert.equal(url.origin + url.pathname, providerModule.GARMIN_AUTHORIZE);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
  assert.equal(url.searchParams.has("scope"), false);
  assert.equal(transaction.state_hash, crypto.hashState(a.state));
  assert.equal(transaction.binding_hash, crypto.hashState(a.binding));
  const verifier = crypto.unseal(transaction.verifier_ciphertext, config.encryptionKey, `verifier:${a.user}:${transaction.state_hash}`);
  assert.equal(crypto.pkceChallenge(verifier), url.searchParams.get("code_challenge"));
  assert.doesNotMatch(a.url, /test-secret|test-service/);
  assert.equal(f.requests.length, 0);
});

test("Garmin callback exchanges form-encoded PKCE server-side and exposes only safe status", async () => {
  const f = fixture(), a = await f.begin(); await f.complete(a);
  const request = f.requests[0], form = new URLSearchParams(request.init.body);
  assert.equal(request.url, providerModule.GARMIN_TOKEN);
  assert.equal(request.init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("code"), "test-code");
  assert.equal(form.get("client_secret"), config.clientSecret);
  assert.equal(form.get("redirect_uri"), config.redirectUri);
  assert.match(form.get("code_verifier"), /^[A-Za-z0-9_-]{64}$/);
  const row = f.rows.get(a.user), view = await f.service.status(a.user);
  assert.equal(view.status, "connected");
  assert.equal(view.authorizedAt, new Date(f.now()).toISOString());
  assert.deepEqual(view.permissions, ["HEALTH_EXPORT", "ACTIVITY_EXPORT"]);
  assert.doesNotMatch(JSON.stringify(view), /test-access|test-refresh|ciphertext|garmin-test-user|test-secret/);
  assert.equal(crypto.unseal(row.token_ciphertext, config.encryptionKey, `tokens:${a.user}`).refreshToken, "test-refresh-1");
  assert.equal(f.transactions.size, 0);
  await f.service.status(a.user);
  assert.equal(f.requests.length, 3, "valid tokens do not cause repeated provider calls");
});

for (const scenario of ["state", "binding", "expired", "different-user", "callback-uri"]) {
  test(`Garmin callback rejects ${scenario} without exchanging the code`, async () => {
    const f = fixture(), a = await f.begin();
    if (scenario === "expired") f.advance(600001);
    if (scenario === "callback-uri") f.transactions.get(a.user).redirect_uri = "https://evil.example/callback";
    await assert.rejects(f.service.callback(scenario === "different-user" ? "athlete-b" : a.user,
      scenario === "state" ? crypto.oauthNonce() : a.state, scenario === "binding" ? crypto.oauthNonce() : a.binding, "test-code", false), { code: "invalid_transaction" });
    assert.equal(f.requests.length, 0);
  });
}

test("Garmin concurrent callbacks consume once and replay never exchanges twice", async () => {
  const f = fixture(), a = await f.begin();
  const results = await Promise.allSettled([f.complete(a), f.complete(a)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  await assert.rejects(f.complete(a), { code: "invalid_transaction" });
  assert.equal(f.requests.filter(request => request.url === providerModule.GARMIN_TOKEN).length, 1);
});

test("Garmin duplicate authorization starts are rejected without replacing the active transaction", async () => {
  const f = fixture(), a = await f.begin(), transaction = copy(f.transactions.get(a.user));
  await assert.rejects(f.begin(), { code: "busy" });
  assert.deepEqual(f.transactions.get(a.user), transaction);
});

for (const denied of [true, false]) {
  test(`Garmin ${denied ? "denied consent" : "missing code"} never appears connected`, async () => {
    const f = fixture(), a = await f.begin();
    await assert.rejects(f.service.callback(a.user, a.state, a.binding, null, denied), { code: denied ? "cancelled" : "invalid_callback" });
    assert.equal((await f.service.status(a.user)).status, "disconnected");
    assert.equal(f.requests.length, 0);
    assert.equal(f.rows.get(a.user).operation, null);
  });
}

test("Garmin code-exchange failure releases the lease and permits a new attempt", async () => {
  const f = fixture(), a = await f.begin(); f.setFailure({ status: 400, code: "invalid_grant" });
  await assert.rejects(f.complete(a), { code: "reauthorization_required" });
  assert.equal(f.rows.get(a.user).token_ciphertext, null);
  f.setFailure(null); await f.complete(await f.begin());
  assert.equal((await f.service.status(a.user)).status, "connected");
});

test("Garmin unique account collision cannot overwrite the original Arc Track association", async () => {
  const f = fixture(); await f.complete(await f.begin());
  const original = copy(f.rows.get("athlete-a")), b = await f.begin("athlete-b");
  await assert.rejects(f.complete(b), { code: "already_connected" });
  assert.deepEqual(f.rows.get("athlete-a"), original);
  assert.equal(f.rows.get("athlete-b").token_ciphertext, null);
  assert.equal(f.requests.some(request => request.init.method === "DELETE"), false);
});

test("Garmin reconnection cannot silently replace an existing provider identity", async () => {
  const f = fixture(); await f.complete(await f.begin());
  const original = copy(f.rows.get("athlete-a"));
  f.setRemoteId("different-garmin-account");
  await assert.rejects(f.complete(await f.begin()), { code: "account_mismatch" });
  const row = f.rows.get("athlete-a");
  assert.equal(row.garmin_user_id, original.garmin_user_id);
  assert.equal(row.token_ciphertext, original.token_ciphertext);
  assert.equal(f.requests.some(request => request.init.method === "DELETE"), false);
});

test("Garmin rotated refresh tokens are committed once across concurrent status requests", async () => {
  const f = fixture(); await f.complete(await f.begin()); f.advance(3240001);
  const gate = deferred(); f.setGate(gate);
  const pending = f.service.status("athlete-a");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.service.status("athlete-a")).status, "connecting");
  gate.resolve(); f.setGate(null);
  assert.equal((await pending).status, "connected");
  const form = new URLSearchParams(f.requests[3].init.body);
  assert.equal(form.get("grant_type"), "refresh_token");
  assert.equal(form.get("refresh_token"), "test-refresh-1");
  assert.equal(f.requests.filter(request => request.url === providerModule.GARMIN_TOKEN).length, 2);
  assert.equal(crypto.unseal(f.rows.get("athlete-a").token_ciphertext, config.encryptionKey, "tokens:athlete-a").refreshToken, "test-refresh-2");
});

for (const scenario of ["revoked", "expired-refresh", "wrong-account", "provider-down"]) {
  test(`Garmin refresh ${scenario} cannot advertise expired authorization as healthy`, async () => {
    const f = fixture(); await f.complete(await f.begin()); f.advance(3600001);
    if (scenario === "revoked") f.setFailure({ status: 400, code: "invalid_grant" });
    if (scenario === "provider-down") f.setFailure({ status: 503, code: "unavailable" });
    if (scenario === "wrong-account") f.setRemoteId("other-garmin-user");
    if (scenario === "expired-refresh") f.advance(86400000);
    const view = await f.service.status("athlete-a");
    assert.equal(view.status, scenario === "provider-down" ? "error" : "reauthorization_required");
    assert.ok(f.rows.get("athlete-a").token_ciphertext, "retain encrypted credentials until deregistration is confirmed");
  });
}

for (const operation of ["refresh", "exchange", "disconnect", "authorize"]) {
  test(`Garmin interrupted ${operation} is recovered after lease expiry without session resurrection`, async () => {
    const f = fixture(); await f.complete(await f.begin());
    const row = f.rows.get("athlete-a"); row.operation = operation; row.lease_until = new Date(f.now() - 1).toISOString();
    const view = await f.service.status("athlete-a");
    assert.equal(view.status, operation === "disconnect" ? "error" : "reauthorization_required");
    assert.ok(f.rows.get("athlete-a").token_ciphertext, "interruption must not erase the last usable credential");
  });
}

test("Garmin delayed provider exchange cannot commit after its lease expired", async () => {
  const f = fixture(), a = await f.begin(), gate = deferred(); f.setGate(gate);
  const pending = f.complete(a);
  await new Promise(resolve => setImmediate(resolve));
  f.advance(91000);
  assert.equal((await f.service.status(a.user)).status, "reauthorization_required");
  gate.resolve(); await assert.rejects(pending, { code: "invalid_transaction" });
  assert.equal(f.rows.get(a.user).token_ciphertext, null);
});

for (const failed of [false, true]) {
  test(`Garmin disconnect ${failed ? "retains credentials after failure for retry" : "erases credentials after confirmed provider deregistration"}`, async () => {
    const f = fixture(); await f.complete(await f.begin());
    const other = await f.store.initialize("athlete-b");
    if (failed) f.setFailure({ status: 503, code: "unavailable" });
    if (failed) {
      const ciphertext = f.rows.get("athlete-a").token_ciphertext;
      await assert.rejects(f.service.disconnect("athlete-a"), { code: "deregistration_failed" });
      assert.equal(f.rows.get("athlete-a").token_ciphertext, ciphertext);
      assert.equal((await f.service.status("athlete-a")).status, "error");
      f.setFailure(null);
    }
    assert.equal((await f.service.disconnect("athlete-a")).warning, false);
    assert.equal(f.requests.at(-1).url, "https://apis.garmin.com/wellness-api/rest/user/registration");
    assert.equal(f.requests.at(-1).init.method, "DELETE");
    assert.equal(f.rows.get("athlete-a").token_ciphertext, null);
    assert.equal(f.rows.get("athlete-a").garmin_user_id, null);
    assert.equal((await f.service.status("athlete-a")).status, "disconnected");
    assert.equal((await f.service.disconnect("athlete-a")).warning, false);
    assert.deepEqual(f.rows.get("athlete-b"), other);
  });
}

test("Garmin disconnect and deletion wait for a previously started authorization to drain", async () => {
  const f = fixture(), a = await f.begin();
  await assert.rejects(f.service.disconnect(a.user), { code: "busy" });
  await assert.rejects(f.prepareDeletion(), { code: "busy" });
  assert.equal(f.requests.length, 0);
  await f.complete(a);
  await f.service.disconnect(a.user);
  assert.equal((await f.service.status(a.user)).status, "disconnected");
});

test("Garmin delayed transaction publication cannot overwrite a newer authorization", async () => {
  const f = fixture(), gate = deferred(), entered = deferred();
  f.setBeforeTransaction(async () => { entered.resolve(); await gate.promise; });
  const old = f.begin(); await entered.promise; f.setBeforeTransaction(null);
  f.advance(600001);
  const current = await f.begin(), transaction = copy(f.transactions.get(current.user));
  gate.resolve(); await assert.rejects(old, { code: "connection_error" });
  assert.deepEqual(f.transactions.get(current.user), transaction);
  await f.store.invalidate(current.user, randomUUID());
  assert.deepEqual(f.transactions.get(current.user), transaction, "stale cleanup cannot delete a newer transaction");
  await f.complete(current);
  assert.equal((await f.service.status(current.user)).status, "connected");
});

test("account deletion without Garmin credentials succeeds without provider configuration or calls", async () => {
  const f = fixture(); await f.prepareDeletion("athlete-a", null);
  const row = f.rows.get("athlete-a");
  assert.ok(row.deletion_requested_at);
  assert.ok(row.deregistered_at);
  assert.equal(row.operation, null);
  assert.equal(f.requests.length, 0);
  await assert.rejects(f.begin(), { code: "busy" });
});

test("account deletion confirms deregistration and removes credentials before granting deletion readiness", async () => {
  const f = fixture(); await f.complete(await f.begin());
  const other = await f.store.initialize("athlete-b");
  await f.prepareDeletion();
  assert.equal(f.requests.at(-1).init.method, "DELETE");
  assert.ok(f.rows.get("athlete-a").deregistered_at);
  assert.equal(f.rows.get("athlete-a").token_ciphertext, null);
  assert.equal(f.rows.get("athlete-a").garmin_user_id, null);
  assert.deepEqual(f.rows.get("athlete-b"), other);
  assert.equal((await f.service.status("athlete-a")).error, "account_deletion_pending");
  await assert.rejects(f.begin(), { code: "busy" });
  await assert.rejects(f.service.disconnect("athlete-a"), { code: "account_deletion_pending" });
  const count = f.requests.length;
  await f.prepareDeletion();
  assert.equal(f.requests.length, count, "retry after failed Auth deletion reuses durable deregistration proof");
});

test("account deletion checkpoints rotated credentials before identity/revocation and retries with the latest token", async () => {
  const f = fixture(); await f.complete(await f.begin()); f.advance(3600001);
  f.observeRequests(url => {
    if (url.endsWith("/id")) assert.equal(crypto.unseal(f.rows.get("athlete-a").token_ciphertext, config.encryptionKey, "tokens:athlete-a").refreshToken, "test-refresh-2");
  });
  f.setFailure({ suffix: "/registration", status: 503, code: "unavailable" });
  await assert.rejects(f.prepareDeletion(), { code: "deregistration_failed" });
  const row = f.rows.get("athlete-a");
  assert.equal(crypto.unseal(row.token_ciphertext, config.encryptionKey, "tokens:athlete-a").refreshToken, "test-refresh-2");
  assert.equal(row.deregistered_at, null);
  assert.ok(row.deletion_requested_at);
  f.setFailure(null); await f.prepareDeletion();
  assert.equal(f.requests.filter(request => request.url === providerModule.GARMIN_TOKEN).length, 2, "rotation is not repeated during retry");
  assert.ok(f.rows.get("athlete-a").deregistered_at);
});

for (const failure of [{ timeout: true }, { status: 500, code: "server_error" }, { status: 401, code: "invalid_token" }, { status: 404, code: "not_found" }]) {
  test(`account deletion does not misclassify Garmin ${failure.timeout ? "timeout" : failure.status} as confirmed deregistration`, async () => {
    const f = fixture(); await f.complete(await f.begin());
    const ciphertext = f.rows.get("athlete-a").token_ciphertext;
    f.setFailure({ suffix: "/registration", ...failure });
    await assert.rejects(f.prepareDeletion(), { code: failure.status === 401 ? "deregistration_recovery_required" : "deregistration_failed" });
    assert.equal(f.rows.get("athlete-a").token_ciphertext, ciphertext);
    assert.equal(f.rows.get("athlete-a").deregistered_at, null);
    assert.ok(f.rows.get("athlete-a").deletion_requested_at);
    f.advance(900001);
    await assert.rejects(f.begin(), { code: "busy" }, "fence survives lease expiry");
  });
}

test("already-revoked authorization is not inferred from generic 401 or invalid_grant", async () => {
  const f = fixture(); await f.complete(await f.begin()); f.advance(3600001);
  f.setFailure({ status: 400, code: "invalid_grant" });
  await assert.rejects(f.prepareDeletion(), { code: "deregistration_recovery_required" });
  assert.ok(f.rows.get("athlete-a").token_ciphertext);
  assert.equal(f.rows.get("athlete-a").deregistered_at, null);
});

test("ordinary refresh timeout records uncertainty and does not automatically reuse a possibly consumed refresh token", async () => {
  const f = fixture(); await f.complete(await f.begin()); f.advance(3600001);
  f.setFailure({ suffix: providerModule.GARMIN_TOKEN, timeout: true });
  assert.equal((await f.service.status("athlete-a")).error, "rotation_uncertain");
  const count = f.requests.length;
  await f.service.status("athlete-a");
  assert.equal(f.requests.length, count);
  await assert.rejects(f.prepareDeletion(), { code: "deregistration_recovery_required" });
  assert.ok(f.rows.get("athlete-a").token_ciphertext);
});

test("account deletion never treats query or configuration failures as no Garmin connection", async () => {
  const f = fixture(); await f.complete(await f.begin());
  const ciphertext = f.rows.get("athlete-a").token_ciphertext;
  await assert.rejects(f.prepareDeletion("athlete-a", null), { code: "provider_configuration" });
  assert.equal(f.rows.get("athlete-a").token_ciphertext, ciphertext);
  assert.equal(f.rows.get("athlete-a").deregistered_at, null);
  const original = f.store.initialize;
  f.store.initialize = async () => { throw new storeModule.GarminStorageError(); };
  await assert.rejects(f.prepareDeletion(), storeModule.GarminStorageError);
  f.store.initialize = original;
  await f.prepareDeletion();
  assert.ok(f.rows.get("athlete-a").deregistered_at);
});

test("duplicate deletion requests share one revocation worker", async () => {
  const f = fixture(); await f.complete(await f.begin());
  const gate = deferred(); f.setGate(gate, "/registration");
  const pending = f.prepareDeletion(); await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.prepareDeletion(), { code: "busy" });
  await assert.rejects(f.begin(), { code: "busy" });
  gate.resolve(); await pending;
  assert.equal(f.requests.filter(request => request.init.method === "DELETE").length, 1);
});

for (const first of ["disconnect", "delete"]) {
  test(`concurrent Disconnect/Delete waits for the ${first} owner and preserves credentials`, async () => {
    const f = fixture(); await f.complete(await f.begin());
    const gate = deferred(); f.setGate(gate, "/registration");
    const pending = first === "disconnect" ? f.service.disconnect("athlete-a") : f.prepareDeletion();
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(first === "disconnect" ? f.prepareDeletion() : f.service.disconnect("athlete-a"),
      { code: first === "disconnect" ? "busy" : "account_deletion_pending" });
    assert.ok(f.rows.get("athlete-a").token_ciphertext);
    gate.resolve(); await pending;
    if (first === "disconnect") await f.prepareDeletion();
    assert.ok(f.rows.get("athlete-a").deregistered_at);
  });
}

test("deletion cannot overtake a provider exchange already in flight", async () => {
  const f = fixture(), a = await f.begin(), gate = deferred(); f.setGate(gate);
  const pending = f.complete(a); await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.prepareDeletion(), { code: "busy" });
  assert.equal(f.rows.get(a.user).deletion_requested_at, null, "do not invalidate credentials still being returned");
  gate.resolve(); f.setGate(null); await pending;
  await f.prepareDeletion();
  assert.equal(f.rows.get(a.user).token_ciphertext, null);
  await assert.rejects(f.complete(a), { code: "invalid_transaction" });
});

test("deletion cannot overtake an in-flight refresh and uses its rotated credentials after draining", async () => {
  const f = fixture(); await f.complete(await f.begin()); f.advance(3240001);
  const gate = deferred(); f.setGate(gate);
  const pending = f.service.status("athlete-a"); await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.prepareDeletion(), { code: "busy" });
  gate.resolve(); f.setGate(null); await pending;
  await f.prepareDeletion();
  assert.equal(f.requests.at(-1).init.headers.Authorization, "Bearer test-access-2");
});

test("interrupted deletion retries retain the durable fence and recover with saved credentials", async () => {
  const f = fixture(); await f.complete(await f.begin());
  await f.store.claim(await f.store.read("athlete-a"), "delete", 90);
  f.advance(91000);
  assert.equal((await f.service.status("athlete-a")).error, "account_deletion_pending");
  assert.ok(f.rows.get("athlete-a").token_ciphertext);
  await assert.rejects(f.begin(), { code: "busy" });
  await f.prepareDeletion();
  assert.ok(f.rows.get("athlete-a").deregistered_at);
});

test("expired non-deletion operations require recovery instead of an endless busy retry", async () => {
  for (const operation of ["authorize", "exchange", "refresh", "disconnect"]) {
    const f = fixture(); await f.complete(await f.begin());
    const row = f.rows.get("athlete-a"), original = row.token_ciphertext;
    row.operation = operation; row.lease_until = new Date(f.now() - 1).toISOString();
    await assert.rejects(f.prepareDeletion(), { code: "deregistration_recovery_required" });
    assert.equal(row.token_ciphertext, original);
    assert.equal(row.deletion_requested_at, null);
  }
});

test("ambiguous process interruption during rotation/exchange is blocked rather than erasing evidence", async () => {
  for (const code of ["rotation_pending", "rotation_uncertain", "interrupted_authorization", "exchange_uncertain", "revocation_unconfirmed"]) {
    const f = fixture(); await f.complete(await f.begin());
    f.rows.get("athlete-a").error_code = code;
    const ciphertext = f.rows.get("athlete-a").token_ciphertext;
    await assert.rejects(f.prepareDeletion(), { code: "deregistration_recovery_required" });
    assert.equal(f.rows.get("athlete-a").token_ciphertext, ciphertext);
    assert.equal(f.requests.length, 3);
  }
});

test("remote success with failed receipt persistence never grants readiness; retry can persist confirmed cleanup", async () => {
  const f = fixture(); await f.complete(await f.begin());
  const finish = f.store.finish.bind(f.store);
  f.store.finish = async (row, patch, expired) => { if (patch.deregistered_at) throw new storeModule.GarminStorageError(); return finish(row, patch, expired); };
  await assert.rejects(f.prepareDeletion(), { code: "deregistration_failed" });
  assert.ok(f.rows.get("athlete-a").token_ciphertext);
  assert.equal(f.rows.get("athlete-a").deregistered_at, null);
  f.store.finish = finish;
  await f.prepareDeletion();
  assert.ok(f.rows.get("athlete-a").deregistered_at);
});

for (const scenario of ["malformed", "large", "wrong-token-type", "missing-rotation", "invalid-client", "network", "permissions-shape"]) {
  test(`Garmin provider safely handles ${scenario} without leaking provider payloads`, async () => {
    const fetcher = async () => {
      if (scenario === "network") throw new Error("private provider internals");
      if (scenario === "malformed") return new Response("private provider internals");
      if (scenario === "large") return new Response("x".repeat(65537));
      if (scenario === "invalid-client") return Response.json({ error: "invalid_client", secret: "private provider internals" }, { status: 401 });
      if (scenario === "permissions-shape") return Response.json({ unexpected: "private provider internals" });
      return Response.json({ access_token: "a", refresh_token: scenario === "missing-rotation" ? undefined : "r", token_type: scenario === "wrong-token-type" ? "not-bearer" : "Bearer", expires_in: 3600 });
    };
    const provider = createGarminProvider(config, fetcher);
    await assert.rejects(scenario === "permissions-shape" ? provider.permissions("test") : provider.exchange("code", "verifier"), error => {
      assert.ok(error instanceof GarminError);
      assert.doesNotMatch(error.message, /private provider internals/);
      return true;
    });
  });
}

test("Garmin accepted-but-pending deregistration is not treated as completed", async () => {
  const provider = createGarminProvider(config, async () => new Response(null, { status: 202 }));
  await assert.rejects(provider.revoke("test-token"), { code: "provider_response" });
});

async function httpFixture(eligible = () => true) {
  const state = { userId: "athlete-a", configured: true, allowed: true, cookie: crypto.oauthNonce(), written: [], calls: [] };
  const service = {
    async start(userId) { state.calls.push(["start", userId]); return { url: "https://connect.garmin.com/oauth2Confirm?state=test", binding: crypto.oauthNonce() }; },
    async callback(...args) { state.calls.push(["callback", ...args]); },
    async status(userId) { state.calls.push(["status", userId]); return emptyGarminView(true); },
    async disconnect(userId) { state.calls.push(["disconnect", userId]); return { warning: false }; },
  };
  const handlers = await load("src/features/garmin/http.server.ts", {
    "next/headers": { cookies: async () => ({ get: () => state.cookie ? { value: state.cookie } : undefined,
      set: (...args) => state.written.push(args) }) },
    "@/lib/supabase/server": { createAuthClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null }, error: null }) } }) },
    "./config.server": { getGarminConfig: () => state.configured ? config : null, mayConnectGarmin: (id) => state.allowed && eligible(id) },
    "./service.server": { configuredGarminService: () => state.configured ? service : null }, "./provider.server": providerModule,
  });
  const post = (path, origin = config.appOrigin, headers = {}) => new Request(`${config.appOrigin}/api/integrations/garmin/${path}`, {
    method: "POST", headers: { Origin: origin, ...headers }, body: "user_id=attacker-selected-id",
  });
  const callback = extra => new Request(`${config.redirectUri}?state=${crypto.oauthNonce()}&code=test-code${extra ?? ""}`);
  return { state, service, handlers, post, callback };
}

test("public OAuth Start and Callback accept different authenticated owners without a test-user list", async () => {
  const env = { GARMIN_CONNECT_ENABLED: "true" };
  const eligibility = await load("src/features/garmin/config.server.ts", { "@/lib/auth/config": { getAuthConfig: () => null } }, { process: { env } });
  for (const id of ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"]) {
    const f = await httpFixture(eligibility.mayConnectGarmin);
    f.state.userId = id;
    assert.equal((await f.handlers.garminStart(f.post("start"))).status, 303);
    assert.deepEqual(f.state.calls.at(-1), ["start", id]);
    assert.equal((await f.handlers.garminCallback(f.callback())).headers.get("Location"), `${config.appOrigin}/health?garmin=connected`);
    assert.equal(f.state.calls.at(-1)[1], id);
    f.state.userId = null;
    const calls = f.state.calls.length;
    assert.equal((await f.handlers.garminStart(f.post("start"))).status, 401);
    assert.match((await f.handlers.garminCallback(f.callback())).headers.get("Location"), /garmin=sign_in_required$/);
    assert.equal(f.state.calls.length, calls);
  }
});

test("direct start and pending callback API attempts fail closed when eligibility is removed; disconnect is ungated", async () => {
  const f = await httpFixture(); f.state.allowed = false;
  assert.equal((await f.handlers.garminStart(f.post("start"))).status, 403);
  assert.equal((await f.handlers.garminCallback(f.callback())).status, 403);
  assert.equal(f.state.calls.length, 0);
  assert.equal(f.state.written.at(-1)[2].maxAge, 0);
  assert.equal((await f.handlers.garminDisconnect(f.post("disconnect"))).status, 303);
  assert.equal(f.state.calls.at(-1)[0], "disconnect");
});

test("Garmin HTTP routes require authenticated identity, POST origin and no-store responses", async () => {
  const f = await httpFixture();
  for (const handler of [f.handlers.garminStart, f.handlers.garminDisconnect]) {
    assert.equal((await handler(f.post("start", "https://evil.example"))).status, 403);
    assert.equal((await handler(f.post("start", config.appOrigin, { "Sec-Fetch-Site": "cross-site" }))).status, 403);
    for (const site of ["cross-site", "same-site", "none", ""]) {
      assert.equal((await handler(f.post("start", "null", { "Sec-Fetch-Site": site }))).status, 403);
    }
    f.state.userId = null;
    assert.equal((await handler(f.post("start"))).status, 401);
    f.state.userId = "athlete-a";
    const response = await handler(f.post("start"));
    assert.equal(response.status, 303);
    assert.match(response.headers.get("Cache-Control"), /private, no-store/);
    assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
    assert.equal(f.state.calls.at(-1)[1], "athlete-a", "caller-supplied IDs never select the actor");
  }
  assert.equal(f.state.written[0][2].httpOnly, true);
  assert.equal(f.state.written[0][2].secure, true);
  assert.equal(f.state.written[0][2].sameSite, "lax");
  assert.equal(f.state.written[0][2].path, "/api/integrations/garmin");
  assert.equal(f.state.written[0][2].maxAge, 600);
  assert.equal((await f.handlers.garminStart(f.post("start", "null", { "Sec-Fetch-Site": "same-origin" }))).status, 303,
    "native form POST from the existing no-referrer Profile page remains usable");
  assert.equal((await f.handlers.garminDisconnect(f.post("disconnect", "null", { "Sec-Fetch-Site": "same-origin" }))).status, 303);
  assert.equal((await f.handlers.garminStart(new Request(`${config.appOrigin}/api/integrations/garmin/start`, {
    method: "POST", headers: { "Sec-Fetch-Site": "same-origin" },
  }))).status, 403, "missing Origin does not get the null-Origin exception");
  f.state.userId = null; assert.equal((await f.handlers.garminStatus()).status, 401);
});

test("Garmin HTTP callback rejects missing/duplicate parameters and missing session before service invocation", async () => {
  const f = await httpFixture();
  for (const request of [new Request(config.redirectUri), f.callback("&state=duplicate"), f.callback("&error=access_denied"), f.callback("&code=duplicate")]) {
    const response = await f.handlers.garminCallback(request);
    assert.equal(response.status, 303);
    assert.match(response.headers.get("Location"), /^https:\/\/arc\.example\/health\?garmin=invalid_/);
  }
  f.state.cookie = null;
  await f.handlers.garminCallback(f.callback());
  f.state.cookie = crypto.oauthNonce(); f.state.userId = null;
  const response = await f.handlers.garminCallback(f.callback());
  assert.match(response.headers.get("Location"), /garmin=sign_in_required$/);
  assert.equal(f.state.calls.length, 0);
});

test("Garmin callback clears browser binding after verified success and cannot redirect to supplied return URL", async () => {
  const f = await httpFixture();
  const response = await f.handlers.garminCallback(f.callback("&returnTo=https://evil.example"));
  assert.equal(response.headers.get("Location"), `${config.appOrigin}/health?garmin=connected`);
  assert.equal(f.state.calls[0][1], "athlete-a");
  assert.equal(f.state.written.at(-1)[2].maxAge, 0);
  f.service.callback = async () => { throw new Error("private provider internals"); };
  const failed = await f.handlers.garminCallback(f.callback());
  assert.equal(failed.headers.get("Location"), `${config.appOrigin}/health?garmin=connection_error`);
  assert.doesNotMatch(await failed.text(), /private provider internals/);
});

test("Garmin HTTP status returns only service DTO and unavailable configuration fails closed", async () => {
  const f = await httpFixture(), response = await f.handlers.garminStatus();
  assert.deepEqual(await response.json(), emptyGarminView(true));
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  f.state.configured = false;
  assert.equal((await f.handlers.garminStart(f.post("start"))).status, 503);
  assert.equal((await f.handlers.garminStatus()).status, 503);
});

test("Garmin real Supabase query builder preserves user/version/expiry fencing in every write", async () => {
  const requests = [];
  const { createClient } = require("@supabase/supabase-js");
  const db = createClient("https://supabase.example", "test-service", { auth: { persistSession: false, autoRefreshToken: false }, global: {
    fetch: async (url, init) => { requests.push({ url: new URL(url), init }); return Response.json([]); },
  } });
  const store = storeModule.garminStore(db, () => Date.parse("2026-10-23T04:00:00Z"));
  const row = { user_id: "athlete-a", version: "version-a" };
  await store.claim(row, "refresh", 90);
  assert.equal(requests.at(-1).url.searchParams.get("user_id"), "eq.athlete-a");
  assert.equal(requests.at(-1).url.searchParams.get("version"), "eq.version-a");
  assert.match(requests.at(-1).url.searchParams.get("or"), /operation\.is\.null,lease_until\.lt\./);
  await store.claim(row, "exchange", 90, true);
  assert.equal(requests.at(-1).url.searchParams.get("operation"), "eq.authorize");
  assert.match(requests.at(-1).url.searchParams.get("lease_until"), /^gt\./);
  await store.finish(row, { status: "disconnected" });
  assert.equal(requests.at(-1).url.searchParams.get("version"), "eq.version-a");
  await store.consume("athlete-a", "state-hash", "binding-hash");
  assert.equal(requests.at(-1).init.method, "DELETE");
  assert.equal(requests.at(-1).url.searchParams.get("state_hash"), "eq.state-hash");
  assert.equal(requests.at(-1).url.searchParams.get("binding_hash"), "eq.binding-hash");
  assert.match(requests.at(-1).url.searchParams.get("expires_at"), /^gt\./);
  await store.invalidate("athlete-a", "version-a");
  assert.equal(requests.at(-1).url.searchParams.get("connection_version"), "eq.version-a");
});

async function cardHarness(view = { ...emptyGarminView(true), canConnect: true }, notice, fetcher = async () => Response.json(view), placement = "health") {
  const states = [], effects = []; let index = 0;
  const loaded = await load("src/features/garmin/components/garmin-connection-card.tsx", {
    react: { useState: initial => { const slot = index++; if (!(slot in states)) states[slot] = initial;
      return [states[slot], value => { states[slot] = typeof value === "function" ? value(states[slot]) : value; }]; },
      useEffect: effect => { effects.push(effect); } },
    "./garmin-connection.module.css": { __esModule: true, default: {} },
    "next/image": { __esModule: true, default: (props) => React.createElement("img", props) },
  }, { fetch: fetcher });
  const render = () => { index = 0; effects.length = 0; return loaded.GarminConnectionCard({ initialStatus: view, notice, placement }); };
  return { render, states, effects };
}
function nodes(tree, type) {
  const found = [];
  const visit = node => { if (!React.isValidElement(node)) return; if (node.type === type) found.push(node); React.Children.forEach(node.props.children, visit); };
  visit(tree); return found;
}

test("Garmin Health control uses official branding, consent text and real POST controls without secrets", async () => {
  const h = await cardHarness(), tree = h.render(), html = renderToStaticMarkup(tree);
  assert.match(html, /Connect Garmin/); assert.match(html, /garmin-connect.png/);
  assert.match(html, /Linking does not confirm health synchronization or share health data with coaches/);
  assert.match(html, /action="\/api\/integrations\/garmin\/start"/);
  assert.match(html, /method="post"/);
  assert.doesNotMatch(html, /test-secret|test-access|test-refresh/);
  const form = nodes(tree, "form")[0];
  form.props.onSubmit({ preventDefault: () => assert.fail("first submission is allowed") });
  let prevented = false; nodes(h.render(), "form")[0].props.onSubmit({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.match(renderToStaticMarkup(h.render()), /Updating/);
});

test("Garmin success query parameter cannot claim connection without backend confirmation", async () => {
  const disconnected = await cardHarness(emptyGarminView(true), "connected");
  assert.doesNotMatch(renderToStaticMarkup(disconnected.render()), /Garmin Connected/);
  const connected = await cardHarness({ ...emptyGarminView(true), status: "connected" }, "connected");
  const html = renderToStaticMarkup(connected.render());
  assert.match(html, /Garmin Connected/);
  assert.match(html, /Disconnect Garmin/);
  assert.doesNotMatch(html, />Connect Garmin</);
});

test("Garmin card loading always resolves on failed refresh and renders an accessible error", async () => {
  const h = await cardHarness(emptyGarminView(true), undefined, async () => { throw new Error("offline"); });
  const tree = h.render();
  nodes(tree, "button").find(node => node.props.children === "Refresh status").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  const html = renderToStaticMarkup(h.render());
  assert.match(html, /role="alert"/); assert.match(html, /could not be refreshed/);
  assert.doesNotMatch(html, /Updating/);
  assert.equal(h.states[1], false);
});

test("Garmin card expires a stale connected badge with timer cleanup", async () => {
  const h = await cardHarness({ ...emptyGarminView(true), status: "connected", expiresAt: new Date(Date.now() - 1).toISOString() });
  h.render(); const cleanup = h.effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  // Timers may run after check phase; use a deterministic timer turn, not a narrow deadline assertion.
  await new Promise(resolve => setTimeout(resolve, 0));
  cleanup();
  assert.equal(h.states[0].status, "error");
  assert.match(renderToStaticMarkup(h.render()), /Refresh your Garmin connection status/);
});

test("Profile keeps advanced Garmin controls in a closed Connected Apps disclosure", async () => {
  const h = await cardHarness({ ...emptyGarminView(true), status: "connected", permissions: ["HEALTH_EXPORT", "ACTIVITY_EXPORT"] }, undefined, undefined, "profile");
  const tree = h.render(), html = renderToStaticMarkup(tree);
  assert.match(html, /Manage connection/);
  assert.match(html, /HEALTH_EXPORT, ACTIVITY_EXPORT/);
  assert.match(html, /Disconnect Garmin/);
  assert.match(html, /href="\/privacy"/);
  assert.equal(nodes(tree, "details")[0].props.open, undefined);
  assert.doesNotMatch(html, /Last authorized|Last checked|Connection status/);
  const disconnected = await cardHarness(undefined, undefined, undefined, "profile");
  const profileHtml = renderToStaticMarkup(disconnected.render());
  assert.match(profileHtml, /href="\/health"/);
  assert.doesNotMatch(profileHtml, /action="\/api\/integrations\/garmin\/start"/);
});

test("cancelled consent offers one message and Try Again; revocation offers Reconnect Garmin", async () => {
  const retry = await cardHarness({ ...emptyGarminView(true), canConnect: true }, "cancelled");
  const html = renderToStaticMarkup(retry.render());
  assert.match(html, /Try Again/);
  assert.match(html, /authorization was cancelled/);
  assert.equal((html.match(/role="alert"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Garmin Connected/);
  const revoked = await cardHarness({ ...emptyGarminView(true), canConnect: true, status: "reauthorization_required", error: "reauthorization_required" }, "reauthorization_required");
  const revokedHtml = renderToStaticMarkup(revoked.render());
  assert.match(revokedHtml, /Reconnect Garmin/);
  assert.equal((revokedHtml.match(/role="alert"/g) ?? []).length, 1);
  assert.doesNotMatch(revokedHtml, /Garmin Connected/);
});

test("failed refresh cannot retain the Connected badge and a later confirmed refresh restores it", async () => {
  const view = { ...emptyGarminView(true), canConnect: true, status: "connected" };
  let fail = true;
  const h = await cardHarness(view, undefined, async () => { if (fail) throw new Error("private failure"); return Response.json(view); });
  await nodes(h.render(), "button").find(node => node.props.children === "Refresh status").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  let html = renderToStaticMarkup(h.render());
  assert.doesNotMatch(html, /Garmin Connected|private failure/);
  assert.match(html, /Reconnect Garmin/);
  fail = false;
  await nodes(h.render(), "button").find(node => node.props.children === "Refresh status").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  html = renderToStaticMarkup(h.render());
  assert.match(html, /Garmin Connected/);
  assert.doesNotMatch(html, /role="alert"|>Connect Garmin</);
});

test("failed or cancelled callbacks return only safe notices to Health after transaction validation", async () => {
  for (const code of ["cancelled", "reauthorization_required", "account_mismatch", "invalid_transaction"]) {
    const f = await httpFixture();
    f.service.callback = async () => { throw new GarminError(code); };
    const response = await f.handlers.garminCallback(f.callback());
    assert.equal(response.headers.get("Location"), `${config.appOrigin}/health?garmin=${code}`);
    assert.equal(response.status, 303);
    if (code !== "invalid_transaction") assert.equal(f.state.written.at(-1)[2].maxAge, 0);
  }
});

test("Garmin route methods and server-only boundaries stay narrow; Expo and scoring are not imported", async () => {
  for (const [route, method] of [["start", "POST"], ["callback", "GET"], ["status", "GET"], ["disconnect", "POST"]]) {
    const text = await source(`src/app/api/integrations/garmin/${route}/route.ts`);
    assert.match(text, new RegExp(`export const ${method} =`)); assert.match(text, /runtime = "nodejs"/);
  }
  const card = await source("src/features/garmin/components/garmin-connection-card.tsx");
  assert.doesNotMatch(card, /SUPABASE_SECRET|GARMIN_CLIENT_SECRET|crypto\.server|store\.server|service\.server/);
  for (const path of ["config", "crypto", "provider", "store", "service", "http"]) {
    const text = await source(`src/features/garmin/${path}.server.ts`);
    assert.match(text, /^import "server-only";/);
    assert.doesNotMatch(text, /console\.(log|error)|apps\/mobile|features\/scoring|features\/health/);
  }
});

for (const code of ["deregistration_failed", "deregistration_recovery_required", "revocation_pending", "revocation_unconfirmed"]) {
  test("status preserves remote cleanup evidence: " + code, async () => {
    const f = fixture(); await f.complete(await f.begin()); f.advance(3600000);
    const row = f.rows.get("athlete-a"); row.status = "error"; row.error_code = code;
    const before = f.requests.length;
    const result = await f.service.status("athlete-a");
    assert.equal(result.error, code); assert.notEqual(result.status, "connected");
    assert.equal(f.requests.length, before); assert.equal(f.rows.get("athlete-a").error_code, code);
  });
}
test("expired disconnect lease never refreshes away recovery evidence on status", async () => {
  const f = fixture(); await f.complete(await f.begin());
  const row = f.rows.get("athlete-a"); row.operation = "disconnect"; row.lease_until = new Date(f.now()-1).toISOString();
  f.advance(3600000); const before=f.requests.length;
  assert.equal((await f.service.status("athlete-a")).error,"deregistration_failed");
  assert.equal(f.requests.length,before);
});
