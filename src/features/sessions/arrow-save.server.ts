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
    const { data, error } = await supabase.from("arrows").upsert({
      session_end_id: end.id, arrow_number: valid.value.arrowNumber,
      score_points: valid.value.scorePoints, is_x: valid.value.isX,
      plot_x: plot?.x ?? null, plot_y: plot?.y ?? null, face_index: plot?.faceIndex ?? null,
    }, { onConflict: "session_end_id,arrow_number" })
      .select("id,arrow_number,score_points,is_x,plot_x,plot_y,face_index").single();
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
