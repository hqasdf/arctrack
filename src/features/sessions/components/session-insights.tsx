import { calculateEndAnalysis, calculateRoundGroupingInsights, convexHull, describeEndTrend, type EndPoint, type GroupingPoint, type RoundGroupingInsights } from "../session-insights-model";
import type { RoundDraft, TargetFaceType } from "../scoring-model";
import styles from "./sessions.module.css";

const ringColours: Record<number, string> = { 1: "#f4f1e9", .9: "#f4f1e9", .8: "#202020", .7: "#202020", .6: "#49a4cf", .5: "#49a4cf", .4: "#e65a55", .3: "#e65a55", .2: "#f5cf3d", .1: "#f5cf3d" };
const fullRings = [1, .9, .8, .7, .6, .5, .4, .3, .2, .1];
const sixRings = [.6, .5, .4, .3, .2, .1];
const tripleRings = [.5, .4, .3, .2, .1];
const tripleCentres = [-110, 0, 110] as const;
const views = { full_face: "-105 -105 210 210", six_ring: "-65 -65 130 130", triple_face: "-58 -168 116 336" } as const;

export function RoundInsights({ round, showTarget = true }: { round: RoundDraft; showTarget?: boolean }) {
  const endAnalysis = calculateEndAnalysis(round);
  const grouping = calculateRoundGroupingInsights(round);
  return <section className={styles.sessionInsights} aria-labelledby="round-insights-heading">
    <div className={styles.insightsHeading}><div><p className={styles.kicker}>Saved performance</p><h2 id="round-insights-heading">Round Insights</h2></div></div>
    <div className={styles.insightsGrid}>
      <article className={styles.insightCard} aria-labelledby="end-performance-heading"><p className={styles.kicker}>Within this Round</p><h3 id="end-performance-heading">End Performance</h3><EndChart ends={endAnalysis.ends}/><div className={styles.insightMetrics}><Metric label="Best End" value={endAnalysis.best ? `End ${endAnalysis.best.endNumber} / ${endAnalysis.best.average!.toFixed(1)} avg` : "No completed End"}/><Metric label="Lowest End" value={endAnalysis.worst ? `End ${endAnalysis.worst.endNumber} / ${endAnalysis.worst.average!.toFixed(1)} avg` : "No completed End"}/><Metric label="End consistency" value={endAnalysis.consistency === null ? "Need at least two completed Ends" : `Your completed Ends were typically about ${endAnalysis.consistency.toFixed(1)} points/Arrow from your Round average.`}/></div><p className={styles.insightNote}>{describeEndTrend(endAnalysis.trendSlope)}</p><details className={styles.insightDetails}><summary>View details</summary><p>Completed-End average: {endAnalysis.average === null ? "not available" : `${endAnalysis.average.toFixed(2)} points/Arrow`}. Variation: {endAnalysis.consistency === null ? "not available" : `${endAnalysis.consistency.toFixed(2)} standard deviation`}. Trend slope: {endAnalysis.trendSlope === null ? "not available" : `${endAnalysis.trendSlope >= 0 ? "+" : ""}${endAnalysis.trendSlope.toFixed(2)} points/Arrow per End`}.</p></details></article>
      <article className={styles.insightCard} aria-labelledby="grouping-insights-heading"><p className={styles.kicker}>Saved target coordinates</p><h3 id="grouping-insights-heading">Target / Grouping Insights</h3>{showTarget && <GroupingTarget round={round} grouping={grouping}/>}<GroupingSummary round={round} grouping={grouping}/></article>
    </div>
  </section>;
}

function EndChart({ ends }: { ends: EndPoint[] }) {
  const shown = ends.filter((end) => end.average !== null);
  if (shown.length === 0) return <div className={styles.insightEmpty}>No saved Arrows in this Round yet.</div>;
  return <><div className={styles.sessionEndChart}>{shown.map((end) => <div key={end.endNumber} className={styles.sessionEndColumn}><div className={styles.sessionEndTrack}><div className={`${styles.sessionEndBar} ${end.complete ? "" : styles.sessionEndPartial}`} style={{ height: `${Math.max(4, end.average! / 10 * 100)}%` }}/></div><strong>{end.average!.toFixed(2)}</strong><span>End {end.endNumber}</span><small>{end.complete ? `Completed / ${end.arrowCount}` : `Partial / ${end.arrowCount}/${end.expectedArrowCount}`}</small></div>)}</div><p className={styles.insightNote}>Partial Ends are shown for context and excluded from the summary.</p></>;
}

