import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { spawnSync } from "node:child_process";

function compile(path, modules, environment = process, diagnostics = console) {
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", "process", "console", compiled)(name => { assert.ok(name in modules, name); return modules[name]; }, exports, environment, diagnostics);
  return exports;
}
function deletion(options = {}) {
  const calls = [], owner = { id: "owner", email: "owner@example.invalid", email_confirmed_at: "2026-10-10" };
  const verifier = { auth: {
    signInWithPassword: async input => { calls.push(["verify", input]); return { data: { user: options.verifiedUser ?? owner, session: options.noSession ? null : {} }, error: options.verificationError ?? null }; },
    signOut: async input => { calls.push(["verificationSignOut", input]); if (options.verifierCleanupThrows) throw new Error("private cleanup"); return { error: null }; },
  } };
  const modules = {
    "next/cache": { revalidatePath: (...args) => calls.push(["revalidate", ...args]) },
    "@/lib/auth/config": { getAuthConfig: () => options.noConfig ? null : { url: "https://test.supabase.invalid", publishableKey: "sb_publishable_test" } },
    "@/lib/supabase/server": { createAuthClient: async () => ({ auth: {
      getUser: async () => ({ data: { user: options.user === undefined ? owner : options.user }, error: options.identityError ?? null }),
      signOut: async input => { calls.push(["browserSignOut", input]); if (options.cleanupThrows) throw new Error("private cleanup"); return { error: null }; },
    } }) },
    "@supabase/supabase-js": { createClient: (...args) => { calls.push(["verifierClient", ...args]); return verifier; } },
    "@/lib/supabase/admin.server": { createAdminClient: () => {
      calls.push(["adminClient"]); if (options.noAdminConfig) throw new Error("private configuration");
      return { auth: { admin: { deleteUser: async (...args) => {
        calls.push(["delete", ...args]); if (options.deleteThrows) throw new Error("private database detail");
        return { data: { user: owner }, error: options.deleteError ?? null };
      } } } };
    } },
  };
  const exports = compile("../src/features/profile/account-deletion-actions.ts", modules);
  const form = new FormData(); form.set("password", "test-only-password"); form.set("confirmation", "DELETE");
  return { run: () => exports.deleteAccount({ status: "idle", message: "" }, form), form, calls };
}
test("verified owner hard-deletion ignores submitted victim IDs and uses only trusted admin authority", async () => {
  const op = deletion();
  for (const key of ["email", "user_id", "profile_id", "organization_id"]) op.form.set(key, "victim");
  assert.equal((await op.run()).status, "success");
  assert.deepEqual(op.calls.map(c => c[0]), ["verifierClient", "verify", "adminClient", "delete", "verificationSignOut", "browserSignOut", "revalidate"]);
  assert.deepEqual(op.calls.find(c => c[0] === "verify"), ["verify", { email: "owner@example.invalid", password: "test-only-password" }]);
  assert.deepEqual(op.calls.find(c => c[0] === "delete"), ["delete", "owner", false]);
});
test("reauthentication is isolated from browser cookies and its temporary session is revoked", async () => {
  const op = deletion({ deleteError: { message: "private SQL" } }); assert.equal((await op.run()).status, "error");
  assert.deepEqual(op.calls[0].slice(1), ["https://test.supabase.invalid", "sb_publishable_test", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }]);
  assert.ok(op.calls.some(c => c[0] === "verificationSignOut")); assert.ok(!op.calls.some(c => c[0] === "browserSignOut"));
});
test("signed-out, expired, unconfirmed and repeated deleted-account requests cannot reach admin", async () => {
  for (const options of [{ user: null }, { identityError: { status: 401 } }, { user: { id: "owner", email: "owner@example.invalid" } }]) {
    const op = deletion(options); assert.equal((await op.run()).status, "error"); assert.deepEqual(op.calls, []);
  }
});
test("password and exact DELETE confirmation are checked server-side", async () => {
  for (const [field, value] of [["confirmation", "delete"], ["confirmation", ""], ["password", ""], ["password", "x".repeat(129)]]) {
    const op = deletion(); op.form.set(field, value); assert.equal((await op.run()).status, "error"); assert.deepEqual(op.calls, []);
  }
});
test("wrong password, mismatched identity and missing verification session cannot create admin authority", async () => {
  for (const options of [{ verificationError: { message: "private auth" } }, { verifiedUser: { id: "other" } }, { noSession: true }]) {
    const op = deletion(options), result = await op.run(); assert.equal(result.status, "error"); assert.doesNotMatch(result.message, /private/);
    assert.ok(!op.calls.some(c => c[0] === "adminClient")); assert.equal(op.calls.at(-1)[0], "verificationSignOut");
  }
});
test("missing configuration and Admin/FK/network failures return safe failure without browser logout", async () => {
  for (const options of [{ noAdminConfig: true }, { deleteError: { message: "private FK" } }, { deleteThrows: true }, { noConfig: true }]) {
    const op = deletion(options), result = await op.run(); assert.equal(result.status, "error"); assert.doesNotMatch(result.message, /private|FK/);
    assert.ok(!op.calls.some(c => c[0] === "browserSignOut" || c[0] === "revalidate"));
  }
});
test("confirmed deletion remains successful if post-deletion cleanup fails", async () => {
  const op = deletion({ cleanupThrows: true, verifierCleanupThrows: true }); assert.equal((await op.run()).status, "success"); assert.equal(op.calls.at(-1)[0], "revalidate");
});
test("admin client uses only server configuration, with no cookies or caller Authorization", () => {
  const calls = [], modules = { "server-only": {}, "@/lib/auth/config": { getAuthConfig: () => ({ url: "https://test.supabase.invalid" }) },
    "@supabase/supabase-js": { createClient: (...args) => { calls.push(args); return {}; } } };
  compile("../src/lib/supabase/admin.server.ts", modules, { env: { SUPABASE_SECRET_KEY: "server-test-secret" } }).createAdminClient();
  assert.deepEqual(calls, [["https://test.supabase.invalid", "server-test-secret", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }]]);
  assert.throws(() => compile("../src/lib/supabase/admin.server.ts", modules, { env: {} }).createAdminClient(), /not configured/);
});

