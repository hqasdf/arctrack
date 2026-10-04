import type { Division } from "./round-presets.ts";
export type ScoreLabel = "X"|"10"|"9"|"8"|"7"|"6"|"5"|"4"|"3"|"2"|"1"|"M";
export type TargetFaceType = "full_face"|"six_ring"|"triple_face";
export type Plot = { x: number; y: number; faceIndex?: 0|1|2 };
export type ArrowSyncState = "saving"|"saved"|"failed";
export type SessionType = "training"|"competition";
export type ArrowEntry = { id: string; end: number; arrow: number; score: ScoreLabel; plot: Plot|null; syncState?: ArrowSyncState };
export type RoundDraft = { id: string; roundNumber: number; name: string; division: Division; distanceMetres: number; ends: number; arrowsPerEnd: number; faceDiameterCm: number; faceType: TargetFaceType; arrows: ArrowEntry[] };
export type SessionDraft = { id: string; title: string; date: string; sessionType: SessionType; arrowCount: number; rounds: RoundDraft[] };
export const SCORE_LABELS: ScoreLabel[] = ["X","10","9","8","7","6","5","4","3","2","1","M"];
export const SCORING_BOUNDARY_ALLOWANCE = 0.01;
const SCORING_BOUNDARIES: ReadonlyArray<{ score: ScoreLabel; radius: number }> = [
  { score: "X", radius: 0.05 }, { score: "10", radius: 0.10 }, { score: "9", radius: 0.20 },
  { score: "8", radius: 0.30 }, { score: "7", radius: 0.40 }, { score: "6", radius: 0.50 },
  { score: "5", radius: 0.60 }, { score: "4", radius: 0.70 }, { score: "3", radius: 0.80 },
  { score: "2", radius: 0.90 }, { score: "1", radius: 1.00 },
];
const boundaryCountByFace: Record<TargetFaceType, number> = { full_face: 11, six_ring: 7, triple_face: 6 };
export function scoreFromPlot({ x, y }: Plot, faceType: TargetFaceType = "full_face"): ScoreLabel {
  const distance = Math.hypot(x, y);
  for (const boundary of SCORING_BOUNDARIES.slice(0, boundaryCountByFace[faceType])) {
    if (distance <= boundary.radius + SCORING_BOUNDARY_ALLOWANCE) return boundary.score;
  }
  return "M";
}
export function points(score: ScoreLabel) { return score === "X" ? 10 : score === "M" ? 0 : Number(score); }
export function roundTotal(arrows: ArrowEntry[]) { return arrows.reduce((sum, item) => sum + points(item.score), 0); }
export function arrowAverage(arrows: ArrowEntry[]) { return arrows.length === 0 ? null : roundTotal(arrows) / arrows.length; }
export function formatArrowAverage(arrows: ArrowEntry[]) { const average = arrowAverage(arrows); return average === null ? "—" : average.toFixed(1); }
export function endTotal(arrows: ArrowEntry[], end: number) { return roundTotal(arrows.filter((item) => item.end === end)); }
export function summarizeRoundScores(arrows: ArrowEntry[], plannedEnds: number) {
  const ends = Array.from({ length: Math.max(0, Math.trunc(plannedEnds)) }, (_, index) => {
    const end = index + 1;
    const endArrows = arrows.filter((item) => item.end === end);
    return { end, score: endArrows.length === 0 ? null : roundTotal(endArrows) };
  });
  return { ends, total: roundTotal(arrows) };
}
export function xCount(arrows: ArrowEntry[]) { return arrows.filter((item) => item.score === "X").length; }
export function arrowKey(end: number, arrow: number) { return `${end}-${arrow}`; }
export function latestPlottedArrow(arrows: ArrowEntry[], preferredKey: string | null): ArrowEntry | null {
  const plotted = arrows.filter((item) => item.plot !== null);
  return plotted.find((item) => arrowKey(item.end, item.arrow) === preferredKey)
    ?? plotted.reduce<ArrowEntry | null>((latest, item) =>
      !latest || item.end > latest.end || item.end === latest.end && item.arrow > latest.arrow ? item : latest, null);
}
export function nextPlottedArrowSlot(arrows: ArrowEntry[], deleted: Pick<ArrowEntry,"end"|"arrow">): {end:number;arrow:number}|null {
  const after=arrows.filter((item)=>item.plot!==null&&(item.end>deleted.end||item.end===deleted.end&&item.arrow>deleted.arrow))
    .sort((a,b)=>a.end-b.end||a.arrow-b.arrow)[0];
  if (after) return {end:after.end,arrow:after.arrow};
  const before=arrows.filter((item)=>item.plot!==null&&(item.end<deleted.end||item.end===deleted.end&&item.arrow<deleted.arrow))
    .sort((a,b)=>b.end-a.end||b.arrow-a.arrow)[0];
  return before?{end:before.end,arrow:before.arrow}:null;
}
