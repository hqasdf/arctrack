import {
  calculateArrowVolume, calculateDistancePerformance, calculateOverview,
  calculateTargetGroupings, calculateTrainingCompetitionComparison, calculateTrend,
  DEFAULT_ANALYTICS_FILTERS, filterAnalyticsRounds, filterComparisonRounds,
  getAvailableFilters, type AnalyticsFilters, type VolumeInterval,
} from "@arc-track/core/analytics";
import { calculateEndAnalysis, calculateRobustMainGroup, calculateRoundGroupingInsights } from "@arc-track/core/insights";
import { arrowAverage, points, roundTotal, type RoundDraft, type SessionDraft } from "@arc-track/core/scoring";

export { DEFAULT_ANALYTICS_FILTERS };
export type { AnalyticsFilters, VolumeInterval };

export { singaporeDate as singaporeToday } from "@arc-track/core/dates";

export function mobileAnalyticsView(sessions: SessionDraft[], filters: AnalyticsFilters, today: string, interval: VolumeInterval) {
  const available = getAvailableFilters(sessions, filters, today);
  const rounds = filterAnalyticsRounds(sessions, filters, today);
  return {
    available, rounds,
    overview: calculateOverview(rounds),
    trend: calculateTrend(rounds),
    distances: calculateDistancePerformance(rounds),
    groupings: calculateTargetGroupings(rounds),
    volume: calculateArrowVolume(sessions, filters, today, interval),
    comparison: calculateTrainingCompetitionComparison(filterComparisonRounds(sessions, filters, today)),
  };
}

export function mobileRoundInsights(round: RoundDraft) {
  const grouping = calculateRoundGroupingInsights(round);
  return {
    total: roundTotal(round.arrows),
    arrowCount: round.arrows.length,
    average: arrowAverage(round.arrows),
    overview: calculateOverview([{ sessionId: "", sessionTitle: "", sessionType: "training", date: "", round }]),
    tenPlusXCount: round.arrows.filter((arrow) => points(arrow.score) === 10).length,
    complete: round.arrows.length === round.ends * round.arrowsPerEnd && round.ends * round.arrowsPerEnd > 0,
    ends: calculateEndAnalysis(round),
    grouping,
    mainGroup: calculateRobustMainGroup(grouping.arrows, round.faceDiameterCm),
  };
}
