import { summarizeRoundScores, xCount, type RoundDraft } from "./scoring-model.ts";
import { calculateGroupingForArrows, calculateRobustMainGroup, convexHull } from "./session-insights-model.ts";

/** A detached presentation snapshot. Scoring and grouping remain in their existing helpers. */
export function createGroupingExport(round: RoundDraft, context = "") {
  const snapshot = { ...round, arrows: round.arrows.map((arrow) => ({ ...arrow,
    plot: arrow.plot ? { ...arrow.plot } : null })) };
  const grouping = calculateGroupingForArrows(snapshot.arrows, snapshot.faceType, snapshot.faceDiameterCm);
  const mainGroup = calculateRobustMainGroup(grouping.arrows, snapshot.faceDiameterCm);
  const summary = summarizeRoundScores(snapshot.arrows, snapshot.ends);
  const ends = summary.ends.map((end) => ({ ...end, arrows: snapshot.arrows
    .filter((arrow) => arrow.end === end.end).sort((a, b) => a.arrow - b.arrow)
    .map((arrow) => ({ number: arrow.arrow, label: arrow.score === "X" ? "10X" : arrow.score })) }));
  return { round: snapshot, context, grouping, mainGroup, ends, total: summary.total,
    xCount: xCount(snapshot.arrows) };
}
export type GroupingExport = ReturnType<typeof createGroupingExport>;

export function groupingExportPosition(report: GroupingExport) {
  const metrics = report.mainGroup.metrics;
  if (!metrics) return "No plotted Arrows";
  const radius = report.round.faceDiameterCm / 2;
  const x = metrics.centreX * radius, y = metrics.centreY * radius;
  if (Math.abs(x) < .05 && Math.abs(y) < .05) return "Centred";
  return `${Math.abs(x).toFixed(1)} cm ${x >= 0 ? "right" : "left"} · ${Math.abs(y).toFixed(1)} cm ${y >= 0 ? "low" : "high"}`;
}

const xml = (value: string) => value.replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
const cm = (value: number | null | undefined) => value == null ? "—" : `${value.toFixed(1)} cm`;

