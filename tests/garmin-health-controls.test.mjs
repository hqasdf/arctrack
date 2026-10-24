import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
async function load(path, dependencies = {}, globals = {}) {
  const code = ts.transpileModule(await readFile(new URL("../" + path, import.meta.url), "utf8"), {
    fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  new Function("require", "exports", ...Object.keys(globals), code)(name => {
    if (name in dependencies) return dependencies[name];
    if (name === "server-only") return {};
    if (name === "react" || name === "react/jsx-runtime" || name.startsWith("node:")) return require(name);
    if (name.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
    throw Error("Unexpected Health control dependency: " + name);
  }, exports, ...Object.values(globals));
  return exports;
}
class GarminError extends Error { constructor(code) { super(code); this.code = code; } }
const { createHealthControlHandler } = await load("src/features/garmin/health/controls.server.ts", {
  "@/lib/supabase/admin.server": {}, "@/lib/auth/config": {}, "../service.server": {}, "../provider.server": { GarminError }, "./config.server": {},
  "../http.server": { sameOrigin: (request, { appOrigin }) => new URL(request.url).origin === appOrigin && request.headers.get("origin") === appOrigin },
});
const control = { generation: randomUUID(), paused: true, acceptAfter: "2026-10-24T06:00:00Z", deletedAt: "2026-10-24T06:00:00Z", changedAt: "2026-10-24T06:00:00Z" };
const input = action => ({ action, generation: randomUUID(), requestId: randomUUID(), confirm: true });
const request = (body, origin = "https://arc.example") => new Request("https://arc.example/api/integrations/garmin/health/control", {
  method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
function fixture(overrides = {}) {
  const calls = [];
  const handle = createHealthControlHandler({ origin: "https://arc.example", owner: async () => "verified-owner", canResume: () => true,
    verify: async id => { calls.push(["verify", id]); return { version: "proof", authorizedAt: "epoch" }; },
    control: async (...args) => { calls.push(["control", ...args]); return control; }, ...overrides });
  return { handle, calls };
}
test("Health deletion uses verified identity, explicit confirmation and backend receipt while preserving OAuth", async () => {
  const { handle, calls } = fixture(); const command = { ...input("delete"), userId: "attacker-selected-owner" };
  const result = await handle(request(command));
  assert.equal(result.status, 200); assert.deepEqual((await result.json()).control, control);
  assert.equal(calls[0][1], "verified-owner"); assert.equal(calls.length, 1); assert.match(result.headers.get("cache-control"), /no-store/);
  assert.equal((await handle(request({ ...command, confirm: false }))).status, 400);
});
test("cross-origin and unauthenticated Health changes stop before controls or provider calls", async () => {
  const denied = fixture(); assert.equal((await denied.handle(request(input("delete"), "https://other.example"))).status, 403); assert.equal(denied.calls.length, 0);
  const signedOut = fixture({ owner: async () => null }); assert.equal((await signedOut.handle(request(input("pause")))).status, 401); assert.equal(signedOut.calls.length, 0);
});
test("Resume respects activation gates before checking Garmin and accepts only verified authorization", async () => {
  const disabled = fixture({ canResume: () => false }); assert.equal((await disabled.handle(request(input("resume")))).status, 403); assert.deepEqual(disabled.calls, []);
  for (const code of ["permissions_required", "provider_unavailable", "reauthorization_required", "busy"]) {
    const denied = fixture({ verify: async () => { throw new GarminError(code); } });
    assert.equal((await denied.handle(request(input("resume")))).status, 409); assert.deepEqual(denied.calls, []);
  }
  const normal = fixture(); assert.equal((await normal.handle(request(input("resume")))).status, 200);
  assert.deepEqual(normal.calls.map(c => c[0]), ["verify", "control"]); assert.deepEqual(normal.calls[1][3], { version: "proof", authorizedAt: "epoch" });
});
test("storage failure does not claim successful deletion or expose internal errors", async () => {
  const f = fixture({ control: async () => { throw new Error("private-secret-detail"); } });
  const result = await f.handle(request(input("delete"))); assert.equal(result.status, 409);
  const body = await result.json(); assert.equal(body.control, undefined); assert.match(body.error, /could not be confirmed/); assert.doesNotMatch(body.error, /private-secret-detail/);
});
test("invalid, oversized and unconfirmed Health commands do not enter persistence", async () => {
  const f = fixture();
  for (const body of [null, {}, { ...input("delete"), generation: "invalid" }, input("unknown"), { ...input("pause"), filler: "x".repeat(3000) }]) {
    assert.equal((await f.handle(request(body))).status, 400);
  }
  assert.equal(f.calls.length, 0);
});
test("Pause/Delete do not depend on a live Garmin request or ingestion activation", async () => {
  for (const action of ["pause", "delete"]) {
    const f = fixture({ canResume: () => false, verify: async () => { throw Error("must not call Garmin"); } });
    assert.equal((await f.handle(request(input(action)))).status, 200);
  }
});
test("the actual Supabase adapter binds the verified owner and rejects returned database errors", async () => {
  const calls = []; let failed = false;
  const api = await load("src/features/garmin/health/controls.server.ts", {
    "@/lib/auth/config": { getAuthConfig: () => ({ appUrl: "https://arc.example" }) },
    "../http.server": { identity: async () => "verified-owner", sameOrigin: () => true },
    "../provider.server": { GarminError }, "../service.server": { configuredGarminService: () => ({ verifyHealthAuthorization: async () => ({ version: "proof", authorizedAt: "epoch" }) }) },
    "./config.server": { garminHealthEnabled: () => true, garminHealthTestUsers: () => ["verified-owner"] },
    "@/lib/supabase/admin.server": { createAdminClient: () => ({ rpc: async (...args) => { calls.push(args); return { data: control, error: failed ? { message: "private database detail" } : null }; } }) },
  });
  const value = input("delete"); assert.equal((await api.garminHealthControl(request({ ...value, userId: "other-owner" }))).status, 200);
  assert.deepEqual(calls[0], ["control_garmin_health", { p_user_id: "verified-owner", p_action: "delete", p_generation: value.generation, p_request_id: value.requestId, p_connection_version: null, p_authorized_at: null }]);
  failed = true; const result = await api.garminHealthControl(request(input("delete"))); assert.equal(result.status, 409); assert.doesNotMatch(await result.text(), /private database detail/);
});
test("Health controls present accessible explicit deletion, resume and accurate Garmin-original notices", async () => {
  const { HealthSyncControls } = await load("src/features/health/components/health-sync-controls.tsx");
  const html = renderToStaticMarkup(React.createElement(HealthSyncControls, { control, onChanged() {}, onUnconfirmed() {} }));
  for (const text of ["Health Sync Paused", "Resume Health Sync", "Delete Health Data", "Confirm Delete Health Data", "Garmin stays connected", "originals in Garmin are not deleted", "aria-describedby", "Cancel"]) assert.ok(html.includes(text), text);
});
test("repeated control taps share one request and success waits for backend confirmation", async () => {
  let complete, fetches = 0, changed = 0; const refs = [];
  const pending = new Promise(resolve => { complete = resolve; });
  const ui = await load("src/features/health/components/health-sync-controls.tsx", { react: { ...React, useState: value => [value, () => {}], useRef: value => { const ref = { current: value }; refs.push(ref); return ref; } } }, {
    fetch: async () => { fetches++; return pending; }, crypto: { randomUUID },
  });
  const tree = ui.HealthSyncControls({ control, onChanged: () => changed++, onUnconfirmed: () => assert.fail("unconfirmed") });
  const buttons = []; function walk(node) { if (!node || typeof node !== "object") return; if (node.type === "button") buttons.push(node); React.Children.forEach(node.props?.children, walk); } walk(tree);
  buttons.find(b => b.props.children === "Resume Health Sync").props.onClick();
  buttons.find(b => b.props.children === "Resume Health Sync").props.onClick();
  assert.equal(fetches, 1); assert.equal(changed, 0);
  complete(Response.json({ control })); await new Promise(resolve => setImmediate(resolve)); assert.equal(changed, 1);
});
