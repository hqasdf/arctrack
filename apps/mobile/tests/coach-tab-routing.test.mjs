import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const app = fileURLToPath(new URL("../app/", import.meta.url));
const read = (path) => readFileSync(join(app, path), "utf8");

test("Coach pages are nested under the existing Organization tab stack", () => {
  const coachRoutes = [
    "(tabs)/organization/[organizationId].tsx",
    "(tabs)/organization/[organizationId]/athletes/index.tsx",
    "(tabs)/organization/[organizationId]/reviews.tsx",
    "(tabs)/organization/[organizationId]/analytics.tsx",
    "(tabs)/organization/[organizationId]/settings.tsx",
    "(tabs)/organization/[organizationId]/athletes/[userId].tsx",
    "(tabs)/organization/[organizationId]/athletes/[userId]/sessions/[sessionId].tsx",
    "(tabs)/organization/[organizationId]/athletes/[userId]/sessions/[sessionId]/rounds/[roundId].tsx",
  ];
  for (const path of coachRoutes) assert.ok(existsSync(join(app, path)), `${path} is inside the tab group`);
  assert.ok(!existsSync(join(app, "organization")), "no duplicate root Coach route tree remains");
  const root = read("_layout.tsx");
  assert.ok(!root.includes('name="organization/[organizationId]"'));
  assert.ok(!root.includes('name="organization/[organizationId]/athletes'));
});

test("main tabs and Coach sections keep their intended order", () => {
  const tabs = read("(tabs)/_layout.tsx");
  const names = [...tabs.matchAll(/<Tabs\.Screen name="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(names, ["sessions", "counter", "analytics", "organization", "profile"]);
  const coachNav = readFileSync(join(app, "../src/coach-ui.tsx"), "utf8");
  assert.match(coachNav, /\["overview", "athletes", "reviews", "analytics", "settings"\]/);
});
