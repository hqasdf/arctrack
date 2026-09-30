import { buildCoachAthleteInsights, coachFilterOptions, DEFAULT_COACH_FILTERS, type CoachFilters } from "@arc-track/core/coach-analytics";
import { formatDateOnly } from "@arc-track/core/dates";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useAuth } from "@/src/auth";
import { CoachHeadline, CoachBars, CoachFilterPanel, CoachLine, CoachMetric, CoachNav, CoachSection, coachStyles } from "@/src/coach-ui";
import { singaporeToday } from "@/src/mobile-analytics";
import { athleteLabel, readCoachAthleteSessions, readCoachAthletes, type CoachAthlete } from "@/src/organizations";
import { colors } from "@/src/theme";
import type { CoachAnalyticsSession } from "@arc-track/core/coach-analytics";

export default function CoachAthleteScreen() {
  const { organizationId, userId } = useLocalSearchParams<{ organizationId: string; userId: string }>();
  const { user } = useAuth();
  const [athlete, setAthlete] = useState<CoachAthlete | null>(null);
  const [sessions, setSessions] = useState<CoachAnalyticsSession[]>([]);
  const [filters, setFilters] = useState<CoachFilters>(DEFAULT_COACH_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!user || !organizationId || !userId) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const roster = await readCoachAthletes(user.id, organizationId);
      const match = roster?.find((item) => item.userId === userId) ?? null;
      if (!match) { setAthlete(null); setSessions([]); return; }
      const loaded = await readCoachAthleteSessions(user.id, organizationId, userId, roster ?? undefined);
      setAthlete(match); setSessions((loaded ?? []).map((session) => ({ ...session, userId })));
    } catch { setError("Athlete performance could not be loaded. Try again."); }
    finally { setLoading(false); }
  }, [user, organizationId, userId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const today = singaporeToday(new Date());
  const options = useMemo(() => coachFilterOptions(sessions, today, filters), [sessions, today, filters]);
  const insights = useMemo(() => athlete ? buildCoachAthleteInsights({ userId: athlete.userId, name: athleteLabel(athlete) }, sessions, filters, today) : null, [athlete, sessions, filters, today]);
  if (loading) return <View style={coachStyles.state}><ActivityIndicator color={colors.accent}/></View>;
  if (error || !athlete || !insights) return <View style={coachStyles.state}><Text style={coachStyles.muted}>{error ?? "This athlete is not available in your active roster."}</Text>{error ? <Pressable onPress={() => void load()}><Text style={coachStyles.link}>Retry</Text></Pressable> : null}</View>;
  const openSession = (sessionId: string) => router.push({ pathname: "/organization/[organizationId]/athletes/[userId]/sessions/[sessionId]", params: { organizationId, userId, sessionId } });
  const openRound = (sessionId: string, roundId: string) => router.push({ pathname: "/organization/[organizationId]/athletes/[userId]/sessions/[sessionId]/rounds/[roundId]", params: { organizationId, userId, sessionId, roundId } });
  const best = insights.overview.bestRound;
  return <ScrollView style={coachStyles.page} contentContainerStyle={coachStyles.content}>
    <CoachNav organizationId={organizationId} current="athletes"/>
    <Text style={coachStyles.eyebrow}>ATHLETE PERFORMANCE · READ ONLY</Text><Text style={coachStyles.title}>{athleteLabel(athlete)}</Text>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: filtersOpen }} onPress={() => setFiltersOpen((open) => !open)} style={coachStyles.chip}><Text style={coachStyles.chipText}>Filters{[filters.period !== DEFAULT_COACH_FILTERS.period, filters.sessionType !== "all", filters.distance !== "all", filters.division !== "all", filters.targetFace !== "all"].filter(Boolean).length ? ` · ${[filters.period !== DEFAULT_COACH_FILTERS.period, filters.sessionType !== "all", filters.distance !== "all", filters.division !== "all", filters.targetFace !== "all"].filter(Boolean).length} active` : ""}</Text></Pressable>
    {filtersOpen ? <CoachFilterPanel filters={filters} setFilters={setFilters} options={options} expanded/> : null}
    <CoachHeadline value={insights.overview.averagePerArrow?.toFixed(2) ?? "—"} label="AVG / ARROW" context={`${insights.summary.scoredArrowCount} scored Arrows · ${insights.summary.sessionCount} Sessions`}/>
    <CoachSection title="Performance Trend"><CoachLine axis="Avg / Arrow" maxValue={10} points={insights.sessionTrend.filter((item) => item.average !== null).map((item) => ({ label: item.session.date.slice(5), value: item.average, detail: `${item.session.title}: ${item.average?.toFixed(2)} avg from ${item.arrowCount} Arrows`, onPress: () => openSession(item.session.id) }))}/></CoachSection>
    <View style={coachStyles.metrics}>
      <CoachMetric label="Total Arrows" value={insights.summary.arrowCount}/><CoachMetric label="Scored Arrows" value={insights.summary.scoredArrowCount}/><CoachMetric label="Sessions" value={insights.summary.sessionCount}/>
      <CoachMetric label="Avg / Arrow" value={insights.overview.averagePerArrow?.toFixed(2) ?? "—"}/>
      <CoachMetric label="10+X rate" value={insights.overview.tenPlusXPercentage === null ? "—" : `${insights.overview.tenPlusXPercentage.toFixed(1)}%`}/>
      <CoachMetric label="X rate" value={insights.overview.xPercentage === null ? "—" : `${insights.overview.xPercentage.toFixed(1)}%`}/>
      <CoachMetric label="End consistency" value={insights.endVariation?.toFixed(2) ?? "Need 2 completed Ends"}/>
    </View>
    <CoachSection title="Best completed Round"><Text style={coachStyles.muted}>{best ? `${best.name} · ${best.average.toFixed(2)} avg/Arrow · ${best.total} pts · ${best.arrowCount} Arrows` : "No completed Round in this view."}</Text></CoachSection>
    <CoachSection title="Latest Session"><Text style={coachStyles.muted}>{insights.perAthlete[0]?.latestSession ? `${insights.perAthlete[0].latestSession.title} · ${formatDateOnly(insights.perAthlete[0].latestSession.date)}` : "No Session in this view."}</Text></CoachSection>
    <CoachSection title="Accuracy Trend"><CoachLine axis="10+X %" secondary="X %" maxValue={100} points={insights.sessionTrend.filter((item) => item.tenPlusXRate !== null).map((item) => ({ label: item.session.date.slice(5), value: item.tenPlusXRate, secondary: item.xRate, detail: `${item.session.title}: ${item.tenPlusXRate?.toFixed(1)}% 10+X · ${item.xRate?.toFixed(1)}% X`, onPress: () => openSession(item.session.id) }))}/></CoachSection>
    <CoachSection title="Arrow Volume"><CoachBars axis="Arrows" points={insights.series.filter((item) => item.arrowCount > 0).map((item) => ({ label: item.label, value: item.arrowCount, detail: `${item.label}: ${item.arrowCount} Session Arrows` }))}/></CoachSection>
    <CoachSection title="Grouping Trend">{insights.groupingTrend ? <>
      <Text style={coachStyles.muted}>{insights.groupingTrend.format} · comparable plotted Rounds only</Text>
      <CoachLine axis="Group size (cm)" points={insights.groupingTrend.points.map((item) => ({ label: item.date.slice(5), value: item.groupSizeCm, detail: `${item.date}: ${item.groupSizeCm.toFixed(1)} cm`, onPress: () => openRound(item.sessionId, item.roundId) }))}/>
      <Text style={coachStyles.muted}>Average group size: {(insights.groupingTrend.points.reduce((sum,item) => sum + item.groupSizeCm, 0) / insights.groupingTrend.points.length).toFixed(1)} cm</Text>
    </> : <Text style={coachStyles.muted}>Need at least two comparable Rounds with enough plotted Arrows.</Text>}</CoachSection>
    <CoachSection title="Score Distribution"><CoachBars axis="Arrows" points={insights.distribution.map((item) => ({ label: item.score, value: item.count, detail: `${item.score}: ${item.count} Arrows · ${item.percentage.toFixed(1)}%` }))}/></CoachSection>
    <CoachSection title="Performance by Distance"><CoachBars axis="Avg / Arrow" points={insights.byDistance.map((item) => ({ label: `${item.distance} m`, value: item.average, detail: `${item.distance} m: ${item.average.toFixed(2)} avg from ${item.arrowCount} Arrows` }))}/></CoachSection>
    <CoachSection title="Training vs Competition">{insights.byType.map((item) => <View key={item.type} style={coachStyles.card}><Text style={coachStyles.cardTitle}>{item.type === "training" ? "Training" : "Competition"}</Text><Text style={coachStyles.muted}>{item.sessionCount} Sessions · {item.arrowCount} Session Arrows · {item.scoredArrowCount} scored</Text><Text style={coachStyles.muted}>{item.average?.toFixed(2) ?? "—"} avg/Arrow · {item.tenPlusXRate?.toFixed(1) ?? "—"}% 10+X · {item.xRate?.toFixed(1) ?? "—"}% X</Text></View>)}</CoachSection>
    <CoachSection title="End Consistency"><Text style={coachStyles.muted}>{insights.endVariation === null ? "Need at least two completed Ends." : `${insights.endVariation.toFixed(2)} points/Arrow across ${insights.completedEndCount} completed Ends.`}</Text></CoachSection>
    <CoachSection title="Recent Sessions">{insights.recent.length ? insights.recent.map(({ session, arrowCount, average }) => <Pressable key={session.id} accessibilityRole="button" onPress={() => openSession(session.id)} style={coachStyles.card}><Text style={coachStyles.cardTitle}>{session.title}</Text><Text style={coachStyles.muted}>{formatDateOnly(session.date)} · {session.sessionType} · {arrowCount} scored Arrows · {average?.toFixed(2) ?? "—"} avg</Text></Pressable>) : <Text style={coachStyles.muted}>No Sessions in this view.</Text>}</CoachSection>
    <CoachSection title="Recent Rounds">{insights.filteredRounds.length ? insights.filteredRounds.slice(0, 8).map(({ session, round }) => <Pressable key={round.id} accessibilityRole="button" onPress={() => openRound(session.id, round.id)} style={coachStyles.card}><Text style={coachStyles.cardTitle}>{round.name}</Text><Text style={coachStyles.muted}>{formatDateOnly(session.date)} · {round.distanceMetres} m · {round.arrows.length} scored Arrows</Text></Pressable>) : <Text style={coachStyles.muted}>No Rounds in this view.</Text>}</CoachSection>
  </ScrollView>;
}
