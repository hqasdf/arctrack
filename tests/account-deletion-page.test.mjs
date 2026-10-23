import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";
import * as seo from "../src/lib/seo.ts";

const source = await readFile(new URL("../src/app/delete-account/page.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;

async function renderPage(identity) {
  const emails = [], pageExports = {};
  new Function("require", "exports", compiled)(name => {
    if (name === "@/lib/seo") return seo;
    if (name === "next/link") return { __esModule: true, default: ({ prefetch, ...props }) => { void prefetch; return React.createElement("a", props); } };
    if (name === "react/jsx-runtime") return jsx;
    if (name === "@/lib/auth/session.server") return { readIdentity: async () => identity };
    if (name === "@/features/profile/components/account-deletion-form") return { AccountDeletionForm: ({ email }) => { emails.push(email); return React.createElement("div", { "data-existing-deletion-form": true }); } };
    if (name.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
    throw new Error(`Unexpected account-deletion page dependency: ${name}`);
  }, pageExports);
  return { html: renderToStaticMarkup(await pageExports.default()), emails, metadata: pageExports.metadata };
}

test("signed-out deletion page exposes instructions and retention details without login or app installation", async () => {
  const { html, emails, metadata } = await renderPage({ user: null, unavailable: false });
  assert.deepEqual(emails, [null]);
  assert.match(html, /Delete your Arc Track account/);
  assert.match(html, /From the Arc Track app/);
  assert.match(html, /Without installing or opening the app/);
  assert.match(html, /current password/);
  assert.match(html, /Permanently delete my account/);
  assert.match(html, /<a href="mailto:wonghanqian123456@gmail\.com">wonghanqian123456@gmail\.com<\/a>/);
  assert.doesNotMatch(html, /Monitored account-deletion support email or contact URL|Contact details and retention information/);
  assert.match(html, /Shared organisations, Training Plans and plan days remain/);
  assert.match(html, /retention reasons and periods/);
  assert.match(html, /no scheduled waiting period/);
  assert.match(html, /href="\/privacy"/);
  assert.doesNotMatch(html, /@example\./);
  assert.equal(metadata.alternates.canonical, "https://archery-website.vercel.app/delete-account");
  assert.doesNotMatch(source, /requireUser\(|redirect\(|createAdminClient\(|deleteUser\(/);
});

test("signed-in page preserves the existing identity-to-form contract", async () => {
  const { html, emails } = await renderPage({ user: { email: "owner@example.invalid" }, unavailable: false });
  assert.deepEqual(emails, ["owner@example.invalid"]);
  assert.equal((html.match(/data-existing-deletion-form/g) ?? []).length, 1);
  assert.match(html, /Account deletion options/);
});

test("public instructions remain visible when account verification is unavailable", async () => {
  const { html, emails } = await renderPage({ user: null, unavailable: true });
  assert.deepEqual(emails, [null]);
  assert.match(html, /role="alert"/);
  assert.match(html, /Account verification is temporarily unavailable/);
  assert.match(html, /Contact for deletion requests/);
  assert.match(html, /Data removed when deletion succeeds/);
});

test("account-deletion route stays public and existing app routes remain protected", async () => {
  const proxy = await readFile(new URL("../src/proxy.ts", import.meta.url), "utf8");
  const matcher = proxy.slice(proxy.indexOf("matcher:"));
  assert.doesNotMatch(matcher, /delete-account|"\/:path\*"/);
  for (const route of ["sessions", "profile", "organization", "analytics", "arrow-counter"]) assert.ok(matcher.includes(`"/${route}/:path*"`));
  const layout = await readFile(new URL("../src/app/(platform)/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /await requireUser\(\)/);
});
