import type { RoundDraft } from "@arc-track/core/scoring";
import { StyleSheet, Text, View } from "react-native";
import { AnalysisTarget } from "./analysis-target";
import { mobileRoundInsights } from "./mobile-analytics";
import { colors } from "./theme";
import { coachPalette } from "./coach-palette";

const number = (value: number | null) => value === null ? "—" : value.toFixed(2);
const percent = (value: number | null) => value === null ? "—" : `${value.toFixed(1)}%`;
function axis(value: number, positive: string, negative: string, radiusCm: number) {
  return `${(Math.abs(value) * radiusCm).toFixed(1)} cm ${value >= 0 ? positive : negative}`;
}

export function RoundInsights({ round, showTarget = true, coach = false }: { round: RoundDraft; showTarget?: boolean; coach?: boolean }) {
  const insight = mobileRoundInsights(round);
  const skin = coach ? coachStyles : styles;
  const metrics = insight.grouping.metrics;
  const flyerIds = new Set(insight.mainGroup.flyers.map((arrow) => arrow.id));
  return <View style={skin.section}>
    <Text style={skin.heading}>Round Insights</Text>
    <Text style={skin.subheading}>{insight.complete ? "Completed Round" : "Round in progress"}</Text>
    <View style={skin.grid}>
      <Metric label="Score" value={String(insight.total)} skin={skin} />
      <Metric label="Recorded Arrows" value={`${insight.arrowCount}/${round.ends * round.arrowsPerEnd}`} skin={skin} />
      <Metric label="Avg / Arrow" value={number(insight.average)} skin={skin} />
      <Metric label="X" value={`${insight.overview.xCount} · ${percent(insight.overview.xPercentage)}`} skin={skin} />
      <Metric label="10 + X" value={`${insight.tenPlusXCount} · ${percent(insight.overview.tenPlusXPercentage)}`} skin={skin} />
    </View>

    <Text style={skin.subheading}>Grouping</Text>
    {insight.grouping.arrows.length ? <>
      {showTarget ? <AnalysisTarget faceType={round.faceType} arrows={insight.grouping.arrows} centre={metrics ? { x: metrics.centreX, y: metrics.centreY } : null} flyerIds={flyerIds} /> : null}
      <Text style={skin.note}>{insight.grouping.arrows.length} plotted Arrows{flyerIds.size ? ` · ${flyerIds.size} possible ${flyerIds.size === 1 ? "flyer" : "flyers"}` : ""}</Text>
      {metrics ? <View style={skin.grid}>
        <Metric label="Group position" value={`${axis(metrics.centreX, "right", "left", round.faceDiameterCm / 2)} · ${axis(metrics.centreY, "low", "high", round.faceDiameterCm / 2)}`} skin={skin} />
        <Metric label="Group size" value={metrics.groupSizeCm === null ? "Need 3 plots" : `${metrics.groupSizeCm.toFixed(1)} cm`} skin={skin} />
        <Metric label="RMS spread" value={metrics.spreadCm === null ? "Need 3 plots" : `${metrics.spreadCm.toFixed(1)} cm`} skin={skin} />
      </View> : null}
    </> : <Text style={skin.note}>No plotted Arrows yet.</Text>}

    <Text style={skin.subheading}>End Performance</Text>
    {insight.ends.ends.filter((end) => end.arrowCount > 0).length ? insight.ends.ends.filter((end) => end.arrowCount > 0).map((end) =>
      <View key={end.endNumber} style={skin.endRow}>
        <Text style={skin.endLabel}>End {end.endNumber} · {end.complete ? "Complete" : `Partial ${end.arrowCount}/${end.expectedArrowCount}`}</Text>
        <Text style={skin.endValue}>{end.total} pts · {number(end.average)} avg</Text>
      </View>
    ) : <Text style={skin.note}>No scored Ends yet.</Text>}
    <Text style={skin.note}>Best completed End: {insight.ends.best ? `End ${insight.ends.best.endNumber} · ${number(insight.ends.best.average)} avg` : "—"}</Text>
    <Text style={skin.note}>Consistency: {insight.ends.consistency === null ? "Need at least two completed Ends" : `${insight.ends.consistency.toFixed(2)} points/Arrow`}</Text>
  </View>;
}

function Metric({ label, value, skin }: { label: string; value: string; skin: typeof styles }) {
  return <View style={skin.metric}><Text style={skin.label}>{label}</Text><Text style={skin.value}>{value}</Text></View>;
}

function makeStyles(palette: { border: string; text: string; surface: string; muted: string }) { return StyleSheet.create({
  section: { gap: 10, borderTopWidth: 1, borderColor: palette.border, paddingTop: 16, marginTop: 8 },
  heading: { color: palette.text, fontSize: 20, fontWeight: "800" },
  subheading: { color: palette.text, fontSize: 16, fontWeight: "700", marginTop: 9 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: { width: "48%", minWidth: 120, flexGrow: 1, backgroundColor: palette.surface, padding: 11, borderRadius: 10 },
  label: { color: palette.muted, fontSize: 11, fontWeight: "700" },
  value: { color: palette.text, fontSize: 17, fontWeight: "800", marginTop: 3 },
  note: { color: palette.muted, fontSize: 13, lineHeight: 18 },
  endRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 5, borderBottomWidth: 1, borderColor: palette.border, paddingVertical: 7 },
  endLabel: { color: palette.text, fontSize: 13 },
  endValue: { color: palette.text, fontSize: 13, fontWeight: "700" },
}); }
const styles = makeStyles(colors);
const coachStyles = makeStyles(coachPalette);
