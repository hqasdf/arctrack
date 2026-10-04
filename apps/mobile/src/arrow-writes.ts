import type { ArrowEntry } from "@arc-track/core/scoring";
import { arrowWriteFields } from "./arrow-write-model";
import { supabase } from "./supabase";

function client() {
  if (!supabase) throw new Error("Arc Track could not connect to Supabase.");
  return supabase;
}

export async function readRoundEndIds(roundId: string): Promise<Map<number, string>> {
  const { data, error } = await client().from("session_ends")
    .select("id,end_number")
    .eq("session_round_id", roundId)
    .order("end_number");
  if (error) throw new Error("The planned Ends could not be loaded. Check your connection and try again.");
  return new Map((data ?? []).map((row) => [row.end_number, row.id]));
}

export async function saveArrowRecord(entry: ArrowEntry, endId: string, savedId?: string): Promise<string> {
  const fields = arrowWriteFields(entry);
  const { data, error } = await client().rpc("save_owned_arrow", {
    p_session_end_id: endId,
    p_arrow_number: entry.arrow,
    p_score_points: fields.score_points,
    p_is_x: fields.is_x,
    p_plot_x: fields.plot_x,
    p_plot_y: fields.plot_y,
    p_face_index: fields.face_index,
    p_arrow_id: savedId ?? null,
  }).single<{ id: string }>();
  if (error || !data) throw new Error("The Arrow could not be saved. Select it and retry.");
  return data.id;
}

export async function deleteArrowRecord(savedId: string, endId: string): Promise<void> {
  const { data, error } = await client().rpc("delete_owned_arrow", {
    p_session_end_id: endId, p_arrow_number: null, p_arrow_id: savedId,
  });
  if (error || data !== true) throw new Error("The Arrow could not be deleted. Try again.");
}
