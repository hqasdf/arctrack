import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import * as validation from "../src/features/organizations/validation.ts";

async function loadJoin(result) {
  const calls = [];
  const query = {
    select: () => query, eq: () => query,
    then: (resolve) => Promise.resolve({ data: [] }).then(resolve),
  };
  const client = { from: () => query, rpc: async (name, args) => {
    calls.push({ name, args }); return result;
  } };
  const source = await readFile(new URL("../src/features/organizations/actions.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  const modules = {
    "next/cache": { revalidatePath() {} },
    "@/lib/auth/session.server": { requireUser: async () => ({ id: "caller" }) },
    "@/lib/supabase/server": { createAuthClient: async () => client },
    "@/features/sessions/validation": { isUuid: () => true },
    "./validation": validation,
  };
  new Function("require", "exports", compiled)((name) => {
    assert.ok(name in modules, name); return modules[name];
  }, exports);
  return { join: exports.joinOrganization, calls };
}

test("web join throttle result is a controlled error, never membership success", async () => {
  const writer = await loadJoin({ data: "rate_limited", error: null });
  assert.deepEqual(await writer.join("abcdefgh"), {
    ok: false, message: "Too many join attempts. Try again shortly.",
  });
  assert.deepEqual(writer.calls, [{ name: "join_organization_by_code", args: { p_code: "ABCDEFGH" } }]);
});

test("web normal joining and already-member responses remain unchanged", async () => {
  for (const status of ["joined", "already_member"]) {
    const writer = await loadJoin({ data: status, error: null });
    assert.deepEqual(await writer.join("ABCDEFGH"), {
      ok: true, data: { status, organizationId: null, role: null },
    });
  }
});

test("web failed join remains a clean error and does not expose SQL details", async () => {
  for (const result of [{ data: "invalid_code", error: null }, {
    data: null, error: { message: "private SQL internals", code: "22023" },
  }]) {
    const writer = await loadJoin(result);
    assert.deepEqual(await writer.join("ABCDEFGH"), {
      ok: false, message: "The join code is invalid or no longer active.",
    });
  }
});

// These are preparation/source-contract checks, not PostgreSQL execution.
test("abuse proposal preserves scoring writes, wrappers, RLS and existing grants", async () => {
  const sql = await readFile(new URL("../supabase/proposals/backend_abuse_protection.sql", import.meta.url), "utf8");
  assert.match(sql, /begin;[\s\S]*commit;/);
  assert.doesNotMatch(sql, /(?:create|alter|drop) policy|grant\s+(?:insert|update|delete|all)|create or replace function public\./i);
  assert.doesNotMatch(sql, /create or replace function private\.(?:save_owned_arrow|delete_owned_arrow|delete_owned_round|delete_owned_session|update_owned_session_arrow_count)/i);
  assert.match(sql, /alter table private\.operation_budgets enable row level security/);
  assert.match(sql, /revoke all on table private\.operation_budgets from public, anon, authenticated/);
  assert.match(sql, /revoke all on function private\.consume_operation_budget\(text\) from public, anon, authenticated/);
  assert.match(sql, /primary key \(user_id, operation\)/);
  assert.match(sql, /on conflict \(user_id, operation\) do update/);
});

test("Round create/update share one workload validator; join rejection retains counters", async () => {
  const sql = await readFile(new URL("../supabase/proposals/backend_abuse_protection.sql", import.meta.url), "utf8");
  assert.match(sql, /perform private\.validate_round_workload\(p_planned_ends, p_arrows_per_end\)/);
  assert.match(sql, /perform private\.validate_round_workload\(p_planned_ends, v_arrows_per_end\)/);
  const join = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION private.join_organization_by_code"));
  assert.match(join, /consume_operation_budget\('join_code'\)/);
  assert.match(join, /return 'invalid_code'/);
  assert.match(join, /return 'rate_limited'/);
  assert.doesNotMatch(join, /raise exception 'Invalid join code/);
});

test("prepared database fixture remains rollback-only and rollback restores all six mutations", async () => {
  const fixture = await readFile(new URL("../supabase/tests/backend-abuse-protection.sql", import.meta.url), "utf8");
  const rollback = await readFile(new URL("../supabase/rollback/backend_abuse_protection.sql", import.meta.url), "utf8");
  assert.match(fixture, /begin;[\s\S]*rollback;\s*$/);
  assert.doesNotMatch(fixture, /^commit;/m);
  for (const name of ["create_owned_session", "create_round_with_ends", "update_owned_round_settings",
    "save_training_plan", "regenerate_organization_join_code", "join_organization_by_code"]) {
    assert.ok(rollback.includes("CREATE OR REPLACE FUNCTION private." + name));
  }
  assert.doesNotMatch(rollback, /grant\s|drop .* cascade/i);
  assert.match(rollback, /raise exception 'Invalid join code\.'/);
});

