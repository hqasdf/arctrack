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
function runtime() {
  let foreground = true;
  const listeners = new Set();
  const scope = createNativeAuthPromptScope({ foreground: () => foreground,
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); } }, 20);
  return { scope, set(value) { foreground = value; for (const listener of [...listeners]) listener(); },
    get listeners() { return listeners.size; } };
}

test("idle construction adds no listeners or native work", () => {
  const r = runtime(); assert.equal(r.scope.active, false); assert.equal(r.listeners, 0);
});
test("foreground native success releases the prompt scope", async () => {
  const r = runtime();
  assert.equal(await r.scope.run(async () => { assert.equal(r.scope.active, true); return "signed-assertion"; }), "signed-assertion");
  assert.equal(r.scope.active, false);
});
test("temporary credential UI background then foreground permits its explicit result", async () => {
  const r = runtime(), gate = deferred(), pending = r.scope.run(() => gate.promise);
  r.set(false); assert.equal(r.scope.active, true);
  r.set(true); gate.resolve("signed-assertion");
  assert.equal(await pending, "signed-assertion"); assert.equal(r.scope.active, false);
});
test("native completion just before foreground event waits before returning for verification", async () => {
  const r = runtime(), gate = deferred();
  const pending = r.scope.run(() => gate.promise);
  r.set(false); gate.resolve("signed-assertion");
  await new Promise(setImmediate);
  assert.equal(r.scope.active, true); assert.equal(r.listeners, 1);
  r.set(true); assert.equal(await pending, "signed-assertion");
  assert.equal(r.listeners, 0); assert.equal(r.scope.active, false);
});
test("remaining backgrounded rejects the result and removes resume listeners", async () => {
  const r = runtime(), gate = deferred(), pending = r.scope.run(() => gate.promise);
  r.set(false); gate.resolve("must-not-verify");
  await assert.rejects(pending, /active app/);
  assert.equal(r.scope.active, false); assert.equal(r.listeners, 0);
});
test("a delayed JS timer cannot allow a foreground return after the wall-clock deadline", async () => {
  const r = runtime(), gate = deferred(), pending = r.scope.run(() => gate.promise);
  r.set(false); gate.resolve("must-not-verify");
  await new Promise(setImmediate);
  // Simulate a suspended/blocked JS thread: AppState returns before its overdue timer runs.
  const until = Date.now() + 30; while (Date.now() < until) { /* simulated suspension */ }
  r.set(true);
  await assert.rejects(pending, /active app/);
  assert.equal(r.scope.active, false); assert.equal(r.listeners, 0);
});
test("background cannot start a prompt and concurrent prompt cannot replace one", async () => {
  const r = runtime(); let calls = 0; r.set(false);
  await assert.rejects(r.scope.run(async () => { calls++; }), /active app/);
  r.set(true); const gate = deferred(), pending = r.scope.run(() => gate.promise);
  await assert.rejects(r.scope.run(async () => { calls++; }), /active app/);
  assert.equal(calls, 0); gate.resolve(); await pending;
});
test("native cancellation releases the scope and preserves the original error", async () => {
  const r = runtime(), cancellation = Error("Synthetic native cancellation");
  await assert.rejects(r.scope.run(async () => { throw cancellation; }), error => error === cancellation);
  assert.equal(r.scope.active, false); assert.equal(await r.scope.run(async () => "retry"), "retry");
});
