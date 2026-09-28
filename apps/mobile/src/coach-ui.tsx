import type { CoachFilters, CoachPeriod } from "@arc-track/core/coach-analytics";
import { router, useFocusEffect } from "expo-router";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";
import { useAuth } from "./auth";
import { readOwnOrganizations, type OwnOrganization } from "./organizations";
import { coachPalette } from "./coach-palette";
export { coachPalette } from "./coach-palette";

export const coachStyles = StyleSheet.create({
  page: { flex: 1, backgroundColor: coachPalette.background }, content: { padding: 16, paddingBottom: 40, gap: 11 },
  title: { color: coachPalette.text, fontSize: 25, fontWeight: "800" }, heading: { color: coachPalette.text, fontSize: 17, fontWeight: "800" },
  muted: { color: coachPalette.muted, fontSize: 13, lineHeight: 19 }, eyebrow: { color: coachPalette.accent, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  section: { backgroundColor: coachPalette.surface, padding: 14, borderWidth: 1, borderColor: coachPalette.border, borderRadius: 12, gap: 8 },
  card: { backgroundColor: coachPalette.raised, padding: 12, borderWidth: 1, borderColor: coachPalette.border, borderRadius: 9, gap: 4, minHeight: 48 },
  cardTitle: { color: coachPalette.text, fontSize: 15, fontWeight: "800" }, link: { color: coachPalette.accent, fontSize: 13, fontWeight: "800" },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 0, borderWidth: 1, borderColor: coachPalette.kpiBorder, borderRadius: 10, overflow: "hidden", backgroundColor: coachPalette.kpiSurface }, metric: { width: "33.3%", minWidth: 94, flexGrow: 1, padding: 10, borderRightWidth: 1, borderBottomWidth: 1, borderColor: coachPalette.kpiDivider },
  metricValue: { color: coachPalette.kpiText, fontSize: 20, fontWeight: "800" }, metricLabel: { color: coachPalette.kpiMuted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  chips: { flexDirection: "row", gap: 7, paddingVertical: 3 }, chip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: coachPalette.border, backgroundColor: coachPalette.surface, minHeight: 42, justifyContent: "center" },
  chipActive: { backgroundColor: coachPalette.accent, borderColor: coachPalette.accent }, chipText: { color: coachPalette.text, fontWeight: "700", fontSize: 13 }, chipTextActive: { color: coachPalette.background },
  state: { flex: 1, backgroundColor: coachPalette.background, justifyContent: "center", alignItems: "center", padding: 24, gap: 12 },
  chartAxis: { color: coachPalette.muted, fontSize: 11 }, chartLabel: { color: coachPalette.muted, fontSize: 10, textAlign: "center" },
});

export function CoachState({ loading, error, unavailable, retry }: { loading: boolean; error: string | null; unavailable?: string; retry: () => void }) {
  return <View style={coachStyles.state}>
    {loading ? <ActivityIndicator color={coachPalette.accent} accessibilityLabel="Loading Coach workspace"/> : <Text style={coachStyles.muted}>{error ?? unavailable ?? "Coach access is unavailable."}</Text>}
    {error ? <Pressable accessibilityRole="button" onPress={retry} style={coachStyles.chip}><Text style={coachStyles.link}>Retry</Text></Pressable> : null}
  </View>;
}

export function CoachNav({ organizationId, current }: { organizationId: string; current: "overview" | "athletes" | "reviews" | "analytics" | "settings" }) {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState<OwnOrganization[]>([]);
  const [switching, setSwitching] = useState(false);
  useFocusEffect(useCallback(() => {
    let active = true;
    if (user) void readOwnOrganizations(user.id).then((items) => {
      if (active) setWorkspaces(items.filter((item) => item.role === "head_coach"));
    }).catch(() => { if (active) setWorkspaces([]); });
    return () => { active = false; };
  }, [user]));
  const choices = (["overview", "athletes", "reviews", "analytics", "settings"] as const);
  function navigate(section: typeof choices[number]) {
    if (section === current) return;
    if (section === "overview") router.push({ pathname: "/organization/[organizationId]", params: { organizationId } });
    else if (section === "athletes") router.push({ pathname: "/organization/[organizationId]/athletes", params: { organizationId } });
    else if (section === "reviews") router.push({ pathname: "/organization/[organizationId]/reviews", params: { organizationId } });
    else if (section === "analytics") router.push({ pathname: "/organization/[organizationId]/analytics", params: { organizationId } });
    else router.push({ pathname: "/organization/[organizationId]/settings", params: { organizationId } });
  }
  return <View style={{ gap: 7 }}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
      <Text style={coachStyles.eyebrow}>COACH&apos;S WORKSPACE</Text>
      {workspaces.length > 1 ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: switching }} onPress={() => setSwitching(!switching)} style={coachStyles.chip}><Text style={coachStyles.link}>Switch ▾</Text></Pressable>
        : workspaces.length === 1 ? <Pressable accessibilityRole="button" onPress={() => router.push("/organization/manage")} style={coachStyles.chip}><Text style={coachStyles.link}>Add workspace</Text></Pressable> : null}
    </View>
    {switching ? <View style={coachStyles.section}>{workspaces.filter((item) => item.id !== organizationId).map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => {
      setSwitching(false);
      router.replace({ pathname: "/organization/[organizationId]", params: { organizationId: item.id } });
    }} style={coachStyles.chip}><Text style={coachStyles.chipText}>{item.name}</Text></Pressable>)}
      <Pressable accessibilityRole="button" onPress={() => { setSwitching(false); router.push("/organization/manage"); }} style={coachStyles.chip}><Text style={coachStyles.link}>Manage memberships</Text></Pressable>
    </View> : null}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={coachStyles.chips} accessibilityLabel="Coach workspace sections">
    {choices.map((section) => <Pressable key={section} accessibilityRole="button" accessibilityState={{ selected: current === section }} onPress={() => navigate(section)} style={[coachStyles.chip, current === section && coachStyles.chipActive]}>
      <Text style={[coachStyles.chipText, current === section && coachStyles.chipTextActive]}>{section[0].toUpperCase() + section.slice(1)}</Text>
    </Pressable>)}
    </ScrollView>
  </View>;
}

