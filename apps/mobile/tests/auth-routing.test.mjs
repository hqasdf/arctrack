import assert from "node:assert/strict";
import test from "node:test";
import { providerRuntime, routingRuntime, transitionFrom } from "./helpers/auth-runtime.mjs";
import { RECOVERY_STORAGE_KEY, serializeRecoveryContext } from "../src/auth-flow.ts";

const user = { id: "qa-archer", email: "archer@example.com" };
const session = { user };
const stale = serializeRecoveryContext({ active: true, stage: "password", email: user.email, userId: user.id });
const ready = (overrides = {}) => ({ user: null, recovery: null, recoveryRequired: false, loading: false, authError: false, ...overrides });

test("normal restored authority ignores same-account stale recovery metadata", async () => {
  const runtime = providerRuntime({ restoredUser: user, storedRecovery: stale, acceptedMode: "normal" });
  const value = await runtime.settle();
  assert.equal(value.recovery?.stage, "password");
  assert.equal(value.recoveryRequired, false);
  const routes = routingRuntime(value);
  assert.equal(routes.indexDestination(), "/(tabs)/sessions");
  assert.ok(routes.routeNames.includes("(tabs)"));
  assert.ok(!routes.routeNames.includes("recover"));
});

test("entry follows accepted account transitions instead of retained recovery metadata", async () => {
  const runtime = providerRuntime({ restoredUser: user, storedRecovery: stale, acceptedMode: "recovery" });
  await runtime.settle();
  assert.equal(routingRuntime(runtime.render()).indexDestination(), "/recover");
  runtime.accept(session, "normal");
  assert.equal(routingRuntime(runtime.render()).indexDestination(), "/(tabs)/sessions");
  const next = { user: { id: "other-athlete", email: "other@example.invalid" } };
  runtime.accept(next, "normal");
  assert.equal(runtime.render().user, null);
  runtime.emitRaw("SIGNED_IN", next);
  assert.equal(routingRuntime(runtime.render()).indexDestination(), "/(tabs)/sessions");
  runtime.accept(next, "recovery");
  assert.equal(routingRuntime(runtime.render()).indexDestination(), "/recover");
  await runtime.render().signOut();
  assert.equal(routingRuntime(runtime.render()).indexDestination(), "/(auth)/sign-in");
});

test("unaccepted SDK sign-in events cannot open protected routes", async () => {
  const runtime = providerRuntime(); await runtime.settle();
  runtime.emitRaw("SIGNED_IN", session);
  assert.equal(runtime.render().user, null);
  assert.equal(routingRuntime(runtime.render()).indexDestination(), "/(auth)/sign-in");
});

test("stale SDK sign-out cannot clear an accepted account", async () => {
  const runtime = providerRuntime({ restoredUser: user }); await runtime.settle();
  runtime.emitRaw("SIGNED_OUT", null);
  assert.equal(runtime.render().user, user);
});

test("durable recovery purpose cannot be cleared by missing or removed UI metadata", async () => {
  const runtime = providerRuntime({ restoredUser: user, acceptedMode: "recovery" }); await runtime.settle();
  assert.equal(runtime.render().recoveryRequired, true);
  assert.equal(runtime.render().recovery.stage, "password");
  await runtime.render().setRecovery(null);
  assert.equal(runtime.render().recoveryRequired, true);
  assert.equal(routingRuntime(runtime.render()).indexDestination(), "/recover");
  runtime.accept(session, "normal");
  assert.equal(runtime.render().recoveryRequired, false);
});

test("changing accepted accounts closes old protected identity before the SDK event", async () => {
  const runtime = providerRuntime({ restoredUser: user }); await runtime.settle();
  const next = { user: { ...user, id: "other-athlete" } };
  runtime.accept(next);
  assert.equal(runtime.render().user, null);
  runtime.emitRaw("SIGNED_IN", next);
  assert.equal(runtime.render().user.id, "other-athlete");
});

test("every root Stack.Screen and protected group corresponds to a real Expo route", () => {
  const routes = routingRuntime(ready());
  const discovered = routes.node.children.map((route) => route.route);
  for (const name of routes.declaredNames) assert.ok(discovered.includes(name), `Missing route: ${name}; actual routes: ${discovered}`);
});

test("sign-in is removed immediately when the root auth guard changes, without index being active", () => {
  const before = routingRuntime(ready());
  const after = routingRuntime(ready({ user }));
  const authRoute = before.node.children.some((route) => route.route === "(auth)") ? "(auth)" : "(auth)/sign-in";
  const next = transitionFrom(authRoute, before, after);
  assert.ok(!next.routes.some((route) => route.name === authRoute), "Sign-in must be removed from history on login");
  assert.equal(next.routes[next.index].name, "index");
  assert.equal(after.indexDestination(), "/(tabs)/sessions");
});

test("sign-out from the real tab stack falls back to Sign In, never Recovery", () => {
  const before = routingRuntime(ready({ user }));
  const after = routingRuntime(ready());
  const next = transitionFrom("(tabs)", before, after);
  assert.equal(next.routes[next.index].name, "index");
  assert.equal(after.indexDestination(), "/(auth)/sign-in");
  assert.ok(!next.routes.some((route) => route.name === "(tabs)"));
});

