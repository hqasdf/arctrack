import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function load(result) {
  const source = await readFile(new URL("../src/training-plans-write.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  const modules = {
    "./supabase": { supabase: { rpc: async () => result } },
    "@arc-track/core/training-plan-input": { prepareTrainingPlanInput: () => ({ ok: true, data: {} }) },
  };
  new Function("require", "exports", compiled)((name) => { assert.ok(name in modules, name); return modules[name]; }, exports);
  return exports;
}

test("mobile Training Plan writes sanitize database internals and missing results", async () => {
  for (const error of [null, { code: "XX000", message: "private SQL token secret" },
    { code: "42501", message: "Only an active Head Coach may manage this Training Plan. private SQL" },
    { code: "XX000", message: "Too many requests. Try again shortly." }]) {
    const writer = await load({ data: null, error });
    await assert.rejects(writer.saveMobileTrainingPlan("org", null, {}), { message: "Training Plan could not be saved." });
    await assert.rejects(writer.deleteMobileTrainingPlan("plan"), { message: "Training Plan could not be deleted." });
  }
});

test("mobile Training Plan writes preserve audited business/rate errors and success", async () => {
  for (const [code, message] of [
    ["P0001", "Too many requests. Try again shortly."],
    ["22023", "Select distinct active Archers."],
    ["42501", "Every assignee must be an active Archer in this organisation."],
  ]) {
    const writer = await load({ data: null, error: { code, message } });
    await assert.rejects(writer.saveMobileTrainingPlan("org", null, {}), { message });
    await assert.rejects(writer.deleteMobileTrainingPlan("plan"), { message });
  }
  const writer = await load({ data: "plan", error: null });
  assert.equal(await writer.saveMobileTrainingPlan("org", null, {}), "plan");
  assert.equal(await writer.deleteMobileTrainingPlan("plan"), undefined);
});
