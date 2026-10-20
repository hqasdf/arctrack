import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

// Preparation only: exercise the installed SDK against an in-memory Auth server.
// No app integration, native module, cryptographic verification or live requests.
const user = { id: "11111111-1111-4111-8111-111111111111", email: "archer@example.invalid",
  email_confirmed_at: "2026-01-01T00:00:00Z", aud: "authenticated", role: "authenticated",
  app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const credential = { id: "synthetic-credential", rawId: "synthetic-credential", type: "public-key",
  response: { clientDataJSON: "synthetic-client-data", signature: "synthetic-signature", authenticatorData: "synthetic-data" } };
const registered = { id: "22222222-2222-4222-8222-222222222222", friendly_name: "Test authenticator", created_at: "2026-01-01T00:00:00Z" };
const storageKey = "passkey-contract-session";
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: {
  "Content-Type": "application/json", "X-Supabase-Api-Version": "2024-01-01",
} });

function runtime(t, experimental = true) {
  const storage = new Map(), requests = [], events = [];
  let serial = 0;
  const server = { passkeys: [], rejectVerification: false, networkError: false };
  const session = () => {
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
    return { access_token: `${encode({ alg: "HS256" })}.${encode({ sub: user.id, exp: expires })}.synthetic-signature`,
      refresh_token: `synthetic-refresh-${++serial}`, token_type: "bearer", expires_in: 3600, expires_at: expires, user };
  };
  const client = createClient("https://passkey-contract.invalid", "synthetic-publishable-key", {
    auth: { storageKey, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
      experimental: { passkey: experimental },
      storage: { getItem: async key => storage.get(key) ?? null,
        setItem: async (key, value) => { storage.set(key, value); }, removeItem: async key => { storage.delete(key); } } },
    global: { fetch: async (input, init) => {
      const url = new URL(input);
      assert.equal(url.hostname, "passkey-contract.invalid");
      const body = init?.body ? JSON.parse(init.body) : null;
      requests.push({ path: url.pathname, method: init?.method, body });
      if (server.networkError) throw new Error("Synthetic network failure");
      if (url.pathname === "/auth/v1/token") return json(session());
      if (url.pathname === "/auth/v1/logout") return json({});
      if (url.pathname === "/auth/v1/user") return json(user);
      if (url.pathname === "/auth/v1/passkeys/registration/options") return json({
        challenge_id: "registration-challenge", expires_at: Date.now() + 60_000,
        options: { challenge: "synthetic-challenge", rp: { id: "example.invalid", name: "Test" },
          user: { id: "synthetic-user-handle", name: user.email, displayName: "Test archer" }, pubKeyCredParams: [{ type: "public-key", alg: -7 }] },
      });
      if (url.pathname === "/auth/v1/passkeys/authentication/options") return json({
        challenge_id: "authentication-challenge", expires_at: Date.now() + 60_000,
        options: { challenge: "synthetic-challenge", rpId: "example.invalid", userVerification: "required" },
      });
      if (url.pathname.endsWith("/verify")) {
        if (server.rejectVerification) return json({ code: "webauthn_verification_failed", msg: "Synthetic rejection" }, 400);
        if (url.pathname.includes("/registration/")) { server.passkeys = [registered]; return json(registered); }
        return server.passkeys.length ? json(session()) : json({ code: "webauthn_credential_not_found", msg: "Synthetic rejection" }, 400);
      }
      if (url.pathname === "/auth/v1/passkeys") return json(server.passkeys);
      if (url.pathname === `/auth/v1/passkeys/${registered.id}` && init.method === "DELETE") {
        server.passkeys = []; return new Response(null, { status: 204 });
      }
      throw Error(`Unexpected mocked Auth endpoint: ${url.pathname}`);
    } },
  });
  client.auth.onAuthStateChange(event => events.push(event));
  t.after(() => client.auth.dispose());
  const passwordLogin = () => client.auth.signInWithPassword({ email: user.email, password: "synthetic-test-password" });
  return { auth: client.auth, storage, requests, events, server, passwordLogin };
}

test("passkey APIs require experimental opt-in without changing normal password sign-in", async t => {
  const r = runtime(t, false);
  await assert.rejects(r.auth.passkey.startAuthentication(), /experimental|passkey/i);
  assert.equal(r.requests.length, 0);
  assert.equal((await r.passwordLogin()).error, null);
  assert.equal((await r.auth.getSession()).data.session.user.id, user.id);
});

