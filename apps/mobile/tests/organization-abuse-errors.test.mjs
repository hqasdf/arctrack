import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import * as model from "../src/organization-model.ts";

async function loadJoin(result) {
  const calls = [];
  const source = await readFile(new URL("../src/organizations.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  const modules = {
    "./supabase": { supabase: { rpc: async (name, args) => { calls.push({ name, args }); return result; } } },
    "./session-mapper": {}, "./sessions": {}, "./organization-model": model,
  };
  new Function("require", "exports", compiled)((name) => {
    assert.ok(name in modules, name); return modules[name];
  }, exports);
  return { join: exports.joinOrganization, calls };
}

test("mobile join handles throttle, normal results, and invalid code without leaking internals", async () => {
  const blocked = await loadJoin({ data: "rate_limited", error: null });
  await assert.rejects(blocked.join("abcdefgh"), { message: "Too many join attempts. Try again shortly." });
  assert.deepEqual(blocked.calls, [{ name: "join_organization_by_code", args: { p_code: "ABCDEFGH" } }]);
  for (const status of ["joined", "already_member"]) {
    const writer = await loadJoin({ data: status, error: null });
    assert.equal(await writer.join("ABCDEFGH"), status);
  }
  for (const result of [{ data: "invalid_code", error: null },
    { data: null, error: { message: "private SQL internals" } }]) {
    const writer = await loadJoin(result);
    await assert.rejects(writer.join("ABCDEFGH"), { message: "The join code is invalid or no longer active." });
  }
});

