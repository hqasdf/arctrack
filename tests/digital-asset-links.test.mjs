import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import nextTesting from "next/experimental/testing/server.js";
import ts from "typescript";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const fingerprint = "71:44:97:2B:C6:BE:FA:06:B2:DD:90:BF:C1:58:6D:1E:1A:B4:9A:6B:AD:03:E3:D9:D0:FA:30:D3:A2:BC:A7:BF";
const association = JSON.parse(read("../public/.well-known/assetlinks.json"));

test("credential association trusts only the supplied Play signing certificate and existing Android app", () => {
  assert.deepEqual(association, [{
    relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
    target: { namespace: "android_app", package_name: "com.arctrack.archery", sha256_cert_fingerprints: [fingerprint] },
  }]);
  assert.equal(JSON.parse(read("../apps/mobile/app.json")).expo.android.package, association[0].target.package_name);
  const preparedTemplate = JSON.parse(read("../apps/mobile/docs/passkey-activation/assetlinks.json.template"));
  assert.deepEqual(preparedTemplate[0].target, association[0].target);
  assert.ok(preparedTemplate[0].relation.every(relation => association[0].relation.includes(relation)), "existing credential-sharing relations remain preserved");
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
