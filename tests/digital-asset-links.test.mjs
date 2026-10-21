import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import nextTesting from "next/experimental/testing/server.js";
import ts from "typescript";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const fingerprint = "71:44:97:2B:C6:BE:FA:06:B2:DD:90:BF:C1:58:6D:1E:1A:B4:9A:6B:AD:03:E3:D9:D0:FA:30:D3:A2:BC:A7:BF";
// Exact additional fingerprints supplied from this app's Google Play Console association JSON.
// Their certificate roles are not inferred here.
const consoleFingerprints = [fingerprint,
  "73:D0:CB:49:9E:6C:EE:F9:63:C9:52:6F:79:90:54:5C:9B:91:0B:FD:B4:6A:79:D1:54:B5:F0:6D:F6:47:A3:AE",
  "B6:A6:9A:E6:E2:DC:77:CB:FF:54:5E:B7:FC:E7:37:B2:8D:8D:AB:9A:60:47:F9:18:A7:6B:81:40:0A:55:E2:D0",
];
const association = JSON.parse(read("../public/.well-known/assetlinks.json"));

test("credential association matches the supplied Play Console certificates, relations and existing Android app", () => {
  assert.deepEqual(association, [{
    relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
    target: { namespace: "android_app", package_name: "com.arctrack.archery", sha256_cert_fingerprints: consoleFingerprints },
  }]);
  assert.equal(JSON.parse(read("../apps/mobile/app.json")).expo.android.package, association[0].target.package_name);
  const preparedTemplate = JSON.parse(read("../apps/mobile/docs/passkey-activation/assetlinks.json.template"));
  assert.equal(preparedTemplate[0].target.namespace, association[0].target.namespace);
  assert.equal(preparedTemplate[0].target.package_name, association[0].target.package_name);
  assert.deepEqual(preparedTemplate[0].target.sha256_cert_fingerprints, [fingerprint], "original activation template remains unchanged");
  assert.ok(association[0].target.sha256_cert_fingerprints.includes(fingerprint), "original Play App Signing fingerprint remains trusted");
  assert.ok(preparedTemplate[0].relation.every(relation => association[0].relation.includes(relation)), "existing credential-sharing relations remain preserved");
});

test("association contains three unique SHA-256 digests and no unexplained certificates", () => {
  const values = association[0].target.sha256_cert_fingerprints;
  assert.equal(new Set(values).size, 3);
  assert.deepEqual(new Set(values), new Set(consoleFingerprints));
  for (const value of values) {
    assert.match(value, /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    assert.equal(Buffer.from(value.replaceAll(":", ""), "hex").length, 32);
  }
});

test("documented native origin round-trips the exact 32 certificate bytes without enabling passkeys", () => {
  const candidate = JSON.parse(read("../apps/mobile/docs/passkey-activation/supabase-auth-config.json.template"));
  const origin = "android:apk-key-hash:cUSXK8a--gay3ZC_wVhtHhq0mmutA-PZ0Pow06K8p78";
  const digest = Buffer.from(fingerprint.replaceAll(":", ""), "hex");
  assert.equal(digest.length, 32);
  assert.equal(`android:apk-key-hash:${digest.toString("base64url")}`, origin);
  assert.deepEqual(Buffer.from(origin.split(":").at(-1), "base64url"), digest);
  assert.equal(candidate.passkey_enabled, false);
  assert.equal(candidate.webauthn_rp_id, "archery-website.vercel.app");
  assert.equal(candidate.webauthn_rp_origins, `https://archery-website.vercel.app,${origin}`);
});

test("public association bypasses the auth proxy while private routes retain their matcher", () => {
  const source = ts.createSourceFile("proxy.ts", read("../src/proxy.ts"), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.filter(ts.isVariableStatement)
    .flatMap(statement => [...statement.declarationList.declarations])
    .find(item => item.name.getText(source) === "config");
  assert.ok(declaration?.initializer);
  const compiled = ts.transpileModule(`exports.config = ${declaration.initializer.getText(source)}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const output = {};
  new Function("exports", compiled)(output);
  assert.equal(nextTesting.unstable_doesMiddlewareMatch({ config: output.config, url: "/.well-known/assetlinks.json" }), false);
  for (const url of ["/sessions", "/profile", "/organization/example"]) {
    assert.equal(nextTesting.unstable_doesMiddlewareMatch({ config: output.config, url }), true);
  }
});
