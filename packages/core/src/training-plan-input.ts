import { trainingPlanDates } from "./training-plan-model.ts";

export type TrainingPlanDayInput = {
  date: string; arrowTarget: string; scoredRoundTarget: string; coachNote: string;
};
export type TrainingPlanEditorInput = {
  title: string; startDate: string; endDate: string; weeklyArrowTarget: string;
  note: string; athleteUserIds: string[]; days: TrainingPlanDayInput[];
};
export type TrainingPlanSavePayload = {
  title: string; startDate: string; endDate: string; weeklyArrowTarget: number | null;
  note: string | null; athleteUserIds: string[];
  days: Array<{ date: string; arrow_target: number | null;
    scored_round_target: number | null; coach_note: string | null }>;
};

function positiveOptional(value: string): number | null | undefined {
  const text = value.trim();
  if (!text) return null;
  if (!/^[1-9]\d*$/.test(text)) return undefined;
  const number = Number(text);
  return Number.isSafeInteger(number) && number <= 2147483647 ? number : undefined;
}

export function prepareTrainingPlanInput(input: TrainingPlanEditorInput):
  { ok: true; data: TrainingPlanSavePayload } | { ok: false; message: string } {
  const title = input.title.trim();
  if (!title || title.length > 120) return { ok: false, message: "Enter a Plan name of up to 120 characters." };
  let dates: string[];
  try { dates = trainingPlanDates(input.startDate, input.endDate); }
  catch { return { ok: false, message: "Enter a valid Start and End date." }; }
  const weeklyArrowTarget = positiveOptional(input.weeklyArrowTarget);
  if (weeklyArrowTarget === undefined) return { ok: false, message: "Weekly Arrow Target must be a positive whole number." };
  if (!input.athleteUserIds.length) return { ok: false, message: "Select at least one active Archer." };
  if (new Set(input.athleteUserIds).size !== input.athleteUserIds.length)
    return { ok: false, message: "Each Archer can be assigned only once." };
  const note = input.note.trim() || null;
  if (note && note.length > 2000) return { ok: false, message: "Overall Coach Note must be at most 2000 characters." };
  const inputDays = new Map(input.days.map((day) => [day.date, day]));
  const days: TrainingPlanSavePayload["days"] = [];
  for (const date of dates) {
    const day = inputDays.get(date);
    const arrowTarget = positiveOptional(day?.arrowTarget ?? "");
    const scoredRoundTarget = positiveOptional(day?.scoredRoundTarget ?? "");
    if (arrowTarget === undefined || scoredRoundTarget === undefined)
      return { ok: false, message: `Enter positive whole-number targets for ${date}, or leave them blank.` };
    const coachNote = day?.coachNote.trim() || null;
    if (coachNote && coachNote.length > 2000)
      return { ok: false, message: `Coach Note for ${date} must be at most 2000 characters.` };
    days.push({ date, arrow_target: arrowTarget, scored_round_target: scoredRoundTarget, coach_note: coachNote });
  }
  return { ok: true, data: { title, startDate: input.startDate, endDate: input.endDate,
    weeklyArrowTarget, note, athleteUserIds: input.athleteUserIds, days } };
}
