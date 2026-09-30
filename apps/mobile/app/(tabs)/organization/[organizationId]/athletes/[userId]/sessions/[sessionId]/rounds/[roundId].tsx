import { summarizeCoachRound } from "@arc-track/core/coach-round";
import { formatDateOnly } from "@arc-track/core/dates";
import { roundTotal, xCount } from "@arc-track/core/scoring";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/src/auth";
import { readCoachRoundDetail } from "@/src/coach-read";
import { RoundInsights } from "@/src/round-insights";
import { CoachReadonlyTarget } from "@/src/coach-readonly-target";
import { CoachBars, CoachLine } from "@/src/coach-ui";
import { PAGE_TOP_SPACING } from "@/src/theme";
import { coachPalette } from "@/src/coach-ui";

type Detail = NonNullable<Awaited<ReturnType<typeof readCoachRoundDetail>>>;

export default function CoachRoundScreen() {
  const { organizationId, userId, sessionId, roundId } = useLocalSearchParams<{ organizationId: string; userId: string; sessionId: string; roundId: string }>();
  const { user } = useAuth();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!user || !organizationId || !userId || !sessionId || !roundId) return;
    setLoading(true); setError(null);
    try { setDetail(await readCoachRoundDetail(user.id, organizationId, userId, sessionId, roundId)); }
    catch { setError("Athlete Round could not be loaded. Try again."); }
    finally { setLoading(false); }
  }, [user, organizationId, userId, sessionId, roundId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  if (loading) return <View style={styles.state}><ActivityIndicator color={coachPalette.accent} /></View>;
  if (error) return <View style={styles.state}><Text style={styles.muted}>{error}</Text><Pressable onPress={() => void load()}><Text style={styles.link}>Retry</Text></Pressable></View>;
  if (!detail) return <View style={styles.state}><Text style={styles.muted}>This Round is not available to you.</Text></View>;
  const { round, ends } = detail.selected;
  const summary = summarizeCoachRound(round);
  return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <Text style={styles.eyebrow}>ATHLETE ROUND Â· READ ONLY</Text>
    <Text style={styles.title}>{round.name}</Text>
    <Text style={styles.muted}>{detail.session.title} Â· {formatDateOnly(detail.session.date)}</Text>
    <Text style={styles.muted}>{round.division} Â· {round.distanceMetres} m Â· {round.faceDiameterCm} cm Â· {round.faceType.replaceAll("_", " ")}</Text>
    <Text style={styles.score}>{summary.total} pts</Text>
    <Text style={styles.muted}>{summary.arrowCount}/{summary.expectedArrows} Arrows Â· {summary.xCount} X Â· {summary.tenPlusXCount} 10+X Â· {summary.average?.toFixed(2) ?? "â€”"} avg/Arrow</Text>

    <CoachReadonlyTarget round={round}/>

    <Text style={styles.heading}>Ends</Text>
    {ends.length === 0 ? <Text style={styles.muted}>No Ends are available.</Text> : ends.map((end) => {
      const total = roundTotal(end.arrows);
      const endXCount = xCount(end.arrows);
      return <View key={end.id} style={styles.endRow}>
        <Text style={styles.endLabel}>END {end.endNumber}</Text>
        <Text style={styles.endTotal}>{total} pts{endXCount ? ` Â· ${endXCount}X` : ""}</Text>
        <Text style={styles.endArrows}>{end.arrows.length ? end.arrows.map((arrow) => arrow.score === "X" ? "10X" : arrow.score).join(" Â· ") : "No Arrows"}</Text>
      </View>;
    })}

    <RoundInsights round={round} showTarget={false} coach />

    <Text style={styles.heading}>Score distribution</Text>
    <CoachBars axis="Arrows" points={summary.distribution.map((item) => ({ label: item.score, value: item.count, detail: `${item.score}: ${item.count} Arrows Â· ${summary.arrowCount ? (item.count / summary.arrowCount * 100).toFixed(1) : "0.0"}%` }))}/>

    <Text style={styles.heading}>End progression</Text>
    {summary.progression.filter((end) => end.arrowCount > 0).length ? summary.progression.filter((end) => end.arrowCount > 0).map((end) =>
      <View key={end.endNumber} style={styles.progressRow}><Text style={styles.muted}>End {end.endNumber}{end.complete ? "" : " Â· partial"}</Text><Text style={styles.endTotal}>{end.cumulative} pts</Text></View>
    ) : <Text style={styles.muted}>No scores to chart yet.</Text>}

    <Text style={styles.heading}>Round progression</Text>
    <CoachLine axis="Running avg / Arrow" maxValue={10} points={summary.arrowProgression.map((item) => ({ label: String(item.sequence), value: item.average, detail: `Arrow ${item.sequence}: ${item.average.toFixed(2)} running avg Â· ${item.cumulative} pts` }))}/>

  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: coachPalette.background }, content: { padding: 20, paddingTop: 20 + PAGE_TOP_SPACING, paddingBottom: 48, gap: 12 },
  state: { flex: 1, backgroundColor: coachPalette.background, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  eyebrow: { color: coachPalette.accent, fontSize: 12, fontWeight: "700" }, title: { color: coachPalette.text, fontSize: 34, lineHeight: 39, fontWeight: "700", letterSpacing: -1 },
  muted: { color: coachPalette.muted, fontSize: 13, lineHeight: 19 }, link: { color: coachPalette.accent, fontWeight: "700", padding: 10 },
  score: { color: coachPalette.text, fontSize: 48, fontWeight: "500", letterSpacing: -1.5, fontVariant: ["tabular-nums"], marginTop: 12 }, heading: { color: coachPalette.text, fontSize: 22, fontWeight: "700", letterSpacing: -.5, marginTop: 24 },
  endRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center", borderBottomWidth: 1, borderColor: coachPalette.border, paddingVertical: 8 },
  endLabel: { color: coachPalette.text, fontSize: 12, fontWeight: "800", minWidth: 48 }, endTotal: { color: coachPalette.text, fontSize: 13, fontWeight: "700" },
  endArrows: { color: coachPalette.muted, fontSize: 13, flexShrink: 1 },
  progressRow: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderColor: coachPalette.border, paddingVertical: 7 },
});
