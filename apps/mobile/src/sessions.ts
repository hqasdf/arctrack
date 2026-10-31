import {readCompleteSessionHistory} from "@arc-track/core/session-history";
import { supabase } from "./supabase";
import type { SessionDraft } from "@arc-track/core/scoring";
import { mapSessionDetail } from "./session-mapper";

export type MobileSession = {
  id: string;
  title: string;
  date: string;
  type: "training" | "competition";
  arrowCount: number;
};

export async function readOwnSessions(userId: string): Promise<MobileSession[]> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const data=await readCompleteSessionHistory(supabase,userId,{details:false});
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    date: row.session_date,
    type: row.session_type as MobileSession["type"],
    arrowCount: row.arrow_count,
  }));
}

export const SESSION_DETAIL_SELECT = `
  id,title,session_date,session_type,arrow_count,
  session_rounds(id,round_number,name,division,distance_metres,face_diameter_cm,face_type,planned_ends,arrows_per_end,
    session_ends(end_number,arrows(id,arrow_number,score_points,is_x,plot_x,plot_y,face_index)))
`;

export async function readOwnAnalyticsSessions(userId: string): Promise<SessionDraft[]> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const rows=await readCompleteSessionHistory(supabase,userId);
  return rows.map(mapSessionDetail);
}

export async function readOwnSession(userId: string, sessionId: string): Promise<SessionDraft | null> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const rows=await readCompleteSessionHistory(supabase,userId,{session:sessionId});
  return rows[0]?mapSessionDetail(rows[0]):null;
}

export async function readOwnRound(userId: string, roundId: string): Promise<{ session: SessionDraft; round: SessionDraft["rounds"][number] } | null> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.from("session_rounds")
    .select("session_id")
    .eq("id", roundId)
    .maybeSingle();
  if (error) throw new Error("Round could not be loaded.");
  if (!data) return null;
  const session = await readOwnSession(userId, data.session_id);
  const round = session?.rounds.find((item) => item.id === roundId);
  return session && round ? { session, round } : null;
}
