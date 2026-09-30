import { buildCoachTeamAnalytics, coachFilterOptions, DEFAULT_COACH_FILTERS, type CoachFilters } from "@arc-track/core/coach-analytics";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { CoachBars, CoachFilterPanel, CoachLine, CoachMetric, CoachNav, CoachSection, CoachState, coachStyles } from "@/src/coach-ui";
import { useCoachWorkspace } from "@/src/coach-workspace";
import { singaporeToday } from "@/src/mobile-analytics";
import { athleteLabel } from "@/src/organizations";

export default function CoachAnalyticsScreen() {
  const { organizationId } = useLocalSearchParams<{ organizationId: string }>();
  const { data, loading, error, reload } = useCoachWorkspace(organizationId);
  const [filters, setFilters] = useState<CoachFilters>(DEFAULT_COACH_FILTERS);
  const today = singaporeToday(new Date());
  const athletes = useMemo(() => data?.athletes.map((athlete) => ({ userId: athlete.userId, name: athleteLabel(athlete) })) ?? [], [data]);
  const options = useMemo(() => data ? coachFilterOptions(data.sessions, today, filters) : { distances: [], divisions: [], targetFaces: [] }, [data, today, filters]);
  const view = useMemo(() => data ? buildCoachTeamAnalytics(athletes, data.sessions, filters, today) : null, [data, athletes, filters, today]);
  if (loading || error || !data || !view) return <CoachState loading={loading} error={error} unavailable="Coach access is unavailable." retry={() => void reload()}/>;
  const byAthlete = (userId: string) => () => router.push({ pathname: "/organization/[organizationId]/athletes/[userId]", params: { organizationId: data.organization.id, userId } });
  const shorten = (name: string) => name.length > 12 ? name.slice(0, 11) + "…" : name;
  return <ScrollView style={coachStyles.page} contentContainerStyle={coachStyles.content}>
    <CoachNav organizationId={data.organization.id} current="analytics"/>
    <Text style={coachStyles.eyebrow}>HEAD COACH · DEEP ANALYTICS</Text><Text style={coachStyles.title}>Team Analytics</Text>
    <Text style={coachStyles.muted}>{data.organization.name} · active Archer members only</Text>
    <CoachFilterPanel filters={filters} setFilters={setFilters} options={options}/>
    <Text style={coachStyles.muted}>Arrow Volume uses keyed Session counts and follows period and Session type. Score metrics also follow Round filters.</Text>
    <View style={coachStyles.metrics}>
      <CoachMetric label="Active Archers" value={view.summary.activeArchers}/><CoachMetric label="Active this period" value={view.summary.activeThisPeriod}/>
      <CoachMetric label="Sessions" value={view.summary.sessionCount}/><CoachMetric label="Total Arrows" value={view.summary.arrowCount}/><CoachMetric label="Scored Arrows" value={view.summary.scoredArrowCount}/>
      <CoachMetric label="Training Sessions" value={view.summary.trainingSessions}/><CoachMetric label="Competition Sessions" value={view.summary.competitionSessions}/>
    </View>
    <Text accessibilityRole="header" style={[coachStyles.title, { fontSize: 28, lineHeight: 34, marginTop: 24 }]}>Scoring</Text>
    <CoachSection title="Team Performance Trend"><CoachLine axis="Avg / Arrow" maxValue={10} points={view.series.filter((item) => item.scoreAverage !== null).map((item) => ({ label: item.label, value: item.scoreAverage, detail: `${item.label}: ${item.scoreAverage?.toFixed(2)} avg from ${item.scoredArrowCount} scored Arrows` }))}/></CoachSection>
    <CoachSection title="Team Score Distribution"><CoachBars axis="Arrows" points={view.distribution.map((item) => ({ label: item.score, value: item.count, detail: `${item.score}: ${item.count} Arrows · ${item.percentage.toFixed(1)}%` }))}/></CoachSection>
    <Text accessibilityRole="header" style={[coachStyles.title, { fontSize: 28, lineHeight: 34, marginTop: 24 }]}>Volume</Text>
    <CoachSection title="Team Arrow Volume"><CoachBars axis="Arrows" points={view.series.filter((item) => item.arrowCount > 0).map((item) => ({ label: item.label, value: item.arrowCount, detail: `${item.label}: ${item.arrowCount} Arrows` }))}/></CoachSection>
    <Text accessibilityRole="header" style={[coachStyles.title, { fontSize: 28, lineHeight: 34, marginTop: 24 }]}>Accuracy</Text>
    <CoachSection title="Team Accuracy Trend"><CoachLine axis="10+X %" secondary="X %" maxValue={100} points={view.series.filter((item) => item.tenPlusXRate !== null).map((item) => ({ label: item.label, value: item.tenPlusXRate, secondary: item.xRate, detail: `${item.label}: ${item.tenPlusXRate?.toFixed(1)}% 10+X · ${item.xRate?.toFixed(1)}% X` }))}/></CoachSection>
    <Text accessibilityRole="header" style={[coachStyles.title, { fontSize: 28, lineHeight: 34, marginTop: 24 }]}>Athletes</Text>
    <CoachSection title="Arrow Volume by Athlete"><CoachBars axis="Arrows" points={view.perAthlete.filter((item) => item.arrowCount > 0).map((item) => ({ label: shorten(item.name), value: item.arrowCount, detail: `${item.name}: ${item.arrowCount} Arrows`, onPress: byAthlete(item.userId) }))}/></CoachSection>
    <CoachSection title="Average Score by Athlete"><CoachBars axis="Avg / Arrow" points={view.perAthlete.filter((item) => item.average !== null).map((item) => ({ label: shorten(item.name), value: item.average, detail: `${item.name}: ${item.average?.toFixed(2)} avg from ${item.scoredArrowCount} scored Arrows`, onPress: byAthlete(item.userId) }))}/></CoachSection>
    <Text accessibilityRole="header" style={[coachStyles.title, { fontSize: 28, lineHeight: 34, marginTop: 24 }]}>Context</Text>
    <CoachSection title="Performance by Distance"><CoachBars axis="Avg / Arrow" points={view.byDistance.map((item) => ({ label: `${item.distance} m`, value: item.average, detail: `${item.distance} m: ${item.average.toFixed(2)} avg from ${item.arrowCount} Arrows` }))}/></CoachSection>
    <CoachSection title="Training vs Competition">
      {view.summary.sessionCount ? view.byType.map((item) => <View key={item.type} style={coachStyles.card}><Text style={coachStyles.cardTitle}>{item.type === "training" ? "Training" : "Competition"}</Text>
        <Text style={coachStyles.muted}>{item.sessionCount} Sessions · {item.arrowCount} Session Arrows · {item.scoredArrowCount} scored</Text>
        <Text style={coachStyles.muted}>{item.average?.toFixed(2) ?? "—"} avg/Arrow · {item.tenPlusXRate?.toFixed(1) ?? "—"}% 10+X · {item.xRate?.toFixed(1) ?? "—"}% X</Text>
      </View>) : <Text style={coachStyles.muted}>No team Sessions in this view.</Text>}
    </CoachSection>
  </ScrollView>;
}
