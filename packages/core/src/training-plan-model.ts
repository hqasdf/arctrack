/** Date-only values are calendar days, never instants or local timestamps. */
export type TrainingPlanDay = {
  date: string;
  arrowTarget: number | null;
  scoredRoundTarget: number | null;
  coachNote: string | null;
};

export type TrainingPlanDefinition = {
  id: string;
  startDate: string;
  endDate: string;
  weeklyArrowTarget: number | null;
  days: TrainingPlanDay[];
};

export type TrainingPlanEnd = { endNumber: number; savedArrowIds: string[] };
export type TrainingPlanRound = {
  id: string;
  plannedEnds: number;
  arrowsPerEnd: number;
  ends: TrainingPlanEnd[];
};
export type TrainingPlanSession = {
  id: string;
  userId: string;
  date: string;
  /** Current schema is non-null; null remains unknown and never falls back to scored rows. */
  arrowCount: number | null;
  rounds: TrainingPlanRound[];
};

export type TrainingPlanDayProgress = TrainingPlanDay & {
  arrowsCompleted: number;
  scoredRoundsCompleted: number;
  unknownArrowCountSessions: number;
  arrowComplete: boolean | null;
  scoredRoundComplete: boolean | null;
  noTrackedRequirement: boolean;
  dayComplete: boolean;
};

export type TrainingPlanWeekProgress = {
  startDate: string;
  endDate: string;
  arrowTarget: number | null;
  arrowsCompleted: number;
  arrowsRemaining: number | null;
  progressRatio: number | null;
  visualRatio: number | null;
  goalReached: boolean | null;
  amountAboveGoal: number | null;
  unknownArrowCountSessions: number;
};

export type TrainingPlanProgress = {
  planId: string;
  athleteUserId: string;
  currentWeek: TrainingPlanWeekProgress | null;
  weeks: TrainingPlanWeekProgress[];
  days: TrainingPlanDayProgress[];
};

/** Inclusive calendar dates for prescription editors; never parse as an instant. */
export function trainingPlanDates(startDate: string, endDate: string): string[] {
  const first = dayOrdinal(startDate);
  const last = dayOrdinal(endDate);
  if (last < first) throw new RangeError("Training Plan dates are reversed.");
  return Array.from({ length: last - first + 1 }, (_, index) => dateFromOrdinal(first + index));
}

export function trainingPlanStatus(startDate: string, endDate: string, today: string): "Upcoming" | "Active" | "Ended" {
  return today < startDate ? "Upcoming" : today > endDate ? "Ended" : "Active";
}

/** This stricter completion rule is only for Training Plan scored-Round goals. */
export function isTrainingPlanScoredRoundComplete(round: TrainingPlanRound): boolean {
  if (!Number.isInteger(round.plannedEnds) || round.plannedEnds < 1
    || !Number.isInteger(round.arrowsPerEnd) || round.arrowsPerEnd < 1) return false;
  const endCounts = new Map<number, number>();
  for (const end of round.ends) {
    if (endCounts.has(end.endNumber)) return false;
    endCounts.set(end.endNumber, end.savedArrowIds.length);
  }
  for (let endNumber = 1; endNumber <= round.plannedEnds; endNumber++) {
    if (endCounts.get(endNumber) !== round.arrowsPerEnd) return false;
  }
  return true;
}

