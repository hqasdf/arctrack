import { buildCoachTeamAnalytics, coachPeriodScoreChange, DEFAULT_COACH_FILTERS, type CoachPeriod } from "@arc-track/core/coach-analytics";
import { formatDateOnly } from "@arc-track/core/dates";
import { points } from "@arc-track/core/scoring";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { athleteLabel } from "../../src/organizations";
import { CoachBars, CoachChoices, CoachLine, CoachMetric, CoachNav, CoachSection, CoachState, coachPalette, coachStyles } from "../../src/coach-ui";
import { useCoachWorkspace } from "../../src/coach-workspace";
import { singaporeToday } from "../../src/mobile-analytics";

export default function CoachOverviewScreen() {
  const { organizationId } = useLocalSearchParams<{ organizationId: string }>();
  const { data, loading, error, reload } = useCoachWorkspace(organizationId);
  const [period, setPeriod] = useState<CoachPeriod>("30");
  const today = singaporeToday(new Date());
  const athletes = useMemo(() => data?.athletes.map((athlete) => ({ userId: athlete.userId, name: athleteLabel(athlete) })) ?? [], [data]);
  const result = useMemo(() => data ? buildCoachTeamAnalytics(athletes, data.sessions, { ...DEFAULT_COACH_FILTERS, period }, today) : null, [data, athletes, period, today]);
  if (loading || error || !data || !result) return <CoachState loading={loading} error={error} unavailable="Coach access is unavailable for this organisation." retry={() => void reload()}/>;
  const base = { organizationId: data.organization.id };
  const names = new Map(athletes.map((athlete) => [athlete.userId, athlete.name]));
  const scoredTotal = result.distribution.reduce((sum, item) => sum + item.count * points(item.score), 0);
  const xCount = result.distribution.find((item) => item.score === "X")?.count ?? 0;
  const tensCount = result.distribution.find((item) => item.score === "10")?.count ?? 0;
  const average = result.summary.arrowCount ? (scoredTotal / result.summary.arrowCount).toFixed(2) : "—";
  const tenPlusXRate = result.summary.arrowCount ? ((tensCount + xCount) / result.summary.arrowCount * 100).toFixed(1) : null;
  const xRate = result.summary.arrowCount ? (xCount / result.summary.arrowCount * 100).toFixed(1) : null;
  const recordedTimes = new Map(data.sessions.map((session) => [session.id, session.createdAt]));
  const sessionTime = (id: string) => {
    const recorded = recordedTimes.get(id);
    return recorded ? new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit" }).format(new Date(recorded)) : null;
  };
  return <ScrollView style={coachStyles.page} contentContainerStyle={coachStyles.content}>
    <CoachNav organizationId={data.organization.id} current="overview"/>
    <Text style={coachStyles.eyebrow}>HEAD COACH · OVERVIEW</Text>
    <Text style={coachStyles.title}>{data.organization.name}</Text>
    <CoachChoices label="Period" value={period} choices={[["7","7d"],["30","30d"],["90","90d"],["all","All"]]} change={(value) => setPeriod(value as CoachPeriod)}/>
    <View style={coachStyles.metrics}>
      <CoachMetric label="Active Archers" value={result.summary.activeArchers}/><CoachMetric label="Active this period" value={result.summary.activeThisPeriod}/>
      <CoachMetric label="Sessions" value={result.summary.sessionCount}/><CoachMetric label="Total scored Arrows" value={result.summary.arrowCount}/>
      <CoachMetric label="Avg / Arrow" value={average}/><CoachMetric label="10+X rate" value={tenPlusXRate === null ? "—" : `${tenPlusXRate}%`}/>
    </View>
    <CoachSection title="Team Performance">
      <Text style={coachStyles.muted}>Average score per Arrow from saved scores.</Text>
      <CoachLine axis="Avg / Arrow" maxValue={10} points={result.series.filter((point) => point.scoreAverage !== null).map((point) => ({ label: point.label, value: point.scoreAverage, detail: `${point.label}: ${point.scoreAverage?.toFixed(2)} average from ${point.arrowCount} Arrows` }))}/>
    </CoachSection>
    <CoachSection title="Team Accuracy">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <View accessible accessibilityLabel={`10 plus X rate ${tenPlusXRate ?? "unavailable"} percent`} style={{ width: 100, height: 100, borderRadius: 50, borderWidth: 1, borderColor: coachPalette.border, justifyContent: "center", alignItems: "center" }}>
          <View style={{ width: 76, height: 76, borderRadius: 38, borderWidth: 1, borderColor: coachPalette.accent, justifyContent: "center", alignItems: "center" }}><Text style={{ color: coachPalette.accent, fontWeight: "800", fontSize: 19 }}>{tenPlusXRate ?? "—"}%</Text></View>
        </View>
        <View style={{ flex: 1, gap: 6 }}><Text style={coachStyles.muted}>10+X rate</Text><Text style={coachStyles.cardTitle}>{xRate ?? "—"}% X rate</Text><Text style={coachStyles.muted}>{result.summary.trainingSessions} Training · {result.summary.competitionSessions} Competition Sessions</Text></View>
      </View>
    </CoachSection>
    <CoachSection title="Team Arrow Volume">
      <Text style={coachStyles.muted}>Saved scored Arrows across active Archers.</Text>
      <CoachBars axis="Arrows" points={result.series.filter((point) => point.arrowCount > 0).map((point) => ({ label: point.label, value: point.arrowCount, detail: `${point.label}: ${point.arrowCount} Arrows` }))}/>
    </CoachSection>
    <CoachSection title="Suggested Reviews">
      <Text style={coachStyles.muted}>Recent completed or Competition Sessions. Review status is not tracked yet.</Text>
      {result.reviewQueue.length ? result.reviewQueue.slice(0, 4).map(({ session, arrowCount, average, tenPlusXCount, xCount }) => <Pressable key={session.id} accessibilityRole="button" onPress={() => router.push({ pathname: "/organization/[organizationId]/athletes/[userId]/sessions/[sessionId]", params: { ...base, userId: session.userId, sessionId: session.id } })} style={coachStyles.card}>
        <Text style={coachStyles.cardTitle}>{names.get(session.userId) ?? "Archer"} · {session.title}</Text>
        <Text style={coachStyles.muted}>{formatDateOnly(session.date)} · {session.sessionType}</Text>
        <Text style={coachStyles.muted}>{arrowCount} scored Arrows · {average?.toFixed(2) ?? "—"} avg · {tenPlusXCount} 10+X · {xCount} X</Text>
        <Text style={coachStyles.link}>Review Session →</Text>
      </Pressable>) : <Text style={coachStyles.muted}>No Sessions currently suggested for review.</Text>}
      <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/organization/[organizationId]/reviews", params: base })}><Text style={coachStyles.link}>Open Reviews →</Text></Pressable>
    </CoachSection>
    <CoachSection title="Athlete Snapshots">
      {result.perAthlete.length ? result.perAthlete.map((athlete) => {
        const change = coachPeriodScoreChange(data.sessions, athlete.userId, period, today);
        return <Pressable key={athlete.userId} accessibilityRole="button" onPress={() => router.push({ pathname: "/organization/[organizationId]/athletes/[userId]", params: { ...base, userId: athlete.userId } })} style={coachStyles.card}>
          <Text style={coachStyles.cardTitle}>{athlete.name}</Text>
          <Text style={coachStyles.muted}>{athlete.latestSession?.rounds.at(-1)?.division ?? "No division yet"} · Last Session {athlete.latestSession ? formatDateOnly(athlete.latestSession.date) : "—"}</Text>
          <Text style={coachStyles.muted}>{athlete.average?.toFixed(2) ?? "—"} avg/Arrow{change === null ? "" : ` · ${change >= 0 ? "+" : ""}${change.toFixed(2)} vs prior period`}</Text>
          <Text style={coachStyles.muted}>{athlete.tenPlusXRate?.toFixed(1) ?? "—"}% 10+X · {athlete.xRate?.toFixed(1) ?? "—"}% X</Text>
          <Text style={coachStyles.muted}>{athlete.arrowCount} scored Arrows · {athlete.sessionCount} Sessions</Text>
        </Pressable>;
      }) : <Text style={coachStyles.muted}>No active Archer members yet.</Text>}
    </CoachSection>
    <CoachSection title="Recent Activity">
      {result.recent.length ? result.recent.slice(0, 6).map(({ session, arrowCount, average }) => <Pressable key={session.id} accessibilityRole="button" onPress={() => router.push({ pathname: "/organization/[organizationId]/athletes/[userId]/sessions/[sessionId]", params: { ...base, userId: session.userId, sessionId: session.id } })} style={coachStyles.card}>
        <Text style={coachStyles.cardTitle}>{names.get(session.userId) ?? "Archer"} · {session.title}</Text>
        <Text style={coachStyles.muted}>{formatDateOnly(session.date)}{sessionTime(session.id) ? ` · ${sessionTime(session.id)} SGT` : ""} · {session.sessionType}</Text>
        <Text style={coachStyles.muted}>{arrowCount} scored Arrows · {average?.toFixed(2) ?? "—"} avg/Arrow</Text>
      </Pressable>) : <Text style={coachStyles.muted}>No team Sessions in this period.</Text>}
    </CoachSection>
  </ScrollView>;
}
