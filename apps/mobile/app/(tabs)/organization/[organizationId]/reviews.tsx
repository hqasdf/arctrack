import { buildCoachTeamAnalytics, DEFAULT_COACH_FILTERS, type CoachPeriod } from "@arc-track/core/coach-analytics";
import { formatDateOnly } from "@arc-track/core/dates";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text } from "react-native";
import { CoachChoices, CoachNav, CoachSection, CoachState, coachStyles } from "@/src/coach-ui";
import { useCoachWorkspace } from "@/src/coach-workspace";
import { singaporeToday } from "@/src/mobile-analytics";
import { athleteLabel } from "@/src/organizations";

export default function CoachReviewsScreen() {
  const { organizationId } = useLocalSearchParams<{ organizationId: string }>();
  const { data, loading, error, reload } = useCoachWorkspace(organizationId);
  const [period, setPeriod] = useState<CoachPeriod>("30");
  const [type, setType] = useState<"all" | "training" | "competition">("all");
  const [athleteId, setAthleteId] = useState("all");
  const athletes = useMemo(() => data?.athletes.map((athlete) => ({ userId: athlete.userId, name: athleteLabel(athlete) })) ?? [], [data]);
  const result = useMemo(() => data ? buildCoachTeamAnalytics(athletes, data.sessions, { ...DEFAULT_COACH_FILTERS, period, sessionType: type }, singaporeToday(new Date())) : null, [data, athletes, period, type]);
  if (loading || error || !data || !result) return <CoachState loading={loading} error={error} unavailable="Coach access is unavailable." retry={() => void reload()}/>;
  const names = new Map(athletes.map((athlete) => [athlete.userId, athlete.name]));
  const queue = result.reviewQueue.filter(({ session }) => athleteId === "all" || session.userId === athleteId);
  const open = (userId: string, sessionId: string) => router.push({ pathname: "/organization/[organizationId]/athletes/[userId]/sessions/[sessionId]", params: { organizationId: data.organization.id, userId, sessionId } });
  return <ScrollView style={coachStyles.page} contentContainerStyle={coachStyles.content}>
    <CoachNav organizationId={data.organization.id} current="reviews"/>
    <Text style={coachStyles.eyebrow}>HEAD COACH · WORKFLOW</Text><Text style={coachStyles.title}>Reviews</Text>
    <Text style={coachStyles.muted}>A suggested queue of completed or Competition Sessions. Review status is not stored yet.</Text>
    <CoachChoices label="Athlete" value={athleteId} choices={[["all","All"],...athletes.map((athlete): [string,string] => [athlete.userId,athlete.name])]} change={setAthleteId}/>
    <CoachChoices label="Period" value={period} choices={[["7","7d"],["30","30d"],["90","90d"],["all","All"]]} change={(value) => setPeriod(value as CoachPeriod)}/>
    <CoachChoices label="Session type" value={type} choices={[["all","All"],["training","Training"],["competition","Competition"]]} change={(value) => setType(value as typeof type)}/>
    <CoachSection title="Suggested Reviews">
      {queue.length ? queue.map(({ session, arrowCount, average, tenPlusXCount, xCount }) => <Pressable key={session.id} accessibilityRole="button" onPress={() => open(session.userId,session.id)} style={coachStyles.card}>
        <Text style={coachStyles.cardTitle}>{names.get(session.userId) ?? "Archer"} · {session.title}</Text>
        <Text style={coachStyles.muted}>{formatDateOnly(session.date)} · {session.sessionType}</Text>
        <Text style={coachStyles.muted}>{arrowCount} scored Arrows · {average?.toFixed(2) ?? "—"} avg/Arrow · {tenPlusXCount} 10+X · {xCount} X</Text>
      </Pressable>) : <Text style={coachStyles.muted}>No Sessions currently match this suggested queue.</Text>}
    </CoachSection>
    <CoachSection title="Competition Sessions">
      {queue.some(({ session }) => session.sessionType === "competition") ? queue.filter(({ session }) => session.sessionType === "competition").map(({ session }) => <Pressable key={session.id} accessibilityRole="button" onPress={() => open(session.userId,session.id)} style={coachStyles.card}>
        <Text style={coachStyles.cardTitle}>{session.title}</Text><Text style={coachStyles.muted}>{names.get(session.userId) ?? "Archer"} · {formatDateOnly(session.date)}</Text>
      </Pressable>) : <Text style={coachStyles.muted}>No Competition Sessions in this view.</Text>}
    </CoachSection>
  </ScrollView>;
}