/** Static SVG report shared by browser PNG export and native SVG capture. */
export function renderGroupingExport(report: GroupingExport) {
  const width = 800;
  const parts: string[] = [];
  const text = (x: number, y: number, value: string, size = 20, bold = false) =>
    `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${size}" fill="#242d2b"${bold ? ' font-weight="700"' : ""}>${xml(value)}</text>`;
  const lines = (value: string, length: number) => {
    const result: string[] = [];
    let remaining = value;
    while (remaining.length > length) {
      const split = remaining.lastIndexOf(" ", length);
      const at = split > 0 ? split : length;
      result.push(remaining.slice(0, at)); remaining = remaining.slice(at).trimStart();
    }
    if (remaining) result.push(remaining);
    return result;
  };
  let y = 42;
  parts.push(text(32, y, "ARC TRACK", 18, true)); y += 38;
  for (const line of lines(report.round.name, 42)) { parts.push(text(32, y, line, 28, true)); y += 34; }
  const face = report.round.faceType === "triple_face" ? "triple face" : report.round.faceType === "six_ring" ? "6-ring face" : "full face";
  for (const line of lines(`${report.context}${report.context ? " · " : ""}${report.round.division} · ${report.round.distanceMetres} m · ${report.round.faceDiameterCm} cm ${face}`, 68)) {
    parts.push(text(32, y, line, 17)); y += 24;
  }
  y += 10;
  const triple = report.round.faceType === "triple_face";
  const view = triple ? "-58 -168 116 336" : report.round.faceType === "six_ring" ? "-65 -65 130 130" : "-105 -105 210 210";
  const targetHeight = triple ? 440 : 380;
  const radii = triple ? [.5, .4, .3, .2, .1] : report.round.faceType === "six_ring" ? [.6, .5, .4, .3, .2, .1] : [1, .9, .8, .7, .6, .5, .4, .3, .2, .1];
  const colors: Record<number, string> = { 1: "#f4f1e9", .9: "#f4f1e9", .8: "#202020", .7: "#202020", .6: "#49a4cf", .5: "#49a4cf", .4: "#e65a55", .3: "#e65a55", .2: "#f5cf3d", .1: "#f5cf3d" };
  const centres = triple ? [-110, 0, 110] : [0];
  const target: string[] = [];
  centres.forEach((cy, index) => {
    radii.forEach((radius) => target.push(`<circle cx="0" cy="${cy}" r="${radius * 100}" fill="${colors[radius]}" stroke="#4b443e" stroke-width=".7"/>`));
    target.push(`<circle cx="0" cy="${cy}" r="5" fill="none" stroke="#4b443e" stroke-width=".7"/>`);
    const arrows = report.mainGroup.mainArrows.filter((arrow) => !triple || arrow.faceIndex === index);
    const hull = convexHull(arrows);
    if (hull.length >= 3) target.push(`<polygon points="${hull.map((arrow) => `${arrow.x * 100},${cy + arrow.y * 100}`).join(" ")}" fill="#306b60" fill-opacity=".18" stroke="#306b60" stroke-width=".8"/>`);
    if (report.mainGroup.metrics && arrows.length) {
      const { centreX, centreY } = report.mainGroup.metrics;
      target.push(`<line x1="0" y1="${cy}" x2="${centreX * 100}" y2="${cy + centreY * 100}" stroke="#306b60" stroke-width="1"/><circle cx="${centreX * 100}" cy="${cy + centreY * 100}" r="3" fill="none" stroke="#306b60" stroke-width="1.2"/>`);
    }
  });
  report.grouping.arrows.forEach((arrow) => target.push(`<circle cx="${arrow.x * 100}" cy="${(triple ? centres[arrow.faceIndex!] : 0) + arrow.y * 100}" r="1.8" fill="#242d2b" stroke="#fff" stroke-width=".6"/>`));
  parts.push(`<svg x="32" y="${y}" width="736" height="${targetHeight}" viewBox="${view}">${target.join("")}</svg>`);
  y += targetHeight + 34;
  const metrics = report.grouping.metrics;
  const stats = [
    ["Group position", groupingExportPosition(report)],
    ["Group size", cm(metrics?.groupSizeCm)],
    ["Horizontal Spread", cm(metrics?.horizontalSpreadCm)],
    ["Vertical Spread", cm(metrics?.verticalSpreadCm)],
    ["RMS spread", cm(metrics?.spreadCm)],
    ["Plotted Arrows", String(report.grouping.arrows.length)],
  ];
  stats.forEach(([label, value]) => { parts.push(text(32, y, label, 18), text(260, y, value, 19, true)); y += 30; });
  y += 18; parts.push(text(32, y, "END SCORES", 19, true)); y += 34;
  for (const end of report.ends) {
    parts.push(`<line x1="32" y1="${y - 20}" x2="768" y2="${y - 20}" stroke="#d7ddd8"/>`);
    parts.push(text(32, y + 6, `END ${end.end}`, 18, true), text(642, y + 6, end.score === null ? "—" : `${end.score} pts`, 18, true));
    const labels = end.arrows.length ? end.arrows.map((arrow) => arrow.label) : ["—"];
    for (let start = 0; start < labels.length; start += 8) {
      parts.push(text(155, y + 6, labels.slice(start, start + 8).join(" · "), 20)); y += 32;
    }
    y += 12;
  }
  y += 14;
  parts.push(text(32, y, "TOTAL SCORE", 20, true), text(540, y + 4, String(report.total), 34, true), text(680, y, `${report.xCount}X`, 20, true));
  const height = y + 36;
  return { width, height, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#ffffff"/>${parts.join("")}</svg>` };
}
