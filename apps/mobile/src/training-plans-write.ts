import { prepareTrainingPlanInput, type TrainingPlanEditorInput } from "@arc-track/core/training-plan-input";
import { supabase } from "./supabase";

export async function saveMobileTrainingPlan(organizationId: string, planId: string | null,
  input: TrainingPlanEditorInput): Promise<string> {
  if (!supabase) throw new Error("Training Plan saving is unavailable.");
  const prepared = prepareTrainingPlanInput(input);
  if (!prepared.ok) throw new Error(prepared.message);
  const plan = prepared.data;
  const { data, error } = await supabase.rpc("save_training_plan", {
    p_plan_id: planId, p_organization_id: organizationId, p_title: plan.title,
    p_start_date: plan.startDate, p_end_date: plan.endDate,
    p_weekly_arrow_target: plan.weeklyArrowTarget, p_note: plan.note,
    p_days: plan.days, p_athlete_user_ids: plan.athleteUserIds,
  });
  if (error || !data) throw new Error(error?.message ?? "Training Plan could not be saved.");
  return data;
}

export async function deleteMobileTrainingPlan(planId: string): Promise<void> {
  if (!supabase) throw new Error("Training Plan deleting is unavailable.");
  const { data, error } = await supabase.rpc("delete_training_plan", { p_plan_id: planId });
  if (error || !data) throw new Error(error?.message ?? "Training Plan could not be deleted.");
}
