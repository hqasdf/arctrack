import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function runtime() {
  const values = new Map([["sb-existing-auth-token", "synthetic-existing-session"]]), calls = [];
  let writeGate = null, failWrite = false;
  const native = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
    async getItemAsync(key) { calls.push(["get", key]); return values.get(key) ?? null; },
    async setItemAsync(key, value, options) { calls.push(["set", key, options]); if (writeGate) await writeGate.promise;
      if (failWrite) throw Error("Synthetic storage denial"); values.set(key, value); },
    async deleteItemAsync(key) { calls.push(["remove", key]); values.delete(key); },
  };
  const exports = {}, code = ts.transpileModule(readFileSync(new URL("../src/passkeys/credential-storage.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "exports", code)(name => { assert.equal(name, "expo-secure-store"); return native; }, exports);
  return { storage: exports.deviceCredentialStorage, values, calls,
    block(gate) { writeGate = gate; }, fail(value) { failWrite = value; } };
}
const key = "arc-track.passkey-registration.v1.synthetic-scope";
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test("credential metadata uses existing SecureStore without a prompt or modifying session keys", async () => {
  const r = runtime(); await r.storage.setItem(key, "synthetic-registration-metadata");
  assert.equal(await r.storage.getItem(key), "synthetic-registration-metadata");
  assert.deepEqual(r.calls[0], ["set", key, { keychainAccessible: 7 }]);
  await r.storage.removeItem(key);
  assert.deepEqual([...r.values], [["sb-existing-auth-token", "synthetic-existing-session"]]);
  assert.ok(r.calls.every(call => call[1] === key));
});

test("controllers sharing the metadata adapter preserve write/remove ordering within a running process", async () => {
  const r = runtime(), gate = deferred(); r.block(gate);
  const pending = r.storage.setItem(key, "metadata"), removal = r.storage.removeItem(key);
  await new Promise(setImmediate); assert.equal(r.calls.length, 1);
  gate.resolve(); await Promise.all([pending, removal]);
  assert.equal(await r.storage.getItem(key), null);
});

test("storage errors propagate and do not poison subsequent metadata operations", async () => {
  const r = runtime(); r.fail(true);
  await assert.rejects(r.storage.setItem(key, "metadata"), /denial/);
  r.fail(false); await r.storage.setItem(key, "retry"); assert.equal(await r.storage.getItem(key), "retry");
});
