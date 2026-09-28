import type { SessionDraft } from "@arc-track/core/scoring";
import { mapSessionDetail, type DbSessionDetail } from "./session-mapper";
import { SESSION_DETAIL_SELECT } from "./sessions";
import { supabase } from "./supabase";
import { mapCoachRoster, mapOwnOrganizations, normalizeJoinCode, type CoachAthlete, type OwnOrganization } from "./organization-model";
export { athleteLabel, mapCoachRoster, mapOwnOrganizations, normalizeJoinCode } from "./organization-model";
export type { CoachAthlete, OwnOrganization } from "./organization-model";

export async function readOwnOrganizations(userId: string, includeJoinCodes = false): Promise<OwnOrganization[]> {
  if (!supabase) throw new Error("Organisations could not be loaded.");
  const { data, error } = await supabase.from("organization_members")
    .select("organization_id,role,organizations(name)").eq("user_id", userId).eq("status", "active");
  if (error) throw new Error("Organisations could not be loaded.");
  const organizations = mapOwnOrganizations((data ?? []) as unknown as Parameters<typeof mapOwnOrganizations>[0]);
  const client = supabase;
  return Promise.all(organizations.map(async (item) => {
    if (item.role !== "head_coach" || !includeJoinCodes) return item;
    const { data: code, error: codeError } = await client.rpc("read_organization_join_code", { p_organization_id: item.id });
    return { ...item, joinCode: codeError || typeof code !== "string" ? null : code };
  }));
}
export async function createOrganization(userId: string, nameInput: string) {
  if (!supabase) throw new Error("Organisation saving is unavailable.");
  const name = nameInput.trim();
  if (!name || Array.from(name).length > 120) throw new Error("Enter an organisation name of up to 120 characters.");
  const { data, error } = await supabase.from("organizations").insert({ name, created_by: userId }).select("id,name").single();
  if (error || !data) throw new Error("The organisation could not be created.");
  return { id: data.id, name: data.name };
}
export async function joinOrganization(codeInput: string): Promise<"joined" | "already_member"> {
  if (!supabase) throw new Error("Joining is unavailable.");
  const code = normalizeJoinCode(codeInput);
  if (!code) throw new Error("Enter a valid 8-character join code.");
  const { data, error } = await supabase.rpc("join_organization_by_code", { p_code: code });
  if (error || (data !== "joined" && data !== "already_member")) throw new Error("The join code is invalid or no longer active.");
  return data;
}
export async function leaveOrganization(id: string) {
  if (!supabase) throw new Error("Membership updating is unavailable.");
  const { data, error } = await supabase.rpc("leave_organization", { p_organization_id: id });
  if (error || data !== true) throw new Error("The organisation could not be left.");
}
export async function regenerateJoinCode(id: string) {
  if (!supabase) throw new Error("Join code updating is unavailable.");
  const { data, error } = await supabase.rpc("regenerate_organization_join_code", { p_organization_id: id });
  if (error || typeof data !== "string") throw new Error("The join code could not be regenerated.");
  return data;
}

export async function readCoachOrganization(userId: string, organizationId: string) {
  if (!supabase) throw new Error("Coach access could not be checked.");
  const { data, error } = await supabase.from("organization_members")
    .select("organization_id,organizations(name)").eq("organization_id", organizationId)
    .eq("user_id", userId).eq("status", "active").eq("role", "head_coach").maybeSingle();
  if (error) throw new Error("Coach access could not be checked.");
  if (!data?.organizations) return null;
  return { id: organizationId, name: (data.organizations as unknown as { name: string }).name };
}
export async function readCoachAthletes(userId: string, organizationId: string): Promise<CoachAthlete[] | null> {
  if (!supabase) throw new Error("Athlete roster could not be loaded.");
  if (!await readCoachOrganization(userId, organizationId)) return null;
  const { data, error } = await supabase.rpc("read_coach_athlete_roster", { p_organization_id: organizationId });
  if (error) throw new Error("Athlete roster could not be loaded.");
  return mapCoachRoster(data ?? []);
}
export async function readCoachAthleteSessions(userId: string, organizationId: string, athleteId: string, knownAthletes?: CoachAthlete[]): Promise<SessionDraft[] | null> {
  if (!supabase) throw new Error("Athlete Sessions could not be loaded.");
  const athletes = knownAthletes ?? await readCoachAthletes(userId, organizationId);
  if (!athletes?.some((athlete) => athlete.userId === athleteId)) return null;
  const rows: DbSessionDetail[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("sessions").select(SESSION_DETAIL_SELECT)
      .eq("user_id", athleteId).order("session_date", { ascending: false }).order("created_at", { ascending: false })
      .range(offset, offset + 499);
    if (error) throw new Error("Athlete Sessions could not be loaded.");
    rows.push(...((data ?? []) as unknown as DbSessionDetail[]));
    if ((data ?? []).length < 500) break;
  }
  return rows.map(mapSessionDetail);
}

export async function readCoachOrganizationSessions(userId: string, organizationId: string, knownAthletes?: CoachAthlete[]): Promise<Array<SessionDraft & { userId: string; createdAt: string }> | null> {
  if (!supabase) throw new Error("Organisation Sessions could not be loaded.");
  const athletes = knownAthletes ?? await readCoachAthletes(userId, organizationId);
  if (athletes === null) return null;
  if (athletes.length === 0) return [];
  const rows: Array<DbSessionDetail & { user_id: string; created_at: string }> = [];
  const ids = athletes.map((athlete) => athlete.userId);
  for (let start = 0; start < ids.length; start += 100) {
    const batch = ids.slice(start, start + 100);
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase.from("sessions").select(`user_id,created_at,${SESSION_DETAIL_SELECT}`)
        .in("user_id", batch).order("session_date", { ascending: false }).order("created_at", { ascending: false })
        .range(offset, offset + 499);
      if (error) throw new Error("Organisation Sessions could not be loaded.");
      rows.push(...((data ?? []) as unknown as Array<DbSessionDetail & { user_id: string; created_at: string }>));
      if ((data ?? []).length < 500) break;
    }
  }
  return rows.map((row) => ({ ...mapSessionDetail(row), userId: row.user_id, createdAt: row.created_at }))
    .sort((a, b) => b.date.localeCompare(a.date));
}