export function CoachMetric({ label, value }: { label: string; value: string | number }) { return <View style={coachStyles.metric}><Text style={coachStyles.metricValue}>{value}</Text><Text style={coachStyles.metricLabel}>{label}</Text></View>; }
export function CoachSection({ title, children }: { title: string; children: ReactNode }) { return <View style={coachStyles.section}><Text style={coachStyles.heading}>{title}</Text>{children}</View>; }
export function CoachChoices({ label, value, choices, change }: { label: string; value: string; choices: Array<[string, string]>; change: (value: string) => void }) {
  return <View style={{ gap: 4 }}><Text style={coachStyles.muted}>{label}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={coachStyles.chips}>
    {choices.map(([key, text]) => <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: key === value }} onPress={() => change(key)} style={[coachStyles.chip, key === value && coachStyles.chipActive]}><Text style={[coachStyles.chipText, key === value && coachStyles.chipTextActive]}>{text}</Text></Pressable>)}
  </ScrollView></View>;
}

export function CoachFilterPanel({ filters, setFilters, options }: { filters: CoachFilters; setFilters: (value: CoachFilters) => void; options: { distances: number[]; divisions: string[]; targetFaces: Array<{ value: string; label: string }> } }) {
  const [open, setOpen] = useState(false);
  const update = (patch: Partial<CoachFilters>) => setFilters({ ...filters, ...patch });
  return <View style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={coachStyles.chip}><Text style={coachStyles.chipText}>Filters · {filters.period === "all" ? "All time" : `${filters.period} days`} · {filters.sessionType === "all" ? "All" : filters.sessionType}  {open ? "▴" : "▾"}</Text></Pressable>
    {open ? <View style={{ gap: 9 }}>
      <CoachChoices label="Period" value={filters.period} choices={[["7","7d"],["30","30d"],["90","90d"],["all","All"]]} change={(period) => update({ period: period as CoachPeriod, distance: "all", division: "all", targetFace: "all" })}/>
      <CoachChoices label="Session type" value={filters.sessionType} choices={[["all","All"],["training","Training"],["competition","Competition"]]} change={(sessionType) => update({ sessionType: sessionType as CoachFilters["sessionType"], distance: "all", division: "all", targetFace: "all" })}/>
      <CoachChoices label="Distance" value={String(filters.distance)} choices={[["all","All"],...options.distances.map((item): [string,string] => [String(item),`${item} m`])]} change={(distance) => update({ distance: distance === "all" ? "all" : Number(distance) })}/>
      <CoachChoices label="Division" value={filters.division} choices={[["all","All"],...options.divisions.map((item): [string,string] => [item,item])]} change={(division) => update({ division })}/>
      <CoachChoices label="Target face" value={filters.targetFace} choices={[["all","All"],...options.targetFaces.map((item): [string,string] => [item.value,item.label])]} change={(targetFace) => update({ targetFace })}/>
    </View> : null}
  </View>;
}

