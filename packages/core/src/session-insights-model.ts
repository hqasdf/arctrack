import { roundTotal, type ArrowEntry, type RoundDraft } from "./scoring-model.ts";

export type EndPoint = {
  endNumber: number;
  total: number;
  average: number | null;
  arrowCount: number;
  expectedArrowCount: number;
  complete: boolean;
};

export type EndAnalysis = {
  ends: EndPoint[];
  completedEndCount: number;
  average: number | null;
  best: EndPoint | null;
  worst: EndPoint | null;
  consistency: number | null;
  trendSlope: number | null;
};

export type GroupingPoint = {
  id: string;
  x: number;
  y: number;
  faceIndex?: 0 | 1 | 2;
  score: ArrowEntry["score"];
};

export type GroupingMetrics = {
  centreX: number;
  centreY: number;
  arrowCount: number;
  horizontalSpreadNormalized: number;
  verticalSpreadNormalized: number;
  horizontalSpreadCm: number | null;
  verticalSpreadCm: number | null;
  groupSizeNormalized: number | null;
  spreadNormalized: number | null;
  groupSizeCm: number | null;
  spreadCm: number | null;
};

export type RoundGroupingInsights = {
  arrows: GroupingPoint[];
  missingPlotCount: number;
  unassignedTripleCount: number;
  metrics: GroupingMetrics | null;
};

export type RobustMainGroup = {
  mainArrows: GroupingPoint[];
  flyers: GroupingPoint[];
  metrics: GroupingMetrics | null;
};

/** A change smaller than one tenth of a point per Arrow per End is shown as steady. */
export const MOSTLY_STEADY_TREND_SLOPE = 0.1;
export const SIGHT_CHECK_MIN_PLOTTED_ARROWS = 6;
export const SIGHT_CHECK_GROUP_SIZE_FACE_RATIO = 0.40;
export const SIGHT_CHECK_MIN_OFFSET_NORMALIZED = 0.08;

export function calculateEndAnalysis(round: RoundDraft): EndAnalysis {
  const ends = Array.from({ length: round.ends }, (_, index) => {
    const endNumber = index + 1;
    const arrows = round.arrows.filter((arrow) => arrow.end === endNumber);
    const total = roundTotal(arrows);
    return {
      endNumber,
      total,
      average: arrows.length ? total / arrows.length : null,
      arrowCount: arrows.length,
      expectedArrowCount: round.arrowsPerEnd,
      complete: arrows.length === round.arrowsPerEnd,
    };
  });
  const completed = ends.filter((end) => end.complete && end.average !== null);
  const average = completed.length ? completed.reduce((sum, end) => sum + end.average!, 0) / completed.length : null;
  const best = completed.reduce<EndPoint | null>((current, end) => !current || end.average! > current.average! ? end : current, null);
  const worst = completed.reduce<EndPoint | null>((current, end) => !current || end.average! < current.average! ? end : current, null);
  const consistency = completed.length < 2 || average === null
    ? null
    : Math.sqrt(completed.reduce((sum, end) => sum + (end.average! - average) ** 2, 0) / completed.length);
  const trendSlope = completed.length < 2
    ? null
    : regressionSlope(completed.map((end) => ({ x: end.endNumber, y: end.average! })));
  return { ends, completedEndCount: completed.length, average, best, worst, consistency, trendSlope };
}

export function calculateGroupingMetrics(
  arrows: Pick<GroupingPoint, "x" | "y">[],
  faceDiameterCm?: number,
): GroupingMetrics | null {
  if (arrows.length === 0) return null;
  const centreX = arrows.reduce((sum, arrow) => sum + arrow.x, 0) / arrows.length;
  const centreY = arrows.reduce((sum, arrow) => sum + arrow.y, 0) / arrows.length;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const arrow of arrows) {
    minX = Math.min(minX, arrow.x); maxX = Math.max(maxX, arrow.x);
    minY = Math.min(minY, arrow.y); maxY = Math.max(maxY, arrow.y);
  }
  const horizontalSpreadNormalized = maxX - minX;
  const verticalSpreadNormalized = maxY - minY;
  const enoughArrows = arrows.length >= 3;
  const spreadNormalized = enoughArrows
    ? Math.sqrt(arrows.reduce((sum, arrow) => sum + (arrow.x - centreX) ** 2 + (arrow.y - centreY) ** 2, 0) / arrows.length)
    : null;
  const groupSizeNormalized = enoughArrows ? maximumPairwiseDistance(arrows) : null;
  const faceRadiusCm = faceDiameterCm === undefined ? null : faceDiameterCm / 2;
  return {
    centreX,
    centreY,
    arrowCount: arrows.length,
    horizontalSpreadNormalized,
    verticalSpreadNormalized,
    horizontalSpreadCm: faceRadiusCm === null ? null : horizontalSpreadNormalized * faceRadiusCm,
    verticalSpreadCm: faceRadiusCm === null ? null : verticalSpreadNormalized * faceRadiusCm,
    groupSizeNormalized,
    spreadNormalized,
    groupSizeCm: groupSizeNormalized === null || faceRadiusCm === null ? null : groupSizeNormalized * faceRadiusCm,
    spreadCm: spreadNormalized === null || faceRadiusCm === null ? null : spreadNormalized * faceRadiusCm,
  };
}

