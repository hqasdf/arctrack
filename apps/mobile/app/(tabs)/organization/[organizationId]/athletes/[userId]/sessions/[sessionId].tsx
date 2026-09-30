import { targetFaceLabel } from "@arc-track/core/analytics";
import { calculateOverview } from "@arc-track/core/analytics";
import { summarizeCoachRound } from "@arc-track/core/coach-round";
import { formatDateOnly } from "@arc-track/core/dates";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/src/auth";
import { readCoachAthleteSessionIndex, readCoachSessionDetail } from "@/src/coach-read";
import { coachSessionNeighbors } from "@/src/coach-mobile-model";
import { athleteLabel } from "@/src/organizations";
import { PAGE_TOP_SPACING } from "@/src/theme";
import { coachPalette } from "@/src/coach-ui";

type Detail = NonNullable<Awaited<ReturnType<typeof readCoachSessionDetail>>>;

export default function CoachSessionScreen() {
  const { organizationId, userId, sessionId } = useLocalSearchParams<{ organizationId: string; userId: string; sessionId: string }>();
  const { user } = useAuth();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [index, setIndex] = useState<Array<{ id: string; session_date: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!user || !organizationId || !userId || !sessionId) return;
    setLoading(true); setError(null);
    try {
      const [loaded, ordered] = await Promise.all([
        readCoachSessionDetail(user.id, organizationId, userId, sessionId),
        readCoachAthleteSessionIndex(user.id, organizationId, userId),
      ]);
      setDetail(loaded); setIndex(ordered ?? []);
    }
    catch { setError("Athlete Session could not be loaded. Try again."); }
    finally { setLoading(false); }
  }, [user, organizationId, userId, sessionId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  if (loading) return <View style={styles.state}><ActivityIndicator color={coachPalette.accent} /></View>;
  if (error) return <View style={styles.state}><Text style={styles.muted}>{error}</Text><Pressable onPress={() => void load()}><Text style={styles.link}>Retry</Text></Pressable></View>;
  if (!detail) return <View style={styles.state}><Text style={styles.muted}>This Session is not available to you.</Text></View>;
  const { session, rounds } = detail;
  const overview = calculateOverview(rounds.map(({ round }) => ({ sessionId, sessionTitle: session.title, sessionType: session.sessionType, date: session.date, round })));
  const { previous: older, next: newer } = coachSessionNeighbors(index, sessionId);
  const openSession = (id: string) => router.replace({ pathname: "/organization/[organizationId]/athletes/[userId]/sessions/[sessionId]", params: { organizationId, userId, sessionId: id } });
  return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <Text style={styles.eyebrow}>{session.sessionType === "competition" ? "COMPETITION" : "TRAINING"} Â· READ ONLY</Text>
    <Text style={styles.muted}>{athleteLabel(detail.athlete)}</Text>
    <Text style={styles.title}>{session.title}</Text>
    <Text style={styles.muted}>{formatDateOnly(session.date)} Â· {session.arrowCount} Session arrows</Text>
    <Text style={styles.muted}>Recorded {detail.createdAt.slice(0, 16).replace("T", " ")} UTC</Text>
    <View style={styles.summary}>
      <Text style={styles.score}>{overview.totalArrows} scored Arrows</Text>
      <Text style={styles.muted}>{overview.averagePerArrow?.toFixed(2) ?? "â€”"} avg/Arrow Â· {overview.tenPlusXPercentage === null ? "â€”" : `${overview.tenPlusXPercentage.toFixed(1)}%`} 10+X Â· {overview.xCount} X Â· {rounds.length} Rounds</Text>
    </View>
    <View style={styles.pager}>
      {older ? <Pressable accessibilityRole="button" onPress={() => openSession(older)} style={styles.pagerButton}><Text style={styles.link}>â† Previous</Text></Pressable> : <View/>}
      {newer ? <Pressable accessibilityRole="button" onPress={() => openSession(newer)} style={styles.pagerButton}><Text style={styles.link}>Next â†’</Text></Pressable> : <View/>}
    </View>
    <Text style={styles.heading}>Rounds</Text>
    {rounds.length === 0 ? <Text style={styles.muted}>No Rounds in this Session yet.</Text> : rounds.map(({ round, ends }) => {
      const score = summarizeCoachRound(round);
      return <Pressable key={round.id} accessibilityRole="button" onPress={() => router.push({ pathname: "/organization/[organizationId]/athletes/[userId]/sessions/[sessionId]/rounds/[roundId]", params: { organizationId, userId, sessionId, roundId: round.id } })} style={styles.card}>
        <Text style={styles.roundName}>{round.name} Â· {round.distanceMetres} m</Text>
        <Text style={styles.muted}>Round {round.roundNumber} Â· {round.division} Â· {targetFaceLabel(round)}</Text>
        <Text style={styles.muted}>{ends.length}/{round.ends} Ends Â· {round.arrowsPerEnd} Arrows/End</Text>
        <Text style={styles.score}>{score.total}/{score.expectedArrows * 10} pts Â· {score.average?.toFixed(2) ?? "â€”"} avg/Arrow</Text>
        <Text style={styles.muted}>{score.tenPlusXCount} 10+X Â· {score.xCount} X Â· {score.arrowCount}/{score.expectedArrows} recorded Â· {score.arrowCount === score.expectedArrows && score.expectedArrows > 0 ? "Complete" : "In progress"}</Text>
      </Pressable>;
    })}
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: coachPalette.background }, content: { padding: 20, paddingTop: 20 + PAGE_TOP_SPACING, paddingBottom: 48, gap: 12 },
  state: { flex: 1, backgroundColor: coachPalette.background, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  eyebrow: { color: coachPalette.accent, fontSize: 12, fontWeight: "700" }, title: { color: coachPalette.text, fontSize: 34, lineHeight: 39, fontWeight: "700", letterSpacing: -1 },
  heading: { color: coachPalette.text, fontSize: 22, fontWeight: "700", letterSpacing: -.5, marginTop: 24 }, muted: { color: coachPalette.muted, fontSize: 13, lineHeight: 19 },
  link: { color: coachPalette.accent, fontWeight: "700", padding: 10 }, card: { borderBottomWidth: 1, borderColor: coachPalette.border, paddingVertical: 20, minHeight: 82, gap: 7 },
  summary: { paddingVertical: 24, borderTopWidth: 1, borderBottomWidth: 1, borderColor: coachPalette.border, gap: 8 },
  pager: { flexDirection: "row", justifyContent: "space-between", gap: 8 }, pagerButton: { minHeight: 44, justifyContent: "center" },
  roundName: { color: coachPalette.text, fontSize: 20, fontWeight: "700", letterSpacing: -.4 }, score: { color: coachPalette.text, fontSize: 22, fontWeight: "600", fontVariant: ["tabular-nums"] },
});
