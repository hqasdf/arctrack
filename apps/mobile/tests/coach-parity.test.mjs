import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = (path) => readFileSync(new URL(`../app/(tabs)/organization/${path}`, import.meta.url), "utf8");
const parse = (text) => ts.createSourceFile("screen.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findNode(root, predicate) {
  if (predicate(root)) return root;
  return ts.forEachChild(root, (node) => findNode(node, predicate));
}

test("directory sorts names and latest Session dates without mutating the roster", () => {
  const tree = parse(source("[organizationId]/athletes/index.tsx"));
  const declaration = findNode(tree, (node) => ts.isVariableDeclaration(node) && node.name.getText(tree) === "shown");
  const expression = declaration.initializer.getText(tree);
  const compiled = ts.transpileModule(`exports.run = () => ${expression};`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const rows = [
    { name: "Zoe", latestSession: { date: "2026-10-20" } },
    { name: "Amy", latestSession: { date: "2026-10-20" } },
    { name: "Ben", latestSession: null },
  ];
  function sorted(sort) {
    const exports = {};
    new Function("exports", "filterCoachDirectory", "result", "search", "division", "activity", "sort", compiled)(exports, (items) => items.filter(() => true), { perAthlete: rows }, "", "all", "all", sort);
    return exports.run().map((item) => item.name);
  }
  assert.deepEqual(sorted("name"), ["Amy", "Ben", "Zoe"]);
  assert.deepEqual(sorted("recent"), ["Amy", "Zoe", "Ben"]);
  assert.deepEqual(rows.map((item) => item.name), ["Zoe", "Amy", "Ben"]);
});

test("Settings shares only a real available join code and handles native share failures", async () => {
  const tree = parse(source("[organizationId]/settings.tsx"));
  const declaration = findNode(tree, (node) => ts.isFunctionDeclaration(node) && node.name?.text === "shareCode");
  const compiled = ts.transpileModule(`${declaration.getText(tree)}; exports.run = shareCode;`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const calls = [], errors = [];
  async function run(item, busy = false, fails = false) {
    const exports = {};
    new Function("exports", "item", "busy", "setError", "Share", compiled)(exports, item, busy, (error) => errors.push(error), { share: async (payload) => { if (fails) throw new Error("native failure"); calls.push(payload); } });
    await exports.run();
  }
  await run({ name: "Club", joinCode: "AB7K4M2Q" });
  assert.deepEqual(calls, [{ message: "Club join code: AB7K4M2Q" }]);
  await run({ name: "Club", joinCode: null });
  await run({ name: "Club", joinCode: "AB7K4M2Q" }, true);
  assert.equal(calls.length, 1);
  await run({ name: "Club", joinCode: "AB7K4M2Q" }, false, true);
  assert.equal(errors.at(-1), "The join code could not be shared. Select the code to copy it.");
});

test("overview distribution uses existing scored data and Settings preserves athlete route context", () => {
  const overview = source("[organizationId].tsx");
  assert.match(overview, /title="Score Distribution"/);
  assert.match(overview, /result\.summary\.scoredArrowCount \? <CoachBars axis="Scored Arrows" points=\{result\.distribution\.map/);
  assert.match(overview, /Keyed Session Arrow counts across active Archers/);
  const settings = source("[organizationId]/settings.tsx");
  assert.match(settings, /pathname: "\/organization\/\[organizationId\]\/athletes\/\[userId\]", params: \{ organizationId: item\.id, userId: athlete\.userId \}/);
  assert.match(settings, /athlete\.joinedAt\.slice\(0, 10\)/);
});
