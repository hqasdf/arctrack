import { formatDateOnly } from "@arc-track/core/dates";
import { trainingPlanStatus } from "@arc-track/core/training-plan";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../../src/auth";
import { readOwnSessions, type MobileSession } from "../../src/sessions";
import { colors, PAGE_TOP_SPACING } from "../../src/theme";
import { singaporeToday } from "../../src/mobile-analytics";
import { readMobileOwnTrainingPlanProgress } from "../../src/training-plans-read";
import { TrainingGoalRing, visibleTrainingWeek } from "../../src/training-plans-ui";

type OwnPlan = Awaited<ReturnType<typeof readMobileOwnTrainingPlanProgress>>[number];

export default function SessionsScreen() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<MobileSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<OwnPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      setSessions(await readOwnSessions(user.id));
    } catch {
      setError("Sessions could not be loaded. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const loadPlans = useCallback(async () => {
    if (!user) { setPlansLoading(false); return; }
    setPlansLoading(true); setPlansError(false);
    try { setPlans(await readMobileOwnTrainingPlanProgress(user.id, singaporeToday(new Date()))); }
    catch { setPlansError(true); }
    finally { setPlansLoading(false); }
  }, [user]);
  useFocusEffect(useCallback(() => { void loadPlans(); }, [loadPlans]));
  const today = singaporeToday(new Date());
  const activePlans = plans.filter(({ plan }) => trainingPlanStatus(plan.startDate, plan.endDate, today) === "Active");
  const planHeader = plansLoading ? <ActivityIndicator style={{ marginVertical: 15 }} color={colors.accent} accessibilityLabel="Loading Training Plans"/> : plansError ? <Pressable accessibilityRole="button" onPress={() => void loadPlans()} style={styles.planCard}><Text style={styles.message}>Training Plans could not be loaded. Tap to retry.</Text></Pressable> : activePlans.length === 1 ? (() => {
    const { plan, progress } = activePlans[0]; const day = progress.days.find((item) => item.date === today);
    return <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/sessions/training-plans/[planId]", params: { planId: plan.id } })} style={styles.planCard}>
      <Text style={styles.eyebrow}>YOUR TRAINING PLAN</Text><Text style={styles.name}>{plan.title}</Text><Text style={styles.date}>{formatDateOnly(plan.startDate)} – {formatDateOnly(plan.endDate)}</Text>
      <TrainingGoalRing week={visibleTrainingWeek(progress, today)}/>
      {day && <View style={{ gap: 3 }}><Text style={styles.detail}>TODAY · {day.arrowTarget === null ? "No Arrow target" : `${day.arrowsCompleted} / ${day.arrowTarget} arrows`}</Text><Text style={styles.detail}>{day.scoredRoundTarget === null ? "No scored-Round target" : `${day.scoredRoundsCompleted} / ${day.scoredRoundTarget} scored Rounds`}</Text>{day.coachNote && <Text style={styles.detail}>Coach note: {day.coachNote}</Text>}</View>}
      <Text style={styles.planLink}>View Training Plan →</Text>
    </Pressable>;
  })() : activePlans.length > 1 ? <View style={styles.planCard}><Text style={styles.name}>{activePlans.length} Active Training Plans</Text>{activePlans.map(({ plan, progress }) => <Pressable key={plan.id} accessibilityRole="button" onPress={() => router.push({ pathname: "/sessions/training-plans/[planId]", params: { planId: plan.id } })} style={styles.planRow}><Text style={styles.planLink}>{plan.title} →</Text><TrainingGoalRing week={visibleTrainingWeek(progress, today)} compact/></Pressable>)}</View> : null;

  return <View style={styles.page}>
    <Text style={styles.title}>Sessions</Text>
    <Pressable accessibilityRole="button" onPress={() => router.push("/sessions/new")} style={({ pressed }) => [styles.newButton, pressed && styles.pressed]}>
      <Text style={styles.newButtonText}>+ New Session</Text>
    </Pressable>
    {loading ? <ActivityIndicator style={styles.state} color={colors.accent} accessibilityLabel="Loading Sessions" /> :
      error ? <View style={styles.state}><Text style={styles.message}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable></View> :
      <FlatList data={sessions} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} ListHeaderComponent={planHeader}
        ListEmptyComponent={<Text style={styles.message}>No Sessions yet.</Text>}
        renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.title}`} onPress={() => router.push({ pathname: "/sessions/[sessionId]", params: { sessionId: item.id } })} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <Text style={styles.date}>{formatDateOnly(item.date)} · {item.type === "competition" ? "Competition" : "Training"}</Text>
          <Text style={styles.name}>{item.title}</Text>
          <Text style={styles.detail}>Arrow count: {item.arrowCount}</Text>
        </Pressable>} />}
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background, paddingTop: 34 + PAGE_TOP_SPACING, paddingHorizontal: 20 },
  eyebrow: { color: colors.accent, fontSize: 12, fontWeight: "700", letterSpacing: 2 },
  title: { color: colors.text, fontSize: 30, fontWeight: "700", marginTop: 7, marginBottom: 22 },
  newButton: { alignSelf: "flex-start", backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 13, marginBottom: 16, minHeight: 48, justifyContent: "center" },
  newButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  list: { gap: 10, paddingBottom: 28, flexGrow: 1 },
  row: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 17, gap: 5 },
  pressed: { opacity: 0.72 },
  date: { color: colors.muted, fontSize: 13 },
  name: { color: colors.text, fontSize: 18, fontWeight: "700" },
  detail: { color: colors.muted, fontSize: 13 },
  state: { marginTop: 42, alignItems: "center", gap: 16 },
  planCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 17, gap: 7, marginBottom: 12 },
  planRow: { minHeight: 48, justifyContent: "center", borderTopWidth: 1, borderColor: colors.border, paddingTop: 8 },
  planLink: { color: colors.accent, fontWeight: "700", fontSize: 14 },
  message: { color: colors.muted, fontSize: 15 },
  retry: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 22, paddingVertical: 14 },
  retryText: { color: "#fff", fontWeight: "700" },
});