export type CoachChartPoint = { label: string; value: number | null; secondary?: number | null; detail: string; onPress?: () => void };
export function CoachBars({ points, axis, secondary }: { points: CoachChartPoint[]; axis: string; secondary?: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  if (!points.length || !points.some((point) => point.value !== null)) return <Text style={coachStyles.muted}>No data for these filters.</Text>;
  const max = Math.max(1, ...points.flatMap((point) => [point.value ?? 0, point.secondary ?? 0]));
  return <View style={{ gap: 5 }}><Text style={coachStyles.chartAxis}>{axis}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled>
    <View style={{ width: Math.max(300, points.length * 52), height: 204, flexDirection: "row", alignItems: "flex-end", borderBottomWidth: 1, borderColor: coachPalette.border }}>
      {points.map((point, index) => <Pressable key={`${point.label}-${index}`} onPress={() => point.onPress ? point.onPress() : setSelected(point.detail)} accessibilityRole="button" accessibilityLabel={point.detail} style={{ width: Math.max(42, 300 / points.length), height: "100%", justifyContent: "flex-end", alignItems: "center", gap: 2 }}>
        <View style={{ height: 148, flexDirection: "row", alignItems: "flex-end", gap: 2 }}>
          <View style={{ width: secondary ? 13 : 24, height: Math.max(2, (point.value ?? 0) / max * 142), backgroundColor: coachPalette.accent, borderTopLeftRadius: 3, borderTopRightRadius: 3 }}/>
          {secondary && point.secondary !== undefined ? <View style={{ width: 13, height: Math.max(2, (point.secondary ?? 0) / max * 142), backgroundColor: coachPalette.secondary, borderTopLeftRadius: 3, borderTopRightRadius: 3 }}/> : null}
        </View><Text style={coachStyles.chartLabel} numberOfLines={1}>{point.label}</Text>
      </Pressable>)}
    </View>
  </ScrollView>{selected ? <Text style={coachStyles.muted}>{selected}</Text> : null}{secondary ? <Text style={coachStyles.chartAxis}>Primary: {axis} · Secondary: {secondary}</Text> : null}</View>;
}

export function CoachLine({ points, axis, secondary, maxValue }: { points: CoachChartPoint[]; axis: string; secondary?: string; maxValue?: number }) {
  const { width: screenWidth } = useWindowDimensions();
  const [selected, setSelected] = useState<string | null>(null);
  if (!points.some((point) => point.value !== null)) return <Text style={coachStyles.muted}>No data for these filters.</Text>;
  const width = Math.max(screenWidth - 66, points.length * 65, 300);
  const top = maxValue ?? Math.max(1, ...points.flatMap((point) => [point.value ?? 0, point.secondary ?? 0]));
  const x = (index: number) => points.length === 1 ? width / 2 : 36 + index * (width - 55) / (points.length - 1);
  const y = (value: number) => 150 - value / top * 125;
  return <View style={{ gap: 5 }}><Text style={coachStyles.chartAxis}>{axis}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled>
    <Svg width={width} height={185} viewBox={`0 0 ${width} 185`} accessibilityLabel={axis}>
      <Line x1={32} y1={25} x2={32} y2={150} stroke={coachPalette.border}/><Line x1={32} y1={150} x2={width - 8} y2={150} stroke={coachPalette.border}/>
      <SvgText x={2} y={29} fontSize={10} fill={coachPalette.muted}>{top.toFixed(top <= 10 ? 1 : 0)}</SvgText><SvgText x={14} y={150} fontSize={10} fill={coachPalette.muted}>0</SvgText>
      {points.filter((point) => point.value !== null).length > 1 ? <Polyline points={points.flatMap((point,index) => point.value === null ? [] : [`${x(index)},${y(point.value)}`]).join(" ")} stroke={coachPalette.accent} fill="none" strokeWidth={2}/> : null}
      {secondary && points.filter((point) => point.secondary !== null && point.secondary !== undefined).length > 1 ? <Polyline points={points.flatMap((point,index) => point.secondary === null || point.secondary === undefined ? [] : [`${x(index)},${y(point.secondary)}`]).join(" ")} stroke={coachPalette.secondary} fill="none" strokeWidth={2}/> : null}
      {points.map((point,index) => <SvgText key={`${point.label}-${index}`} x={x(index)} y={174} textAnchor="middle" fontSize={10} fill={coachPalette.muted}>{point.label}</SvgText>)}
      {points.map((point,index) => point.value === null ? null : <Circle key={`${point.label}-${index}`} cx={x(index)} cy={y(point.value)} r={5} fill={coachPalette.accent} onPress={() => point.onPress ? point.onPress() : setSelected(point.detail)} accessibilityLabel={point.detail}/>)}
      {secondary ? points.map((point,index) => point.secondary === null || point.secondary === undefined ? null : <Circle key={`s-${point.label}-${index}`} cx={x(index)} cy={y(point.secondary)} r={4} fill={coachPalette.secondary}/> ) : null}
    </Svg>
  </ScrollView>{selected ? <Text style={coachStyles.muted}>{selected}</Text> : null}{secondary ? <Text style={coachStyles.chartAxis}>Primary: {axis} · Secondary: {secondary}</Text> : null}</View>;
}
