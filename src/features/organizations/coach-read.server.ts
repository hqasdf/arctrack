import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session.server";
import { createAuthClient } from "@/lib/supabase/server";
import { mapSession, SESSION_DETAIL_SELECT, type DbSession } from "@/features/sessions/read.server";
import { buildCoachRoundHierarchy, type CoachEndRef, type CoachRoundHierarchy } from "@arc-track/core/coach-round";
import type { SessionDraft } from "@/features/sessions/scoring-model";
import type { CoachAthlete } from "./coach-model";

export type CoachSession = SessionDraft & { userId: string };
export type CoachSessionDetail = { session: CoachSession; createdAt: string; rounds: CoachRoundHierarchy[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COACH_SESSION_SELECT = `user_id,${SESSION_DETAIL_SELECT}`;
const COACH_DETAIL_SELECT = `
  user_id,id,title,session_date,session_type,arrow_count,created_at,
  session_rounds(id,round_number,name,division,distance_metres,face_diameter_cm,face_type,planned_ends,arrows_per_end,
    session_ends(id,end_number,arrows(id,arrow_number,score_points,is_x,plot_x,plot_y,face_index)))
`;

function mapCoachSession(row: DbSession & { user_id: string }): CoachSession {
  return { ...mapSession(row), userId: row.user_id };
}

export const requireCoachOrganization = cache(async (organizationId: string) => {
  if (!UUID.test(organizationId)) notFound();
  const user = await requireUser();
  const supabase = await createAuthClient();
  const { data, error } = await supabase.from("organization_members")
    .select("organization_id,organizations(name)")
    .eq("organization_id", organizationId).eq("user_id", user.id)
    .eq("role", "head_coach").eq("status", "active").maybeSingle();
  if (error) throw new Error("Coach access could not be checked.");
  if (!data?.organizations) notFound();
  const organization = data.organizations as unknown as { name: string };
  return { id: organizationId, name: organization.name };
});

export const readCoachAthletes = cache(async (organizationId: string): Promise<CoachAthlete[]> => {
  await requireCoachOrganization(organizationId);
  const supabase = await createAuthClient();
  const { data, error } = await supabase.rpc("read_coach_athlete_roster", { p_organization_id: organizationId });
  if (error) throw new Error("Athlete roster could not be loaded.");
  return (data ?? []).map((row: {
    user_id: string; display_name: string | null; joined_at: string;
  }) => ({ userId: row.user_id, displayName: row.display_name,
    joinedAt: row.joined_at }));
});

export async function readCoachOrganizationSessions(organizationId: string): Promise<CoachSession[]> {
  const athletes = await readCoachAthletes(organizationId);
  if (athletes.length === 0) return [];
  const supabase = await createAuthClient();
  const rows: (DbSession & { user_id: string })[] = [];
  const ids = athletes.map((athlete) => athlete.userId);
  for (let start = 0; start < ids.length; start += 100) {
    const batch = ids.slice(start, start + 100);
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase.from("sessions").select(COACH_SESSION_SELECT)
        .in("user_id", batch).order("session_date", { ascending: false }).order("created_at", { ascending: false })
        .range(offset, offset + 499);
      if (error) throw new Error("Organisation Sessions could not be loaded.");
      rows.push(...((data ?? []) as unknown as (DbSession & { user_id: string })[]));
      if ((data ?? []).length < 500) break;
    }
  }
  return rows.map(mapCoachSession).sort((a, b) => b.date.localeCompare(a.date));
}

export async function readCoachAthleteSessions(organizationId: string, athleteId: string): Promise<CoachSession[]> {
  if (!UUID.test(athleteId)) notFound();
  const athletes = await readCoachAthletes(organizationId);
  if (!athletes.some((athlete) => athlete.userId === athleteId)) notFound();
  const supabase = await createAuthClient();
  const rows: (DbSession & { user_id: string })[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("sessions").select(COACH_SESSION_SELECT)
      .eq("user_id", athleteId)
      .order("session_date", { ascending: false }).order("created_at", { ascending: false })
      .range(offset, offset + 499);
    if (error) throw new Error("Athlete Sessions could not be loaded.");
    rows.push(...((data ?? []) as unknown as (DbSession & { user_id: string })[]));
    if ((data ?? []).length < 500) break;
  }
  return rows.map(mapCoachSession);
}

export async function readCoachAthleteSessionIndex(organizationId: string, athleteId: string) {
  if (!UUID.test(athleteId)) notFound();
  const athletes = await readCoachAthletes(organizationId);
  if (!athletes.some((athlete) => athlete.userId === athleteId)) notFound();
  const supabase = await createAuthClient();
  const { data, error } = await supabase.from("sessions").select("id,title,session_date")
    .eq("user_id", athleteId).order("session_date", { ascending: false }).order("created_at", { ascending: false });
  if (error) throw new Error("Athlete Session navigation could not be loaded.");
  return data ?? [];
}

export async function readCoachSessionDetail(organizationId: string, athleteId: string, sessionId: string): Promise<CoachSessionDetail | null> {
  if (![athleteId, sessionId].every((id) => UUID.test(id))) notFound();
  const athletes = await readCoachAthletes(organizationId);
  if (!athletes.some((athlete) => athlete.userId === athleteId)) notFound();
  const supabase = await createAuthClient();
  const { data, error } = await supabase.from("sessions").select(COACH_DETAIL_SELECT)
    .eq("id", sessionId).eq("user_id", athleteId).maybeSingle();
  if (error) throw new Error("Athlete Session could not be loaded.");
  if (!data) return null;
  const row = data as unknown as DbSession & { user_id: string; session_rounds: Array<{
    id: string; session_ends: Array<{ id: string; end_number: number }> | null;
  }> };
  const endRefs: CoachEndRef[] = (row.session_rounds ?? []).flatMap((round) =>
    (round.session_ends ?? []).map((end) => ({ roundId: round.id, id: end.id!, endNumber: end.end_number })));
  const session = mapCoachSession(row);
  return { session, createdAt: row.created_at, rounds: buildCoachRoundHierarchy(session, endRefs) };
}

export async function readCoachRoundDetail(organizationId: string, athleteId: string, sessionId: string, roundId: string) {
  if (!UUID.test(roundId)) notFound();
  const detail = await readCoachSessionDetail(organizationId, athleteId, sessionId);
  const selected = detail?.rounds.find(({ round }) => round.id === roundId);
  return detail && selected ? { ...detail, selected } : null;
}
