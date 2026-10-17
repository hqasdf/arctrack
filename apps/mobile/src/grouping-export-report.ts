import { renderGroupingExport, type GroupingExport } from "@arc-track/core/grouping-export";
import { mobileRoundInsights } from "./mobile-analytics.ts";

export const EXPORT_TOP_PADDING = 100;
export const MOBILE_REPORT_WIDTH = 390;
export function mobileExportPreviewWidth(screenWidth: number) {
  return Math.min(Math.max(1, screenWidth - 24), MOBILE_REPORT_WIDTH);
}

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
  const endDetails = Object.fromEntries(insight.ends.ends.filter((end) => end.arrowCount > 0).map((end) => [end.endNumber,
    `${end.complete ? "Complete" : `Partial ${end.arrowCount}/${end.expectedArrowCount}`} · ${number(end.average)} avg`]));
  return renderGroupingExport(report, { width: MOBILE_REPORT_WIDTH, stats, endDetails });
}
