import {
  formatAnalyticsDate, formatAnalyticsWeekRange,
  type AnalyticsDateRange, type AnalyticsSessionType,
} from "@arc-track/core/analytics";
import type { SessionDraft, TargetFaceType } from "@arc-track/core/scoring";
import { useFocusEffect } from "expo-router";
import { Fragment, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";
import { AnalysisTarget } from "../../src/analysis-target";
import { ANALYTICS_AXIS_LABELS, verticalBarHeight } from "../../src/analytics-chart-model";
import { chartAxis, chartTick } from "@arc-track/core/chart-axis";
import { useAuth } from "../../src/auth";
import {
  DEFAULT_ANALYTICS_FILTERS, mobileAnalyticsView, singaporeToday,
  type AnalyticsFilters, type VolumeInterval,
} from "../../src/mobile-analytics";
import { readOwnAnalyticsSessions } from "../../src/sessions";
import { colors, PAGE_TOP_SPACING } from "../../src/theme";

const average = (value: number | null) => value === null ? "—" : value.toFixed(2);
const percentage = (value: number | null) => value === null ? "—" : `${value.toFixed(1)}%`;
const faceNames: Record<TargetFaceType, string> = { full_face: "Full face", six_ring: "6-ring", triple_face: "Triple face" };

export default function AnalyticsScreen() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<SessionDraft[]>([]);
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_ANALYTICS_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [interval, setInterval] = useState<VolumeInterval>("daily");
  const [requestedFace, setRequestedFace] = useState<TargetFaceType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const today = singaporeToday(new Date());

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try { setSessions(await readOwnAnalyticsSessions(user.id)); }
    catch { setError("Analytics could not be loaded. Check your connection and try again."); }
    finally { setLoading(false); }
  }, [user]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const view = useMemo(() => mobileAnalyticsView(sessions, filters, today, interval), [sessions, filters, today, interval]);
  const activeGroup = view.groupings.find((group) => group.faceType === requestedFace)
    ?? view.groupings.find((group) => group.arrows.length > 0) ?? view.groupings[0] ?? null;
  function primary(update: Partial<Pick<AnalyticsFilters, "sessionType" | "dateRange">>) {
    setFilters((current) => ({ ...current, ...update, distance: "all", division: "all", targetFace: "all" }));
  }

  if (loading) return <View style={styles.state}><ActivityIndicator color={colors.accent} accessibilityLabel="Loading Analytics" /></View>;
  if (error) return <View style={styles.state}><Text style={styles.muted}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable></View>;

  return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <Text style={styles.title}>Analytics</Text>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: showFilters }} onPress={() => setShowFilters((value) => !value)} style={styles.filterToggle}>
      <Text style={styles.filterToggleText}>Filters · {filters.sessionType === "all" ? "All" : filters.sessionType === "training" ? "Training" : "Competition"} · {filters.dateRange === "all" ? "All time" : `${filters.dateRange} days`}</Text>
      <Text style={styles.filterToggleText}>{showFilters ? "Hide" : "Edit"}</Text>
    </Pressable>
    {showFilters ? <View style={styles.filterPanel}>
      <ChoiceRow label="Session type" value={filters.sessionType} choices={[["all", "All"], ["training", "Training"], ["competition", "Competition"]]}
        onChange={(value) => primary({ sessionType: value as AnalyticsSessionType })} />
      <ChoiceRow label="Date range" value={filters.dateRange} choices={[["7", "7 days"], ["30", "30 days"], ["all", "All time"]]}
        onChange={(value) => primary({ dateRange: value as AnalyticsDateRange })} />
      <ChoiceRow label="Distance" value={String(filters.distance)} choices={[["all", "All"], ...view.available.distances.map((distance) => [String(distance), `${distance} m`] as [string, string])]}
        onChange={(value) => setFilters((current) => ({ ...current, distance: value === "all" ? "all" : Number(value) }))} />
      <ChoiceRow label="Division" value={filters.division} choices={[["all", "All"], ...view.available.divisions.map((division) => [division, division] as [string, string])]}
        onChange={(value) => setFilters((current) => ({ ...current, division: value as AnalyticsFilters["division"] }))} />
      <ChoiceRow label="Target face" value={filters.targetFace} choices={[["all", "All"], ...view.available.targetFaces.map((face) => [face.value, face.label] as [string, string])]}
        onChange={(value) => setFilters((current) => ({ ...current, targetFace: value }))} />
    </View> : null}
    <Text style={styles.context}>{view.rounds.length} {view.rounds.length === 1 ? "Round" : "Rounds"} in this view</Text>

    <Section title="Overview">
      <View style={styles.grid}>
        <Metric label="Total Arrows" value={String(view.volume.reduce((sum, point) => sum + point.arrowCount, 0))} />
        <Metric label="Scored Arrows" value={String(view.overview.totalArrows)} />
        <Metric label="Avg / Arrow" value={average(view.overview.averagePerArrow)} />
        <Metric label="X" value={String(view.overview.xCount)} />
        <Metric label="X rate" value={percentage(view.overview.xPercentage)} />
        <Metric label="10 + X rate" value={percentage(view.overview.tenPlusXPercentage)} />
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>BEST COMPLETED ROUND</Text>
        {view.overview.bestRound ? <>
          <Text style={styles.cardTitle}>{view.overview.bestRound.name}</Text>
          <Text style={styles.muted}>{formatAnalyticsDate(view.overview.bestRound.date)} · {view.overview.bestRound.average.toFixed(2)} avg / Arrow</Text>
          <Text style={styles.muted}>{view.overview.bestRound.total} pts · {view.overview.bestRound.arrowCount} scored Arrows</Text>
        </> : <Text style={styles.muted}>No completed Round in this view.</Text>}
      </View>
    </Section>

    <Section title="Performance Trend">
      {view.trend.length ? <>
        <TrendChart points={view.trend} />
        {view.trend.map((point) => <View key={point.id} style={styles.row}>
          <Text style={styles.rowMain}>{formatAnalyticsDate(point.date)} · {point.roundName}</Text>
          <Text style={styles.rowDetail}>{point.average.toFixed(2)} avg · {point.arrowCount} scored Arrows</Text>
        </View>)}
      </> : <Text style={styles.muted}>No scored Rounds in this view.</Text>}
    </Section>

    <Section title="Performance by Distance">
      {view.distances.length ? view.distances.map((item) => <View key={item.distance} style={styles.row}>
        <Text style={styles.rowMain}>{item.distance} m · {item.average.toFixed(2)} avg / Arrow</Text>
        <Text style={styles.rowDetail}>{item.arrowCount} scored Arrows · {item.roundCount} Rounds</Text>
      </View>) : <Text style={styles.muted}>No distance results yet.</Text>}
    </Section>

    <Section title="Target Grouping">
      {view.groupings.length ? <>
        <ChoiceRow label="Layout" value={activeGroup?.faceType ?? ""}
          choices={view.groupings.map((group) => [group.faceType, `${faceNames[group.faceType]} ${group.arrows.length}`])}
          onChange={(value) => setRequestedFace(value as TargetFaceType)} />
        {activeGroup && activeGroup.arrows.length ? <AnalysisTarget faceType={activeGroup.faceType} arrows={activeGroup.arrows} />
          : <Text style={styles.muted}>No plotted Arrows for this layout.</Text>}
        {activeGroup ? <Text style={styles.context}>{activeGroup.arrows.length} plotted Arrows{activeGroup.missingPlotCount ? ` · ${activeGroup.missingPlotCount} without plots` : ""}</Text> : null}
      </> : <Text style={styles.muted}>No target plots yet.</Text>}
    </Section>

    <Section title="Arrow Volume">
      <Text style={styles.context}>Session Arrow counts, independent of Round-format filters.</Text>
      <ChoiceRow label="Interval" value={interval} choices={[["daily", "Daily"], ["weekly", "Weekly"]]}
        onChange={(value) => setInterval(value as VolumeInterval)} />
      {view.volume.length ? <>
        <VolumeBars points={view.volume} interval={interval} />
        {view.volume.map((point) => <View key={point.key} style={styles.row}>
          <Text style={styles.rowMain}>{interval === "daily" ? formatAnalyticsDate(point.startDate) : formatAnalyticsWeekRange(point.startDate, point.endDate)}</Text>
          <Text style={styles.rowDetail}>{point.arrowCount} Arrows</Text>
        </View>)}
      </> : <Text style={styles.muted}>No Session Arrow volume in this view.</Text>}
    </Section>

    <Section title="Training vs Competition">
      {view.comparison.training.arrowCount + view.comparison.competition.arrowCount ? <>
        <Text style={styles.context}>{view.comparison.context}</Text>
        <View style={styles.grid}>
          <Metric label="Training avg" value={average(view.comparison.training.average)} />
          <Metric label="Competition avg" value={average(view.comparison.competition.average)} />
          <Metric label="Training X" value={percentage(view.comparison.training.xPercentage)} />
          <Metric label="Competition X" value={percentage(view.comparison.competition.xPercentage)} />
        </View>
        <Text style={styles.context}>Comparison uses both Session types with the selected date and Round-format filters.</Text>
      </> : <Text style={styles.muted}>No scored Training or Competition Rounds to compare yet.</Text>}
    </Section>
  </ScrollView>;
}

