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

/** Export presentation only. Supplied native values retain their existing definitions. */
type GroupingExportPresentation = { width?: number; stats?: string[][]; endDetails?: Record<number, string> };

function groupingExportTarget(report: GroupingExport, targetWidth: number, targetHeight: number) {
  const triple = report.round.faceType === "triple_face";
  const view = triple ? [-58, -168, 116, 336] : report.round.faceType === "six_ring" ? [-65, -65, 130, 130] : [-105, -105, 210, 210];
  const radii = triple ? [.5, .4, .3, .2, .1] : report.round.faceType === "six_ring" ? [.6, .5, .4, .3, .2, .1] : [1, .9, .8, .7, .6, .5, .4, .3, .2, .1];
  const colors: Record<number, string> = { 1: "#f4f1e9", .9: "#f4f1e9", .8: "#202020", .7: "#202020", .6: "#49a4cf", .5: "#49a4cf", .4: "#e65a55", .3: "#e65a55", .2: "#f5cf3d", .1: "#f5cf3d" };
  const centres = triple ? [-110, 0, 110] : [0];
  const target: (string | ((scale: number) => string))[] = [], indicators: ((scale: number) => string)[] = [];
  let left = view[0], top = view[1], right = left + view[2], bottom = top + view[3];
  function include(x: number, y: number, padding: number) {
    left = Math.min(left, x - padding); top = Math.min(top, y - padding);
    right = Math.max(right, x + padding); bottom = Math.max(bottom, y + padding);
  }
  centres.forEach((cy, index) => {
    radii.forEach((radius) => target.push(`<circle cx="0" cy="${cy}" r="${radius * 100}" fill="${colors[radius]}" stroke="#4b443e" stroke-width=".7"/>`));
    target.push(`<circle cx="0" cy="${cy}" r="5" fill="none" stroke="#4b443e" stroke-width=".7"/>`);
    const arrows = report.mainGroup.mainArrows.filter((arrow) => !triple || arrow.faceIndex === index);
    const hull = convexHull(arrows);
    if (hull.length >= 3) {
      const points = hull.map((arrow) => `${arrow.x * 100},${cy + arrow.y * 100}`).join(" ");
      target.push((scale) => `<g data-main-group-area="${index}" pointer-events="none"><path d="M ${points.replace(/ /g, " L ")} Z" fill="none" stroke="#ffffff" stroke-opacity=".85" stroke-width="${2.5 / scale}"/><polygon points="${points}" fill="#306b60" fill-opacity=".16" stroke="#306b60" stroke-width="${1 / scale}"/></g>`);
    }
    if (report.mainGroup.metrics && arrows.length) {
      const { centreX, centreY } = report.mainGroup.metrics;
      const x = centreX * 100, y = cy + centreY * 100;
      const extent = Math.min(10, Math.max(6, ...arrows.map((arrow) => Math.hypot(arrow.x - centreX, arrow.y - centreY) * 100)));
      include(x, y, extent + 2);
      indicators.push((scale) => {
        const arm = (targetWidth < 500 ? 8 : 10) / scale, gap = 3.5 / scale, radius = 3 / scale;
        const crosshair = `M ${x - arm} ${y} H ${x - gap} M ${x + gap} ${y} H ${x + arm} M ${x} ${y - arm} V ${y - gap} M ${x} ${y + gap} V ${y + arm}`;
        return `<g data-main-group-centre="${index}" pointer-events="none" fill="none"><path d="${crosshair}" stroke="#ffffff" stroke-width="${2.5 / scale}"/><path d="${crosshair}" stroke="#306b60" stroke-width="${1.2 / scale}"/><circle cx="${x}" cy="${y}" r="${radius}" stroke="#ffffff" stroke-width="${2.5 / scale}"/><circle cx="${x}" cy="${y}" r="${radius}" stroke="#306b60" stroke-width="${1.2 / scale}"/></g>`;
      });
    }
    const plotted = report.grouping.arrows.filter((arrow) => !triple || arrow.faceIndex === index);
    if (plotted.length) {
      const centreX = plotted.reduce((sum, arrow) => sum + arrow.x, 0) / plotted.length;
      const centreY = plotted.reduce((sum, arrow) => sum + arrow.y, 0) / plotted.length;
      const x = centreX * 100, y = cy + centreY * 100;
      include(x, y, 3);
      indicators.push((scale) => `<g data-average-impact="${index}" pointer-events="none"><circle cx="${x}" cy="${y}" r="${1.5 / scale}" fill="#754a89" stroke="#ffffff" stroke-width="${1 / scale}"/></g>`);
    }
  });
  report.grouping.arrows.forEach((arrow) => {
    const x = arrow.x * 100, y = (triple ? centres[arrow.faceIndex!] : 0) + arrow.y * 100;
    include(x, y, 3);
    target.push(`<circle cx="${x}" cy="${y}" r="1.8" fill="#242d2b" stroke="#fff" stroke-width=".6"/>`);
  });
  target.push(...indicators);
  const framedView = [left, top, right - left, bottom - top];
  // Size overlays in export pixels while retaining the original centre and hull coordinates.
  const scale = Math.min(targetWidth / framedView[2], targetHeight / framedView[3]);
  return { view: framedView, content: target.map((layer) => typeof layer === "string" ? layer : layer(scale)).join("") };
}

