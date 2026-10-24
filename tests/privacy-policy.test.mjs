import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as seo from "../src/lib/seo.ts";

const require = createRequire(import.meta.url);
const source = await readFile(new URL("../src/app/privacy/page.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const pageExports = {};
new Function("require", "exports", compiled)(name => {
  if (name === "@/lib/seo") return seo;
  if (name === "next/link") return { __esModule: true, default: ({ prefetch, ...props }) => { void prefetch; return React.createElement("a", props); } };
  if (name === "@/components/ui/icon") return { Icon: () => React.createElement("svg", { "aria-hidden": true }) };
  if (name.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
  if (name === "react/jsx-runtime") return require(name);
  throw new Error(`Unexpected privacy-page dependency: ${name}`);
}, pageExports);

test("Privacy Policy renders as public HTML without auth, cookies, user data or network reads", () => {
  const html = renderToStaticMarkup(React.createElement(pageExports.default));
  assert.match(html, /<h1>Privacy Policy<\/h1>/);
  assert.match(html, /dateTime="2026-10-24"/);
  assert.match(html, /Optional Garmin account connection/);
  assert.match(html, /encrypted access\/refresh credentials/);
  assert.match(html, /does not send Garmin-derived information to AI training or evaluation services/);
  assert.match(html, /If cleanup cannot be confirmed/);
  assert.match(html, /foreground location/);
  assert.match(html, /two decimal places/);
  assert.match(html, /Open-Meteo/);
  assert.match(html, /Supabase/);
  assert.match(html, /Vercel/);
  assert.match(html, /href="\/delete-account"/);
  assert.match(html, /<h2>1\. Privacy contact<\/h2>/);
  assert.doesNotMatch(html, /Operator name|Operator:|Operator &amp; contact/);
  assert.match(html, /<a href="mailto:wonghanqian123456@gmail\.com">wonghanqian123456@gmail\.com<\/a>/);
  assert.doesNotMatch(html, /Monitored privacy email or contact URL|genuine privacy contact and/);
  assert.doesNotMatch(source, /readIdentity\(|requireUser\(|cookies\(|fetch\(|redirect\(/);
  assert.equal(pageExports.metadata.alternates.canonical, "https://archery-website.vercel.app/privacy");
  assert.equal(pageExports.metadata.robots.index, true);
  for (const anchor of html.matchAll(/href="#([^"]+)"/g)) assert.ok(html.includes(`id="${anchor[1]}"`));
});

test("Privacy route stays outside auth proxy matching while signed-in routes remain protected", async () => {
  const proxy = await readFile(new URL("../src/proxy.ts", import.meta.url), "utf8");
  const matcher = proxy.slice(proxy.indexOf("matcher:"));
  assert.doesNotMatch(matcher, /privacy|"\/:path\*"/);
  for (const route of ["sessions", "analytics", "organization", "profile", "arrow-counter"]) assert.ok(matcher.includes(`"/${route}/:path*"`));
  const layout = await readFile(new URL("../src/app/(platform)/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /await requireUser\(\)/);
  const panel = await readFile(new URL("../src/features/auth/components/auth-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /<Link href="\/privacy" prefetch={false}>Privacy Policy<\/Link>/);
});

test("Garmin Health disclosures describe the prepared service, processors, owner access and actual cleanup without invented retention", () => {
  const html=renderToStaticMarkup(React.createElement(pageExports.default));
  for(const text of ["Cloudflare","Body Battery","sleep stages","private Health Dashboard","90-day reading window","pending or quarantined","successfully confirmed disconnect","collection remains disabled"])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/This phase connects accounts only|Future health-data synchronization would require/);
  assert.match(html,/Automatic Garmin Health and Activity synchronization is not currently active/);
  assert.match(html,/href="#garmin"/);
});
