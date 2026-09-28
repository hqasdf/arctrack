"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session.server";
import { createAuthClient } from "@/lib/supabase/server";
import { isUuid } from "@/features/sessions/validation";
import { normalizeJoinCode, validateOrganizationName, type CreateOrganizationInput } from "./validation";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

export async function createOrganization(input: CreateOrganizationInput): Promise<Result<{ id: string; name: string }>> {
  const user = await requireUser();
  const valid = validateOrganizationName(input);
  if (!valid.ok) return { ok: false, message: valid.message };
  try {
    const supabase = await createAuthClient({ writable: true });
    const { data, error } = await supabase.from("organizations")
      .insert({ name: valid.name, created_by: user.id }).select("id,name").single();
    if (error || !data) return { ok: false, message: "The organisation could not be created." };
    revalidatePath("/organization");
    return { ok: true, data: { id: data.id, name: data.name } };
  } catch { return { ok: false, message: "Organisation saving is temporarily unavailable." }; }
}

export async function joinOrganization(codeInput: string): Promise<Result<{ status: "joined" | "already_member"; organizationId: string | null; role: "archer" | "head_coach" | null }>> {
  const user = await requireUser();
  const code = normalizeJoinCode(codeInput);
  if (!code) return { ok: false, message: "Enter a valid 8-character join code." };
  try {
    const supabase = await createAuthClient({ writable: true });
    const { data: before } = await supabase.from("organization_members").select("organization_id")
      .eq("user_id", user.id).eq("status", "active");
    const { data, error } = await supabase.rpc("join_organization_by_code", { p_code: code });
    if (error || (data !== "joined" && data !== "already_member"))
      return { ok: false, message: "The join code is invalid or no longer active." };
    revalidatePath("/organization");
    const { data: after } = await supabase.from("organization_members").select("organization_id,role")
      .eq("user_id", user.id).eq("status", "active");
    const known = new Set((before ?? []).map((item) => item.organization_id));
    const joined = (after ?? []).find((item) => !known.has(item.organization_id));
    return { ok: true, data: { status: data, organizationId: joined?.organization_id ?? null,
      role: joined?.role === "head_coach" ? "head_coach" : joined?.role === "archer" ? "archer" : null } };
  } catch { return { ok: false, message: "Joining is temporarily unavailable." }; }
}

export async function regenerateJoinCode(id: string): Promise<Result<string>> {
  await requireUser();
  if (!isUuid(id)) return { ok: false, message: "The organisation could not be identified." };
  try {
    const supabase = await createAuthClient({ writable: true });
    const { data, error } = await supabase.rpc("regenerate_organization_join_code", { p_organization_id: id });
    if (error || !data) return { ok: false, message: "The join code could not be regenerated." };
    revalidatePath("/organization");
    return { ok: true, data };
  } catch { return { ok: false, message: "Join code updating is temporarily unavailable." }; }
}

export async function leaveOrganization(id: string): Promise<Result<null>> {
  await requireUser();
  if (!isUuid(id)) return { ok: false, message: "The organisation could not be identified." };
  try {
    const supabase = await createAuthClient({ writable: true });
    const { data, error } = await supabase.rpc("leave_organization", { p_organization_id: id });
    if (error || !data) return { ok: false, message: "The organisation could not be left." };
    revalidatePath("/organization");
    return { ok: true, data: null };
  } catch { return { ok: false, message: "Membership updating is temporarily unavailable." }; }
}
