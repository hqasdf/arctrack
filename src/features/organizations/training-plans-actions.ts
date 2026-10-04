"use server";

import { revalidatePath } from "next/cache";
import { prepareTrainingPlanInput, type TrainingPlanEditorInput } from "@arc-track/core/training-plan-input";
import { requireUser } from "@/lib/auth/session.server";
import { createAuthClient } from "@/lib/supabase/server";
import { isUuid } from "@/features/sessions/validation";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

export async function saveTrainingPlan(organizationId: string, planId: string | null,
  input: TrainingPlanEditorInput): Promise<Result<string>> {
  await requireUser();
  if (!isUuid(organizationId) || (planId !== null && !isUuid(planId)))
    return { ok: false, message: "Training Plan could not be identified." };
  const prepared = prepareTrainingPlanInput(input);
  if (!prepared.ok) return prepared;
  const payload = prepared.data;
  try {
    const supabase = await createAuthClient({ writable: true });
    const { data, error } = await supabase.rpc("save_training_plan", {
      p_plan_id: planId, p_organization_id: organizationId, p_title: payload.title,
      p_start_date: payload.startDate, p_end_date: payload.endDate,
      p_weekly_arrow_target: payload.weeklyArrowTarget, p_note: payload.note,
      p_days: payload.days, p_athlete_user_ids: payload.athleteUserIds,
    });
    if (error || !data) return { ok: false, message: error?.message ?? "Training Plan could not be saved." };
    revalidatePath(`/organization/${organizationId}/training-plans`);
    revalidatePath("/sessions");
    return { ok: true, data };
  } catch { return { ok: false, message: "Training Plan saving is temporarily unavailable." }; }
}

export async function deleteTrainingPlan(organizationId: string, planId: string): Promise<Result<null>> {
  await requireUser();
  if (!isUuid(organizationId) || !isUuid(planId))
    return { ok: false, message: "Training Plan could not be identified." };
  try {
    const supabase = await createAuthClient({ writable: true });
    const { data, error } = await supabase.rpc("delete_training_plan", { p_plan_id: planId });
    if (error || !data) return { ok: false, message: error?.message ?? "Training Plan could not be deleted." };
    revalidatePath(`/organization/${organizationId}/training-plans`);
    revalidatePath("/sessions");
    return { ok: true, data: null };
  } catch { return { ok: false, message: "Training Plan deleting is temporarily unavailable." }; }
}
