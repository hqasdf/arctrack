import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createAuthStorage } from "../src/auth-storage.ts";
import { readFileSync } from "node:fs";
import ts from "typescript";

const key = "sb-pdwxphgyqbbflnrruobp-auth-token";
function memory(initial = {}) {
  const values = new Map(Object.entries(initial));
  const calls = [];
  return { values, calls,
    async getItem(k) { calls.push(["get", k]); return values.get(k) ?? null; },
    async setItem(k, value) { calls.push(["set", k]); values.set(k, value); },
    async removeItem(k) { calls.push(["remove", k]); values.delete(k); },
  };
}
function setup(initial = {}) {
  const secure = memory(), legacy = memory(initial);
  let failures = 0;
  return { secure, legacy, storage: createAuthStorage(secure, legacy, () => failures++), failures: () => failures };
}
const dummy = JSON.stringify({ dummy: "test session only" });

test("legacy migration writes and verifies secure data before deleting plaintext; repeated startups are idempotent", async () => {
  const s = setup({ [key]: dummy, "arrow-counter": "72" });
  const order = [];
  for (const [name, store] of [["secure", s.secure], ["legacy", s.legacy]]) {
    for (const method of ["getItem", "setItem", "removeItem"]) {
      const original = store[method];
      store[method] = async (...args) => { order.push(`${name}.${method}`); return original(...args); };
    }
  }
  assert.equal(await s.storage.getItem(key), dummy);
  assert.deepEqual(order, ["secure.getItem", "legacy.getItem", "secure.setItem", "secure.getItem", "legacy.removeItem"]);
  for (let i = 0; i < 2; i++) {
    const restart = createAuthStorage(s.secure, s.legacy, () => assert.fail("unexpected migration failure"));
    assert.equal(await restart.getItem(key), dummy);
  }
  assert.equal(s.secure.calls.filter(([op]) => op === "set").length, 1);
  assert.equal(s.legacy.values.has(key), false);
  assert.equal(s.legacy.values.get("arrow-counter"), "72");
});

test("secure session is authoritative over an older legacy account", async () => {
  const s = setup({ [key]: "old-account" });
  s.secure.values.set(key, "new-account");
  assert.equal(await s.storage.getItem(key), "new-account");
  assert.equal(s.legacy.calls.some(([op]) => op === "get"), false);
  assert.equal(s.legacy.values.has(key), false);
});

test("migration write failure preserves and returns legacy session without logging data; next read retries", async () => {
  const s = setup({ [key]: dummy });
  const write = s.secure.setItem;
  s.secure.setItem = async () => { throw new Error("sensitive native details"); };
  assert.equal(await s.storage.getItem(key), dummy);
  assert.equal(s.legacy.values.get(key), dummy);
  assert.equal(s.failures(), 1);
  s.secure.setItem = write;
  assert.equal(await s.storage.getItem(key), dummy);
  assert.equal(s.legacy.values.has(key), false);
});

test("migration readback mismatch does not delete legacy data", async () => {
  const s = setup({ [key]: dummy });
  s.secure.setItem = async () => {};
  assert.equal(await s.storage.getItem(key), dummy);
  assert.equal(s.legacy.values.get(key), dummy);
  assert.equal(s.failures(), 1);
});

test("secure read error cannot fall back to stale plaintext", async () => {
  const s = setup({ [key]: dummy });
  s.secure.getItem = async () => { throw new Error("secret native details"); };
  await assert.rejects(s.storage.getItem(key), { message: "Auth secure storage could not be read." });
  assert.deepEqual(s.legacy.calls, []);
});

test("normal writes persist only securely, and failed writes never create plaintext fallback", async () => {
  const s = setup();
  await s.storage.setItem(key, dummy);
  assert.equal(s.secure.values.get(key), dummy);
  assert.equal(s.legacy.calls.some(([op]) => op === "set"), false);
  s.secure.setItem = async () => { throw new Error("secret native details"); };
  await assert.rejects(s.storage.setItem(key, "new session"), { message: "Auth secure storage could not be saved." });
  assert.equal(s.legacy.values.has(key), false);
});

test("failed plaintext cleanup retains secure authority and retries; failed logout cannot resurrect legacy", async () => {
  const s = setup({ [key]: dummy });
  const remove = s.legacy.removeItem;
  s.legacy.removeItem = async () => { throw new Error("cleanup failed"); };
  assert.equal(await s.storage.getItem(key), dummy);
  assert.equal(s.secure.values.get(key), dummy);
  assert.equal(s.failures(), 1);
  await assert.rejects(s.storage.removeItem(key), { message: "Auth storage could not be cleared." });
  assert.equal(s.secure.values.get(key), dummy);
  s.legacy.removeItem = remove;
  await s.storage.removeItem(key);
  assert.equal(await createAuthStorage(s.secure, s.legacy, () => {}).getItem(key), null);
});

