import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import nextConfig from "../next.config.ts";
import { callbackDestination, parseAuthConfig } from "../src/lib/auth/config.ts";

function arrowRoute(save = async () => ({ ok: true, data: { id: "dummy-arrow" } })) {
  const source = readFileSync(new URL("../src/app/api/session-arrows/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}, calls = [];
  const modules = {
    "next/cache": { revalidatePath: path => calls.push(["revalidate", path]) },
    "@/features/sessions/arrow-save.server": { saveArrowRecord: async input => { calls.push(["save", input]); return save(input); } },
  };
  new Function("require", "exports", compiled)(name => { assert.ok(name in modules, name); return modules[name]; }, exports);
  return { post: exports.POST, calls };
}
function request(body = '{}', headers = {}) {
  return new Request("https://arc.example/api/session-arrows", {
    method: "POST", body,
    headers: { origin: "https://arc.example", "content-type": "application/json", ...headers },
  });
}
function privateResponse(response) { assert.match(response.headers.get("cache-control"), /private.*no-store/); }

test("same-origin Arrow requests retain the existing save and revalidation flow", async () => {
  const route = arrowRoute();
  const input = { roundId: "dummy", endNumber: 1, arrowNumber: 1, score: "X", plot: { x: 0.02, y: 0.01 } };
  const response = await route.post(request(JSON.stringify(input)));
  assert.equal(response.status, 200); privateResponse(response);
  assert.deepEqual(route.calls, [["save", input], ["revalidate", "/sessions"]]);
});

test("cross-site and missing-Origin Arrow requests are denied before mutations", async () => {
  for (const origin of ["https://evil.example", "null", "https://arc.example.evil.example"]) {
    const route = arrowRoute(), response = await route.post(request('{}', { origin }));
    assert.equal(response.status, 403); privateResponse(response); assert.deepEqual(route.calls, []);
  }
  const route = arrowRoute(), missing = request(); missing.headers.delete("origin");
  assert.equal((await route.post(missing)).status, 403); assert.deepEqual(route.calls, []);
});

test("unsupported media types and malformed JSON fail with sanitized private responses", async () => {
  for (const type of ["text/plain", "application/json-malicious"]) {
    const route = arrowRoute(), response = await route.post(request('{}', { "content-type": type }));
    assert.equal(response.status, 415); privateResponse(response); assert.deepEqual(route.calls, []);
  }
  for (const body of ['{ private details', '[]', 'null']) {
    const route = arrowRoute(), response = await route.post(request(body));
    assert.equal(response.status, 400); privateResponse(response); assert.deepEqual(route.calls, []);
    assert.doesNotMatch(JSON.stringify(await response.json()), /private details/);
  }
});

test("Arrow payload limit is enforced by bytes even without Content-Length", async () => {
  for (const headers of [{}, { "content-length": "1" }, { "content-length": "20000" }]) {
    const route = arrowRoute(), response = await route.post(request(JSON.stringify({ value: "x".repeat(17000) }), headers));
    assert.equal(response.status, 413); privateResponse(response); assert.deepEqual(route.calls, []);
  }
  const route = arrowRoute();
  const atLimit = '{"value":"' + 'x'.repeat(16384 - 12) + '"}';
  assert.equal(Buffer.byteLength(atLimit), 16384);
  assert.equal((await route.post(request(atLimit))).status, 200);
});

test("chunked oversized requests cancel reading and never call the save boundary", async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(9000)); controller.enqueue(new Uint8Array(9000));
  }, cancel() { cancelled = true; } });
  const route = arrowRoute();
  const response = await route.post(new Request("https://arc.example/api/session-arrows", {
    method: "POST", body, duplex: "half", headers: { origin: "https://arc.example", "content-type": "application/json" },
  }));
  assert.equal(response.status, 413); assert.equal(cancelled, true); assert.deepEqual(route.calls, []);
});

test("authorization and server failures never expose underlying details or revalidate", async () => {
  for (const save of [async () => { throw new Error("private SQL /srv/auth token dummy"); }, async () => ({ ok: false, message: "The Arrow was not saved." })]) {
    const route = arrowRoute(save), response = await route.post(request());
    privateResponse(response);
    assert.doesNotMatch(JSON.stringify(await response.json()), /private SQL|\/srv\/auth|dummy/);
    assert.equal(route.calls.some(([kind]) => kind === "revalidate"), false);
  }
});

test("global headers prevent framing and sniffing without restricting scripts or export images", async () => {
  const rules = await nextConfig.headers();
  const headers = Object.fromEntries(rules.find(rule => rule.source === "/:path*").headers.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["content-security-policy"], "frame-ancestors 'none'");
  assert.equal(headers["referrer-policy"], "no-referrer");
  assert.equal(headers["permissions-policy"], "camera=(), microphone=(), geolocation=()");
  assert.doesNotMatch(headers["content-security-policy"], /script-src|style-src|img-src|connect-src/);
});

test("dangerous destination schemes and encoded redirects cannot escape the existing callback allowlist", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,test", "vbscript:test", "file:///tmp/test", "//evil.example", "%2F%2Fevil.example", "/sessions?next=https://evil.example"]) {
    assert.equal(callbackDestination(value), "/sessions");
  }
  assert.equal(callbackDestination("/update-password"), "/update-password");
  assert.equal(parseAuthConfig({ url: "https://project.example", key: "sb_publishable_dummy", appUrl: "https://user:password@evil.example" }), null);
});

test("Analytics receives the same proxy privacy and refresh coverage as other private pages", () => {
  const source = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
  assert.match(source, /"\/analytics\/:path\*"/);
  assert.match(source, /private, no-store, max-age=0/);
});
