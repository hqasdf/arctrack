import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { ciScope } from "../scripts/ci-scope.mjs";
import { validateMigrations, checkMigrations } from "../scripts/check-migrations.mjs";
import { validateWorkflow } from "../scripts/check-workflow.mjs";

test("CI scopes web, mobile, core and migration work without running every platform on docs-only changes", () => {
  assert.deepEqual(ciScope(["docs/development.md"]), { web: false, mobile: false, core: false, maintenance: false });
  assert.equal(ciScope(["apps/mobile/src/theme.ts"]).web, false);
  assert.equal(ciScope(["src/features/profile/page.tsx"]).mobile, false);
  assert.equal(ciScope(["packages/core/src/counter-model.ts"]).mobile, true);
  assert.equal(ciScope(["package-lock.json"]).core, true);
  assert.equal(ciScope(["supabase/migrations/new.sql"]).maintenance, true);
  assert.equal(ciScope(["tests/maintenance.test.mjs"]).maintenance, true);
  assert.equal(ciScope(["tests/counter-parity.test.mjs"]).maintenance, true);
  assert.equal(ciScope(["src/odd\nname.tsx"]).web, true);
});
test("migration checks retain existing content and reject duplicate, renamed, retroactive and invalid IDs", () => {
  const file = { name: "20261025003708_example.sql", content: "select 1;\n" };
  const baseline = { historicalAliases: [], migrations: [{ file: file.name, sha256: createHash("sha256").update(file.content).digest("hex") }] };
  assert.equal(validateMigrations([file], baseline).count, 1);
  assert.equal(validateMigrations([{ ...file, content: "select 1;\r\n" }], baseline).count, 1);
  for (const files of [[], [{ ...file, content: "select 2;" }], [{ ...file, name: "20261025003708_renamed.sql" }], [file, { ...file, name: "20261025003708_duplicate.sql" }], [file, { ...file, name: "20261024000000_older.sql" }], [file, { ...file, name: "20260230000000_impossible.sql" }]]) assert.throws(() => validateMigrations(files, baseline));
  assert.equal(validateMigrations([file, { ...file, name: "20261026000000_additive.sql" }], baseline).count, 2);
});
test("canonical local migrations and seven documented historical aliases remain intact", async () => {
  const result = await checkMigrations();
  assert.ok(result.count >= 24); assert.equal(result.historicalAliases, 7);
});
test("workflow parses and keeps actions pinned, tokens read-only and release commands excluded", () => {
  const source = readFileSync(new URL("../.github/workflows/validate.yml", import.meta.url), "utf8");
  const workflow = validateWorkflow(source);
  assert.ok(workflow.on.workflow_dispatch.inputs.full_regression);
  assert.ok(workflow.jobs.mobile.steps.some(step => step.run === "npm run test:essential --workspace @arc-track/mobile"));
  assert.throws(() => validateWorkflow(source.replace("contents: read", "contents: write")));
  assert.throws(() => validateWorkflow(source + "\n# npm publish"));
  assert.throws(() => validateWorkflow(source.replace("persist-credentials: false", "persist-credentials: true")));
});

test("the lint consumer uses patched Zod 4 and rejects oversized invalid collections with bounded errors", () => {
  const require = createRequire(import.meta.url);
  const lintRequire = createRequire(require.resolve("eslint-plugin-react-hooks"));
  const { z } = lintRequire("zod/v4");
  assert.equal(lintRequire("zod/package.json").version, "4.6.6");
  const schema = z.array(z.number()).max(2);
  const invalid = schema.safeParse(Array(1000).fill("invalid"));
  assert.equal(invalid.success, false);
  assert.equal(invalid.error.issues.length, 1);
  const alternative = z.array(z.string()).max(1).safeParse([{}, {}, {}]);
  assert.equal(alternative.success, false); assert.equal(alternative.error.issues.length, 1);
  assert.equal(schema.safeParse([1, 2]).success, true);
  assert.equal(typeof lintRequire("zod-validation-error/v4").fromError(invalid.error).message, "string");
  const expoRequire = createRequire(require.resolve("@expo/cli"));
  assert.equal(expoRequire("zod/package.json").version, "3.25.76", "do not force Expo onto an incompatible Zod major");
});
