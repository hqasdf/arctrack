import "server-only";
import { requireUser } from "@/lib/auth/session.server";
import { createAuthClient } from "@/lib/supabase/server";
import { validateArrowInput, type ArrowInput } from "./validation";
import type { ArrowEntry } from "./scoring-model";

type Result = { ok: true; data: ArrowEntry } | { ok: false; message: string };

export async function saveArrowRecord(input: ArrowInput): Promise<Result> {
  await requireUser();
  const valid = validateArrowInput(input);
  if (!valid.ok) return valid;
  try {
    const supabase = await createAuthClient({ writable: true });
    const { data: end, error: endError } = await supabase.from("session_ends")
      .select("id").eq("session_round_id", valid.value.roundId)
      .eq("end_number", valid.value.endNumber).maybeSingle();
    if (endError || !end) return { ok: false, message: "The planned End could not be found." };
    const plot = valid.value.plot;
    const { data: result, error } = await supabase.rpc("save_owned_arrow", {
      p_session_end_id: end.id, p_arrow_number: valid.value.arrowNumber,
      p_score_points: valid.value.scorePoints, p_is_x: valid.value.isX,
      p_plot_x: plot?.x ?? null, p_plot_y: plot?.y ?? null, p_face_index: plot?.faceIndex ?? null,
    }).single();
    const data = result as { id: string; arrow_number: number; score_points: number; is_x: boolean; plot_x: number | null; plot_y: number | null; face_index: number | null } | null;
    if (error || !data) return { ok: false, message: "The Arrow was not saved." };
    return { ok: true, data: {
      id: data.id, end: valid.value.endNumber, arrow: data.arrow_number,
      score: data.is_x ? "X" : data.score_points === 0 ? "M" : String(data.score_points) as ArrowEntry["score"],
      plot: data.plot_x === null || data.plot_y === null ? null : {
        x: data.plot_x, y: data.plot_y,
        ...(data.face_index === null ? {} : { faceIndex: data.face_index as 0 | 1 | 2 }),
      },
      syncState: "saved",
    } };
  } catch {
    return { ok: false, message: "Arrow saving is temporarily unavailable." };
  }
}
