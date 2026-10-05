import { formatDateOnly } from "@arc-track/core/dates";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/src/auth";
import { singaporeToday } from "@/src/mobile-analytics";
import { readMobileOwnTrainingPlanProgress } from "@/src/training-plans-read";
import { singleTrainingPlanRouteParam } from "@/src/training-plan-route-params";
import { TrainingDailyProgress, TrainingGoalRing, visibleTrainingWeek } from "@/src/training-plans-ui";
import { colors } from "@/src/theme";

type OwnPlan = Awaited<ReturnType<typeof readMobileOwnTrainingPlanProgress>>[number];
export default function AthleteTrainingPlanScreen() {
  const { planId: rawPlanId } = useLocalSearchParams<{ planId?: string | string[] }>();
  const planId = singleTrainingPlanRouteParam(rawPlanId);
  const { user } = useAuth();
  const [result, setResult] = useState<OwnPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!user || !planId) { setLoading(false); return; }
    setLoading(true); setError(null);
    try { setResult((await readMobileOwnTrainingPlanProgress(user.id, singaporeToday(new Date()))).find(({ plan }) => plan.id === planId) ?? null); }
    catch { setError("Training Plan could not be loaded. Try again."); }
    finally { setLoading(false); }
  }, [user, planId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  if (loading) return <View style={styles.state}><ActivityIndicator color={colors.accent} accessibilityLabel="Loading Training Plan"/></View>;
  if (error || !result) return <View style={styles.state}><Text style={styles.muted}>{error ?? "This Training Plan is unavailable or no longer assigned to you."}</Text>{error && <Pressable accessibilityRole="button" onPress={() => void load()}><Text style={styles.link}>Retry</Text></Pressable>}</View>;
  const { plan, progress } = result;
  const today = singaporeToday(new Date());
  return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}><Text style={styles.link}>← Sessions</Text></Pressable>
    <Text style={styles.title}>{plan.title}</Text>
    <Text style={styles.muted}>{formatDateOnly(plan.startDate)} – {formatDateOnly(plan.endDate)}</Text>
    {plan.note && <Text style={styles.muted}>Coach note: {plan.note}</Text>}
    <View style={styles.section}><Text style={styles.heading}>Weekly Arrow goal</Text><TrainingGoalRing week={visibleTrainingWeek(progress, today)}/>
      {progress.weeks.length > 1 && progress.weeks.map((week) => <View key={week.startDate} style={styles.week}><Text style={styles.muted}>{formatDateOnly(week.startDate)} – {formatDateOnly(week.endDate)}</Text><Text style={styles.muted}>{week.arrowTarget === null ? "No weekly Arrow target" : `${week.arrowsCompleted} / ${week.arrowTarget} arrows`}</Text></View>)}
    </View>
    <View style={styles.section}><Text style={styles.heading}>Daily prescription</Text><TrainingDailyProgress days={progress.days} today={today}/></View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background }, content: { padding: 20, paddingBottom: 48, gap: 13 },
  state: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  back: { minHeight: 44, justifyContent: "center" }, link: { color: colors.accent, fontWeight: "700" },
  title: { color: colors.text, fontSize: 32, fontWeight: "700", letterSpacing: -1 }, heading: { color: colors.text, fontSize: 21, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 21 }, section: { borderTopWidth: 1, borderColor: colors.border, paddingTop: 18, gap: 10 },
  week: { borderTopWidth: 1, borderColor: colors.border, paddingVertical: 10, gap: 3 },
});
