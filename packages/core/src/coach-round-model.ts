import { calculateEndAnalysis } from "./session-insights-model.ts";
import { arrowAverage, points, roundTotal, SCORE_LABELS, xCount, type ArrowEntry, type RoundDraft, type SessionDraft } from "./scoring-model.ts";

export type CoachEndRef = { roundId: string; id: string; endNumber: number };
export type CoachRoundHierarchy = { round: RoundDraft; ends: Array<{ id: string; endNumber: number; arrows: ArrowEntry[] }> };

export function buildCoachRoundHierarchy(session: SessionDraft, endRefs: CoachEndRef[]): CoachRoundHierarchy[] {
  return session.rounds.map((round) => ({
    round,
    ends: endRefs.filter((end) => end.roundId === round.id).sort((a, b) => a.endNumber - b.endNumber)
      .map((end) => ({ id: end.id, endNumber: end.endNumber,
        arrows: round.arrows.filter((arrow) => arrow.end === end.endNumber).sort((a, b) => a.arrow - b.arrow) })),
  }));
}

export function summarizeCoachRound(round: RoundDraft) {
  const total = roundTotal(round.arrows);
  const endAnalysis = calculateEndAnalysis(round);
  let cumulative = 0;
  const progression = endAnalysis.ends.map((end) => {
    cumulative += end.total;
    return { endNumber: end.endNumber, total: end.total, cumulative, arrowCount: end.arrowCount, complete: end.complete };
  });
  let arrowPoints = 0;
  const arrowProgression = [...round.arrows].sort((a, b) => a.end - b.end || a.arrow - b.arrow).map((arrow, index) => {
    arrowPoints += points(arrow.score);
    return { sequence: index + 1, endNumber: arrow.end, arrowNumber: arrow.arrow, average: arrowPoints / (index + 1), cumulative: arrowPoints };
  });
  return {
    total,
    average: arrowAverage(round.arrows),
    arrowCount: round.arrows.length,
    expectedArrows: round.ends * round.arrowsPerEnd,
    xCount: xCount(round.arrows),
    tenPlusXCount: round.arrows.filter((arrow) => points(arrow.score) === 10).length,
    plottedCount: round.arrows.filter((arrow) => arrow.plot !== null).length,
    distribution: SCORE_LABELS.map((score) => ({ score, count: round.arrows.filter((arrow) => arrow.score === score).length })),
    progression, arrowProgression,
  };
}
