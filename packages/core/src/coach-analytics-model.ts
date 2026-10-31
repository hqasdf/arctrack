import { analyticsDateWindow, matchesAnalyticsDate } from "./date.ts";
import { points, SCORE_LABELS, type RoundDraft, type SessionDraft, type SessionType } from "./scoring-model.ts";
import { calculateOverview, targetFaceKey, targetFaceLabel } from "./analytics-model.ts";
import { calculateEndAnalysis, calculateRoundGroupingInsights } from "./session-insights-model.ts";

export type CoachAnalyticsSession = SessionDraft & { userId: string };
export type CoachAnalyticsAthlete = { userId: string; name: string };
export type CoachPeriod = "7" | "30" | "90" | "all";
export type CoachFilters = { period: CoachPeriod; sessionType: SessionType | "all"; distance: number | "all"; division: string; targetFace: string };
export const DEFAULT_COACH_FILTERS: CoachFilters = { period: "30", sessionType: "all", distance: "all", division: "all", targetFace: "all" };
export type CoachSeriesPoint = { key: string; label: string; startDate: string; arrowCount: number; scoredArrowCount: number; sessionCount: number; scoreAverage: number | null; xRate: number | null; tenPlusXRate: number | null };
type ScoreTotals = { count: number; total: number; xCount: number; tenPlusXCount: number };
type Bucket = { key: string; startDate: string; arrowCount: number; sessionIds: Set<string>; scores: ScoreTotals };
function emptyScores(): ScoreTotals { return { count: 0, total: 0, xCount: 0, tenPlusXCount: 0 }; }
function addScore(scores: ScoreTotals, value: number, isX: boolean, isTen: boolean) {
  scores.count++; scores.total += value; scores.xCount += Number(isX); scores.tenPlusXCount += Number(isTen);
}
function scoreRates(scores: ScoreTotals) {
  return { scoredArrowCount: scores.count, average: scores.count ? scores.total / scores.count : null,
    xRate: scores.count ? scores.xCount / scores.count * 100 : null,
    tenPlusXRate: scores.count ? scores.tenPlusXCount / scores.count * 100 : null };
}

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
  const window = analyticsDateWindow(filters.period, today);
  const rounds = sessions.filter((session) => matchesAnalyticsDate(session.date, window) && (filters.sessionType === "all" || session.sessionType === filters.sessionType)).flatMap((session) => session.rounds);
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
  const window = analyticsDateWindow(filters.period, today);
  const primary = sessions.filter((session) => activeIds.has(session.userId) && matchesAnalyticsDate(session.date, window) && (filters.sessionType === "all" || session.sessionType === filters.sessionType));
  const roundFilter = filters.distance !== "all" || filters.division !== "all" || filters.targetFace !== "all";
  const matches = (round: RoundDraft) => (filters.distance === "all" || round.distanceMetres === filters.distance) &&
    (filters.division === "all" || round.division === filters.division) &&
    (filters.targetFace === "all" || targetFaceKey(round) === filters.targetFace);
  // Keep each input entry's totals separate, including legacy duplicate IDs or
  // references. Public records retain the original Session and Round objects.
  const entries = primary.map((session) => ({ session, rounds: session.rounds.filter(matches), scores: emptyScores() }));
  const matchingEntries = entries.filter((entry) => !roundFilter || entry.rounds.length > 0);
  const matchingSessions = matchingEntries.map((entry) => entry.session);
  const records: Array<{ session: CoachAnalyticsSession; round: RoundDraft }> = [];
  let scoredArrowCount = 0, totalArrowCount = 0;
  const athleteTotals = new Map<string, { sessionCount: number; arrowCount: number; scores: ScoreTotals; latestSession: CoachAnalyticsSession | null }>();
  const typeTotals = new Map((['training', 'competition'] as SessionType[]).map((type) => [type, { sessionCount: 0, arrowCount: 0, scores: emptyScores() }]));
  const distributionCounts = new Map<string, number>();
  const distanceMap = new Map<number, { total: number; arrowCount: number; athleteIds: Set<string> }>();
  const interval = coachChartInterval(filters.period, primary.map((session) => session.date));
  const buckets = new Map<string, Bucket>();
  const bucketFor = (date: string) => {
    const key = bucketKey(date, interval);
    const bucket = buckets.get(key) ?? { key, startDate: key, arrowCount: 0, sessionIds: new Set<string>(), scores: emptyScores() };
    buckets.set(key, bucket);
    return bucket;
  };
  for (const entry of entries) {
    const { session } = entry;
    const bucket = bucketFor(session.date);
    bucket.arrowCount += session.arrowCount;
    totalArrowCount += session.arrowCount;
    const own = athleteTotals.get(session.userId) ?? { sessionCount: 0, arrowCount: 0, scores: emptyScores(), latestSession: null };
    athleteTotals.set(session.userId, own);
    const type = typeTotals.get(session.sessionType);
    own.arrowCount += session.arrowCount;
    if (type) type.arrowCount += session.arrowCount;
    if (!roundFilter || entry.rounds.length > 0) {
      bucket.sessionIds.add(session.id); own.sessionCount++;
      if (!own.latestSession || session.date.localeCompare(own.latestSession.date) > 0) own.latestSession = session;
      if (type) type.sessionCount++;
    }
    for (const round of entry.rounds) {
      records.push({ session, round });
      const distance = distanceMap.get(round.distanceMetres) ?? { total: 0, arrowCount: 0, athleteIds: new Set<string>() };
      distanceMap.set(round.distanceMetres, distance);
      for (const arrow of round.arrows) {
        const value = points(arrow.score), isX = arrow.score === 'X', isTen = value === 10;
        scoredArrowCount++;
        // Accumulate each aggregate in the original Arrow encounter order;
        // do not replace point-wise sums with regrouped Round averages/totals.
        addScore(entry.scores, value, isX, isTen); addScore(own.scores, value, isX, isTen);
        addScore(bucket.scores, value, isX, isTen); if (type) addScore(type.scores, value, isX, isTen);
        distance.total += value; distance.arrowCount++; distance.athleteIds.add(session.userId);
        distributionCounts.set(arrow.score, (distributionCounts.get(arrow.score) ?? 0) + 1);
      }
    }
  }
  const series: CoachSeriesPoint[] = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)).map((bucket) => ({
    key: bucket.key, label: bucketLabel(bucket.key, interval), startDate: bucket.startDate,
    arrowCount: bucket.arrowCount, scoredArrowCount: bucket.scores.count, sessionCount: bucket.sessionIds.size,
    scoreAverage: bucket.scores.count ? bucket.scores.total / bucket.scores.count : null,
    xRate: bucket.scores.count ? bucket.scores.xCount / bucket.scores.count * 100 : null,
    tenPlusXRate: bucket.scores.count ? bucket.scores.tenPlusXCount / bucket.scores.count * 100 : null,
  }));
  const perAthlete = athletes.map((athlete) => {
    const own = athleteTotals.get(athlete.userId);
    return { ...athlete, sessionCount: own?.sessionCount ?? 0, arrowCount: own?.arrowCount ?? 0,
      ...scoreRates(own?.scores ?? emptyScores()), latestSession: own?.latestSession ?? null };
  });
  const byType = (["training", "competition"] as SessionType[]).map((type) => {
    const totals = typeTotals.get(type)!;
    return { type, sessionCount: totals.sessionCount, arrowCount: totals.arrowCount, ...scoreRates(totals.scores) };
  });
  const byDistance = [...distanceMap].filter(([, item]) => item.arrowCount).map(([distance, item]) => ({ distance, average: item.total / item.arrowCount, arrowCount: item.arrowCount, athleteCount: item.athleteIds.size })).sort((a, b) => a.distance - b.distance);
  const distribution = SCORE_LABELS.map((score) => ({ score, count: distributionCounts.get(score) ?? 0, percentage: scoredArrowCount ? (distributionCounts.get(score) ?? 0) / scoredArrowCount * 100 : 0 }));
  const newestEntries = [...matchingEntries].sort((a, b) => b.session.date.localeCompare(a.session.date));
  const reviewQueue = newestEntries.filter(({ session }) => session.sessionType === 'competition' || session.rounds.some((round) => round.arrows.length > 0 && round.arrows.length === round.ends * round.arrowsPerEnd)).map(({ session, scores }) => ({
    session, arrowCount: scores.count, average: scores.count ? scores.total / scores.count : null, xCount: scores.xCount, tenPlusXCount: scores.tenPlusXCount,
  }));
  return {
    interval, series, perAthlete, byType, byDistance, distribution, reviewQueue, filteredSessions: matchingSessions, filteredRounds: records,
    recent: newestEntries.filter(({ session }) => session.date <= today).slice(0, 8).map(({ session, scores }) => ({ session, arrowCount: scores.count, average: scores.count ? scores.total / scores.count : null })),
    summary: { activeArchers: athletes.length, activeThisPeriod: perAthlete.filter((athlete) => athlete.sessionCount > 0).length,
      sessionCount: matchingSessions.length, arrowCount: totalArrowCount, scoredArrowCount,
      trainingSessions: byType[0].sessionCount, competitionSessions: byType[1].sessionCount },
  };
}

export function buildCoachAthleteInsights(athlete: CoachAnalyticsAthlete, sessions: CoachAnalyticsSession[], filters: CoachFilters, today: string) {
  const team = buildCoachTeamAnalytics([athlete], sessions, filters, today);
  const rounds = team.filteredRounds.map(({ session, round }) => ({ sessionId: session.id, sessionTitle: session.title, sessionType: session.sessionType, date: session.date, round }));
  const overview = calculateOverview(rounds);
  const scoresBySession = new Map<string, ScoreTotals>();
  for (const { session, round } of team.filteredRounds) {
    const scores = scoresBySession.get(session.id) ?? emptyScores();
    scoresBySession.set(session.id, scores);
    for (const arrow of round.arrows) { const value = points(arrow.score); addScore(scores, value, arrow.score === 'X', value === 10); }
  }
  const sessionTrend = team.filteredSessions.map((session) => {
    const scores = scoresBySession.get(session.id) ?? emptyScores();
    return { session, arrowCount: scores.count, average: scores.count ? scores.total / scores.count : null,
      xRate: scores.count ? scores.xCount / scores.count * 100 : null,
      tenPlusXRate: scores.count ? scores.tenPlusXCount / scores.count * 100 : null };
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