test("concurrent migration followed by logout and new-account write preserves operation order", async () => {
  const s = setup({ [key]: "account A" });
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const write = s.secure.setItem;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  s.secure.setItem = async (...args) => { entered(); await barrier; await write(...args); };
  const migration = s.storage.getItem(key);
  await started;
  const logout = s.storage.removeItem(key);
  const nextAccount = s.storage.setItem(key, "account B");
  release();
  assert.equal(await migration, "account A");
  await Promise.all([logout, nextAccount]);
  assert.equal(await s.storage.getItem(key), "account B");
  assert.equal(s.legacy.values.has(key), false);
});

test("auxiliary Auth keys migrate individually and unrelated preferences remain untouched", async () => {
  const keys = [key, `${key}-user`, `${key}-code-verifier`, `${key}-flows-code-verifier`, `${key}-test-flow-code-verifier`];
  const s = setup(Object.fromEntries([...keys.map(k => [k, dummy]), ["preferences", "untouched"]]));
  for (const k of keys) {
    assert.match(k, /^[\w.-]+$/);
    assert.equal(await s.storage.getItem(k), dummy);
    await s.storage.removeItem(k);
    assert.equal(s.secure.values.has(k), false);
    assert.equal(s.legacy.values.has(k), false);
  }
  assert.equal(s.legacy.values.get("preferences"), "untouched");
});

function session(id = "athlete-a", expires = Math.floor(Date.now() / 1000) + 3600) {
  const access_token = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify({ sub: id, exp: expires })).toString("base64url"), "dummy-signature"].join(".");
  return { access_token, refresh_token: `dummy-refresh-${id}`, token_type: "bearer", expires_in: 3600, expires_at: expires,
    user: { id, aud: "authenticated", role: "authenticated", email: `${id}@example.invalid`, app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } };
}
function client(storage, fetch) {
  return createClient("https://pdwxphgyqbbflnrruobp.supabase.co", "dummy-publishable-key", {
    auth: { storage, autoRefreshToken: false, persistSession: true, detectSessionInUrl: false },
    global: { fetch },
  });
}
function response(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }

test("actual Supabase client restores migrated session, logs out, and cannot restore account A after account B", async () => {
  const a = session(), b = session("athlete-b");
  const s = setup({ [key]: JSON.stringify(a) });
  const fetch = async () => response({}, 200);
  const first = client(s.storage, fetch);
  try {
    assert.equal((await first.auth.getSession()).data.session.user.id, a.user.id);
    assert.equal((await first.auth.signOut({ scope: "local" })).error, null);
    assert.equal(await s.storage.getItem(key), null);
  } finally { await first.auth.dispose(); }
  const second = client(createAuthStorage(s.secure, s.legacy, () => {}), async () => response({ user: b.user }));
  try {
    assert.equal((await second.auth.getSession()).data.session, null);
    const result = await second.auth.setSession({ access_token: b.access_token, refresh_token: b.refresh_token });
    assert.equal(result.error, null);
    assert.equal(result.data.session.user.id, b.user.id);
  } finally { await second.auth.dispose(); }
  const third = client(createAuthStorage(s.secure, s.legacy, () => {}), fetch);
  try { assert.equal((await third.auth.getSession()).data.session.user.id, b.user.id); }
  finally { await third.auth.dispose(); }
});

test("actual Supabase client verifies a valid legacy session despite failed migration write", async () => {
  const a = session();
  const s = setup({ [key]: JSON.stringify(a) });
  s.secure.setItem = async () => { throw new Error("simulated failure"); };
  const auth = client(s.storage, async () => response({ user: a.user }));
  try {
    const { data, error } = await auth.auth.getUser();
    assert.equal(error, null);
    assert.equal(data.user.id, a.user.id);
    assert.equal(s.legacy.values.get(key), JSON.stringify(a));
  } finally { await auth.auth.dispose(); }
});

test("actual Supabase refresh writes rotated session securely with no legacy dual-write", async () => {
  const a = session(), refreshed = { ...session(), refresh_token: "dummy-rotated-refresh" };
  const s = setup({ [key]: JSON.stringify(a) });
  let refreshes = 0;
  const auth = client(s.storage, async url => {
    assert.match(String(url), /\/token\?grant_type=refresh_token/);
    refreshes++;
    return response(refreshed);
  });
  try {
    await auth.auth.getSession();
    const { data, error } = await auth.auth.refreshSession();
    assert.equal(error, null);
    assert.equal(data.session.refresh_token, refreshed.refresh_token);
    assert.equal(JSON.parse(s.secure.values.get(key)).refresh_token, refreshed.refresh_token);
    assert.equal(s.legacy.values.has(key), false);
    assert.equal(refreshes, 1);
  } finally { await auth.auth.dispose(); }
});

