import assert from "node:assert/strict";
import test from "node:test";
import { organizationEntry } from "../src/organization-entry.ts";

test("one active Coach membership opens its workspace", () => {
  assert.deepEqual(organizationEntry([{ id: "a", role: "head_coach" }]), { kind: "coach", organizationId: "a" });
  assert.deepEqual(organizationEntry([{ id: "a", role: "head_coach" }, { id: "b", role: "archer" }]), { kind: "coach", organizationId: "a" });
});
test("multiple Coach memberships require explicit selection", () => {
  assert.deepEqual(organizationEntry([{ id: "a", role: "head_coach" }, { id: "b", role: "head_coach" }]), { kind: "selector" });
});
test("Archer membership stays in member experience", () => {
  assert.deepEqual(organizationEntry([{ id: "a", role: "archer" }]), { kind: "member", organizationId: "a" });
  assert.deepEqual(organizationEntry([{ id: "a", role: "archer" }, { id: "b", role: "archer" }]), { kind: "selector" });
});
test("no active membership shows onboarding", () => {
  assert.deepEqual(organizationEntry([]), { kind: "onboarding" });
});