for (const storedRecovery of [null, stale]) {
test(`real provider publishes password login immediately (${storedRecovery ? "stale recovery" : "normal, no auth event"})`, async () => {
  let finishRemoval;
  const removal = new Promise((resolve) => { finishRemoval = resolve; });
  const runtime = providerRuntime({ storedRecovery, removeItem: () => removal });
  await runtime.settle();
  runtime.auth.signInWithPassword = async () => {
    if (storedRecovery) runtime.emit("SIGNED_IN", session);
    return { data: { user, session }, error: null };
  };
  let finished = false;
  const login = runtime.render().signIn(user.email, "test-only").then(() => { finished = true; });
  const value = await runtime.settle();
  try {
    assert.equal(finished, true, "Login must not await AsyncStorage recovery cleanup");
    assert.equal(value.user, user);
    assert.equal(value.loading, false);
    assert.equal(value.recovery, null);
    assert.equal(value.recoveryRequired, false);
    assert.equal(runtime.getUserCalls(), 1, "Only startup calls getUser");
    assert.equal(routingRuntime(value).indexDestination(), "/(tabs)/sessions");
  } finally { finishRemoval(); await login; }
  assert.equal(runtime.storage.has(RECOVERY_STORAGE_KEY), false);
});
}

for (const storedRecovery of [null, stale]) {
  test(`real provider sign-out clears recovery and routes to Sign In (${storedRecovery ? "stale recovery" : "normal"})`, async () => {
    const runtime = providerRuntime({ restoredUser: user });
    await runtime.settle();
    // Simulate stale disk metadata while the current session is a normal login.
    if (storedRecovery) runtime.storage.set(RECOVERY_STORAGE_KEY, storedRecovery);
    assert.equal(runtime.render().recoveryRequired, false);
    await runtime.render().signOut();
    const value = runtime.render();
    assert.equal(value.user, null);
    assert.equal(value.recovery, null);
    assert.equal(value.recoveryRequired, false);
    assert.equal(runtime.storage.has(RECOVERY_STORAGE_KEY), false);
    assert.equal(routingRuntime(value).indexDestination(), "/(auth)/sign-in");
  });
}

test("recovery authentication alone gates Sessions and routes to Set New Password", async () => {
  const runtime = providerRuntime();
  await runtime.settle();
  await runtime.render().setRecovery({ active: true, stage: "password", email: user.email });
  runtime.emit("SIGNED_IN", session); // event emitted by verifyOtp(type: recovery)
  await runtime.render().setRecovery({ active: true, stage: "password", email: user.email, userId: user.id });
  const value = runtime.render();
  assert.equal(value.user, user);
  assert.equal(value.recoveryRequired, true);
  const routes = routingRuntime(value);
  assert.ok(!routes.routeNames.includes("(tabs)"));
  assert.ok(!routes.routeNames.includes("(auth)"));
  assert.equal(routes.indexDestination(), "/recover");
});

test("the SIGNED_OUT event clears user and recovery together while storage I/O is pending", async () => {
  let finishRemoval;
  const removal = new Promise((resolve) => { finishRemoval = resolve; });
  const runtime = providerRuntime({ storedRecovery: stale, restoredUser: user, removeItem: () => removal });
  await runtime.settle();
  runtime.emit("SIGNED_OUT", null);
  const value = runtime.render();
  try {
    assert.equal(value.user, null);
    assert.equal(value.recovery, null);
    assert.equal(value.recoveryRequired, false);
    assert.equal(routingRuntime(value).indexDestination(), "/(auth)/sign-in");
  } finally { finishRemoval(); await runtime.settle(); }
});

test("three login/logout cycles remove the previous screen from router history every time", async () => {
  const runtime = providerRuntime();
  await runtime.settle();
  runtime.auth.signInWithPassword = async () => {
    runtime.emit("SIGNED_IN", session);
    return { data: { user, session }, error: null };
  };
  for (let cycle = 0; cycle < 3; cycle++) {
    const signedOut = routingRuntime(runtime.render());
    await runtime.render().signIn(user.email, "test-only");
    const signedIn = routingRuntime(runtime.render());
    assert.equal(transitionFrom("(auth)", signedOut, signedIn).routes[0].name, "index");
    assert.equal(signedIn.indexDestination(), "/(tabs)/sessions");
    assert.ok(!signedIn.routeNames.includes("recover"));
    await runtime.render().signOut();
    const next = routingRuntime(runtime.render());
    assert.equal(transitionFrom("(tabs)", signedIn, next).routes[0].name, "index");
    assert.equal(next.indexDestination(), "/(auth)/sign-in");
  }
});

test("startup loading and errors prevent the navigator from rendering", () => {
  assert.equal(routingRuntime(ready({ loading: true })).blocked, true);
  assert.equal(routingRuntime(ready({ authError: true })).blocked, true);
});
