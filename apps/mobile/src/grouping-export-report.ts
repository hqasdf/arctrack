import { renderGroupingExport, type GroupingExport } from "@arc-track/core/grouping-export";
import { mobileRoundInsights } from "./mobile-analytics.ts";

export const EXPORT_TOP_PADDING = 100;
export const MOBILE_REPORT_WIDTH = 390;
export function mobileExportPreviewWidth(screenWidth: number) {
  return Math.min(Math.max(1, screenWidth - 24), MOBILE_REPORT_WIDTH);
}

const escapeXml = (value: string) => value.replace(/[&<>"']/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
const cm = (value: number | null | undefined) => value == null ? "—" : `${value.toFixed(1)} cm`;
const number = (value: number | null) => value === null ? "—" : value.toFixed(2);
const percent = (value: number | null) => value === null ? "—" : `${value.toFixed(1)}%`;

/** Mobile-only presentation. All statistics come from the existing Round Insights result. */
export function renderMobileGroupingExport(report: GroupingExport) {
  const insight = mobileRoundInsights(report.round);
  const metrics = insight.grouping.metrics;
  const radius = report.round.faceDiameterCm / 2;
  // Match the existing Expo Group Position display, including its direction convention.
  const axis = (value: number, positive: string, negative: string) =>
    `${(Math.abs(value) * radius).toFixed(1)} cm ${value >= 0 ? positive : negative}`;
  const stats = [
    ["Group position", metrics ? `${axis(metrics.centreX, "right", "left")} · ${axis(metrics.centreY, "low", "high")}` : "No plotted Arrows yet."],
    ["Group size", metrics?.groupSizeCm == null ? "Need 3 plots" : cm(metrics.groupSizeCm)],
    ["Horizontal Spread", cm(metrics?.horizontalSpreadCm)],
    ["Vertical Spread", cm(metrics?.verticalSpreadCm)],
    ["RMS spread", metrics?.spreadCm == null ? "Need 3 plots" : cm(metrics.spreadCm)],
    ["Plotted Arrows", String(insight.grouping.arrows.length)],
    ["Possible Flyers", String(insight.mainGroup.flyers.length)],
    ["Round status", insight.complete ? "Completed Round" : "Round in progress"],
    ["Recorded Arrows", `${insight.arrowCount}/${report.round.ends * report.round.arrowsPerEnd}`],
    ["Avg / Arrow", number(insight.average)],
    ["X", `${insight.overview.xCount} · ${percent(insight.overview.xPercentage)}`],
    ["10 + X", `${insight.tenPlusXCount} · ${percent(insight.overview.tenPlusXPercentage)}`],
    ["Best completed End", insight.ends.best ? `End ${insight.ends.best.endNumber} · ${number(insight.ends.best.average)} avg` : "—"],
    ["Consistency", insight.ends.consistency === null ? "Need at least two completed Ends" : `${insight.ends.consistency.toFixed(2)} points/Arrow`],
  ];
  const width = MOBILE_REPORT_WIDTH;
  const parts: string[] = [];
  let y = EXPORT_TOP_PADDING;
  function text(value: string, size = 16, bold = false, x = 24) {
    y += size;
    parts.push(`<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${size}" fill="#242d2b"${bold ? ' font-weight="700"' : ""}>${escapeXml(value)}</text>`);
    y += 8;
  }
  function wrapped(value: string, size = 16, bold = false) {
    // Conservative character widths also wrap long unbroken names safely.
    const limit = Math.floor((width - 48) / (size * .72));
    let rest = value;
    while (rest.length > limit) {
      const space = rest.lastIndexOf(" ", limit);
      const at = space > 0 ? space : limit;
      text(rest.slice(0, at), size, bold); rest = rest.slice(at).trimStart();
    }
    if (rest) text(rest, size, bold);
  }
  text("ARC TRACK", 16, true);
  wrapped(report.round.name, 24, true);
  wrapped(report.context, 15);
  const face = report.round.faceType === "triple_face" ? "triple face" : report.round.faceType === "six_ring" ? "6-ring face" : "full face";
  wrapped(`${report.round.division} · ${report.round.distanceMetres} m · ${report.round.faceDiameterCm} cm ${face}`, 15);
  y += 16;
  // Reuse the shared static target verbatim; change only its report placement/size.
  const target = renderGroupingExport(report).svg.match(/<svg x="32"[^>]*>[\s\S]*?<\/svg>/)?.[0];
  if (!target) throw new Error("Static export target is unavailable.");
  const targetWidth = Math.round((width - 48) * .85);
  const targetHeight = targetWidth;
  const targetX = (width - targetWidth) / 2;
  const viewBox = target.match(/viewBox="([^"]+)"/)?.[1].split(/\s+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value))) throw new Error("Static target viewBox is unavailable.");
  const [viewX, viewY, viewWidth, viewHeight] = viewBox;
  // SVG xMidYMid/meet presentation mapping, without a nested native SVG viewport.
  const scale = Math.min(targetWidth / viewWidth, targetHeight / viewHeight);
  const translateX = targetX + (targetWidth - viewWidth * scale) / 2 - viewX * scale;
  const translateY = y + (targetHeight - viewHeight * scale) / 2 - viewY * scale;
  const targetContent = target.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  const targetTop = y;
  parts.push(`<defs><clipPath id="export-target-bounds"><rect x="${targetX}" y="${y}" width="${targetWidth}" height="${targetHeight}"/></clipPath></defs><g clip-path="url(#export-target-bounds)"><g transform="translate(${translateX} ${translateY}) scale(${scale})">${targetContent}</g></g>`);
  y += targetHeight + 24;
  text("GROUPING / ROUND STATS", 16, true);
  for (const [label, value] of stats) {
    y += 8; text(label, 14); wrapped(value, 16, true);
  }
  y += 20;
  const endsTop = y;
  text("END SCORES", 16, true);
  const endPositions: number[] = [];
  for (const end of report.ends) {
    endPositions.push(y);
    y += 12;
    parts.push(`<line x1="24" y1="${y}" x2="366" y2="${y}" stroke="#d7ddd8"/>`);
    y += 8; text(`END ${end.end}`, 16, true);
    wrapped(end.arrows.length ? end.arrows.map((arrow) => arrow.label).join(" · ") : "—", 16);
    text(end.score === null ? "—" : `${end.score} pts`, 16, true);
    const performance = insight.ends.ends.find((item) => item.endNumber === end.end);
    if (performance && performance.arrowCount > 0) {
      wrapped(`${performance.complete ? "Complete" : `Partial ${performance.arrowCount}/${performance.expectedArrowCount}`} · ${number(performance.average)} avg`, 14);
    }
  }
  y += 24;
  const totalTop = y;
  text("TOTAL SCORE", 16, true);
  text(`${report.total} · ${report.xCount}X`, 28, true);
  const height = y + 32;
  return { width, height, stats, layout: { targetTop, targetWidth, targetHeight, statsTop: targetTop + targetHeight + 24, endsTop, endPositions, totalTop }, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#ffffff"/>${parts.join("")}</svg>` };
}