export function GroupingTarget({ round, grouping }: { round: RoundDraft; grouping: RoundGroupingInsights }) {
  if (grouping.arrows.length === 0) return <div className={styles.insightEmpty}>No plotted Arrows yet.</div>;
  const metrics = grouping.metrics!;
  const groups = round.faceType === "triple_face"
    ? tripleCentres.map((centre, faceIndex) => ({ centre, arrows: grouping.arrows.filter((arrow) => arrow.faceIndex === faceIndex) })).filter(({ arrows }) => arrows.length > 0)
    : [{ centre: 0, arrows: grouping.arrows }];
  return <div className={`${styles.insightTarget} ${round.faceType === "triple_face" ? styles.insightTripleTarget : ""}`}><svg viewBox={views[round.faceType]} role="img" aria-label={`${faceLabel(round.faceType)} showing ${grouping.arrows.length} plotted Arrows and the group centre`}>
    {round.faceType === "triple_face" ? tripleCentres.map((cy) => <Face key={cy} cy={cy} radii={tripleRings}/>) : <Face cy={0} radii={round.faceType === "six_ring" ? sixRings : fullRings}/>}
    {groups.map(({ centre, arrows }) => <GroupingOverlay key={centre} arrows={arrows} centreX={metrics.centreX} centreY={metrics.centreY} faceCentreY={centre}/>)}
    {grouping.arrows.map((arrow) => { const cy = round.faceType === "triple_face" ? tripleCentres[arrow.faceIndex ?? 1] : 0; return <circle key={arrow.id} cx={arrow.x * 100} cy={cy + arrow.y * 100} r="3.2" className={styles.insightMarker}/>; })}
  </svg></div>;
}

function GroupingOverlay({ arrows, centreX, centreY, faceCentreY }: { arrows: GroupingPoint[]; centreX: number; centreY: number; faceCentreY: number }) {
  const hull = arrows.length >= 3 ? convexHull(arrows) : [];
  const coordinates = hull.map((arrow) => `${arrow.x * 100},${faceCentreY + arrow.y * 100}`).join(" ");
  return <g>{hull.length >= 3 ? <polygon points={coordinates} className={styles.groupHull}/> : hull.length === 2 ? <polyline points={coordinates} className={styles.groupHullLine}/> : null}<line x1="0" y1={faceCentreY} x2={centreX * 100} y2={faceCentreY + centreY * 100} className={styles.groupCentreLine}/><circle cx={centreX * 100} cy={faceCentreY + centreY * 100} r="3.4" className={styles.groupCentreMarker}/></g>;
}

function GroupingSummary({ round, grouping }: { round: RoundDraft; grouping: RoundGroupingInsights }) {
  const metrics = grouping.metrics;
  if (!metrics) return null;
  const enoughArrows = metrics.arrowCount >= 3;
  const faceRadiusCm = round.faceDiameterCm / 2;
  return <><div className={styles.groupingInsightMetrics}><Metric label="Group position" value={`${axisCm(metrics.centreX, "right", "left", faceRadiusCm)} / ${axisCm(metrics.centreY, "low", "high", faceRadiusCm)}`}/>{enoughArrows ? <><Metric label="Group size" value={`${metrics.groupSizeCm!.toFixed(1)} cm`}/><Metric label="Group tightness" value={`Most plotted Arrows are about ${metrics.spreadCm!.toFixed(1)} cm from the group centre.`}/></> : <Metric label="Grouping" value="Add at least 3 plotted Arrows for group shape, size, and tightness."/>}<Metric label="Horizontal Spread" value={`${metrics.horizontalSpreadCm!.toFixed(1)} cm`}/><Metric label="Vertical Spread" value={`${metrics.verticalSpreadCm!.toFixed(1)} cm`}/></div><p className={styles.insightNote}>{metrics.arrowCount} plotted {metrics.arrowCount === 1 ? "Arrow" : "Arrows"}{grouping.missingPlotCount ? ` / ${grouping.missingPlotCount} without plot coordinates` : ""}{grouping.unassignedTripleCount ? ` / ${grouping.unassignedTripleCount} Triple-face plots without face index excluded` : ""}</p><details className={styles.insightDetails}><summary>View details</summary><p>Normalised group centre: {metrics.centreX.toFixed(3)}, {metrics.centreY.toFixed(3)}. Normalised spread: {metrics.spreadNormalized === null ? "not available" : metrics.spreadNormalized.toFixed(3)}.</p></details></>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function Face({ cy, radii }: { cy: number; radii: number[] }) { return <g>{radii.map((radius) => <circle key={radius} cx="0" cy={cy} r={radius * 100} fill={ringColours[radius]} stroke="#4b443e" strokeWidth=".7"/>)}<circle cx="0" cy={cy} r="5" fill="none" stroke="#4b443e" strokeWidth=".7"/><circle cx="0" cy={cy} r="1.5" fill="none" stroke="#4b443e" strokeWidth=".6"/></g>; }
function faceLabel(faceType: TargetFaceType) { return faceType === "triple_face" ? "Triple-face target" : faceType === "six_ring" ? "Six-ring target" : "Full-face target"; }
function axisCm(value: number, positive: string, negative: string, faceRadiusCm: number) { return `${(Math.abs(value) * faceRadiusCm).toFixed(1)} cm ${value >= 0 ? positive : negative}`; }
