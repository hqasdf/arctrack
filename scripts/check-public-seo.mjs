import assert from "node:assert/strict";

// Anonymous, read-only verification against a built app or the live public site.
const base = new URL(process.argv[2] ?? "http://127.0.0.1:3100");
const canonicalBase = "https://archery-website.vercel.app";
const publicPaths = ["/", "/sign-in", "/privacy", "/delete-account"];
const agents = {
  browser: "Mozilla/5.0 ArcTrack-SEO-Check",
  Googlebot: "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
};

for (const [agent, userAgent] of Object.entries(agents)) {
  const get = path => fetch(new URL(path, base), {
    redirect: "manual", headers: { "user-agent": userAgent }, signal: AbortSignal.timeout(30000),
  });
  for (const path of publicPaths) {
    const response = await get(path);
    assert.equal(response.status, 200, `${agent} ${path}: HTTP 200`);
    assert.doesNotMatch(response.headers.get("x-robots-tag") ?? "", /noindex|none/i);
    const html = await response.text();
    const robots = [...html.matchAll(/<meta\b[^>]*name="(?:robots|googlebot)"[^>]*>/gi)].map(match => match[0]);
    assert.equal(robots.length, 1, `${path}: one robots directive`);
    assert.match(robots[0], /content="index, follow"/);
    assert.doesNotMatch(robots.join(" "), /noindex|nofollow|none/i);
    // Next normalizes the root canonical to the origin without its trailing slash.
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/);
    const openGraph = html.match(/<meta property="og:url" content="([^"]+)"/);
    assert.ok(canonical && openGraph);
    assert.equal(new URL(canonical[1]).href, new URL(canonicalBase + path).href);
    assert.equal(new URL(openGraph[1]).href, new URL(canonicalBase + path).href);
    if (path === "/sign-in") {
      assert.match(html, /Arc Track is your archery training journal/);
      assert.match(html, /<input[^>]*type="password"/);
      assert.match(html, /href="\/privacy"/);
      assert.match(response.headers.get("cache-control"), /private.*no-store/);
    }
    if (path === "/") {
      assert.match(html, /EVERY ARROW/);
      assert.match(html, /href="\/sign-up"/);
      assert.match(html, /href="\/sessions"/);
      assert.match(html, /Illustrative data/);
      assert.match(html, /Coach Dashboard/);
      assert.match(html, /Session feedback/);
    }
    console.log(`PASS ${agent} ${path}: public HTML, canonical, robots, headers`);
  }
  for (const path of ["/sessions", "/analytics", "/arrow-counter", "/organization", "/profile"]) {
    const response = await get(path);
    assert.equal(response.status, 307, `${path}: anonymous redirect`);
    assert.equal(response.headers.get("location"), "/sign-in");
    assert.match(response.headers.get("cache-control"), /private.*no-store/);
    assert.match(await response.text(), /name="robots" content="noindex, nofollow"/);
  }
  console.log(`PASS ${agent}: all five private-route guards`);
  const robots = await get("/robots.txt");
  assert.equal(robots.status, 200);
  assert.match(robots.headers.get("content-type"), /text\/plain/);
  const rules = await robots.text();
  assert.match(rules, /Allow: \/(?:\r?\n|$)/);
  assert.doesNotMatch(rules, /Disallow: \/(?:\r?\n|$)/);
  assert.ok(rules.includes(`Sitemap: ${canonicalBase}/sitemap.xml`));
  const sitemap = await get("/sitemap.xml");
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.headers.get("content-type"), /(?:application|text)\/xml/);
  const xml = await sitemap.text();
  assert.match(xml, /<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
  assert.deepEqual([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]), publicPaths.map(path => canonicalBase + path));
  assert.doesNotMatch(xml, /<lastmod>/);
  console.log(`PASS ${agent}: robots.txt and canonical-only sitemap XML`);
}
