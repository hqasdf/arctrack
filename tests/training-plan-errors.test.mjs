import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function load(result, authenticated = true) {
  const source = await readFile(new URL("../src/features/organizations/training-plans-actions.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  let calls = 0;
  const modules = {
    "next/cache": { revalidatePath() {} },
    "@/lib/auth/session.server": { requireUser: async () => { if (!authenticated) throw new Error("unauthenticated"); return { id: "caller" }; } },
    "@/lib/supabase/server": { createAuthClient: async () => ({ rpc: async () => { calls++; return result; } }) },
    "@/features/sessions/validation": { isUuid: () => true },
    "./training-plan-workload": { trainingPlanWorkloadSupported: () => true },
    "@arc-track/core/training-plan-input": { prepareTrainingPlanInput: () => ({ ok: true, data: {} }) },
  };
  new Function("require", "exports", compiled)((name) => { assert.ok(name in modules, name); return modules[name]; }, exports);
  return { exports, calls: () => calls };
}

test("Training Plan writes hide unexpected database errors and missing result details", async () => {
  for (const error of [null, { code: "XX000", message: "SQL private.table password=secret" },
    { code: "42501", message: "Only an active Head Coach may manage this Training Plan. SQL detail" },
    { code: "XX000", message: "Too many requests. Try again shortly." }]) {
    const writer = await load({ data: null, error });
    assert.deepEqual(await writer.exports.saveTrainingPlan("org", null, {}), { ok: false, message: "Training Plan could not be saved." });
    assert.deepEqual(await writer.exports.deleteTrainingPlan("org", "plan"), { ok: false, message: "Training Plan could not be deleted." });
  }
});

test("Training Plan writes preserve audited business and rate-limit messages", async () => {
  for (const [code, message] of [
    ["P0001", "Too many requests. Try again shortly."],
    ["22023", "Select distinct active Archers."],
    ["42501", "Every assignee must be an active Archer in this organisation."],
    ["42501", "Only an active Head Coach may delete this Training Plan."],
  ]) {
    const writer = await load({ data: null, error: { code, message } });
    assert.equal((await writer.exports.saveTrainingPlan("org", null, {})).message, message);
    assert.equal((await writer.exports.deleteTrainingPlan("org", "plan")).message, message);
  }
});

test("Training Plan writes retain success and authenticated-user boundary", async () => {
  const writer = await load({ data: "plan", error: null });
  assert.deepEqual(await writer.exports.saveTrainingPlan("org", null, {}), { ok: true, data: "plan" });
  assert.deepEqual(await writer.exports.deleteTrainingPlan("org", "plan"), { ok: true, data: null });
  const denied = await load({ data: "plan", error: null }, false);
  await assert.rejects(denied.exports.saveTrainingPlan("org", null, {}), /unauthenticated/);
  await assert.rejects(denied.exports.deleteTrainingPlan("org", "plan"), /unauthenticated/);
  assert.equal(denied.calls(), 0);
});
