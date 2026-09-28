import "server-only";
import { requireUser } from "@/lib/auth/session.server";
import { createAuthClient } from "@/lib/supabase/server";
import type { OrganizationRole } from "./validation";

export type OwnOrganization = { id: string; name: string; role: OrganizationRole; joinCode: string | null };

export async function readOwnOrganizations(includeJoinCodes = false): Promise<OwnOrganization[]> {
  const user = await requireUser();
  const supabase = await createAuthClient();
  const { data, error } = await supabase.from("organization_members")
    .select("organization_id,role,organizations(id,name)")
    .eq("user_id", user.id).eq("status", "active");
  if (error) throw new Error("Organisations could not be loaded.");
  const memberships = ((data ?? []) as unknown as Array<{
    organization_id: string; role: OrganizationRole; organizations: { id: string; name: string } | null;
  }>).flatMap((row) => row.organizations ? [{ id: row.organization_id, name: row.organizations.name, role: row.role }] : []);
  return Promise.all(memberships.map(async (item) => {
    if (!includeJoinCodes || item.role !== "head_coach") return { ...item, joinCode: null };
    const { data: joinCode, error: codeError } = await supabase.rpc("read_organization_join_code", { p_organization_id: item.id });
    if (codeError || !joinCode) throw new Error("Join code could not be loaded.");
    return { ...item, joinCode };
  }));
}