test("registration requires a session and returns metadata only after mocked server verification", async t => {
  const r = runtime(t);
  assert.ok((await r.auth.passkey.startRegistration()).error);
  assert.equal(r.requests.length, 0);
  await r.passwordLogin();
  const options = await r.auth.passkey.startRegistration();
  assert.equal(options.error, null);
  assert.equal(r.server.passkeys.length, 0);
  const attestation = { ...credential, response: { clientDataJSON: "synthetic-client-data", attestationObject: "synthetic-attestation" } };
  const result = await r.auth.passkey.verifyRegistration({ challengeId: options.data.challenge_id, credential: attestation });
  assert.equal(result.error, null);
  assert.deepEqual(result.data, registered);
  assert.deepEqual(r.requests.at(-1).body, { challenge_id: "registration-challenge", credential: attestation });
  assert.deepEqual((await r.auth.passkey.list()).data, [registered]);
});

test("logout clears the current session; a registered credential can obtain a new session through verification", async t => {
  const r = runtime(t);
  await r.passwordLogin();
  const registration = await r.auth.passkey.startRegistration();
  await r.auth.passkey.verifyRegistration({ challengeId: registration.data.challenge_id,
    credential: { ...credential, response: { clientDataJSON: "synthetic-client-data", attestationObject: "synthetic-attestation" } } });
  const previousRefresh = (await r.auth.getSession()).data.session.refresh_token;
  assert.equal((await r.auth.signOut()).error, null);
  assert.equal((await r.auth.getSession()).data.session, null);
  assert.equal(r.storage.has(storageKey), false);
  assert.equal(r.server.passkeys.length, 1);
  const options = await r.auth.passkey.startAuthentication();
  assert.equal((await r.auth.getSession()).data.session, null, "Fetching a challenge must not sign in");
  const result = await r.auth.passkey.verifyAuthentication({ challengeId: options.data.challenge_id, credential });
  assert.equal(result.error, null);
  assert.equal(result.data.user.id, user.id);
  assert.notEqual(result.data.session.refresh_token, previousRefresh);
  assert.equal((await r.auth.getSession()).data.session.refresh_token, result.data.session.refresh_token);
  assert.equal(r.storage.has(storageKey), true);
  assert.deepEqual(r.requests.at(-1).body, { challenge_id: "authentication-challenge", credential });
  assert.equal(r.events.at(-1), "SIGNED_IN");
});

test("abandoning a challenge does not authenticate; rejected assertions leave password fallback available", async t => {
  const r = runtime(t);
  await r.auth.passkey.startAuthentication(); // A cancelled native ceremony submits no assertion.
  assert.equal((await r.auth.getSession()).data.session, null);
  assert.equal(r.requests.some(request => request.path.endsWith("/verify")), false);
  r.server.rejectVerification = true;
  const result = await r.auth.passkey.verifyAuthentication({ challengeId: "authentication-challenge", credential });
  assert.equal(result.error.code, "webauthn_verification_failed");
  assert.equal((await r.auth.getSession()).data.session, null);
  assert.equal(r.events.includes("SIGNED_IN"), false);
  assert.equal(r.storage.has(storageKey), false);
  assert.equal((await r.passwordLogin()).error, null);
});

test("missing or removed passkeys do not create a session and management remains session-scoped", async t => {
  const r = runtime(t);
  assert.equal((await r.auth.passkey.verifyAuthentication({ challengeId: "authentication-challenge", credential })).error.code, "webauthn_credential_not_found");
  assert.equal((await r.auth.getSession()).data.session, null);
  assert.ok((await r.auth.passkey.list()).error);
  assert.ok((await r.auth.passkey.delete({ passkeyId: registered.id })).error);
  await r.passwordLogin();
  r.server.passkeys = [registered];
  assert.equal((await r.auth.passkey.delete({ passkeyId: registered.id })).error, null);
  assert.deepEqual((await r.auth.passkey.list()).data, []);
});

test("rejected registration adds no credential; challenge network failure creates no session", async t => {
  const r = runtime(t);
  await r.passwordLogin();
  const registration = await r.auth.passkey.startRegistration();
  r.server.rejectVerification = true;
  const result = await r.auth.passkey.verifyRegistration({ challengeId: registration.data.challenge_id, credential });
  assert.equal(result.error.code, "webauthn_verification_failed");
  assert.equal(result.data, null);
  assert.deepEqual((await r.auth.passkey.list()).data, []);
  assert.equal((await r.auth.getSession()).data.session.user.id, user.id);
  await r.auth.signOut();
  r.server.networkError = true;
  assert.ok((await r.auth.passkey.startAuthentication()).error);
  assert.equal((await r.auth.getSession()).data.session, null);
  assert.equal(r.storage.has(storageKey), false);
});
