import {readCompleteSessionHistory} from "@arc-track/core/session-history";
import { buildCoachRoundHierarchy, type CoachEndRef } from "@arc-track/core/coach-round";
import { mapSessionDetail } from "./session-mapper";
import { readCoachAthletes } from "./organizations";
import { supabase } from "./supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readCoachSessionDetail(coachId: string, organizationId: string, athleteId: string, sessionId: string) {
  if (![organizationId, athleteId, sessionId].every((id) => UUID.test(id))) return null;
  if (!supabase) throw new Error("Athlete Session could not be loaded.");
  const athletes = await readCoachAthletes(coachId, organizationId);
  if (!athletes?.some((athlete) => athlete.userId === athleteId)) return null;
  const rows=await readCompleteSessionHistory(supabase,coachId,{organization:organizationId,owner:athleteId,session:sessionId});
  const row=rows[0];if(!row)return null;
  const endRefs: CoachEndRef[] = (row.session_rounds ?? []).flatMap((round) =>
    (round.session_ends ?? []).map((end) => ({ roundId: round.id, id: end.id!, endNumber: end.end_number })));
  const session = mapSessionDetail(row);
  return { session, createdAt: row.created_at, rounds: buildCoachRoundHierarchy(session, endRefs), athlete: athletes.find((item) => item.userId === athleteId)! };
}

export async function readCoachRoundDetail(coachId: string, organizationId: string, athleteId: string, sessionId: string, roundId: string) {
  if (!UUID.test(roundId)) return null;
  const detail = await readCoachSessionDetail(coachId, organizationId, athleteId, sessionId);
  const selected = detail?.rounds.find(({ round }) => round.id === roundId);
  return detail && selected ? { ...detail, selected } : null;
}

export async function readCoachAthleteSessionIndex(coachId: string, organizationId: string, athleteId: string) {
  if (![organizationId, athleteId].every((id) => UUID.test(id))) return null;
  if (!supabase) throw new Error("Athlete Session navigation could not be loaded.");
  const athletes = await readCoachAthletes(coachId, organizationId);
  if (!athletes?.some((athlete) => athlete.userId === athleteId)) return null;
  return readCompleteSessionHistory(supabase,coachId,{organization:organizationId,owner:athleteId,details:false});
}
