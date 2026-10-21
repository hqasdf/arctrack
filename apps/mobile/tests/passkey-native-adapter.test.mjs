import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as diagnostics from "../src/passkeys/registration-diagnostics.ts";

const source = readFileSync(new URL("../src/passkeys/native-adapter.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const fixtureModule = { exports: {} };
const promptScope = { run: action => action() };
new Function("require", "module", "exports", outputText)(name => {
  if (name === "react-native") return { Platform: { OS: "android", Version: 36 } };
  if (name === "../auth-native-prompt") return { nativeAuthPrompt: promptScope };
  if (name === "./registration-diagnostics.ts") return diagnostics;
  throw Error(`Unexpected eager dependency ${name}`);
}, fixtureModule, fixtureModule.exports);
const { createNativePasskeyAdapter } = fixtureModule.exports;
const encode = value => Buffer.from(value).toString("base64url");
const id = encode("synthetic-credential");
const registration = { id, response: { clientDataJSON: encode("signed-client-data"), attestationObject: encode("signed-attestation") } };
const assertion = { id, response: { clientDataJSON: encode("signed-client-data"), authenticatorData: encode("signed-auth-data"),
  signature: encode("signed-signature"), userHandle: encode("synthetic-user") } };
const createOptions = { challenge: "-__vAA", rp: { id: "example.invalid", name: "Test" }, user: {
  id: encode("synthetic-user"), name: "athlete@example.invalid", displayName: "Test athlete" },
  pubKeyCredParams: [{ type: "public-key", alg: -7 }], authenticatorSelection: { residentKey: "required", userVerification: "required" } };
const getOptions = { challenge: "-__vAA", rpId: "example.invalid", userVerification: "required" };
function runtime({ response = assertion, error, platform = { os: "android", version: 36 }, supported = true, loadError } = {}) {
  let loads = 0, availabilityCalls = 0;
  const calls = [];
  const adapter = createNativePasskeyAdapter({ platform, loadNative: async () => {
    loads++; if (loadError) throw loadError;
    return { Passkey: { isSupported() { availabilityCalls++; return supported; },
      async create(options) { calls.push({ kind: "create", options }); if (error) throw error; return response; },
      async get(options) { calls.push({ kind: "get", options }); if (error) throw error; return response; } } };
  } });
  return { adapter, calls, get loads() { return loads; }, get availabilityCalls() { return availabilityCalls; } };
}
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);

test("creation resolution is logged before response validation; invalid response cannot reach success", async t => {
  const events = []; t.mock.method(console, "info", (_tag, value) => events.push(JSON.parse(value)));
  await rejects(runtime({ response: { id, response: {} } }).adapter.create(createOptions), "invalid_response");
  assert.deepEqual(events.map(event => event.stage), ["native_create_started", "native_create_success", "native_prompt_returned", "native_response_error"]);
});

test("native creation rejection preserves its safe code in diagnostics, never its message", async t => {
  const events = []; t.mock.method(console, "info", (_tag, value) => events.push(JSON.parse(value)));
  await rejects(runtime({ error: { error: "RequestFailed", message: "secret credential" } }).adapter.create(createOptions), "native_error");
  assert.equal(events[1].stage, "native_create_error"); assert.equal(events[1].code, "RequestFailed");
  assert.ok(!events.some(event => event.stage === "native_create_success"));
  assert.ok(!JSON.stringify(events).includes("secret"));
});

test("resolved creation followed by foreground rejection is distinct from native rejection", async t => {
  const events = []; t.mock.method(console, "info", (_tag, value) => events.push(JSON.parse(value)));
  t.mock.method(promptScope, "run", async action => { await action(); throw Error("Device authentication did not return to the active app."); });
  await rejects(runtime({ response: registration }).adapter.create(createOptions), "native_error");
  assert.deepEqual(events.map(event => event.stage), ["native_create_started", "native_create_success", "native_prompt_error"]);
});

test("construction and basic availability never load native module or check native provider", () => {
  const r = runtime(); assert.equal(r.adapter.isSupported(), true);
  assert.equal(r.loads, 0); assert.equal(r.availabilityCalls, 0); assert.equal(r.calls.length, 0);
});
test("registration preserves requests and signed response bytes while filling SDK structural defaults", async () => {
  const r = runtime({ response: registration }); const before = JSON.stringify(registration), optionsBefore = JSON.stringify(createOptions);
  const result = await r.adapter.create(createOptions);
  assert.equal(r.calls[0].options, createOptions); assert.deepEqual(result.response, registration.response);
  assert.equal(result.id, id); assert.equal(result.rawId, id); assert.equal(result.type, "public-key");
  assert.deepEqual(result.clientExtensionResults, {}); assert.equal(JSON.stringify(registration), before);
  assert.equal(JSON.stringify(createOptions), optionsBefore);
});
test("authentication preserves discoverable request and exact assertion fields; lazy module loads once", async () => {
  const r = runtime(); const result = await r.adapter.get(getOptions); await r.adapter.get(getOptions);
  assert.equal(r.loads, 1); assert.equal(r.calls[0].options, getOptions);
  assert.equal("allowCredentials" in r.calls[0].options, false); assert.deepEqual(result.response, assertion.response);
});
for (const platform of [{ os: "android", version: 27 }, { os: "ios", version: "26.0" }, { os: "web", version: 36 }, { os: "android", version: "invalid" }]) {
  test(`unsupported platform ${JSON.stringify(platform)} never imports native library`, async () => {
    const r = runtime({ platform }); assert.equal(r.adapter.isSupported(), false);
    await rejects(r.adapter.get(getOptions), "unsupported"); assert.equal(r.loads, 0); assert.equal(r.calls.length, 0);
  });
}
for (const rpId of [undefined, "", "https://example.invalid", "example.invalid/path", "example.invalid:443", "bad domain", "127.0.0.1", "bad..domain", "-invalid.example", "example.invalid."]) {
  test(`reject malformed RP ID ${String(rpId)} before native import`, async () => {
    const r = runtime(); await rejects(r.adapter.get({ ...getOptions, rpId }), "invalid_request");
    await rejects(r.adapter.create({ ...createOptions, rp: { ...createOptions.rp, id: rpId } }), "invalid_request");
    assert.equal(r.loads, 0);
  });
}
for (const options of [{ ...getOptions, challenge: "" }, { ...getOptions, challenge: "a" }, { ...getOptions, challenge: "a+/=" },
  { ...getOptions, timeout: NaN }, { ...getOptions, userVerification: "whatever" },
  { ...getOptions, allowCredentials: [{ type: "password", id }] }]) {
  test(`reject invalid request ${JSON.stringify(options)} before native import`, async () => {
    const r = runtime(); await rejects(r.adapter.get(options), "invalid_request"); assert.equal(r.loads, 0);
  });
}
test("registration rejects incomplete user, algorithm and selection input without native import", async () => {
  const r = runtime();
  for (const input of [{ ...createOptions, user: {} }, { ...createOptions, pubKeyCredParams: [] },
    { ...createOptions, authenticatorSelection: { residentKey: "unknown" } }]) await rejects(r.adapter.create(input), "invalid_request");
  assert.equal(r.loads, 0);
});
for (const [native, code] of [["UserCancelled", "cancelled"], ["NotSupported", "unsupported"], ["NoCredentials", "unavailable"],
  ["NoCreateOption", "unavailable"], ["Interrupted", "unavailable"], ["BadConfiguration", "invalid_request"], ["Native error", "native_error"]]) {
  test(`native ${native} maps safely without exposing messages`, async () => {
    const r = runtime({ error: { error: native, message: "private-user@example.invalid secret-token" } });
    await assert.rejects(r.adapter.get(getOptions), error => error.code === code && !error.message.includes("secret") && !error.message.includes("@"));
  });
}
test("missing native package and unavailable native provider return safe fallback", async () => {
  await rejects(runtime({ loadError: Error("private filesystem path") }).adapter.get(getOptions), "unavailable");
  const r = runtime({ supported: false }); await rejects(r.adapter.get(getOptions), "unavailable"); assert.equal(r.calls.length, 0);
});
for (const response of [undefined, null, {}, { id, response: {} }, { ...assertion, type: "password" },
  { ...assertion, rawId: encode("different") }, { ...assertion, clientExtensionResults: [] },
  { ...assertion, response: { ...assertion.response, signature: "invalid+/=" } }]) {
  test(`reject malformed native response ${JSON.stringify(response)}`, async () => {
    const r = runtime({ response: response === undefined ? null : response });
    await rejects(r.adapter.get(getOptions), "invalid_response");
  });
}
test("optional null user handle is omitted without mutating original signed response", async () => {
  const original = { ...assertion, response: { ...assertion.response, userHandle: null } };
  const result = await runtime({ response: original }).adapter.get(getOptions);
  assert.equal("userHandle" in result.response, false); assert.equal(original.response.userHandle, null);
  assert.equal(result.response.signature, original.response.signature);
});
