import test from "node:test";
import assert from "node:assert/strict";
import { MOSTLY_STEADY_TREND_SLOPE, calculateEndAnalysis, calculateGroupingForArrows, calculateGroupingMetrics, calculateRobustMainGroup, calculateRoundGroupingInsights, calculateSightCheck, convexHull, describeEndTrend, geometricMedian, groupSizeThresholdCm } from "../src/session-insights-model.ts";

function arrow(id, score, end, plot = null) { return { id, end, arrow: Number(id.replace(/\D/g, "")) || 1, score, plot, syncState: "saved" }; }
function round(overrides = {}) { return { id: "round", roundNumber: 1, name: "Round", division: "Recurve", distanceMetres: 70, ends: 1, arrowsPerEnd: 3, faceDiameterCm: 122, faceType: "full_face", arrows: [], ...overrides }; }
function plottedGroup(count, centreX = 0, centreY = 0, radius = .08, faceIndex) { return Array.from({ length: count }, (_, index) => ({ id: `p${index}`, x: centreX + Math.cos(index * 2.399) * radius * (.65 + index % 4 / 10), y: centreY + Math.sin(index * 2.399) * radius * (.65 + index % 3 / 10), faceIndex, score: "9" })); }

test("End summaries exclude partial Ends while retaining them in chart data", () => {
  const analyzed = calculateEndAnalysis(round({ ends: 3, arrowsPerEnd: 3, arrows: [
    arrow("e1", "10", 1), arrow("e2", "9", 1), arrow("e3", "8", 1),
    arrow("e4", "1", 2),
    arrow("e5", "6", 3), arrow("e6", "6", 3), arrow("e7", "6", 3),
  ] }));
  assert.deepEqual(analyzed.ends.map((end) => [end.endNumber, end.complete, end.average]), [[1, true, 9], [2, false, 1], [3, true, 6]]);
  assert.equal(analyzed.best?.endNumber, 1);
  assert.equal(analyzed.worst?.endNumber, 3);
  assert.equal(analyzed.average, 7.5);
  assert.equal(analyzed.consistency, 1.5);
  assert.equal(analyzed.trendSlope, -1.5);
});

test("Consistency and trend require two completed Ends", () => {
  const analyzed = calculateEndAnalysis(round({ ends: 2, arrowsPerEnd: 2, arrows: [arrow("e1", "10", 1), arrow("e2", "8", 1), arrow("e3", "X", 2)] }));
  assert.equal(analyzed.completedEndCount, 1);
  assert.equal(analyzed.consistency, null);
  assert.equal(analyzed.trendSlope, null);
});

test("Grouping centre, group size and RMS spread convert from face radius to centimetres", () => {
  const result = calculateGroupingMetrics([{ x: -0.1, y: 0 }, { x: 0.1, y: 0 }, { x: 0, y: 0.3 }], 40);
  assert.equal(result?.centreX, 0);
  assert.ok(Math.abs(result.centreY - 0.1) < 1e-12);
  assert.ok(Math.abs(result.spreadNormalized - Math.sqrt(0.08 / 3)) < 1e-12);
  assert.ok(Math.abs(result.spreadCm - Math.sqrt(0.08 / 3) * 20) < 1e-12);
  assert.ok(Math.abs(result.groupSizeNormalized - Math.sqrt(0.1)) < 1e-12);
  assert.ok(Math.abs(result.groupSizeCm - Math.sqrt(0.1) * 20) < 1e-12);
});

test("Group size and spread require at least three plotted Arrows", () => {
  const result = calculateGroupingMetrics([{ x: 0, y: 0 }, { x: 1, y: 1 }], 122);
  assert.equal(result?.groupSizeCm, null);
  assert.equal(result?.spreadCm, null);
});

test("Triple-face grouping combines local coordinates and keeps face indexes for rendering", () => {
  const result = calculateRoundGroupingInsights(round({ faceDiameterCm: 40, faceType: "triple_face", arrows: [
    arrow("a1", "9", 1, { x: 0.1, y: 0.1, faceIndex: 0 }),
    arrow("a2", "9", 1, { x: 0.1, y: 0.1, faceIndex: 1 }),
    arrow("a3", "9", 1, { x: 0.1, y: 0.1, faceIndex: 2 }),
    arrow("a4", "8", 1, { x: 0.2, y: 0.2 }),
  ] }));
  assert.deepEqual(result.arrows.map((item) => item.faceIndex), [0, 1, 2]);
  assert.equal(result.unassignedTripleCount, 1);
  assert.equal(result.metrics?.groupSizeCm, 0);
  assert.ok(Math.abs(result.metrics?.spreadCm ?? 1) < 1e-12);
});

