export type OrganizationEntry =
  | { kind: "coach"; organizationId: string }
  | { kind: "member"; organizationId: string }
  | { kind: "selector" }
  | { kind: "onboarding" };

export function organizationEntry(memberships: ReadonlyArray<{ id: string; role: "head_coach" | "archer" }>): OrganizationEntry {
  const coaches = memberships.filter((item) => item.role === "head_coach");
  if (coaches.length === 1) return { kind: "coach", organizationId: coaches[0].id };
  if (coaches.length > 1) return { kind: "selector" };
  if (memberships.length === 1) return { kind: "member", organizationId: memberships[0].id };
  return { kind: memberships.length ? "selector" : "onboarding" };
}