/** One static report layout for browser PNG export and native SVG capture. */
export function renderGroupingExport(report: GroupingExport, presentation: GroupingExportPresentation = {}) {
  const width = presentation.width ?? 800, compact = width < 600;
  const margin = compact ? 20 : 32, padding = compact ? 16 : 24;
  const contentWidth = width - margin * 2, innerWidth = contentWidth - padding * 2;
  const ink = "#20352e", muted = "#66756d", accent = "#306b60", border = "#dce4de";
  const parts: string[] = [];
  const text = (x: number, y: number, value: string, size = 16, bold = false, color = ink, anchor = "start") =>
    `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${size}" fill="${color}" text-anchor="${anchor}"${bold ? ' font-weight="700"' : ""}>${xml(value)}</text>`;
  function lines(value: string, available: number, size: number) {
    const result: string[] = [];
    let rest = Array.from(value);
    while (rest.length) {
      let used = 0, count = 0;
      for (const character of rest) {
        const factor = /[MW@%&]/.test(character) ? 1.05 : /[mw]/.test(character) ? .95 : /[ilI .,:;!|]/.test(character) ? .36 : /[A-Z]/.test(character) ? .85 : character.codePointAt(0)! > 255 ? 1.1 : .65;
        if (count && used + factor * size > available) break;
        used += factor * size; count++;
      }
      const space = rest.slice(0, count).lastIndexOf(" ");
      const at = count < rest.length && space > 0 ? space : count;
      result.push(rest.slice(0, at).join("")); rest = rest.slice(at);
      while (rest[0] === " ") rest.shift();
    }
    return result;
  }
  function wrapped(value: string, x: number, top: number, available: number, size: number, bold = false, color = ink) {
    let bottom = top;
    for (const line of lines(value, available, size)) { bottom += size; parts.push(text(x, bottom, line, size, bold, color)); bottom += 6; }
    return bottom;
  }
  const card = (top: number, height: number) => `<rect x="${margin}" y="${top}" width="${contentWidth}" height="${height}" rx="16" fill="#ffffff" stroke="${border}"/>`;
  let y = 40;
  parts.push(`<path d="M ${margin} 23 H ${margin + 4} V 37 H ${margin} Z" fill="${accent}"/>`, text(margin + 14, 35, "ARC TRACK", 15, true, accent), text(width - margin, 35, "GROUPING REPORT", compact ? 10 : 12, true, muted, "end"));
  y += 18;
  const context = report.context.match(/^(.*) · (\d{4}-\d{2}-\d{2})$/);
  const sessionTitle = context ? context[1] : report.context;
  y = wrapped(sessionTitle || report.round.name, margin, y, contentWidth, compact ? 26 : 32, true);
  if (sessionTitle) y = wrapped(report.round.name, margin, y + 2, contentWidth, compact ? 16 : 20, false, muted);
  const face = report.round.faceType === "triple_face" ? "triple face" : report.round.faceType === "six_ring" ? "6-ring face" : "full face";
  y = wrapped(`${context ? `${context[2]} · ` : ""}${report.round.division} · ${report.round.distanceMetres} m · ${report.round.faceDiameterCm} cm ${face}`, margin, y + 8, contentWidth, compact ? 13 : 15, false, muted) + 20;

  const targetCardTop = y, targetCardIndex = parts.length;
  parts.push("");
  parts.push(text(margin + padding, y + 30, "GROUPING", 13, true, accent), text(width - margin - padding, y + 30, `${report.grouping.arrows.length} plotted Arrows`, 12, false, muted, "end"));
  const targetTop = y + 48, targetWidth = innerWidth;
  const targetHeight = report.round.faceType === "triple_face" ? (compact ? 420 : 560) : (compact ? targetWidth : 480);
  const { view, content } = groupingExportTarget(report, targetWidth, targetHeight);
  const [viewX, viewY, viewWidth, viewHeight] = view;
  const scale = Math.min(targetWidth / viewWidth, targetHeight / viewHeight);
  const translateX = margin + padding + (targetWidth - viewWidth * scale) / 2 - viewX * scale;
  const translateY = targetTop + (targetHeight - viewHeight * scale) / 2 - viewY * scale;
  parts.push(`<defs><clipPath id="export-target-bounds"><rect x="${margin + padding}" y="${targetTop}" width="${targetWidth}" height="${targetHeight}"/></clipPath></defs><g clip-path="url(#export-target-bounds)"><g data-target-plot="true" transform="translate(${translateX} ${translateY}) scale(${scale})">${content}</g></g>`);
  y = targetTop + targetHeight + 18;
  parts.push(`<line x1="${margin + padding}" y1="${y}" x2="${width - margin - padding}" y2="${y}" stroke="${border}"/>`);
  const legendTop = y + 18;
  const legend = ["Main Group Centre", "All-Arrow Average", "Main Group Area"];
  legend.forEach((label, index) => {
    const x = margin + padding + (compact ? 0 : index * innerWidth / 3), top = legendTop + (compact ? index * 26 : 0);
    const icon = index === 0 ? `<path d="M 0 0 H 5 M 11 0 H 16 M 8 -8 V -3 M 8 3 V 8" fill="none" stroke="${accent}" stroke-width="1.5"/><circle cx="8" cy="0" r="3" fill="none" stroke="${accent}"/>` : index === 1 ? '<circle cx="8" cy="0" r="1.5" fill="#754a89" stroke="#ffffff" stroke-width="1"/>' : `<path d="M 1 4 L 4 -6 L 14 -4 L 16 5 Z" fill="${accent}" fill-opacity=".16" stroke="${accent}"/>`;
    parts.push(`<g data-legend-item="${index}" transform="translate(${x} ${top + 7})">${icon}</g>`, text(x + 24, top + 11, label, compact ? 13 : 14, false, index === 1 ? "#754a89" : muted));
  });
  y = legendTop + (compact ? 78 : 26) + 12;
  parts[targetCardIndex] = card(targetCardTop, y - targetCardTop);
  y += 24;
  const metrics = report.grouping.metrics;
  const stats = presentation.stats ?? [
    ["Group position", groupingExportPosition(report)],
    ["Group size", cm(metrics?.groupSizeCm)],
    ["Horizontal Spread", cm(metrics?.horizontalSpreadCm)],
    ["Vertical Spread", cm(metrics?.verticalSpreadCm)],
    ["RMS spread", cm(metrics?.spreadCm)],
    ["Plotted Arrows", String(report.grouping.arrows.length)],
  ];
  const statsTop = y;
  function statistics(title: string, entries: string[][], positionFirst = false) {
    if (!entries.length) return;
    const top = y, background = parts.length; parts.push("");
    parts.push(text(margin + padding, y + 28, title, 12, true, accent)); y += 44;
    let remaining = entries;
    if (positionFirst) {
      parts.push(text(margin + padding, y + 12, entries[0][0], 12, false, muted));
      y = wrapped(entries[0][1], margin + padding, y + 20, innerWidth, compact ? 19 : 23, true) + 12;
      parts.push(`<line x1="${margin + padding}" y1="${y}" x2="${width - margin - padding}" y2="${y}" stroke="${border}"/>`);
      y += 18; remaining = entries.slice(1);
    }
    const columns = compact ? 2 : 3, gap = compact ? 18 : 24;
    const cellWidth = (innerWidth - (columns - 1) * gap) / columns;
    for (let index = 0; index < remaining.length; index += columns) {
      let bottom = y;
      remaining.slice(index, index + columns).forEach(([label, value], column) => {
        const x = margin + padding + column * (cellWidth + gap);
        const labelBottom = wrapped(label, x, y, cellWidth, compact ? 11 : 13, false, muted);
        bottom = Math.max(bottom, wrapped(value, x, labelBottom + 4, cellWidth, compact ? 16 : 20, true));
      });
      y = bottom + 16;
    }
    y += 4; parts[background] = card(top, y - top); y += 24;
  }
  const groupingLabels = new Set(["Group position", "Group size", "Horizontal Spread", "Vertical Spread", "RMS spread", "Plotted Arrows", "Possible Flyers"]);
  statistics("GROUPING MEASUREMENTS", stats.filter(([label]) => groupingLabels.has(label)), true);
  statistics("ROUND SUMMARY", stats.filter(([label]) => !groupingLabels.has(label)));

  const endsTop = y, endsBackground = parts.length; parts.push("");
  parts.push(text(margin + padding, y + 30, "END SCORES", 13, true, accent)); y += 48;
  const endPositions: number[] = [];
  for (const end of report.ends) {
    endPositions.push(y);
    parts.push(`<line x1="${margin + padding}" y1="${y}" x2="${width - margin - padding}" y2="${y}" stroke="${border}"/>`);
    parts.push(text(margin + padding, y + 25, `END ${end.end}`, compact ? 11 : 14, true), text(width - margin - padding, y + 25, end.score === null ? "—" : `${end.score} pts`, compact ? 12 : 15, true, ink, "end"));
    const scoreX = margin + padding + (compact ? 52 : 86);
    const scoreWidth = innerWidth - (compact ? 116 : 176);
    const values = end.arrows.length ? end.arrows.map((arrow) => arrow.label).join(" · ") : "—";
    y = wrapped(values, scoreX, y + 10, scoreWidth, compact ? 13 : 17) + 10;
    const detail = presentation.endDetails?.[end.end];
    if (detail) y = wrapped(detail, scoreX, y, innerWidth - (scoreX - margin - padding), 12, false, muted) + 6;
  }
  y += 10; parts[endsBackground] = card(endsTop, y - endsTop); y += 24;
  const totalTop = y;
  parts.push(`<rect x="${margin}" y="${y}" width="${contentWidth}" height="96" rx="16" fill="#203e34"/>`, text(margin + padding, y + 27, "TOTAL SCORE", 12, true, "#d8e8df"), text(margin + padding, y + 73, String(report.total), compact ? 36 : 42, true, "#ffffff"), text(width - margin - padding, y + 67, `${report.xCount}X`, 23, true, "#ffffff", "end"));
  const height = y + 96 + margin;
  return { width, height, stats, layout: { targetTop, targetWidth, targetHeight, legendTop, statsTop, endsTop, endPositions, totalTop }, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#f3f6f2"/>${parts.join("")}</svg>` };
}
