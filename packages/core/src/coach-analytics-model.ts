import { points, SCORE_LABELS, type RoundDraft, type SessionDraft, type SessionType } from "./scoring-model.ts";
import { calculateOverview, targetFaceKey, targetFaceLabel } from "./analytics-model.ts";
import { calculateEndAnalysis, calculateRoundGroupingInsights } from "./session-insights-model.ts";

export type CoachAnalyticsSession = SessionDraft & { userId: string };
export type CoachAnalyticsAthlete = { userId: string; name: string };
export type CoachPeriod = "7" | "30" | "90" | "all";
export type CoachFilters = { period: CoachPeriod; sessionType: SessionType | "all"; distance: number | "all"; division: string; targetFace: string };
export const DEFAULT_COACH_FILTERS: CoachFilters = { period: "30", sessionType: "all", distance: "all", division: "all", targetFace: "all" };
export type CoachSeriesPoint = { key: string; label: string; startDate: string; arrowCount: number; sessionCount: number; scoreAverage: number | null; xRate: number | null; tenPlusXRate: number | null };
type Bucket = { key: string; startDate: string; arrowCount: number; sessionIds: Set<string>; scoreTotal: number; xCount: number; tenPlusXCount: number };

function dateShift(value: string, days: number) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function monday(value: string) { const date = new Date(`${value}T00:00:00Z`); return dateShift(value, -(date.getUTCDay() + 6) % 7); }
function month(value: string) { return `${value.slice(0, 7)}-01`; }
function bucketKey(value: string, interval: "daily" | "weekly" | "monthly") { return interval === "daily" ? value : interval === "weekly" ? monday(value) : month(value); }
function bucketLabel(value: string, interval: "daily" | "weekly" | "monthly") { return interval === "daily" ? value.slice(5) : interval === "weekly" ? `${value.slice(5)}–${dateShift(value, 6).slice(5)}` : value.slice(0, 7); }

export function coachChartInterval(period: CoachPeriod, dates: string[]): "daily" | "weekly" | "monthly" {
  if (period === "7" || period === "30") return "daily";
  if (period === "90") return "weekly";
  if (!dates.length) return "weekly";
  return dates.sort()[0] < dateShift(dates.at(-1)!, -366) ? "monthly" : "weekly";
}