export function geometricMedian(points: Pick<GroupingPoint, "x" | "y">[]) {
  if (!points.length) return null;
  let current = {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
  for (let iteration = 0; iteration < 80; iteration += 1) {
    let weightedX = 0;
    let weightedY = 0;
    let totalWeight = 0;
    let coincident: Pick<GroupingPoint, "x" | "y"> | null = null;
    for (const point of points) {
      const distance = Math.hypot(point.x - current.x, point.y - current.y);
      if (distance < 1e-9) { coincident = point; break; }
      const weight = 1 / distance;
      weightedX += point.x * weight;
      weightedY += point.y * weight;
      totalWeight += weight;
    }
    const next = coincident ? { x: coincident.x, y: coincident.y } : { x: weightedX / totalWeight, y: weightedY / totalWeight };
    if (Math.hypot(next.x - current.x, next.y - current.y) < 1e-7) return next;
    current = next;
  }
  return current;
}

export function calculateRobustMainGroup(arrows: GroupingPoint[], faceDiameterCm?: number): RobustMainGroup {
  if (!arrows.length) return { mainArrows: [], flyers: [], metrics: null };
  const initialCentre = geometricMedian(arrows)!;
  let mainArrows = arrows;
  let flyers: GroupingPoint[] = [];
  if (arrows.length >= 6) {
    const distances = arrows.map((arrow) => ({ arrow, distance: Math.hypot(arrow.x - initialCentre.x, arrow.y - initialCentre.y) }));
    const medianDistance = median(distances.map(({ distance }) => distance));
    const mad = median(distances.map(({ distance }) => Math.abs(distance - medianDistance)));
    const cutoff = medianDistance + Math.max(4.5 * 1.4826 * mad, .05);
    const candidates = distances.filter(({ distance }) => distance > cutoff && distance > medianDistance * 2.25);
    const maximumFlyers = Math.max(1, Math.floor(arrows.length * .15));
    if (candidates.length > 0 && candidates.length <= maximumFlyers) {
      const candidateIds = new Set(candidates.map(({ arrow }) => arrow.id));
      const possibleMain = arrows.filter((arrow) => !candidateIds.has(arrow.id));
      const maximumMainDistance = Math.max(...distances.filter(({ arrow }) => !candidateIds.has(arrow.id)).map(({ distance }) => distance));
      const minimumFlyerDistance = Math.min(...candidates.map(({ distance }) => distance));
      if (possibleMain.length >= 3 && minimumFlyerDistance >= Math.max(maximumMainDistance * 1.5, medianDistance + .08)) {
        mainArrows = possibleMain;
        flyers = candidates.map(({ arrow }) => arrow);
      }
    }
  }
  const centre = geometricMedian(mainArrows)!;
  const baseMetrics = calculateGroupingMetrics(mainArrows, faceDiameterCm)!;
  const spreadNormalized = mainArrows.length >= 3
    ? Math.sqrt(mainArrows.reduce((sum, arrow) => sum + (arrow.x - centre.x) ** 2 + (arrow.y - centre.y) ** 2, 0) / mainArrows.length)
    : null;
  const faceRadiusCm = faceDiameterCm === undefined ? null : faceDiameterCm / 2;
  return {
    mainArrows,
    flyers,
    metrics: {
      ...baseMetrics,
      centreX: centre.x,
      centreY: centre.y,
      spreadNormalized,
      spreadCm: spreadNormalized === null || faceRadiusCm === null ? null : spreadNormalized * faceRadiusCm,
    },
  };
}

export function calculateGroupingForArrows(arrowsToAnalyse: ArrowEntry[], faceType: RoundDraft["faceType"], faceDiameterCm?: number): RoundGroupingInsights {
  const arrows: GroupingPoint[] = [];
  let missingPlotCount = 0;
  let unassignedTripleCount = 0;
  for (const arrow of arrowsToAnalyse) {
    if (!arrow.plot) {
      missingPlotCount += 1;
      continue;
    }
    if (!Number.isFinite(arrow.plot.x) || !Number.isFinite(arrow.plot.y)) {
      missingPlotCount += 1;
      continue;
    }
    if (faceType === "triple_face" && (arrow.plot.faceIndex === undefined || ![0, 1, 2].includes(arrow.plot.faceIndex))) {
      unassignedTripleCount += 1;
      continue;
    }
    arrows.push({ id: arrow.id, x: arrow.plot.x, y: arrow.plot.y, faceIndex: arrow.plot.faceIndex, score: arrow.score });
  }
  return {
    arrows,
    missingPlotCount,
    unassignedTripleCount,
    metrics: calculateGroupingMetrics(arrows, faceDiameterCm),
  };
}

export function calculateRoundGroupingInsights(round: RoundDraft): RoundGroupingInsights {
  return calculateGroupingForArrows(round.arrows, round.faceType, round.faceDiameterCm);
}

/**
 * Returns the outer boundary of plotted coordinates in clockwise order.
 * Duplicate points are removed; collinear points correctly reduce to the two end points.
 */
export function convexHull<T extends Pick<GroupingPoint, "x" | "y">>(points: T[]): T[] {
  const unique = [...new Map(points.map((point) => [`${point.x},${point.y}`, point])).values()]
    .sort((first, second) => first.x - second.x || first.y - second.y);
  if (unique.length <= 2) return unique;

  const cross = (origin: T, first: T, second: T) =>
    (first.x - origin.x) * (second.y - origin.y) - (first.y - origin.y) * (second.x - origin.x);
  const lower: T[] = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: T[] = [];
  for (const point of [...unique].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function describeEndTrend(slope: number | null) {
  if (slope === null) return "End trend: Need at least two completed Ends.";
  if (Math.abs(slope) <= MOSTLY_STEADY_TREND_SLOPE) return "Mostly steady across your completed Ends.";
  return slope > 0 ? "Scoring increased later in the Round." : "Scoring decreased later in the Round.";
}

export function groupSizeThresholdCm(faceDiameterCm: number) {
  return faceDiameterCm * SIGHT_CHECK_GROUP_SIZE_FACE_RATIO;
}

export function calculateSightCheck(metrics: GroupingMetrics | null, faceDiameterCm: number): string | null {
  if (!metrics || metrics.arrowCount < SIGHT_CHECK_MIN_PLOTTED_ARROWS || metrics.spreadNormalized === null || metrics.groupSizeCm === null) return null;
  if (metrics.groupSizeCm > groupSizeThresholdCm(faceDiameterCm)) return "Group too spread out to judge sight position yet.";
  const offset = Math.hypot(metrics.centreX, metrics.centreY);
  if (offset < SIGHT_CHECK_MIN_OFFSET_NORMALIZED || offset < metrics.spreadNormalized * 1.5) return null;
  const directions = [
    Math.abs(metrics.centreX) >= .04 ? (metrics.centreX > 0 ? "right" : "left") : null,
    Math.abs(metrics.centreY) >= .04 ? (metrics.centreY > 0 ? "low" : "high") : null,
  ].filter((direction): direction is string => direction !== null);
  if (!directions.length) return null;
  return `Your group is consistently ${directions.join(" and ")} of centre. It may be worth checking your sight.`;
}

function maximumPairwiseDistance(arrows: Pick<GroupingPoint, "x" | "y">[]) {
  let maximum = 0;
  for (let first = 0; first < arrows.length; first += 1) {
    for (let second = first + 1; second < arrows.length; second += 1) {
      maximum = Math.max(maximum, Math.hypot(arrows[second].x - arrows[first].x, arrows[second].y - arrows[first].y));
    }
  }
  return maximum;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function regressionSlope(points: { x: number; y: number }[]) {
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const denominator = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  return denominator === 0 ? 0 : points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0) / denominator;
}