function ChoiceRow({ label, value, choices, onChange }: { label: string; value: string; choices: [string, string][]; onChange: (value: string) => void }) {
  return <View><Text style={styles.label}>{label.toUpperCase()}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
    {choices.map(([key, text]) => <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: value === key }} onPress={() => onChange(key)}
      style={[styles.choice, value === key && styles.choiceActive]}><Text style={[styles.choiceText, value === key && styles.choiceTextActive]}>{text}</Text></Pressable>)}
  </ScrollView></View>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>;
}
function Metric({ label, value }: { label: string; value: string }) {
  return <View style={styles.metric}><Text style={styles.label}>{label.toUpperCase()}</Text><Text style={styles.metricValue}>{value}</Text></View>;
}
function TrendChart({ points }: { points: { id: string; date: string; roundName: string; average: number; arrowCount: number }[] }) {
  const width = Math.max(380, points.length * 34 + 68);
  const left = 50, right = width - 18, top = 18, bottom = 160;
  const [selected, setSelected] = useState<string | null>(null);
  const { min, max, ticks } = chartAxis(points.map((point) => point.average), "score");
  const x = (index: number) => points.length === 1 ? (left + right) / 2 : left + index / (points.length - 1) * (right - left);
  const y = (score: number) => bottom - (score - min) / (max - min) * (bottom - top);
  const dateTicks = Array.from(new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]));
  return <View accessibilityLabel="Average score per Arrow by Round over time">
    <ScrollView horizontal showsHorizontalScrollIndicator={false}><Svg width={width} height={222} viewBox={`0 0 ${width} 222`}>
      {ticks.map((score) => <Fragment key={score}>
        <Line x1={left} x2={right} y1={y(score)} y2={y(score)} stroke={colors.border} strokeWidth={1} />
        <SvgText x={left - 9} y={y(score) + 4} fill={colors.muted} fontSize={10} textAnchor="end">{chartTick(score, "score")}</SvgText>
      </Fragment>)}
      <SvgText x={13} y={(top + bottom) / 2} fill={colors.muted} fontSize={10} textAnchor="middle" rotation="-90" originX={13} originY={(top + bottom) / 2}>{ANALYTICS_AXIS_LABELS.trendY}</SvgText>
      {points.length > 1 ? <Polyline points={points.map((point, index) => `${x(index)},${y(point.average)}`).join(" ")} fill="none" stroke={colors.accent} strokeWidth={2.5} /> : null}
      {points.map((point, index) => { const detail = `${formatAnalyticsDate(point.date)} · ${point.roundName}: ${point.average.toFixed(2)} avg/Arrow · ${point.arrowCount} scored Arrows`; return <Circle key={point.id} cx={x(index)} cy={y(point.average)} r={8} fill={colors.accent} onPress={() => setSelected(detail)} accessibilityLabel={detail} />; })}
      {dateTicks.map((index) => <SvgText key={points[index].id} x={x(index)} y={180} fill={colors.muted} fontSize={10} textAnchor="middle">{formatAnalyticsDate(points[index].date).replace(/ \d{4}$/, "")}</SvgText>)}
      <SvgText x={(left + right) / 2} y={211} fill={colors.muted} fontSize={10} textAnchor="middle">{ANALYTICS_AXIS_LABELS.trendX}</SvgText>
    </Svg></ScrollView>{selected ? <Pressable accessibilityRole="button" accessibilityLabel="Dismiss chart detail" onPress={() => setSelected(null)}><Text style={styles.context}>{selected} · Tap to dismiss</Text></Pressable> : null}
  </View>;
}
function VolumeBars({ points, interval }: { points: { key: string; startDate: string; endDate: string; arrowCount: number }[]; interval: VolumeInterval }) {
  const [selected, setSelected] = useState<string | null>(null);
  const { max, ticks } = chartAxis(points.map((point) => point.arrowCount), "count", true);
  const dateLabel = (point: (typeof points)[number]) => interval === "daily"
    ? formatAnalyticsDate(point.startDate).replace(/ \d{4}$/, "")
    : formatAnalyticsWeekRange(point.startDate, point.endDate).replace(/,? \d{4}/g, "");
  return <View>
    <Text style={styles.chartAxisY}>{ANALYTICS_AXIS_LABELS.volumeY}</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.volumeChart}>
      {points.map((point) => { const date = interval === "daily" ? formatAnalyticsDate(point.startDate) : formatAnalyticsWeekRange(point.startDate, point.endDate); const detail = `${date}: ${point.arrowCount} Session Arrows`; return <Pressable key={point.key} accessibilityRole="button" accessibilityLabel={detail} onPress={() => setSelected(detail)} style={styles.volumeColumn}>
        <View style={styles.volumePlot}>
          <Text style={styles.volumeValue}>{point.arrowCount}</Text>
          <View style={[styles.bar, { height: verticalBarHeight(point.arrowCount, max, 102) }]} />
        </View>
        <Text style={styles.volumeDate} numberOfLines={2}>{dateLabel(point)}</Text>
      </Pressable>; })}
    </ScrollView>
    <Text style={styles.chartAxisX}>{ANALYTICS_AXIS_LABELS.volumeX[interval]} · 0–{chartTick(max, "count")} · ticks {ticks.map((tick) => chartTick(tick, "count")).join(" / ")}</Text>
    {selected ? <Pressable accessibilityRole="button" accessibilityLabel="Dismiss chart detail" onPress={() => setSelected(null)}><Text style={styles.context}>{selected} · Tap to dismiss</Text></Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingTop: 16 + PAGE_TOP_SPACING, paddingBottom: 35, gap: 10 },
  title: { color: colors.text, fontSize: 28, fontWeight: "800" },
  filterToggle: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.surface, paddingHorizontal: 12, borderRadius: 10, gap: 8 },
  filterToggleText: { color: colors.accent, fontSize: 13, fontWeight: "700", flexShrink: 1 },
  filterPanel: { gap: 12, padding: 12, backgroundColor: colors.surface, borderRadius: 10 },
  choices: { gap: 6, paddingVertical: 5 },
  choice: { minHeight: 40, paddingHorizontal: 12, borderRadius: 20, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, justifyContent: "center" },
  choiceActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  choiceText: { color: colors.text, fontSize: 12, fontWeight: "600" },
  choiceTextActive: { color: "#fff" },
  context: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  section: { gap: 10, paddingTop: 14, marginTop: 8, borderTopWidth: 1, borderColor: colors.border },
  sectionTitle: { color: colors.text, fontSize: 19, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, width: "48%", minWidth: 115, flexGrow: 1 },
  label: { color: colors.muted, fontSize: 10, fontWeight: "700", letterSpacing: .5 },
  metricValue: { color: colors.text, fontSize: 20, fontWeight: "800", marginTop: 4 },
  card: { backgroundColor: colors.surface, borderRadius: 10, padding: 13, gap: 4 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  row: { paddingVertical: 9, borderBottomWidth: 1, borderColor: colors.border, gap: 3 },
  rowMain: { color: colors.text, fontSize: 13, fontWeight: "700" },
  rowDetail: { color: colors.muted, fontSize: 12 },
  chartAxisY: { color: colors.muted, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  chartAxisX: { color: colors.muted, fontSize: 11, fontWeight: "700", textAlign: "center", marginTop: 4 },
  volumeChart: { minHeight: 174, alignItems: "flex-end", paddingHorizontal: 8, paddingTop: 8, gap: 8, backgroundColor: colors.surface, borderRadius: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  volumeColumn: { width: 54, height: 158, alignItems: "center", justifyContent: "flex-end", gap: 4 },
  volumePlot: { height: 124, width: "100%", justifyContent: "flex-end", alignItems: "center", gap: 3 },
  volumeValue: { color: colors.text, fontSize: 10, fontWeight: "700" },
  volumeDate: { color: colors.muted, fontSize: 9, lineHeight: 11, height: 26, textAlign: "center", width: "100%" },
  bar: { width: 24, backgroundColor: colors.accent, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  state: { flex: 1, backgroundColor: colors.background, justifyContent: "center", alignItems: "center", padding: 22, gap: 15 },
  retry: { minHeight: 44, backgroundColor: colors.accent, borderRadius: 9, justifyContent: "center", paddingHorizontal: 20 },
  retryText: { color: "#fff", fontWeight: "700" },
});
