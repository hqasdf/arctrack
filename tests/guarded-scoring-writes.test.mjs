import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import * as validation from "../src/features/sessions/validation.ts";

const id = "123e4567-e89b-42d3-a456-426614174000";

async function loadWriter(file, responses) {
  const calls = [];
  let authentications = 0;
  const client = {
    from(table) {
      assert.equal(table, "session_ends", "only the existing End read remains a direct query");
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id }, error: null }) };
      return query;
    },
    rpc(name, args) {
      calls.push({ name, args });
      const result = responses.shift();
      assert.ok(result, "unexpected extra persistence call");
      return Object.assign(Promise.resolve(result), { single: async () => result });
    },
  };
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  const modules = {
    "server-only": {}, "next/cache": { revalidatePath() {} },
    "@/lib/auth/session.server": { requireUser: async () => { authentications++; return { id: "never-send-this-user-id" }; } },
    "@/lib/supabase/server": { createAuthClient: async () => client },
    "./validation": validation, "./arrow-save.server": { saveArrowRecord() {} },
  };
  new Function("require", "exports", compiled)((name) => {
    assert.ok(name in modules, `unexpected dependency ${name}`);
    return modules[name];
  }, exports);
  return { exports, calls, authentications: () => authentications };
}

test("web Session/Round mutations call narrow RPCs without a browser-supplied owner", async () => {
  const row = { id, title: "Practice", session_date: "2026-10-05", session_type: "training", arrow_count: 0 };
  const writer = await loadWriter("../src/features/sessions/actions.ts", [
    { data: row }, { data: { arrow_count: 200 } }, { data: true }, { data: true }, { data: false },
  ]);
  assert.equal((await writer.exports.createSession({ title: "Practice", date: row.session_date, sessionType: "training" })).ok, true);
  assert.deepEqual(await writer.exports.updateSessionArrowCount({ sessionId: id, arrowCount: 200 }), { ok: true, data: 200 });
  assert.equal((await writer.exports.deleteRound(id)).ok, true);
  assert.equal((await writer.exports.deleteSession(id)).ok, true);
  assert.equal((await writer.exports.deleteSession(id)).ok, false);
  assert.deepEqual(writer.calls.map(({ name }) => name), ["create_owned_session", "update_owned_session_arrow_count", "delete_owned_round", "delete_owned_session", "delete_owned_session"]);
  assert.deepEqual(writer.calls[0].args, { p_title: "Practice", p_session_date: row.session_date, p_session_type: "training" });
  assert.equal(writer.authentications(), 5);
  assert.equal(JSON.stringify(writer.calls).includes("never-send-this-user-id"), false);
});

test("web Arrow RPC confirmation preserves score, slot and exact original plot coordinates", async () => {
  const plot = { x: 0.084, y: 0.067, faceIndex: 1 };
  const writer = await loadWriter("../src/features/sessions/arrow-save.server.ts", [
    { data: { id, arrow_number: 2, score_points: 10, is_x: true, plot_x: plot.x, plot_y: plot.y, face_index: 1 } },
    { data: null, error: { code: "42501" } },
  ]);
  const input = { roundId: id, endNumber: 1, arrowNumber: 2, score: "X", plot };
  const result = await writer.exports.saveArrowRecord(input);
  assert.deepEqual(result, { ok: true, data: { id, end: 1, arrow: 2, score: "X", plot, syncState: "saved" } });
  assert.deepEqual(writer.calls[0], { name: "save_owned_arrow", args: { p_session_end_id: id, p_arrow_number: 2, p_score_points: 10, p_is_x: true, p_plot_x: plot.x, p_plot_y: plot.y, p_face_index: 1 } });
  assert.deepEqual(await writer.exports.saveArrowRecord(input), { ok: false, message: "The Arrow was not saved." });
});

test("web Arrow deletion remains slot-based and validation rejects bad input before persistence", async () => {
  const writer = await loadWriter("../src/features/sessions/actions.ts", [{ data: false }]);
  assert.equal((await writer.exports.removeArrow({ roundId: id, endNumber: 1, arrowNumber: 2 })).ok, true);
  assert.deepEqual(writer.calls, [{ name: "delete_owned_arrow", args: { p_session_end_id: id, p_arrow_number: 2 } }]);
  assert.equal((await writer.exports.updateSessionArrowCount({ sessionId: id, arrowCount: -1 })).ok, false);
  assert.equal(writer.calls.length, 1);
});

test("web and Expo application code cannot reintroduce direct scoring table mutations", async () => {
  const protectedTables = new Set(["sessions", "session_rounds", "session_ends", "arrows"]);
  const mutations = new Set(["insert", "upsert", "update", "delete"]);
  const violations = [];
  for (const root of ["../src/", "../apps/mobile/src/", "../apps/mobile/app/"]) {
    const base = new URL(root, import.meta.url);
    for (const file of await readdir(base, { recursive: true })) {
      if (!/\.tsx?$/.test(file)) continue;
      const text = await readFile(new URL(file.replaceAll("\\", "/"), base), "utf8");
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      function visit(node) {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && mutations.has(node.expression.name.text)) {
          let receiver = node.expression.expression;
          while (ts.isCallExpression(receiver) && ts.isPropertyAccessExpression(receiver.expression)) {
            if (receiver.expression.name.text === "from") {
              const table = receiver.arguments[0];
              // A dynamic table name cannot prove that it avoids protected tables.
              if (!table || !ts.isStringLiteral(table) || protectedTables.has(table.text)) {
                violations.push(`${root}${file}: ${node.getText(source)}`);
              }
              break;
            }
            receiver = receiver.expression.expression;
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  assert.deepEqual(violations, []);
});