export function calculateTrainingPlanProgress(
  plan: TrainingPlanDefinition,
  athleteUserId: string,
  sessions: TrainingPlanSession[],
  asOfDate: string,
): TrainingPlanProgress {
  const firstDay = dayOrdinal(plan.startDate);
  const lastDay = dayOrdinal(plan.endDate);
  const today = dayOrdinal(asOfDate);
  if (lastDay < firstDay) throw new RangeError("Training Plan dates are reversed.");

  const byDate = new Map<string, { arrows: number; scoredRounds: number; unknown: number }>();
  for (const session of sessions) {
    if (session.userId !== athleteUserId || session.date < plan.startDate || session.date > plan.endDate) continue;
    const current = byDate.get(session.date) ?? { arrows: 0, scoredRounds: 0, unknown: 0 };
    if (session.arrowCount === null) current.unknown++;
    else current.arrows += session.arrowCount;
    current.scoredRounds += session.rounds.filter(isTrainingPlanScoredRoundComplete).length;
    byDate.set(session.date, current);
  }

  const requirements = new Map(plan.days.map((day) => [day.date, day]));
  const days: TrainingPlanDayProgress[] = [];
  for (let ordinal = firstDay; ordinal <= lastDay; ordinal++) {
    const date = dateFromOrdinal(ordinal);
    const requirement = requirements.get(date) ?? {
      date, arrowTarget: null, scoredRoundTarget: null, coachNote: null,
    };
    const actual = byDate.get(date) ?? { arrows: 0, scoredRounds: 0, unknown: 0 };
    const arrowComplete = requirement.arrowTarget === null ? null : actual.arrows >= requirement.arrowTarget;
    const scoredRoundComplete = requirement.scoredRoundTarget === null
      ? null : actual.scoredRounds >= requirement.scoredRoundTarget;
    const noTrackedRequirement = arrowComplete === null && scoredRoundComplete === null;
    days.push({ ...requirement, arrowsCompleted: actual.arrows,
      scoredRoundsCompleted: actual.scoredRounds, unknownArrowCountSessions: actual.unknown,
      arrowComplete, scoredRoundComplete, noTrackedRequirement,
      dayComplete: !noTrackedRequirement && arrowComplete !== false && scoredRoundComplete !== false });
  }

  const weeks: TrainingPlanWeekProgress[] = [];
  for (let start = firstDay; start <= lastDay; start += 7) {
    const end = Math.min(start + 6, lastDay);
    const block = days.slice(start - firstDay, end - firstDay + 1);
    const arrowsCompleted = block.reduce((sum, day) => sum + day.arrowsCompleted, 0);
    const unknownArrowCountSessions = block.reduce((sum, day) => sum + day.unknownArrowCountSessions, 0);
    const target = plan.weeklyArrowTarget;
    const progressRatio = target === null ? null : arrowsCompleted / target;
    weeks.push({
      startDate: dateFromOrdinal(start), endDate: dateFromOrdinal(end),
      arrowTarget: target, arrowsCompleted, unknownArrowCountSessions,
      arrowsRemaining: target === null ? null : Math.max(0, target - arrowsCompleted),
      progressRatio, visualRatio: progressRatio === null ? null : Math.min(1, progressRatio),
      goalReached: target === null ? null : arrowsCompleted >= target,
      amountAboveGoal: target === null ? null : Math.max(0, arrowsCompleted - target),
    });
  }
  const currentWeek = today < firstDay || today > lastDay
    ? null : weeks[Math.floor((today - firstDay) / 7)];
  return { planId: plan.id, athleteUserId, currentWeek, weeks, days };
}

// Proleptic Gregorian calendar arithmetic; no Date or timezone conversion.
function dayOrdinal(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError("Expected a YYYY-MM-DD calendar date.");
  let year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > lengths[month - 1]) {
    throw new RangeError("Invalid calendar date.");
  }
  year -= Number(month <= 2);
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  return era * 146097 + yearOfEra * 365 + Math.floor(yearOfEra / 4)
    - Math.floor(yearOfEra / 100) + dayOfYear;
}

function dateFromOrdinal(ordinal: number): string {
  const era = Math.floor(ordinal / 146097);
  const dayOfEra = ordinal - era * 146097;
  const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460)
    + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
  let year = yearOfEra + era * 400;
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const marchMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * marchMonth + 2) / 5) + 1;
  const month = marchMonth + (marchMonth < 10 ? 3 : -9);
  year += Number(month <= 2);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