export function coachFilterOptions(sessions: CoachAnalyticsSession[], today: string, filters: Pick<CoachFilters, "period" | "sessionType">) {
  const cutoff = filters.period === "all" ? null : dateShift(today, 1 - Number(filters.period));
  const rounds = sessions.filter((session) => (!cutoff || session.date >= cutoff) && session.date <= today && (filters.sessionType === "all" || session.sessionType === filters.sessionType)).flatMap((session) => session.rounds);
  return {
    distances: [...new Set(rounds.map((round) => round.distanceMetres))].sort((a, b) => a - b),
    divisions: [...new Set(rounds.map((round) => round.division))].sort(),
    targetFaces: [...new Map(rounds.map((round) => [targetFaceKey(round), targetFaceLabel(round)])).entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
  };
}

export function coachPeriodScoreChange(sessions: CoachAnalyticsSession[], userId: string, period: CoachPeriod, today: string): number | null {
  if (period === "all") return null;
  const days = Number(period);
  const currentStart = dateShift(today, 1 - days);
  const previousStart = dateShift(currentStart, -days);
  const current = sessions.filter((session) => session.userId === userId && session.date >= currentStart && session.date <= today).flatMap((session) => session.rounds.flatMap((round) => round.arrows));
  const previous = sessions.filter((session) => session.userId === userId && session.date >= previousStart && session.date < currentStart).flatMap((session) => session.rounds.flatMap((round) => round.arrows));
  if (current.length < 12 || previous.length < 12) return null;
  return current.reduce((sum, arrow) => sum + points(arrow.score), 0) / current.length - previous.reduce((sum, arrow) => sum + points(arrow.score), 0) / previous.length;
}

export function buildCoachTeamAnalytics(athletes: CoachAnalyticsAthlete[], sessions: CoachAnalyticsSession[], filters: CoachFilters, today: string) {
  const activeIds = new Set(athletes.map((athlete) => athlete.userId));
  const cutoff = filters.period === "all" ? null : dateShift(today, 1 - Number(filters.period));
  const primary = sessions.filter((session) => activeIds.has(session.userId) && session.date <= today && (!cutoff || session.date >= cutoff) && (filters.sessionType === "all" || session.sessionType === filters.sessionType));
  const roundFilter = filters.distance !== "all" || filters.division !== "all" || filters.targetFace !== "all";
  const matches = (round: RoundDraft) => (filters.distance === "all" || round.distanceMetres === filters.distance) &&
    (filters.division === "all" || round.division === filters.division) &&
    (filters.targetFace === "all" || targetFaceKey(round) === filters.targetFace);
  const matchingSessions = primary.filter((session) => !roundFilter || session.rounds.some(matches));
  const records = primary.flatMap((session) => session.rounds.filter(matches).map((round) => ({ session, round })));
  const allArrows = records.flatMap(({ round }) => round.arrows);
  const scoredArrowCount = allArrows.length;
  const interval = coachChartInterval(filters.period, matchingSessions.map((session) => session.date));
  const buckets = new Map<string, Bucket>();
  const bucketFor = (date: string) => {
    const key = bucketKey(date, interval);
    const bucket = buckets.get(key) ?? { key, startDate: key, arrowCount: 0, sessionIds: new Set<string>(), scoreTotal: 0, xCount: 0, tenPlusXCount: 0 };
    buckets.set(key, bucket);
    return bucket;
  };
  for (const session of matchingSessions) bucketFor(session.date).sessionIds.add(session.id);
  for (const { session, round } of records) {
    const bucket = bucketFor(session.date);
    for (const arrow of round.arrows) {
      bucket.arrowCount++;
      bucket.scoreTotal += points(arrow.score);
      bucket.xCount += Number(arrow.score === "X");
      bucket.tenPlusXCount += Number(points(arrow.score) === 10);
    }
  }
  const series: CoachSeriesPoint[] = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)).map((bucket) => ({
    key: bucket.key, label: bucketLabel(bucket.key, interval), startDate: bucket.startDate,
    arrowCount: bucket.arrowCount, sessionCount: bucket.sessionIds.size,
    scoreAverage: bucket.arrowCount ? bucket.scoreTotal / bucket.arrowCount : null,
    xRate: bucket.arrowCount ? bucket.xCount / bucket.arrowCount * 100 : null,
    tenPlusXRate: bucket.arrowCount ? bucket.tenPlusXCount / bucket.arrowCount * 100 : null,
  }));
  const perAthlete = athletes.map((athlete) => {
    const ownSessions = matchingSessions.filter((session) => session.userId === athlete.userId);
    const ownArrows = records.filter(({ session }) => session.userId === athlete.userId).flatMap(({ round }) => round.arrows);
    const xCount = ownArrows.filter((arrow) => arrow.score === "X").length;
    const tenPlusXCount = ownArrows.filter((arrow) => points(arrow.score) === 10).length;
    return { ...athlete, sessionCount: ownSessions.length, arrowCount: ownArrows.length,
      average: ownArrows.length ? ownArrows.reduce((sum, arrow) => sum + points(arrow.score), 0) / ownArrows.length : null,
      xRate: ownArrows.length ? xCount / ownArrows.length * 100 : null,
      tenPlusXRate: ownArrows.length ? tenPlusXCount / ownArrows.length * 100 : null,
      latestSession: ownSessions.sort((a, b) => b.date.localeCompare(a.date))[0] ?? null };
  });
  const byType = (["training", "competition"] as SessionType[]).map((type) => {
    const typeSessions = matchingSessions.filter((session) => session.sessionType === type);
    const arrows = records.filter(({ session }) => session.sessionType === type).flatMap(({ round }) => round.arrows);
    return { type, sessionCount: typeSessions.length, arrowCount: arrows.length, average: arrows.length ? arrows.reduce((sum, arrow) => sum + points(arrow.score), 0) / arrows.length : null,
      xRate: arrows.length ? arrows.filter((arrow) => arrow.score === "X").length / arrows.length * 100 : null,
      tenPlusXRate: arrows.length ? arrows.filter((arrow) => points(arrow.score) === 10).length / arrows.length * 100 : null };
  });
  const distanceMap = new Map<number, { total: number; arrowCount: number; athleteIds: Set<string> }>();
  for (const { session, round } of records) {
    const item = distanceMap.get(round.distanceMetres) ?? { total: 0, arrowCount: 0, athleteIds: new Set<string>() };
    for (const arrow of round.arrows) { item.total += points(arrow.score); item.arrowCount++; item.athleteIds.add(session.userId); }
    distanceMap.set(round.distanceMetres, item);
  }
  const byDistance = [...distanceMap].filter(([, item]) => item.arrowCount).map(([distance, item]) => ({ distance, average: item.total / item.arrowCount, arrowCount: item.arrowCount, athleteCount: item.athleteIds.size })).sort((a, b) => a.distance - b.distance);
  const distribution = SCORE_LABELS.map((score) => ({ score, count: allArrows.filter((arrow) => arrow.score === score).length, percentage: scoredArrowCount ? allArrows.filter((arrow) => arrow.score === score).length / scoredArrowCount * 100 : 0 }));
  const reviewQueue = [...matchingSessions].filter((session) => session.sessionType === "competition" || session.rounds.some((round) => round.arrows.length > 0 && round.arrows.length === round.ends * round.arrowsPerEnd)).sort((a, b) => b.date.localeCompare(a.date)).map((session) => {
    const arrows = session.rounds.filter(matches).flatMap((round) => round.arrows);
    const total = arrows.reduce((sum, arrow) => sum + points(arrow.score), 0);
    return { session, arrowCount: arrows.length, average: arrows.length ? total / arrows.length : null,
      xCount: arrows.filter((arrow) => arrow.score === "X").length, tenPlusXCount: arrows.filter((arrow) => points(arrow.score) === 10).length };
  });
  return {
    interval, series, perAthlete, byType, byDistance, distribution, reviewQueue, filteredSessions: matchingSessions, filteredRounds: records,
    recent: [...matchingSessions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).map((session) => {
      const arrows = session.rounds.filter(matches).flatMap((round) => round.arrows);
      return { session, arrowCount: arrows.length, average: arrows.length ? arrows.reduce((sum, arrow) => sum + points(arrow.score), 0) / arrows.length : null };
    }),
    summary: { activeArchers: athletes.length, activeThisPeriod: perAthlete.filter((athlete) => athlete.sessionCount > 0).length,
      sessionCount: matchingSessions.length, arrowCount: scoredArrowCount,
      trainingSessions: byType[0].sessionCount, competitionSessions: byType[1].sessionCount },
  };
}

