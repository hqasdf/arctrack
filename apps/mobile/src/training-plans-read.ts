import { calculateTrainingPlanProgress, type TrainingPlanDefinition,
  type TrainingPlanSession } from "@arc-track/core/training-plan";
import { readCoachAthletes } from "./organizations";
import { supabase } from "./supabase";

type PlanRow = {
  id: string; organization_id: string; title: string; note: string | null;
  start_date: string; end_date: string; weekly_arrow_target: number | null;
  training_plan_days: Array<{ date: string; arrow_target: number | null;
    scored_round_target: number | null; coach_note: string | null }> | null;
  training_plan_assignments: Array<{ athlete_user_id: string }> | null;
};
type SessionRow = {
  id: string; user_id: string; session_date: string; arrow_count: number | null;
  session_rounds: Array<{ id: string; planned_ends: number; arrows_per_end: number;
    session_ends: Array<{ end_number: number; arrows: Array<{ id: string }> | null }> | null }> | null;
};
const PLAN_SELECT = `id,start_date,end_date,weekly_arrow_target,
  organization_id,title,note,
  training_plan_days(date,arrow_target,scored_round_target,coach_note),
  training_plan_assignments(athlete_user_id)`;
const SESSION_SELECT = `id,user_id,session_date,arrow_count,
  session_rounds(id,planned_ends,arrows_per_end,
    session_ends(end_number,arrows(id)))`;

export type MobileTrainingPlan = TrainingPlanDefinition & {
  organizationId: string; title: string; note: string | null; assignedUserIds: string[];
};
function mapPlan(row: PlanRow): MobileTrainingPlan {
  return { id: row.id, organizationId: row.organization_id, title: row.title, note: row.note,
    assignedUserIds: (row.training_plan_assignments ?? []).map((item) => item.athlete_user_id),
    startDate: row.start_date, endDate: row.end_date,
    weeklyArrowTarget: row.weekly_arrow_target,
    days: (row.training_plan_days ?? []).map((day) => ({ date: day.date,
      arrowTarget: day.arrow_target, scoredRoundTarget: day.scored_round_target,
      coachNote: day.coach_note })).sort((a, b) => a.date.localeCompare(b.date)) };
}

export async function readMobileCoachTrainingPlans(coachId: string, organizationId: string) {
  if (!supabase) throw new Error("Training Plans could not be loaded.");
  if (await readCoachAthletes(coachId, organizationId) === null) return null;
  const { data, error } = await supabase.from("training_plans").select(PLAN_SELECT)
    .eq("organization_id", organizationId).order("start_date", { ascending: false });
  if (error) throw new Error("Training Plans could not be loaded.");
  return ((data ?? []) as unknown as PlanRow[]).map(mapPlan);
}
function mapSession(row: SessionRow): TrainingPlanSession {
  return { id: row.id, userId: row.user_id, date: row.session_date,
    arrowCount: row.arrow_count,
    rounds: (row.session_rounds ?? []).map((round) => ({ id: round.id,
      plannedEnds: round.planned_ends, arrowsPerEnd: round.arrows_per_end,
      ends: (round.session_ends ?? []).map((end) => ({ endNumber: end.end_number,
        savedArrowIds: (end.arrows ?? []).map((arrow) => arrow.id) })) })) };
}

async function readPlanSessions(userIds: string[], startDate: string, endDate: string) {
  if (!supabase) throw new Error("Training Plan progress could not be loaded.");
  const rows: SessionRow[] = [];
  for (let index = 0; index < userIds.length; index += 100) {
    const batch = userIds.slice(index, index + 100);
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase.from("sessions").select(SESSION_SELECT)
        .in("user_id", batch).gte("session_date", startDate).lte("session_date", endDate)
        .order("session_date").order("id").range(offset, offset + 499);
      if (error) throw new Error("Training Plan Session progress could not be loaded.");
      rows.push(...((data ?? []) as unknown as SessionRow[]));
      if ((data ?? []).length < 500) break;
    }
  }
  return rows.map(mapSession);
}

/** The coach roster check and ordinary authenticated RLS both guard these reads. */
export async function readMobileCoachTrainingPlanProgress(
  coachId: string, organizationId: string, planId: string, asOfDate: string,
) {
  if (!supabase) throw new Error("Training Plan could not be loaded.");
  const roster = await readCoachAthletes(coachId, organizationId);
  if (roster === null) return null;
  const { data, error } = await supabase.from("training_plans").select(PLAN_SELECT)
    .eq("id", planId).eq("organization_id", organizationId).maybeSingle();
  if (error) throw new Error("Training Plan could not be loaded.");
  if (!data) return null;
  const row = data as unknown as PlanRow;
  const plan = mapPlan(row);
  const assignedIds = new Set((row.training_plan_assignments ?? []).map((item) => item.athlete_user_id));
  const athletes = roster.filter((athlete) => assignedIds.has(athlete.userId));
  const sessions = await readPlanSessions(athletes.map((athlete) => athlete.userId),
    plan.startDate, plan.endDate);
  return { plan, athletes: athletes.map((athlete) => ({ ...athlete,
    progress: calculateTrainingPlanProgress(plan, athlete.userId, sessions, asOfDate) })) };
}

/** RLS limits assignments to this signed-in Archer's row. */
export async function readMobileOwnTrainingPlanProgress(userId: string, asOfDate: string) {
  if (!supabase) throw new Error("Training Plans could not be loaded.");
  const { data: assignments, error: assignmentError } = await supabase
    .from("training_plan_assignments").select("training_plan_id")
    .eq("athlete_user_id", userId);
  if (assignmentError) throw new Error("Training Plan assignments could not be loaded.");
  const ids = (assignments ?? []).map((item) => item.training_plan_id);
  if (!ids.length) return [];
  const rows: PlanRow[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await supabase.from("training_plans").select(PLAN_SELECT)
      .in("id", ids.slice(index, index + 100));
    if (error) throw new Error("Training Plans could not be loaded.");
    rows.push(...((data ?? []) as unknown as PlanRow[]));
  }
  const plans = rows.map(mapPlan).sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (!plans.length) return [];
  const sessions = await readPlanSessions([userId], plans[0].startDate,
    plans.reduce((latest, plan) => plan.endDate > latest ? plan.endDate : latest, plans[0].endDate));
  return plans.map((plan) => ({ plan,
    progress: calculateTrainingPlanProgress(plan, userId, sessions, asOfDate) }));
}

export async function readMobileCoachAthleteTrainingPlanProgress(
  coachId: string, organizationId: string, athleteId: string, asOfDate: string,
) {
  const roster = await readCoachAthletes(coachId, organizationId);
  if (!roster?.some((athlete) => athlete.userId === athleteId)) return [];
  const plans = (await readMobileCoachTrainingPlans(coachId, organizationId) ?? [])
    .filter((plan) => plan.assignedUserIds.includes(athleteId));
  if (!plans.length) return [];
  const first = plans.reduce((date, plan) => plan.startDate < date ? plan.startDate : date, plans[0].startDate);
  const last = plans.reduce((date, plan) => plan.endDate > date ? plan.endDate : date, plans[0].endDate);
  const sessions = await readPlanSessions([athleteId], first, last);
  return plans.map((plan) => ({ plan,
    progress: calculateTrainingPlanProgress(plan, athleteId, sessions, asOfDate) }));
}
