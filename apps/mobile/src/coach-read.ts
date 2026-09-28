import { buildCoachRoundHierarchy, type CoachEndRef } from "@arc-track/core/coach-round";
import { mapSessionDetail, type DbSessionDetail } from "./session-mapper";
import { readCoachAthletes } from "./organizations";
import { supabase } from "./supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COACH_DETAIL_SELECT = `
  id,title,session_date,session_type,arrow_count,created_at,
  session_rounds(id,round_number,name,division,distance_metres,face_diameter_cm,face_type,planned_ends,arrows_per_end,
    session_ends(id,end_number,arrows(id,arrow_number,score_points,is_x,plot_x,plot_y,face_index)))
`;

export async function readCoachSessionDetail(coachId: string, organizationId: string, athleteId: string, sessionId: string) {
  if (![organizationId, athleteId, sessionId].every((id) => UUID.test(id))) return null;
  if (!supabase) throw new Error("Athlete Session could not be loaded.");
  const athletes = await readCoachAthletes(coachId, organizationId);
  if (!athletes?.some((athlete) => athlete.userId === athleteId)) return null;
  const { data, error } = await supabase.from("sessions").select(COACH_DETAIL_SELECT)
    .eq("id", sessionId).eq("user_id", athleteId).maybeSingle();
  if (error) throw new Error("Athlete Session could not be loaded.");
  if (!data) return null;
  const row = data as unknown as DbSessionDetail & { created_at: string; session_rounds: Array<{
    id: string; session_ends: Array<{ id: string; end_number: number }> | null;
  }> };
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
  const rows: Array<{ id: string; session_date: string }> = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("sessions").select("id,session_date")
      .eq("user_id", athleteId).order("session_date", { ascending: false }).order("created_at", { ascending: false })
      .range(offset, offset + 499);
    if (error) throw new Error("Athlete Session navigation could not be loaded.");
    rows.push(...(data ?? []));
    if ((data ?? []).length < 500) break;
  }
  return rows;
}