test("convex hull keeps only the outer grouping shape and includes an outlier", () => {
  const hull = convexHull([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: .5, y: .5 }, { x: 2, y: .5 }]);
  assert.deepEqual(hull.map(({ x, y }) => [x, y]), [[0, 0], [1, 0], [2, .5], [1, 1], [0, 1]]);
  assert.equal(hull.some(({ x, y }) => x === .5 && y === .5), false);
});

test("convex hull handles small, duplicate, and collinear plotted groups", () => {
  assert.deepEqual(convexHull([{ x: .1, y: .2 }, { x: .1, y: .2 }]), [{ x: .1, y: .2 }]);
  assert.deepEqual(convexHull([{ x: 0, y: 0 }, { x: .5, y: .5 }, { x: 1, y: 1 }]), [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
});

test("triple-face hull coordinates remain local to each face", () => {
  const grouped = calculateRoundGroupingInsights(round({ faceType: "triple_face", arrows: [
    arrow("a1", "9", 1, { x: -.2, y: -.1, faceIndex: 0 }),
    arrow("a2", "9", 1, { x: .2, y: -.1, faceIndex: 0 }),
    arrow("a3", "9", 1, { x: 0, y: .2, faceIndex: 0 }),
    arrow("a4", "9", 1, { x: -.2, y: -.1, faceIndex: 2 }),
  ] }));
  const topHull = convexHull(grouped.arrows.filter((arrow) => arrow.faceIndex === 0));
  const bottomHull = convexHull(grouped.arrows.filter((arrow) => arrow.faceIndex === 2));
  assert.equal(topHull.length, 3);
  assert.equal(bottomHull.length, 1);
  assert.ok(topHull.every((arrow) => arrow.faceIndex === 0));
});

test("end trend wording keeps small score changes neutral", () => {
  assert.equal(describeEndTrend(MOSTLY_STEADY_TREND_SLOPE), "Mostly steady across your completed Ends.");
  assert.equal(describeEndTrend(-MOSTLY_STEADY_TREND_SLOPE), "Mostly steady across your completed Ends.");
  assert.equal(describeEndTrend(MOSTLY_STEADY_TREND_SLOPE + .01), "Scoring increased later in the Round.");
  assert.equal(describeEndTrend(-MOSTLY_STEADY_TREND_SLOPE - .01), "Scoring decreased later in the Round.");
});

test("live target grouping shares the Round grouping model for full and six-ring faces", () => {
  const arrows = [
    arrow("a1", "9", 1, { x: -.2, y: -.1 }),
    arrow("a2", "9", 1, { x: .2, y: -.1 }),
    arrow("a3", "9", 1, { x: 0, y: .2 }),
  ];
  const full = calculateGroupingForArrows(arrows, "full_face", 122);
  const six = calculateGroupingForArrows(arrows, "six_ring", 80);
  assert.equal(full.arrows.length, 3);
  assert.equal(six.arrows.length, 3);
  assert.equal(convexHull(full.arrows).length, 3);
  assert.equal(full.metrics?.groupSizeNormalized, six.metrics?.groupSizeNormalized);
  assert.notEqual(full.metrics?.groupSizeCm, six.metrics?.groupSizeCm);
});

test("live grouping safely represents one, two, and removed plotted Arrows", () => {
  const first = arrow("a1", "9", 1, { x: 0, y: 0 });
  const second = arrow("a2", "8", 1, { x: .1, y: .1 });
  const third = arrow("a3", "7", 1, { x: -.2, y: .2 });
  assert.equal(calculateGroupingForArrows([first], "full_face", 122).metrics?.groupSizeCm, null);
  assert.equal(calculateGroupingForArrows([first, second], "full_face", 122).metrics?.spreadCm, null);
  const three = calculateGroupingForArrows([first, second, third], "full_face", 122);
  assert.equal(convexHull(three.arrows).length, 3);
  const afterRemoval = calculateGroupingForArrows([first, third], "full_face", 122);
  assert.equal(afterRemoval.metrics?.groupSizeCm, null);
});

test("horizontal and vertical spans use the full plotted extent and the target radius", () => {
  const points = [
    arrow("a1", "M", 1, { x: -0.2, y: -0.1 }),
    arrow("a2", "10", 1, { x: 0.3, y: 0.25 }),
  ];
  const metrics = calculateGroupingForArrows(points, "full_face", 80).metrics;
  assert.equal(metrics?.horizontalSpreadNormalized, 0.5);
  assert.equal(metrics?.verticalSpreadNormalized, 0.35);
  assert.equal(metrics?.horizontalSpreadCm, 20);
  assert.equal(metrics?.verticalSpreadCm, 14);
  // Score-only corrections do not affect position-derived measurements.
  const corrected = calculateGroupingForArrows(points.map((item) => ({ ...item, score: "X" })), "full_face", 80).metrics;
  assert.equal(corrected?.horizontalSpreadCm, metrics?.horizontalSpreadCm);
  assert.equal(corrected?.verticalSpreadCm, metrics?.verticalSpreadCm);
});

test("single plotted Arrow has zero extent and no plotted Arrows have unavailable extent", () => {
  const only = arrow("a1", "9", 1, { x: -0.4, y: 0.7 });
  const one = calculateGroupingForArrows([only], "full_face", 122).metrics;
  assert.equal(one?.horizontalSpreadNormalized, 0);
  assert.equal(one?.verticalSpreadNormalized, 0);
  assert.equal(one?.horizontalSpreadCm, 0);
  assert.equal(one?.verticalSpreadCm, 0);
  assert.equal(calculateGroupingForArrows([], "full_face", 122).metrics, null);
});

test("multi-Arrow extents are order-independent and include flyers", () => {
  const points = [
    arrow("a1", "9", 1, { x: -0.4, y: 0.1 }),
    arrow("a2", "9", 1, { x: 0.2, y: -0.5 }),
    arrow("a3", "9", 1, { x: 0.6, y: 0.3 }),
    arrow("a4", "9", 1, { x: -0.1, y: 0.7 }),
    arrow("flyer", "M", 1, { x: 0.9, y: 0.95 }),
  ];
  const forward = calculateGroupingForArrows(points, "full_face", 40).metrics;
  const reverse = calculateGroupingForArrows([...points].reverse(), "full_face", 40).metrics;
  assert.equal(forward?.horizontalSpreadNormalized, 1.3);
  assert.equal(forward?.verticalSpreadNormalized, 1.45);
  assert.equal(forward?.horizontalSpreadCm, 26);
  assert.equal(forward?.verticalSpreadCm, 29);
  assert.equal(reverse?.horizontalSpreadCm, forward?.horizontalSpreadCm);
  assert.equal(reverse?.verticalSpreadCm, forward?.verticalSpreadCm);
});

test("unplotted and invalid coordinates are excluded using grouping eligibility", () => {
  const result = calculateGroupingForArrows([
    arrow("valid1", "9", 1, { x: -0.2, y: -0.1 }),
    arrow("score-only", "10", 1),
    arrow("invalid", "8", 1, { x: Number.NaN, y: 0.4 }),
  ], "full_face", 80);
  assert.deepEqual(result.arrows.map((item) => item.id), ["valid1"]);
  assert.equal(result.missingPlotCount, 2);
  const triple = calculateGroupingForArrows([
    arrow("valid-triple", "9", 1, { x: 0.1, y: 0.2, faceIndex: 2 }),
    arrow("missing-face", "9", 1, { x: 0.2, y: 0.3 }),
    arrow("invalid-face", "9", 1, { x: 0.2, y: 0.3, faceIndex: 3 }),
  ], "triple_face", 40);
  assert.deepEqual(triple.arrows.map((item) => item.id), ["valid-triple"]);
  assert.equal(triple.unassignedTripleCount, 2);
});

test("triple-face extents combine existing local face coordinates without spot separation", () => {
  const result = calculateGroupingForArrows([
    arrow("top", "9", 1, { x: -0.2, y: -0.1, faceIndex: 0 }),
    arrow("middle", "9", 1, { x: 0.3, y: 0.25, faceIndex: 1 }),
    arrow("bottom", "9", 1, { x: 0.1, y: -0.2, faceIndex: 2 }),
  ], "triple_face", 40).metrics;
  assert.equal(result?.horizontalSpreadNormalized, 0.5);
  assert.equal(result?.verticalSpreadNormalized, 0.45);
  assert.equal(result?.horizontalSpreadCm, 10);
  assert.equal(result?.verticalSpreadCm, 9);
});

test("sight check uses physical group diameter rather than an RMS spread threshold", () => {
  assert.ok(Math.abs(groupSizeThresholdCm(122) - 48.8) < 1e-12);
  assert.equal(groupSizeThresholdCm(80), 32);
  assert.equal(groupSizeThresholdCm(40), 16);
  assert.equal(calculateSightCheck({ centreX: .2, centreY: 0, arrowCount: 3, groupSizeNormalized: .1, spreadNormalized: .04, groupSizeCm: 6.1, spreadCm: 2.4 }, 122), null);
  const threshold = groupSizeThresholdCm(122);
  const thresholdMetrics = { centreX: .2, centreY: 0, arrowCount: 6, groupSizeNormalized: .8, spreadNormalized: .05, groupSizeCm: threshold, spreadCm: 3.05 };
  assert.equal(calculateSightCheck(thresholdMetrics, 122), "Your group is consistently right of centre. It may be worth checking your sight.");
  assert.equal(calculateSightCheck({ ...thresholdMetrics, groupSizeCm: threshold + .0001 }, 122), "Group too spread out to judge sight position yet.");
  assert.equal(calculateSightCheck({ centreX: .03, centreY: .02, arrowCount: 6, groupSizeNormalized: .1, spreadNormalized: .04, groupSizeCm: 6.1, spreadCm: 2.4 }, 122), null);
  assert.equal(calculateSightCheck({ centreX: .3, centreY: -.1, arrowCount: 6, groupSizeNormalized: .1, spreadNormalized: .16, groupSizeCm: 30, spreadCm: 9.8 }, 122), "Your group is consistently right and high of centre. It may be worth checking your sight.");
});

test("geometric median and robust main group resist one obvious flyer", () => {
  const cluster = plottedGroup(35, .18, -.12, .07);
  const flyer = { id: "flyer", x: .9, y: .75, score: "4" };
  const result = calculateRobustMainGroup([...cluster, flyer], 122);
  const centre = geometricMedian([...cluster, flyer]);
  assert.equal(result.mainArrows.length, 35);
  assert.deepEqual(result.flyers.map(({ id }) => id), ["flyer"]);
  assert.ok(Math.abs((centre?.x ?? 0) - .18) < .02);
  assert.ok(Math.abs((result.metrics?.centreY ?? 0) + .12) < .02);
});

test("robust main group conservatively handles dense counts and two clear flyers", () => {
  for (const count of [1, 2, 6, 18, 36, 55]) {
    const result = calculateRobustMainGroup(plottedGroup(count, .1, .05, .1), 80);
    assert.equal(result.mainArrows.length, count);
    assert.equal(result.flyers.length, 0);
  }
  const cluster = plottedGroup(18, -.1, .12, .06);
  const result = calculateRobustMainGroup([...cluster, { id: "f1", x: .8, y: .75, score: "3" }, { id: "f2", x: -.85, y: -.7, score: "2" }], 80);
  assert.deepEqual(new Set(result.flyers.map(({ id }) => id)), new Set(["f1", "f2"]));
});

test("generally scattered shooting does not invent a main cluster or flyers", () => {
  const scattered = Array.from({ length: 36 }, (_, index) => ({ id: `s${index}`, x: Math.cos(index / 36 * Math.PI * 2) * (.35 + index % 5 * .1), y: Math.sin(index / 36 * Math.PI * 2) * (.35 + index % 5 * .1), score: "6" }));
  const result = calculateRobustMainGroup(scattered, 122);
  assert.equal(result.mainArrows.length, 36);
  assert.equal(result.flyers.length, 0);
});

test("Triple-face robust grouping uses local coordinates rather than physical spot separation", () => {
  const local = [...plottedGroup(6, .15, -.1, .04, 0), ...plottedGroup(6, .15, -.1, .04, 1), ...plottedGroup(6, .15, -.1, .04, 2)];
  const result = calculateRobustMainGroup(local, 40);
  assert.equal(result.flyers.length, 0);
  assert.ok(Math.abs((result.metrics?.centreX ?? 0) - .15) < .02);
  assert.ok(Math.abs((result.metrics?.centreY ?? 0) + .1) < .02);
});
