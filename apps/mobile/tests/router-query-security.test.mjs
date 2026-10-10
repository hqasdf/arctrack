import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const forksPath = require.resolve("expo-router/build/fork/getStateFromPath-forks.js");
// Exercise the installed Router's real parser, not a replacement app-level guard.
const forks = {};
new Function("require", "exports", readFileSync(forksPath, "utf8"))(name => {
  if (name === "../utils/url") return require("expo-router/build/utils/url.js");
  if (name === "../matchers") return require("expo-router/build/matchers.js");
  return require(name);
}, forks);

test("installed Expo query parser preserves valid route queries and repeated parameters", () => {
  const result = forks.parseQueryParams("/sessions/test?planId=plan-a&name=70%20m&tag=a&tag=b", { name: "sessions" });
  assert.deepEqual({ ...result }, { planId: "plan-a", name: "70 m", tag: ["a", "b"] });
});

test("installed Expo query parser handles malformed percent input without calling the vulnerable decoder", () => {
  const result = forks.parseQueryParams("/sessions?value=" + "%EF%BF%BD%GG".repeat(1000), { name: "sessions" });
  assert.equal(typeof result.value, "string");
  assert.match(result.value, /%GG/);
  const source = readFileSync(forksPath, "utf8");
  assert.doesNotMatch(source, /require\(["'](?:query-string|decode-uri-component)["']\)/);
});
