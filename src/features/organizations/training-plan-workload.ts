import type { TrainingPlanEditorInput } from "@arc-track/core/training-plan-input";

// Mirrors the authoritative private.save_training_plan proposal.
// Check before prepareTrainingPlanInput expands calendar days on the server.
export const MAX_TRAINING_PLAN_DAYS = 366;
export const MAX_TRAINING_PLAN_ASSIGNMENTS = 1000;

export function trainingPlanWorkloadSupported(input: TrainingPlanEditorInput): boolean {
  if (!input || !Array.isArray(input.days) || input.days.length > MAX_TRAINING_PLAN_DAYS
    || !Array.isArray(input.athleteUserIds) || input.athleteUserIds.length > MAX_TRAINING_PLAN_ASSIGNMENTS)
    return false;
  const dates = [input.startDate, input.endDate];
  if (dates.some((date) => typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || date < "0001-01-01" || date > "9999-12-31")) return false;
  const [start, end] = dates.map((date) => Date.parse(date + "T00:00:00Z"));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (new Date(start).toISOString().slice(0, 10) !== input.startDate
    || new Date(end).toISOString().slice(0, 10) !== input.endDate) return false;
  const days = (end - start) / 86400000 + 1;
  return days >= 1 && days <= MAX_TRAINING_PLAN_DAYS;
}

