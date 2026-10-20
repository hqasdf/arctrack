import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const fixtureModule = { exports: {} };
  new Function("require", "module", "exports", ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(name => dependencies[name] ?? require(name), fixtureModule, fixtureModule.exports);
  return fixtureModule.exports;
}
const pure = load("../src/session-authority.ts");
const { createMobileSessionClient } = load("../src/session-client.ts", { "./session-authority": pure });
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const outcome = promise => promise.then(value => ({ value }), error => ({ error }));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { "Content-Type": "application/json", "X-Supabase-Api-Version": "2024-01-01" } });
const user = id => ({ id, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {},
  email: `${id}@synthetic.invalid`, created_at: "2026-10-20T00:00:00Z" });
function session(id = "athlete-a", serial = "one") {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: id, session_id: `${id}-${serial}`, exp })}.${encode("synthetic-signature")}`,
    refresh_token: `synthetic-refresh-${id}-${serial}`, token_type: "bearer", expires_at: exp, expires_in: 3600, user: user(id) };
}
function memory() {
  const values = new Map();
  return { values, async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); }, async removeItem(key) { values.delete(key); } };
}
let serial = 0;
function runtime(t) {
  const records = memory(), legacy = memory(), calls = [], sessions = new Map(), refreshes = new Map(), clients = [];
  const controls = { password: null, refresh: null, otp: null, signup: null, user: null };
  const url = `https://session-client-${++serial}.invalid`;
  const register = value => { sessions.set(value.access_token, value); refreshes.set(value.refresh_token, value); return value; };
  register(session()); register(session("athlete-b"));
  const transport = async (input, init) => {
    const endpoint = new URL(String(input));
    assert.equal(endpoint.origin, url, "synthetic transport must never contact a real project");
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    const bearer = new Headers(init?.headers).get("Authorization")?.replace(/^Bearer /i, "");
    calls.push({ path: endpoint.pathname, grant: endpoint.searchParams.get("grant_type"), body, bearer, method: init?.method });
    if (endpoint.pathname.endsWith("/logout")) return json({});
    if (endpoint.pathname.endsWith("/recover") || endpoint.pathname.endsWith("/resend")) return json({});
    if (endpoint.pathname.endsWith("/token")) {
      if (endpoint.searchParams.get("grant_type") === "password") {
        if (controls.password) return controls.password(body);
        const id = body.email.split("@")[0]; return json(register(session(id)));
      }
      if (controls.refresh) return controls.refresh(body);
      return json(refreshes.get(body.refresh_token));
    }
    if (endpoint.pathname.endsWith("/signup")) return controls.signup ? controls.signup(body) : json({ user: user(body.email.split("@")[0]), session: null });
    if (endpoint.pathname.endsWith("/verify")) return controls.otp ? controls.otp(body) : json(register(session(body.email.split("@")[0], "otp")));
    if (endpoint.pathname.endsWith("/user")) {
      if (controls.user) return controls.user({ body, bearer, method: init?.method });
      const known = sessions.get(bearer);
      return known ? json(known.user) : json({ message: "Synthetic unknown identity" }, 401);
    }
    assert.fail(`Unexpected synthetic endpoint ${endpoint.pathname}`);
  };
  const create = () => {
    const client = createMobileSessionClient(url, "sb_publishable_synthetic_test_only", {
      records, legacy, legacyRecovery: async () => false, reportCleanupFailure: () => {}, fetch: transport, autoRefreshToken: false,
    }); clients.push(client); return client;
  };
  t.after(() => { for (const value of clients) value.client.auth.dispose(); });
  return { create, records, legacy, calls, controls, register, url };
}
const login = (client, id = "athlete-a") => client.authentication.signInWithPassword({ email: `${id}@synthetic.invalid`, password: "synthetic-password-only" });

test("real SDK password sign-in accepts server-verified session and restores it after restart", async t => {
  const r = runtime(t), current = r.create();
  const result = await login(current); assert.equal(result.error, null);
  assert.equal(current.authority.allowsSession(result.data.session), true);
  current.client.auth.dispose();
  const restarted = r.create(); const restored = await restarted.client.auth.getSession();
  assert.equal(restored.data.session.user.id, "athlete-a");
  assert.equal(restarted.authority.allowsSession(restored.data.session), true);
});

test("signed-out recovery email and signup resend remain usable without accepting a session", async t => {
  const r = runtime(t), current = r.create();
  const recovery = await current.client.auth.resetPasswordForEmail("athlete-a@synthetic.invalid");
  const resend = await current.client.auth.resend({ type: "signup", email: "athlete-a@synthetic.invalid" });
  assert.equal(recovery.error, null); assert.equal(resend.error, null);
  assert.equal(current.authority.snapshot().accepted, null);
  assert.equal(r.calls.filter(call => call.path.endsWith("/recover") || call.path.endsWith("/resend")).length, 2);
});

