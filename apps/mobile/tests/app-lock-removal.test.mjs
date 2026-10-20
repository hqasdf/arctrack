import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { providerRuntime, routingRuntime } from "./helpers/auth-runtime.mjs";

const require = createRequire(import.meta.url);
const mobile = new URL("../", import.meta.url);
const read = file => readFileSync(new URL(file, mobile), "utf8");
const user = { id: "athlete-a", email: "athlete-a@example.invalid" };
const preference = id => `arc-track.biometric-unlock.v1.${id}`;

test("no app-lock provider, overlay, prompt or background timeout remains in application code", () => {
  for (const directory of ["app/", "src/"]) {
    for (const file of readdirSync(new URL(directory, mobile), { recursive: true }).filter(file => /\.[tj]sx?$/.test(file))) {
      assert.doesNotMatch(read(`${directory}${file}`), /BiometricLock|BiometricSetting|useBiometricPrivacyState|authenticateBiometric|expo-local-authentication|BIOMETRIC_BACKGROUND_MS|Arc Track locked/, file);
    }
  }
  for (const file of ["src/biometric-lock.tsx", "src/biometric-lock-model.ts", "src/biometrics.ts"]) {
    assert.equal(existsSync(new URL(file, mobile)), false);
  }
});

test("restored sessions open protected routes while only the current account's obsolete flag is removed", async () => {
  const secureValues = new Map([
    [preference(user.id), "1"], [preference("athlete-b"), "1"],
    ["sb-project-auth-token", "synthetic-session"], ["other.preference", "keep"],
  ]);
  const app = providerRuntime({ restoredUser: user, secureValues });
  assert.equal(routingRuntime(app.render()).blocked, true, "Normal auth initialization still gates routes");
  await app.settle();
  const value = await app.settle();
  assert.equal(value.user, user);
  assert.equal(routingRuntime(value).indexDestination(), "/(tabs)/sessions");
  assert.deepEqual(app.secureDeletes, [preference(user.id)]);
  assert.deepEqual([...secureValues], [[preference("athlete-b"), "1"], ["sb-project-auth-token", "synthetic-session"], ["other.preference", "keep"]]);
  assert.equal(app.getUserCalls(), 1, "Removing the lock adds no identity request");
});

test("preference deletion failure or pending storage cannot lock a valid session", async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  for (const deleteSecureItem of [async () => { throw Error("private storage error"); }, () => pending]) {
    const app = providerRuntime({ restoredUser: user, deleteSecureItem });
    await app.settle();
    const value = await app.settle();
    assert.equal(value.loading, false);
    assert.equal(value.authError, false);
    assert.equal(routingRuntime(value).indexDestination(), "/(tabs)/sessions");
  }
  release();
});

test("signed-out users retain no protected access and never perform speculative preference cleanup", async () => {
  const app = providerRuntime();
  await app.settle();
  const routes = routingRuntime(app.render());
  assert.equal(routes.indexDestination(), "/(auth)/sign-in");
  assert.ok(!routes.routeNames.includes("(tabs)"));
  assert.deepEqual(app.secureDeletes, []);
});

test("account switching cleans each account's own flag and logout still removes protected routes", async () => {
  const secureValues = new Map([[preference(user.id), "1"], [preference("athlete-b"), "1"]]);
  const app = providerRuntime({ restoredUser: user, secureValues });
  await app.settle(); await app.settle();
  await app.render().signOut();
  assert.ok(!routingRuntime(app.render()).routeNames.includes("(tabs)"));
  const other = { ...user, id: "athlete-b" };
  app.auth.signInWithPassword = async () => ({ data: { user: other, session: { user: other } }, error: null });
  await app.render().signIn(other.email, "synthetic-password");
  await app.settle(); await app.settle();
  assert.equal(app.render().user.id, other.id);
  assert.deepEqual(app.secureDeletes, [preference(user.id), preference(other.id)]);
  assert.equal(secureValues.size, 0);
});

test("ordinary rerenders, token refresh and app return introduce no lock or extra identity checks", async () => {
  const app = providerRuntime({ restoredUser: user });
  await app.settle(); await app.settle();
  // The provider/root no longer subscribe to AppState. Returning after any elapsed
  // interval has no app-lock listener/timer to run; ordinary rendering stays open.
  for (let i = 0; i < 5; i++) {
    app.emit("TOKEN_REFRESHED", { user });
    await app.settle();
    assert.equal(routingRuntime(app.render()).indexDestination(), "/(tabs)/sessions");
  }
  assert.equal(app.getUserCalls(), 1);
  assert.deepEqual(app.secureDeletes, [preference(user.id)]);
  assert.doesNotMatch(read("src/auth.tsx") + read("app/_layout.tsx"), /AppState|setTimeout|setInterval/);
});

test("Expo configuration drops app-lock permission descriptions and dependency without changing token storage", () => {
  const manifest = JSON.parse(read("package.json"));
  assert.equal(manifest.dependencies["expo-local-authentication"], undefined);
  const result = spawnSync(process.execPath, [require.resolve("expo/bin/cli"), "config", "--type", "introspect", "--json"], {
    cwd: mobile, encoding: "utf8", maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.status, 0, "Expo configuration evaluation must succeed");
  const config = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
  assert.equal(config._internal.modResults.ios.infoPlist.NSFaceIDUsageDescription, undefined);
  assert.ok(!(config.android.permissions ?? []).some(permission => /USE_BIOMETRIC|USE_FINGERPRINT/.test(permission)));
  assert.doesNotMatch(read("src/secure-auth-storage.ts"), /requireAuthentication|LocalAuthentication/);
  assert.doesNotMatch(read("src/supabase.ts"), /experimental|passkey/);
});
