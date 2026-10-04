import { formatDateOnly } from "@arc-track/core/dates";
import { trainingPlanStatus } from "@arc-track/core/training-plan";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useAuth } from "@/src/auth";
import { CoachNav, CoachState, coachStyles } from "@/src/coach-ui";
import { singaporeToday } from "@/src/mobile-analytics";
import { readMobileCoachTrainingPlans, type MobileTrainingPlan } from "@/src/training-plans-read";
import { singleTrainingPlanRouteParam } from "@/src/training-plan-route-params";
import { Action, ui } from "@/src/training-plans-ui";

export default function CoachTrainingPlansScreen() {
  const { organizationId: rawOrganizationId } = useLocalSearchParams<{ organizationId?: string | string[] }>();
  const organizationId = singleTrainingPlanRouteParam(rawOrganizationId);
  const { user } = useAuth();
  const [plans, setPlans] = useState<MobileTrainingPlan[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!user || !organizationId) { setLoading(false); return; }
    setLoading(true); setError(null);
    try { setPlans(await readMobileCoachTrainingPlans(user.id, organizationId)); }
    catch { setError("Training Plans could not be loaded. Try again."); }
    finally { setLoading(false); }
  }, [user, organizationId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  if (loading || error || !plans || !organizationId) return <CoachState loading={loading} error={error} unavailable="Coach Training Plans are unavailable." retry={() => void load()}/>;
  const today = singaporeToday(new Date());
  return <ScrollView style={coachStyles.page} contentContainerStyle={coachStyles.content}>
    <CoachNav organizationId={organizationId} current="training-plans"/>
    <Text style={coachStyles.eyebrow}>HEAD COACH · PLANNING</Text><Text style={coachStyles.title}>Training Plans</Text>
    <View style={{ alignItems: "flex-start" }}><Action label="+ New Plan" press={() => router.push({ pathname: "/organization/[organizationId]/training-plans/new", params: { organizationId } })}/></View>
    {plans.length ? plans.map((plan) => <Pressable key={plan.id} accessibilityRole="button" onPress={() => router.push({ pathname: "/organization/[organizationId]/training-plans/[planId]", params: { organizationId, planId: plan.id } })} style={coachStyles.card}>
      <Text style={coachStyles.cardTitle}>{plan.title}</Text>
      <Text style={coachStyles.muted}>{formatDateOnly(plan.startDate)} – {formatDateOnly(plan.endDate)} · {trainingPlanStatus(plan.startDate, plan.endDate, today)}</Text>
      <Text style={coachStyles.muted}>{plan.weeklyArrowTarget === null ? "No weekly Arrow target" : `${plan.weeklyArrowTarget} arrows / week`} · {plan.assignedUserIds.length} athletes</Text>
      <Text style={coachStyles.link}>View Plan →</Text>
    </Pressable>) : <View style={[coachStyles.section, { gap: 10 }]}><Text style={ui.heading}>No Training Plans yet</Text><Text style={coachStyles.muted}>Create a plan to set weekly Arrow goals and daily training requirements for your athletes.</Text><Action label="Create Training Plan" press={() => router.push({ pathname: "/organization/[organizationId]/training-plans/new", params: { organizationId } })}/></View>}
  </ScrollView>;
}
