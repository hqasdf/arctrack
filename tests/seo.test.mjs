import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as seo from "../src/lib/seo.ts";

const require = createRequire(import.meta.url);
const link = { __esModule: true, default: ({ children, prefetch, ...props }) => {
  void prefetch;
  return React.createElement("a", props, children);
} };
const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
async function load(path, dependencies = {}) {
  const source = await read(path);
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "@/lib/seo") return seo;
    if (name === "react/jsx-runtime") return require(name);
    if (name.endsWith(".css")) return { __esModule: true, default: {} };
    throw new Error(`Unexpected SEO test dependency: ${name}`);
  }, exports);
  return exports;
}

test("public metadata, sitemap and robots agree in production and block preview environments", async () => {
  const previous = process.env.VERCEL_ENV;
  const robots = (await load("src/app/robots.ts")).default;
  const sitemap = (await load("src/app/sitemap.ts")).default;
  try {
    for (const environment of [undefined, "production", "preview", "development", "staging"]) {
      if (environment === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = environment;
      const allowed = environment === undefined || environment === "production";
      const entries = sitemap();
      assert.deepEqual(entries.map(entry => entry.url), allowed
        ? ["/", "/sign-in", "/privacy", "/delete-account"].map(path => seo.PUBLIC_SITE_URL + path)
        : []);
      assert.ok(entries.every(entry => !Object.hasOwn(entry, "lastModified")));
      for (const path of ["/", "/sign-in", "/privacy", "/delete-account"]) {
        const metadata = seo.publicPageMetadata(path, "Public page", "Public description");
        assert.deepEqual(metadata.robots, { index: allowed, follow: allowed });
        assert.equal(metadata.alternates.canonical, seo.PUBLIC_SITE_URL + path);
        assert.equal(metadata.openGraph.url, metadata.alternates.canonical);
        assert.equal(metadata.openGraph.siteName, "Arc Track");
      }
      if (allowed) {
        assert.equal(robots().rules.allow, "/");
        assert.deepEqual(robots().rules.disallow, ["/api/", "/auth/"]);
        assert.equal(robots().sitemap, `${seo.PUBLIC_SITE_URL}/sitemap.xml`);
      } else {
        assert.deepEqual(robots(), { rules: { userAgent: "*", disallow: "/" } });
      }
    }
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
});

test("anonymous sign-in renders useful public content using the existing authentication panel", async () => {
  const panel = await load("src/features/auth/components/auth-panel.tsx", {
    "next/link": link,
    "@/components/ui/icon": { Icon: () => null },
    "@/lib/auth/config": { getAuthConfig: () => ({}) },
    "./auth-form": { AuthForm: ({ mode }) => React.createElement("form", { "data-auth-mode": mode }) },
    "./verification-form": { VerificationForm: () => null },
  });
  let identity = { user: null };
  const page = await load("src/app/(auth)/sign-in/page.tsx", {
    "next/link": link,
    "next/navigation": { redirect: path => { throw new Error(`redirect:${path}`); } },
    "@/features/auth/components/auth-panel": panel,
    "@/lib/auth/session.server": { readIdentity: async () => identity },
  });
  const html = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({}) }));
  assert.match(html, /<h1[^>]*>Welcome back\.<\/h1>/);
  assert.match(html, /Arc Track is your archery training journal/);
  assert.match(html, /Record Sessions, score Rounds, review shooting performance/);
  assert.match(html, /data-auth-mode="sign-in"/);
  assert.match(html, /<a href="\/"[^>]*aria-label="Arc Track home"/);
  const signup = renderToStaticMarkup(panel.AuthPanel({ title: "Create account", description: "", mode: "sign-up" }));
  assert.match(signup, /<a href="\/sign-in"[^>]*aria-label="Arc Track sign in"/);
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /href="\/forgot-password"/);
  assert.match(html, /href="\/sign-up"/);
  assert.equal(page.metadata.alternates.canonical, `${seo.PUBLIC_SITE_URL}/sign-in`);
  assert.equal(page.metadata.robots.index, true);
  identity = { user: { id: "test-user" } };
  await assert.rejects(page.default({ searchParams: Promise.resolve({}) }), /redirect:\/sessions/);
});

test("public homepage overrides only its metadata while private defaults and guards remain intact", async () => {
  const root = await load("src/app/layout.tsx");
  assert.deepEqual(root.metadata.robots, { index: false, follow: false });
  const redirect = path => { throw new Error(`redirect:${path}`); };
  const home = await load("src/app/page.tsx", {
    "next/link": link,
    "@/components/ui/icon": { Icon: () => null },
    "@/features/home/cinematic-scene": { CinematicScene: () => null },
    "@/features/home/precision-demo": { PrecisionDemo: () => null },
    "@/features/home/coach-showcase": await load("src/features/home/coach-showcase.tsx", { "next/link": link, "@/components/ui/icon": { Icon: () => null } }),
  });
  const html = renderToStaticMarkup(home.default());
  assert.match(html, /EVERY ARROW/);
  assert.match(html, /Coach Dashboard/);
  assert.match(html, /Session feedback/);
  assert.match(home.metadata.description, /coaches athlete analytics/);
  assert.match(html, /href="\/sign-up"/);
  assert.match(html, /href="\/sessions"/);
  assert.equal(home.metadata.robots.index, true);
  assert.equal(home.metadata.alternates.canonical, `${seo.PUBLIC_SITE_URL}/`);
  let shellRendered = false;
  const platform = await load("src/app/(platform)/layout.tsx", {
    "@/lib/auth/session.server": { requireUser: async () => redirect("/sign-in") },
    "@/components/layout/app-shell": { AppShell: () => { shellRendered = true; return null; } },
  });
  await assert.rejects(platform.default({ children: "private content" }), /redirect:\/sign-in/);
  assert.equal(shellRendered, false);
  const proxy = await read("src/proxy.ts");
  assert.match(proxy, /private, no-store, max-age=0/);
  for (const route of ["sessions", "analytics", "arrow-counter", "profile", "organization"]) {
    assert.ok(proxy.includes(`"/${route}/:path*"`));
  }
});
