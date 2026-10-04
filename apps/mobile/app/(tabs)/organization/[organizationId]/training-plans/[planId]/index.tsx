import { formatDateOnly } from "@arc-track/core/dates";
import { trainingPlanStatus } from "@arc-track/core/training-plan";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useAuth } from "@/src/auth";
import { CoachNav, CoachState, coachStyles } from "@/src/coach-ui";
import { singaporeToday } from "@/src/mobile-analytics";
import { athleteLabel } from "@/src/organizations";
import { readMobileCoachTrainingPlanProgress } from "@/src/training-plans-read";
import { deleteMobileTrainingPlan } from "@/src/training-plans-write";
import { Action, TrainingDailyProgress, TrainingGoalRing, ui, visibleTrainingWeek } from "@/src/training-plans-ui";
import { singleTrainingPlanRouteParam } from "@/src/training-plan-route-params";

type Loaded = NonNullable<Awaited<ReturnType<typeof readMobileCoachTrainingPlanProgress>>>;
export default function CoachTrainingPlanDetailScreen() {
  const { organizationId: rawOrganizationId, planId: rawPlanId } = useLocalSearchParams<{
    organizationId?: string | string[]; planId?: string | string[];
  }>();
  const organizationId = singleTrainingPlanRouteParam(rawOrganizationId);
  const planId = singleTrainingPlanRouteParam(rawPlanId);
  const { user } = useAuth();
  const [result, setResult] = useState<Loaded | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!user || !organizationId || !planId) { setLoading(false); return; }
    setLoading(true); setError(null);
    try { setResult(await readMobileCoachTrainingPlanProgress(user.id, organizationId, planId, singaporeToday(new Date()))); }
    catch { setError("Training Plan progress could not be loaded."); }
    finally { setLoading(false); }
  }, [user, organizationId, planId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  if (loading || error || !result || !organizationId || !planId) return <CoachState loading={loading} error={error} unavailable="Training Plan is unavailable." retry={() => void load()}/>;
  const today = singaporeToday(new Date());
  const { plan, athletes } = result;
  const selected = athletes.find((athlete) => athlete.userId === selectedId) ?? athletes[0];
  const week = selected ? visibleTrainingWeek(selected.progress, today) : null;
  function confirmDelete() {
    Alert.alert("Delete Training Plan?", "The Training Plan and its assignments will be removed. Athlete scoring and performance records are unaffected.", [
      { text: "Cancel", style: "cancel" }, { text: "Delete Plan", style: "destructive", onPress: () => void remove() },
    ]);
  }
  async function remove() {
    if (deleting || !organizationId) return;
    setDeleting(true); setError(null);
    try { await deleteMobileTrainingPlan(plan.id); router.replace({ pathname: "/organization/[organizationId]/training-plans", params: { organizationId } }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Training Plan could not be deleted."); }
    finally { setDeleting(false); }
  }
  return <ScrollView style={coachStyles.page} contentContainerStyle={coachStyles.content}>
    <CoachNav organizationId={organizationId} current="training-plans"/>
    <Text style={coachStyles.eyebrow}>HEAD COACH · TRAINING PLAN</Text><Text style={coachStyles.title}>{plan.title}</Text>
    <Text style={coachStyles.muted}>{formatDateOnly(plan.startDate)} – {formatDateOnly(plan.endDate)} · {trainingPlanStatus(plan.startDate, plan.endDate, today)}</Text>
    <Text style={coachStyles.muted}>{plan.weeklyArrowTarget === null ? "No weekly Arrow target" : `${plan.weeklyArrowTarget} arrows / week`} · {plan.assignedUserIds.length} assigned athletes</Text>
    {plan.note && <Text style={coachStyles.muted}>{plan.note}</Text>}
    <View style={ui.actions}><Action label="Edit Plan" secondary press={() => router.push({ pathname: "/organization/[organizationId]/training-plans/[planId]/edit", params: { organizationId, planId } })}/><Action label={deleting ? "Deleting…" : "Delete Plan"} secondary disabled={deleting} press={confirmDelete}/></View>
    {error && <Text style={ui.error}>{error}</Text>}
    <View style={coachStyles.section}><Text style={coachStyles.heading}>Weekly progress{selected ? ` · ${athleteLabel(selected)}` : ""}</Text><TrainingGoalRing week={week} coach/></View>
    <View style={coachStyles.section}><Text style={coachStyles.heading}>Athlete progress</Text>
      {athletes.length ? athletes.map((athlete) => { const value = visibleTrainingWeek(athlete.progress, today); return <Pressable key={athlete.userId} accessibilityRole="button" accessibilityState={{ selected: selected?.userId === athlete.userId }} onPress={() => setSelectedId(athlete.userId)} style={coachStyles.card}>
        <Text style={coachStyles.cardTitle}>{athleteLabel(athlete)}</Text>
        <Text style={coachStyles.muted}>{value?.arrowTarget === null || !value ? "No weekly Arrow target" : `${value.arrowsCompleted} / ${value.arrowTarget} arrows · ${Math.round((value.progressRatio ?? 0) * 100)}% · ${value.goalReached ? value.amountAboveGoal ? `+${value.amountAboveGoal} above target` : "Goal complete" : `${value.arrowsRemaining} remaining`}`}</Text>
        <View style={{ height: 6, borderRadius: 6, backgroundColor: "#c8cbc2", overflow: "hidden" }}><View style={{ width: `${(value?.visualRatio ?? 0) * 100}%`, height: 6, backgroundColor: "#306b60" }}/></View>
      </Pressable>; }) : <Text style={coachStyles.muted}>No active assigned athletes are available.</Text>}
    </View>
    <View style={coachStyles.section}><Text style={coachStyles.heading}>Daily prescription{selected ? ` · ${athleteLabel(selected)}` : ""}</Text>
      {selected ? <TrainingDailyProgress days={selected.progress.days} today={today} coach/> : plan.days.map((day) => <View key={day.date} style={ui.day}><Text style={ui.body}>{formatDateOnly(day.date)}</Text><Text style={ui.muted}>{day.arrowTarget ?? "No"} Arrow target · {day.scoredRoundTarget ?? "No"} scored-Round target</Text>{day.coachNote && <Text style={ui.muted}>{day.coachNote}</Text>}</View>)}
    </View>
  </ScrollView>;
}