export function buildCoachAthleteInsights(athlete: CoachAnalyticsAthlete, sessions: CoachAnalyticsSession[], filters: CoachFilters, today: string) {
  const team = buildCoachTeamAnalytics([athlete], sessions, filters, today);
  const rounds = team.filteredRounds.map(({ session, round }) => ({ sessionId: session.id, sessionTitle: session.title, sessionType: session.sessionType, date: session.date, round }));
  const overview = calculateOverview(rounds);
  const sessionTrend = team.filteredSessions.map((session) => {
    const arrows = team.filteredRounds.filter((item) => item.session.id === session.id).flatMap((item) => item.round.arrows);
    const xCount = arrows.filter((arrow) => arrow.score === "X").length;
    const tenPlusXCount = arrows.filter((arrow) => points(arrow.score) === 10).length;
    return { session, arrowCount: arrows.length,
      average: arrows.length ? arrows.reduce((sum, arrow) => sum + points(arrow.score), 0) / arrows.length : null,
      xRate: arrows.length ? xCount / arrows.length * 100 : null,
      tenPlusXRate: arrows.length ? tenPlusXCount / arrows.length * 100 : null };
  }).sort((a, b) => a.session.date.localeCompare(b.session.date));
  const completedEnds = rounds.flatMap(({ round }) => calculateEndAnalysis(round).ends.filter((end) => end.complete && end.average !== null).map((end) => end.average!));
  const endMean = completedEnds.length ? completedEnds.reduce((sum, value) => sum + value, 0) / completedEnds.length : null;
  const endVariation = completedEnds.length < 2 || endMean === null ? null : Math.sqrt(completedEnds.reduce((sum, value) => sum + (value - endMean) ** 2, 0) / completedEnds.length);
  const grouped = new Map<string, Array<{ date: string; sessionId: string; roundId: string; groupSizeCm: number }>>();
  for (const { round, date, sessionId } of rounds) {
    const metrics = calculateRoundGroupingInsights(round).metrics;
    if (metrics?.groupSizeCm === null || !metrics) continue;
    const key = `${round.distanceMetres} m · ${round.division} · ${targetFaceLabel(round)}`;
    const items = grouped.get(key) ?? [];
    items.push({ date, sessionId, roundId: round.id, groupSizeCm: metrics.groupSizeCm });
    grouped.set(key, items);
  }
  const grouping = [...grouped].filter(([, items]) => items.length >= 2).sort((a, b) => b[1].length - a[1].length)[0] ?? null;
  return { ...team, overview, sessionTrend, endVariation, completedEndCount: completedEnds.length,
    groupingTrend: grouping ? { format: grouping[0], points: grouping[1].sort((a, b) => a.date.localeCompare(b.date)) } : null };
}
