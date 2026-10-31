import {readCompleteSessionHistory} from "@arc-track/core/session-history";
import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session.server";
import { createAuthClient } from "@/lib/supabase/server";
import { mapSession, type DbSession } from "@/features/sessions/read.server";
import { buildCoachRoundHierarchy, type CoachEndRef, type CoachRoundHierarchy } from "@arc-track/core/coach-round";
import type { SessionDraft } from "@/features/sessions/scoring-model";
import type { CoachAthlete } from "./coach-model";

export type CoachSession = SessionDraft & { userId: string };
export type CoachSessionDetail = { session: CoachSession; createdAt: string; rounds: CoachRoundHierarchy[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const supabase = await createAuthClient();
  const user=await requireUser();
  const rows=await readCompleteSessionHistory(supabase,user.id,{organization:organizationId,allowedOwners:athletes.map(a=>a.userId)});
  return rows.map(mapCoachSession);
}

export async function readCoachAthleteSessions(organizationId: string, athleteId: string): Promise<CoachSession[]> {
  if (!UUID.test(athleteId)) notFound();
  const athletes = await readCoachAthletes(organizationId);
  if (!athletes.some((athlete) => athlete.userId === athleteId)) notFound();
  const supabase = await createAuthClient();
  const user=await requireUser();
  const rows=await readCompleteSessionHistory(supabase,user.id,{organization:organizationId,owner:athleteId});
  return rows.map(mapCoachSession);
}

export async function readCoachAthleteSessionIndex(organizationId: string, athleteId: string) {
  if (!UUID.test(athleteId)) notFound();
  const athletes = await readCoachAthletes(organizationId);
  if (!athletes.some((athlete) => athlete.userId === athleteId)) notFound();
  const supabase = await createAuthClient();
  const user=await requireUser();
  return readCompleteSessionHistory(supabase,user.id,{organization:organizationId,owner:athleteId,details:false});
}

export async function readCoachSessionDetail(organizationId: string, athleteId: string, sessionId: string): Promise<CoachSessionDetail | null> {
  if (![athleteId, sessionId].every((id) => UUID.test(id))) notFound();
  const athletes = await readCoachAthletes(organizationId);
  if (!athletes.some((athlete) => athlete.userId === athleteId)) notFound();
  const supabase = await createAuthClient();
  const user=await requireUser();
  const rows=await readCompleteSessionHistory(supabase,user.id,{organization:organizationId,owner:athleteId,session:sessionId});
  const row=rows[0];if(!row)return null;
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