test("late password verification cannot undo a completed logout", async t => {
  const r = runtime(t), current = r.create(), entered = deferred(), released = deferred();
  await login(current);
  r.controls.password = async () => { entered.resolve(); await released.promise; return json(r.register(session("athlete-b"))); };
  const pending = outcome(login(current, "athlete-b")); await entered.promise;
  await current.authentication.signOut(); released.resolve();
  assert.equal((await pending).error?.code, "stale");
  assert.equal(current.authority.snapshot().accepted, null);
  assert.equal((await current.client.auth.getSession()).data.session, null);
  assert.ok(r.calls.some(call => call.path.endsWith("/logout") && call.bearer === session("athlete-b").access_token));
});

test("account switching accepts only the explicitly selected account", async t => {
  const r = runtime(t), current = r.create(); await login(current);
  const result = await login(current, "athlete-b");
  assert.equal(result.data.user.id, "athlete-b");
  assert.equal((await current.client.auth.getUser()).data.user.id, "athlete-b");
  assert.equal(current.authority.snapshot().accepted.accountId, "athlete-b");
});

test("real SDK refresh rotates accepted tokens without creating a new login epoch", async t => {
  const r = runtime(t), current = r.create(); const first = await login(current);
  const epoch = current.authority.snapshot().accepted.epoch;
  const exp = first.data.session.expires_at + 3600;
  const refreshed = r.register({ ...first.data.session, expires_at: exp, expires_in: 7200,
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: "athlete-a", session_id: "athlete-a-one", exp })}.${encode("rotated-synthetic-signature")}`,
    refresh_token: "synthetic-new-rotated-refresh" });
  r.controls.refresh = async () => json(refreshed);
  const result = await current.client.auth.refreshSession();
  assert.equal(result.error, null);
  assert.equal(current.authority.allowsSession(result.data.session), true);
  assert.equal(current.authority.allowsSession(first.data.session), false);
  assert.equal(current.authority.snapshot().accepted.epoch, epoch);
});

test("late recovery OTP cannot replace a newer password login", async t => {
  const r = runtime(t), current = r.create(), entered = deferred(), released = deferred();
  r.controls.otp = async () => { entered.resolve(); await released.promise; return json(r.register(session("athlete-a", "recovery"))); };
  const old = outcome(current.authentication.verifyOtp({ type: "recovery", email: "athlete-a@synthetic.invalid", token: "123456" }));
  await entered.promise; const accepted = await login(current, "athlete-b"); released.resolve();
  assert.equal((await old).error?.code, "stale");
  assert.equal(current.authority.allowsSession(accepted.data.session), true);
  assert.equal(current.authority.snapshot().accepted.mode, "normal");
});

test("newer same-account sign-in invalidates an older attempt without revoking the accepted session", async t => {
  const r = runtime(t), current = r.create(), entered = deferred(), released = deferred();
  let attempts = 0;
  r.controls.password = async () => {
    const count = ++attempts;
    if (count === 1) { entered.resolve(); await released.promise; }
    return json(r.register(session("athlete-a", `attempt-${count}`)));
  };
  const old = outcome(login(current)); await entered.promise;
  const next = await login(current); released.resolve();
  assert.equal((await old).error?.code, "stale");
  assert.equal(current.authority.allowsSession(next.data.session), true);
  assert.equal(r.calls.some(call => call.path.endsWith("/logout") && call.bearer === next.data.session.access_token), false);
});

test("signup without a session preserves previous accepted login; OTP accepts correct identity", async t => {
  const r = runtime(t), current = r.create(); await login(current);
  const signup = await current.authentication.signUp({ email: "athlete-b@synthetic.invalid", password: "synthetic-password-only" });
  assert.equal(signup.data.session, null);
  assert.equal(current.authority.snapshot().accepted.accountId, "athlete-a");
  const verified = await current.authentication.verifyOtp({ type: "email", email: "athlete-b@synthetic.invalid", token: "123456" });
  assert.equal(verified.error, null);
  assert.equal(current.authority.snapshot().accepted.accountId, "athlete-b");
});

test("recovery OTP remains restricted until actual SDK password update succeeds", async t => {
  const r = runtime(t), current = r.create();
  const recovery = await current.authentication.verifyOtp({ type: "recovery", email: "athlete-a@synthetic.invalid", token: "123456" });
  assert.equal(recovery.error, null);
  assert.equal(current.authority.snapshot().accepted.mode, "recovery");
  const updated = await current.authentication.updateUser({ password: "synthetic-updated-password-only" });
  assert.equal(updated.error, null);
  assert.equal(current.authority.snapshot().accepted.mode, "normal");
});

test("future passkey candidate ownership transfers to primary SDK without cleanup revocation", async t => {
  const r = runtime(t), current = r.create(); await current.authority.ready();
  const ticket = await current.authentication.beginPasskey();
  const candidate = r.register(session("athlete-b", "passkey"));
  const accepted = await ticket.accept(candidate);
  assert.equal(accepted.error, null); assert.equal(ticket.owns(candidate), true);
  assert.equal(current.authority.allowsSession(candidate), true);
  assert.equal(r.calls.some(call => call.path.endsWith("/logout")), false);
});

test("successful future passkey acceptance consumes its ticket and cannot be replayed", async t => {
  const r = runtime(t), current = r.create(); await current.authority.ready();
  const ticket = await current.authentication.beginPasskey();
  const first = r.register(session("athlete-a", "passkey-first"));
  await ticket.accept(first);
  await assert.rejects(ticket.accept(r.register(session("athlete-b", "passkey-replay"))), error => error.code === "stale");
  assert.equal(current.authority.allowsSession(first), true);
});

test("logout invalidates future passkey candidate before acceptance", async t => {
  const r = runtime(t), current = r.create(); await login(current);
  const ticket = await current.authentication.beginPasskey(); await current.authentication.signOut();
  assert.equal(ticket.isCurrent(), false);
  await assert.rejects(ticket.accept(r.register(session("athlete-b", "passkey"))), error => error.code === "stale");
  assert.equal(current.authority.snapshot().accepted, null);
});

test("unguarded direct main SDK password sign-in is denied without replacing accepted identity", async t => {
  const r = runtime(t), current = r.create(); await login(current);
  const attempted = await outcome(current.client.auth.signInWithPassword({ email: "athlete-b@synthetic.invalid", password: "synthetic-password-only" }));
  assert.ok(attempted.error || attempted.value.error);
  assert.equal(current.authority.snapshot().accepted.accountId, "athlete-a");
});

test("SecureStore write failure rejects candidate and closes authority access", async t => {
  const r = runtime(t), current = r.create(); await current.client.auth.getSession();
  r.records.setItem = async () => { throw Error("Synthetic native failed acknowledgment"); };
  await assert.rejects(login(current), error => error.code === "storage");
  assert.equal(current.authority.snapshot().accepted, null);
});

test("startup storage failure resolves to denied authority without authorizing or leaking a session", async t => {
  const r = runtime(t);
  r.records.setItem = async () => { throw Error("Synthetic startup acknowledgment failure"); };
  const current = r.create();
  const restored = await outcome(current.client.auth.getSession());
  assert.equal(restored.error, undefined);
  assert.equal(restored.value.data.session, null);
  await assert.rejects(current.authority.ready(), error => error.code === "storage");
  assert.equal(current.authority.snapshot().accepted, null);
  assert.equal(current.authority.snapshot().error.code, "storage");
  await new Promise(resolve => setImmediate(resolve));
});

for (const failed of [false, true]) {
  test(`old refresh ${failed ? "error" : "success"} after logout cannot retire or restore a newer login`, async t => {
    const r = runtime(t), current = r.create(); const first = await login(current);
    const entered = deferred(), released = deferred();
    r.controls.refresh = async () => { entered.resolve(); await released.promise;
      return failed ? json({ error_code: "refresh_token_not_found", message: "Synthetic expired refresh" }, 400) : json(first.data.session); };
    const refreshed = outcome(current.client.auth.refreshSession()); await entered.promise;
    const logout = current.authentication.signOut();
    const next = outcome(login(current, "athlete-b"));
    released.resolve(); await refreshed; await logout;
    const accepted = await next; assert.equal(accepted.error, undefined);
    assert.equal(accepted.value.error, null);
    assert.equal(current.authority.snapshot().accepted.accountId, "athlete-b");
    assert.equal((await current.client.auth.getSession()).data.session.user.id, "athlete-b");
  });

  test(`expired legacy startup refresh ${failed ? "error" : "success"} cannot clear newer pending login after logout`, async t => {
    const r = runtime(t), entered = deferred(), released = deferred();
    const exp = Math.floor(Date.now() / 1000) - 60;
    const expired = r.register({ ...session(), expires_at: exp,
      access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: "athlete-a", session_id: "athlete-a-one", exp })}.${encode("expired-synthetic-signature")}` });
    const key = `sb-${new URL(r.url).hostname.split(".")[0]}-auth-token`;
    r.legacy.values.set(key, JSON.stringify(expired));
    r.controls.refresh = async () => { entered.resolve(); await released.promise;
      return failed ? json({ code: "refresh_token_not_found", message: "Synthetic expired refresh" }, 400) : json(r.register(session())); };
    const current = r.create();
    await entered.promise;
    const logout = current.authentication.signOut();
    const next = outcome(login(current, "athlete-b"));
    released.resolve(); await logout;
    const accepted = await next;
    assert.equal(accepted.error, undefined);
    assert.equal(accepted.value.error, null);
    assert.equal(current.authority.snapshot().accepted.accountId, "athlete-b");
    assert.equal((await current.client.auth.getSession()).data.session.user.id, "athlete-b");
  });
}
