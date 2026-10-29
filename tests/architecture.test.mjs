import test from "node:test";
import assert from "node:assert/strict";
import { checkArchitecture, moduleReferences, validateArchitecture } from "../scripts/check-architecture.mjs";

const validate = entries => validateArchitecture(new Map(entries), { ".": "./src/index.ts", "./scoring": "./src/scoring.ts" });
test("architecture: real source boundaries and core runtime graph", async () => {
  assert.ok((await checkArchitecture()).files > 100);
});
test("architecture: platform adapters may consume public core exports", () => {
  assert.deepEqual(validate([["src/features/scoring.ts", 'export * from "@arc-track/core/scoring";'],
    ["apps/mobile/src/scoring.ts", 'import type { Score } from "@arc-track/core/scoring";'],
    ["packages/core/src/scoring.ts", "export type Score = number;"]]), []);
});
test("architecture: core rejects platform, framework and infrastructure dependencies including type imports", () => {
  for (const dependency of ["react", "react-native", "node:fs", "@supabase/supabase-js", "../../../src/lib/auth", "@/lib/auth"]) {
    assert.ok(validate([["packages/core/src/a.ts", `import type { X } from "${dependency}";`]]).length);
  }
});
test("architecture: cross-platform imports, reverse route dependencies and undeclared exports fail", () => {
  for (const [file, dependency] of [["src/a.ts", "../apps/mobile/src/a"], ["apps/mobile/src/a.ts", "../../../src/a"],
    ["src/features/a.ts", "@/app/actions"], ["src/a.ts", "@arc-track/core/secret"]]) {
    assert.ok(validate([[file, `export * from "${dependency}";`]]).length);
  }
});
test("architecture: runtime cycles fail; type-only cycles are allowed", () => {
  const a = "packages/core/src/a.ts", b = "packages/core/src/b.ts";
  assert.ok(validate([[a, 'export * from "./b.ts";'], [b, 'import("./a.ts");']]).some(error => error.includes("cycle")));
  assert.deepEqual(validate([[a, 'import type { B } from "./b.ts";'], [b, 'import { type A } from "./a.ts";']]), []);
});
test("architecture: syntax parsing ignores comments and string contents and covers dynamic imports", () => {
  assert.deepEqual(moduleReferences('// import "bad";\nconst text = \'require("bad")\';\nimport("good");'), [{ specifier: "good", runtime: true }]);
});
