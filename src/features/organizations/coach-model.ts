import { calculateArrowVolume, calculateOverview } from "../analytics/analytics-model.ts";
import { arrowAverage, roundTotal, xCount, type RoundDraft, type SessionDraft } from "../sessions/scoring-model.ts";

export type CoachAthlete = {
  userId: string;
  displayName: string | null;
  joinedAt: string;
};

export function athleteName(athlete: CoachAthlete) {
  return athlete.displayName?.trim() || `Archer ${athlete.userId.slice(0, 8)}`;
}

export function thisWeek(sessions: SessionDraft[], today: string) {
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  const monday = start.toISOString().slice(0, 10);
  const current = sessions.filter((session) => session.date >= monday && session.date <= today);
  return { sessionCount: current.length, arrowCount: current.reduce((sum, session) => sum + session.arrowCount, 0) };
}

export function latestCompletedRound(sessions: SessionDraft[]) {
  return completedRounds(sessions)[0] ?? null;
}

export function completedRounds(sessions: SessionDraft[]) {
  return [...sessions].sort((a, b) => b.date.localeCompare(a.date)).flatMap((session) =>
    [...session.rounds].sort((a, b) => b.roundNumber - a.roundNumber)
      .filter((round) => round.ends * round.arrowsPerEnd > 0 && round.arrows.length === round.ends * round.arrowsPerEnd)
      .map((round) => ({ session, round })));
}

export function roundSummary(round: RoundDraft) {
  return { total: roundTotal(round.arrows), average: arrowAverage(round.arrows), xCount: xCount(round.arrows) };
}

export function athleteAnalytics(sessions: SessionDraft[], today: string) {
  const rounds = sessions.flatMap((session) => session.rounds.map((round) => ({
    sessionId: session.id, sessionTitle: session.title, sessionType: session.sessionType,
    date: session.date, round,
  })));
  const overview = calculateOverview(rounds);
  const volume = calculateArrowVolume(sessions, { sessionType: "all", dateRange: "all" }, today, "daily");
  return { overview, volume };
}