test("missing localhost admin configuration fails before network access with safe development diagnostics", () => {
  const warnings = [];
  const modules = { "server-only": {},
    "@/lib/auth/config": { getAuthConfig: () => ({ url: "https://test.supabase.invalid" }) },
    "@supabase/supabase-js": { createClient: () => assert.fail("Missing secret must not create an Admin client") } };
  const diagnostics = { warn: (...args) => warnings.push(args) };
  assert.throws(() => compile("../src/lib/supabase/admin.server.ts", modules,
    { env: { NODE_ENV: "development" } }, diagnostics).createAdminClient(), /not configured/);
  assert.deepEqual(warnings, [["[account-deletion] admin_configuration", { reason: "SUPABASE_SECRET_KEY missing" }]]);
  warnings.length = 0;
  assert.throws(() => compile("../src/lib/supabase/admin.server.ts", modules,
    { env: { NODE_ENV: "production" } }, diagnostics).createAdminClient(), /not configured/);
  assert.deepEqual(warnings, []);
});
test("unsafe pending migration is retired and SQL fixture checks old RPC calls under both client roles", () => {
  assert.equal(existsSync(new URL("../supabase/migrations/20260926130000_prepare_self_service_account_deletion.sql", import.meta.url)), false);
  const sql = readFileSync(new URL("../supabase/tests/self-service-account-deletion.sql", import.meta.url), "utf8");
  assert.match(sql, /retired deletion RPC still exists/); assert.match(sql, /authenticated public legacy RPC call accepted/);
  assert.match(sql, /anonymous public legacy RPC call accepted/); assert.match(sql, /rollback;\s*$/i);
});
test("web and Expo keep one public resource without mobile admin authority", () => {
  const page = readFileSync(new URL("../src/app/delete-account/page.tsx", import.meta.url), "utf8"); assert.match(page, /readIdentity/); assert.doesNotMatch(page, /requireUser|admin\.deleteUser/);
  const form = readFileSync(new URL("../src/features/profile/components/account-deletion-form.tsx", import.meta.url), "utf8"); assert.match(form, /removeItem\(COUNTER_STORAGE_KEY\)/);
  const mobile = readFileSync(new URL("../apps/mobile/app/(tabs)/profile.tsx", import.meta.url), "utf8");
  assert.match(mobile, /Linking\.openURL\("https:\/\/archery-website\.vercel\.app\/delete-account"\)/); assert.doesNotMatch(mobile, /SUPABASE_SECRET_KEY|admin\.deleteUser/);
});

test("database integration runner rejects production and non-loopback URLs before network access", () => {
  for (const url of ["https://pdwxphgyqbbflnrruobp.supabase.co", "http://localhost.evil.invalid", "http://127.0.0.1/not-a-local-root"]) {
    const result = spawnSync(process.execPath, ["supabase/tests/self-service-account-deletion.integration.mjs"], {
      encoding: "utf8", env: { SUPABASE_TEST_URL: url },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Only explicit http localhost\/127\.0\.0\.1 test endpoints are allowed/);
  }
});
