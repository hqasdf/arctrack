import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const fixture = { exports: {} };
new Function("require", "module", "exports", ts.transpileModule(readFileSync(new URL("../src/auth-native-prompt.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(name => { assert.equal(name, "react-native"); return { AppState: {} }; }, fixture, fixture.exports);
const { createNativeAuthPromptScope } = fixture.exports;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function runtime(t) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  let foreground = true;
  const listeners = new Set();
  const scope = createNativeAuthPromptScope({ foreground: () => foreground,
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); } });
  return { scope, set(value) { foreground = value; for (const listener of [...listeners]) listener(); },
    get listeners() { return listeners.size; } };
}

test("idle construction adds no listeners or native work", t => {
  const r = runtime(t); assert.equal(r.scope.active, false); assert.equal(r.listeners, 0);
});
test("foreground native success releases the prompt scope", async t => {
  const r = runtime(t);
  assert.equal(await r.scope.run(async () => { assert.equal(r.scope.active, true); return "signed-assertion"; }), "signed-assertion");
  assert.equal(r.scope.active, false);
});
test("temporary credential UI background then foreground permits its explicit result", async t => {
  const r = runtime(t), gate = deferred(), pending = r.scope.run(() => gate.promise);
  r.set(false); assert.equal(r.scope.active, true);
  r.set(true); gate.resolve("signed-assertion");
  assert.equal(await pending, "signed-assertion"); assert.equal(r.scope.active, false);
});
test("native completion just before foreground event waits before returning for verification", async t => {
  const r = runtime(t), gate = deferred();
  const pending = r.scope.run(() => gate.promise);
  r.set(false); gate.resolve("signed-assertion");
  await Promise.resolve();
  assert.equal(r.scope.active, true); assert.equal(r.listeners, 1);
  t.mock.timers.tick(999);
  r.set(true); assert.equal(await pending, "signed-assertion");
  assert.equal(r.listeners, 0); assert.equal(r.scope.active, false);
});
test("remaining backgrounded rejects the result and removes resume listeners", async t => {
  const r = runtime(t), gate = deferred(), pending = r.scope.run(() => gate.promise);
  const rejected = assert.rejects(pending, /active app/);
  r.set(false); gate.resolve("must-not-verify");
  await Promise.resolve();
  t.mock.timers.tick(1000);
  await rejected;
  assert.equal(r.scope.active, false); assert.equal(r.listeners, 0);
});
test("a delayed JS timer cannot allow a foreground return after the wall-clock deadline", async t => {
  const r = runtime(t), gate = deferred(), pending = r.scope.run(() => gate.promise);
  const rejected = assert.rejects(pending, /active app/);
  r.set(false); gate.resolve("must-not-verify");
  await Promise.resolve();
  // Simulate a suspended/blocked JS thread: AppState returns before its overdue timer runs.
  t.mock.timers.setTime(Date.now() + 1001);
  r.set(true);
  await rejected;
  assert.equal(r.scope.active, false); assert.equal(r.listeners, 0);
});
test("background cannot start a prompt and concurrent prompt cannot replace one", async t => {
  const r = runtime(t); let calls = 0; r.set(false);
  await assert.rejects(r.scope.run(async () => { calls++; }), /active app/);
  r.set(true); const gate = deferred(), pending = r.scope.run(() => gate.promise);
  await assert.rejects(r.scope.run(async () => { calls++; }), /active app/);
  assert.equal(calls, 0); gate.resolve(); await pending;
});
test("native cancellation releases the scope and preserves the original error", async t => {
  const r = runtime(t), cancellation = Error("Synthetic native cancellation");
  await assert.rejects(r.scope.run(async () => { throw cancellation; }), error => error === cancellation);
  assert.equal(r.scope.active, false); assert.equal(await r.scope.run(async () => "retry"), "retry");
});
