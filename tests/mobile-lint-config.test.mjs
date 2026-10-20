import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";

test("mobile lint checks TypeScript and hook dependencies without changing web lint scope", async () => {
  const mobile = new ESLint({ overrideConfigFile: "eslint.mobile.config.mjs" });
  const filePath = "apps/mobile/src/lint-regression.tsx";
  const [result] = await mobile.lintText(`
    import { useEffect } from "react";
    export function Screen({ value }: { value: any }) {
      useEffect(() => { console.log(value); }, []);
      return null;
    }
  `, { filePath });
  assert.ok(result.messages.some(message => message.ruleId === "@typescript-eslint/no-explicit-any"));
  assert.ok(result.messages.some(message => message.ruleId === "react-hooks/exhaustive-deps"));
  assert.ok(!Object.keys((await mobile.calculateConfigForFile(filePath)).rules)
    .some(name => name.startsWith("@next/")));
  assert.equal(await new ESLint().isPathIgnored(filePath), true);
  assert.equal(await mobile.calculateConfigForFile("src/app/layout.tsx"), undefined);
});
