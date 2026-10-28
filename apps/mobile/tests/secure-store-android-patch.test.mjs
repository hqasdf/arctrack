import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import ts from "typescript";
import { patchSecureStoreAndroid, secureStorePatch } from "../scripts/patch-secure-store-android.mjs";
import { createAuthStorage } from "../src/auth-storage.ts";

const require = createRequire(import.meta.url);
const installedDirectory = dirname(require.resolve("expo-secure-store/package.json"));
const patched = readFileSync(join(installedDirectory, secureStorePatch.source), "utf8").replace(/\r\n/g, "\n");
const replacement = `      val success = saveEncryptedItem(encryptedItem, prefs, keychainAwareKey, options.requireAuthentication, options.keychainService)
      if (!success) {
        throw WriteException("Could not persist encrypted value to SecureStore", key, options.keychainService)
      }`;
const original = patched.replace(replacement,
  "      saveEncryptedItem(encryptedItem, prefs, keychainAwareKey, options.requireAuthentication, options.keychainService)");
const hash = value => createHash("sha256").update(value).digest("hex");

function fixture(t, { version = secureStorePatch.version, source = original } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "arc-securestore-patch-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const target = join(directory, secureStorePatch.source);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "expo-secure-store", version }));
  writeFileSync(target, source);
  return { directory, read: () => readFileSync(target, "utf8") };
}

test("installed SecureStore contains only the pinned encrypted-commit acknowledgment correction", () => {
  assert.equal(hash(original), secureStorePatch.originalSha256);
  assert.equal(hash(patched), secureStorePatch.patchedSha256);
  const root = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
  assert.equal(root.scripts.postinstall, "node apps/mobile/scripts/patch-secure-store-android.mjs");
  const mobile = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(mobile.expo.autolinking.android.buildFromSource, ["expo-secure-store"]);
});

test("fresh dependency source is patched reproducibly and repeated application is a no-op", t => {
  const f = fixture(t);
  assert.equal(patchSecureStoreAndroid(f.directory), "patched");
  assert.equal(f.read(), patched);
  assert.equal(patchSecureStoreAndroid(f.directory), "already patched");
  assert.equal(f.read(), patched);
});

test("unsupported dependency version fails without changing source", t => {
  const f = fixture(t, { version: "58.0.3" });
  assert.throws(() => patchSecureStoreAndroid(f.directory), /requires expo-secure-store@58\.0\.2/);
  assert.equal(f.read(), original);
});

test("unexpected native source fails closed rather than applying a partial patch", t => {
  const source = `${original}\n// Unexpected dependency change\n`;
  const f = fixture(t, { source });
  assert.throws(() => patchSecureStoreAndroid(f.directory), /differs from the reviewed version/);
  assert.equal(f.read(), source);
});

test("CRLF dependency checkout receives the same reviewed patch", t => {
  const f = fixture(t, { source: original.replace(/\n/g, "\r\n") });
  assert.equal(patchSecureStoreAndroid(f.directory), "patched");
  assert.equal(f.read(), patched);
});

// This executes the installed JS wrapper with an injected native result. Native
// Kotlin tests separately cover the real commit path; this is not a JNI test.
function secureStoreWrapper(native) {
  const source = readFileSync(join(installedDirectory, "src/SecureStore.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const fixtureModule = { exports: {} };
  new Function("require", "module", "exports", outputText)(name => {
    assert.equal(name, "./ExpoSecureStore");
    return { __esModule: true, default: native };
  }, fixtureModule, fixtureModule.exports);
  return fixtureModule.exports;
}

test("installed JS API resolves successful writes without changing key, value or options", async () => {
  const calls = [];
  const wrapper = secureStoreWrapper({ setValueWithKeyAsync: async (...args) => { calls.push(args); } });
  const options = { requireAuthentication: false };
  assert.equal(await wrapper.setItemAsync("synthetic-key", "synthetic-value", options), undefined);
  assert.deepEqual(calls, [["synthetic-value", "synthetic-key", options]]);
});

test("installed JS API propagates native write rejection instead of resolving", async () => {
  const failure = Object.assign(Error("Synthetic write failure"), { code: "ERR_WRITE" });
  const wrapper = secureStoreWrapper({ setValueWithKeyAsync: async () => { throw failure; } });
  await assert.rejects(wrapper.setItemAsync("synthetic-key", "synthetic-value"), error => error === failure);
});

test("existing auth adapter rejects uncertain writes without trusting a possible readback", async () => {
  let reads = 0, legacyRemovals = 0;
  const wrapper = secureStoreWrapper({ setValueWithKeyAsync: async () => { throw Error("Synthetic native rejection"); } });
  const storage = createAuthStorage({
    getItem: async () => { reads++; return "synthetic-value"; },
    setItem: (key, value) => wrapper.setItemAsync(key, value),
    removeItem: async () => {},
  }, {
    getItem: async () => null, setItem: async () => {},
    removeItem: async () => { legacyRemovals++; },
  }, () => {});
  await assert.rejects(storage.setItem("synthetic-key", "synthetic-value"), /could not be saved/);
  assert.equal(reads, 0);
  assert.equal(legacyRemovals, 0);
});
