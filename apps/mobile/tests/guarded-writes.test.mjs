import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as sessionModel from "../src/session-write-model.ts";
import * as roundConfig from "../src/round-config.ts";
import * as roundUpdate from "../src/round-update-model.ts";
import * as arrowModel from "../src/arrow-write-model.ts";

// Execute the actual persistence adapters with mocked network I/O, rather than
// asserting source text. Any accidental direct table write fails this client.
function runtime(file, responses = []) {
  const calls = [];
  const client = {
    from() { throw new Error("Direct scoring-table access is not part of this mutation test"); },
    rpc(name, args) {
      calls.push({ name, args });
      const response = responses.shift() ?? { data: true, error: null };
      return { single: async () => response, then: (resolve, reject) => Promise.resolve(response).then(resolve, reject) };
    },
  };
  const dependencies = {
    "./supabase": { supabase: client },
    "./session-write-model": sessionModel,
    "./round-config": roundConfig,
    "./round-update-model": roundUpdate,
    "./arrow-write-model": arrowModel,
  };
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)((name) => {
    if (!(name in dependencies)) throw new Error(`Unmocked dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return { ...module.exports, calls };
}

test("mobile Session creation sends no caller-supplied ownership to the guarded RPC", async () => {
  const saved = { id: "session", title: "Practice", session_date: "2026-10-05", session_type: "training", arrow_count: 0 };
  const api = runtime("writes.ts", [{ data: saved, error: null }]);
  const result = await api.createMobileSession("advisory-user-id", { title: "Practice", date: "2026-10-05", sessionType: "training" });
  assert.equal(result.id, "session");
  assert.deepEqual(api.calls, [{ name: "create_owned_session", args: {
    p_title: "Practice", p_session_date: "2026-10-05", p_session_type: "training",
  } }]);
});

test("mobile count, Session delete and Round delete use guarded operations and parent context", async () => {
  const api = runtime("writes.ts", [{ data: { arrow_count: 200 }, error: null }]);
  assert.equal(await api.saveMobileSessionArrowCount("advisory-user", "session", 200), 200);
  await api.deleteMobileSession("advisory-user", "session");
  await api.deleteMobileRound("session", "round");
  assert.deepEqual(api.calls, [
    { name: "update_owned_session_arrow_count", args: { p_session_id: "session", p_arrow_count: 200 } },
    { name: "delete_owned_session", args: { p_session_id: "session" } },
    { name: "delete_owned_round", args: { p_round_id: "round", p_session_id: "session" } },
  ]);
  await assert.rejects(api.saveMobileSessionArrowCount("user", "session", -1), /non-negative whole/);
  assert.equal(api.calls.length, 3);
});

test("Arrow save uses the existing End/number slot and preserves score, plots and expected id", async () => {
  const api = runtime("arrow-writes.ts", [{ data: { id: "saved" }, error: null }, { data: { id: "saved" }, error: null }]);
  const entry = { end: 1, arrow: 2, score: "X", plot: { x: 0.084, y: 0.067, faceIndex: 2 } };
  assert.equal(await api.saveArrowRecord(entry, "end"), "saved");
  assert.equal(await api.saveArrowRecord({ ...entry, score: "9" }, "end", "saved"), "saved");
  assert.deepEqual(api.calls[0], { name: "save_owned_arrow", args: {
    p_session_end_id: "end", p_arrow_number: 2, p_score_points: 10, p_is_x: true,
    p_plot_x: 0.084, p_plot_y: 0.067, p_face_index: 2, p_arrow_id: null,
  } });
  assert.deepEqual(api.calls[1].args, { ...api.calls[0].args, p_score_points: 9, p_is_x: false, p_arrow_id: "saved" });
});

test("cleared plots and misses remain unchanged through the RPC; delete validates End and saved id", async () => {
  const api = runtime("arrow-writes.ts", [{ data: { id: "saved" }, error: null }]);
  await api.saveArrowRecord({ end: 1, arrow: 1, score: "M", plot: null }, "end");
  assert.deepEqual(api.calls[0].args, {
    p_session_end_id: "end", p_arrow_number: 1, p_score_points: 0, p_is_x: false,
    p_plot_x: null, p_plot_y: null, p_face_index: null, p_arrow_id: null,
  });
  await api.deleteArrowRecord("saved", "end");
  assert.deepEqual(api.calls[1], { name: "delete_owned_arrow", args: {
    p_session_end_id: "end", p_arrow_number: null, p_arrow_id: "saved",
  } });
});

test("RPC denials and absent confirmations preserve the existing safe retry/delete errors", async () => {
  const arrows = runtime("arrow-writes.ts", [
    { data: null, error: { code: "42501", message: "private database detail" } },
    { data: false, error: null },
  ]);
  await assert.rejects(arrows.saveArrowRecord({ end: 1, arrow: 1, score: "9", plot: null }, "end"), /^Error: The Arrow could not be saved\. Select it and retry\.$/);
  await assert.rejects(arrows.deleteArrowRecord("arrow", "end"), /Arrow could not be deleted/);
  const sessions = runtime("writes.ts", [{ data: false, error: null }, { data: false, error: null }]);
  await assert.rejects(sessions.deleteMobileSession("user", "session"), /Session could not be deleted/);
  await assert.rejects(sessions.deleteMobileRound("session", "round"), /Round could not be deleted/);
});