test("actual Supabase password sign-in saves the session only in secure storage", async () => {
  const a = session();
  const s = setup();
  const auth = client(s.storage, async url => {
    assert.match(String(url), /\/token\?grant_type=password/);
    return response(a);
  });
  try {
    const { data, error } = await auth.auth.signInWithPassword({ email: a.user.email, password: "dummy-test-password" });
    assert.equal(error, null);
    assert.equal(data.session.user.id, a.user.id);
    assert.equal(JSON.parse(s.secure.values.get(key)).user.id, a.user.id);
    assert.equal(s.legacy.values.has(key), false);
    assert.equal(s.legacy.calls.some(([op]) => op === "set"), false);
  } finally { await auth.auth.dispose(); }
});

test("synthetic serialized session round-trips exactly; byte count is not a physical-device size guarantee", async () => {
  const value = JSON.stringify(session());
  assert.ok(Buffer.byteLength(value, "utf8") > 0);
  const s = setup({ [key]: value });
  assert.equal(await s.storage.getItem(key), value);
  assert.equal(s.secure.values.get(key), value);
});

test("oversized native migration rejection preserves the full legacy value without truncation or splitting", async () => {
  const value = JSON.stringify({ ...session(), user: { ...session().user, user_metadata: { dummy: "x".repeat(4096) } } });
  assert.ok(Buffer.byteLength(value, "utf8") > 2048);
  const s = setup({ [key]: value });
  s.secure.setItem = async () => { throw new Error("simulated native size rejection"); };
  assert.equal(await s.storage.getItem(key), value);
  assert.equal(s.legacy.values.get(key), value);
  assert.equal(s.failures(), 1);
  assert.equal(s.legacy.calls.some(([op]) => op === "set"), false);
});

function evaluateMobileSource(file, dependencies) {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)((name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}

test("native wrapper uses SecureStore directly without biometric options or plaintext writes", async () => {
  const secure = memory(), legacy = memory();
  const { secureAuthStorage } = evaluateMobileSource("secure-auth-storage.ts", {
    "@react-native-async-storage/async-storage": { __esModule: true, default: legacy },
    "./auth-storage": { createAuthStorage },
    "expo-secure-store": {
      getItemAsync: (...args) => { assert.equal(args.length, 1); return secure.getItem(...args); },
      setItemAsync: (...args) => { assert.equal(args.length, 2); return secure.setItem(...args); },
      deleteItemAsync: (...args) => { assert.equal(args.length, 1); return secure.removeItem(...args); },
    },
  });
  await secureAuthStorage.setItem(key, dummy);
  assert.equal(await secureAuthStorage.getItem(key), dummy);
  await secureAuthStorage.removeItem(key);
  assert.equal(await secureAuthStorage.getItem(key), null);
  assert.equal(legacy.calls.some(([op]) => op === "set"), false);
});

test("mobile client keeps its persistence flags and foreground refresh behavior", () => {
  let config, onChange;
  const storage = {};
  let starts = 0, stops = 0;
  evaluateMobileSource("supabase.ts", {
    "react-native-url-polyfill/auto": {},
    "./secure-auth-storage": { secureAuthStorage: storage },
    "@supabase/supabase-js": { createClient: (_url, _key, options) => {
      config = options;
      return { auth: { startAutoRefresh: () => starts++, stopAutoRefresh: () => stops++ } };
    } },
    "react-native": { AppState: { addEventListener: (event, callback) => { assert.equal(event, "change"); onChange = callback; } } },
  });
  // Source uses real process.env; exercise configured initialization separately.
  if (!config) {
    const previousUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const previousKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    try {
      process.env.EXPO_PUBLIC_SUPABASE_URL = "https://dummy.example.invalid";
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_dummy";
      evaluateMobileSource("supabase.ts", {
        "react-native-url-polyfill/auto": {},
        "./secure-auth-storage": { secureAuthStorage: storage },
        "@supabase/supabase-js": { createClient: (_url, _key, options) => { config = options; return { auth: { startAutoRefresh: () => starts++, stopAutoRefresh: () => stops++ } }; } },
        "react-native": { AppState: { addEventListener: (_event, callback) => { onChange = callback; } } },
      });
    } finally {
      if (previousUrl === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL; else process.env.EXPO_PUBLIC_SUPABASE_URL = previousUrl;
      if (previousKey === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousKey;
    }
  }
  assert.deepEqual(config.auth, { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false });
  onChange("active"); onChange("background"); onChange("active");
  assert.equal(starts, 2); assert.equal(stops, 1);
});
