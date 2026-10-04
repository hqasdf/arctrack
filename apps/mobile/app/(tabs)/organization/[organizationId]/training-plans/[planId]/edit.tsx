import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { useAuth } from "@/src/auth";
import { CoachState } from "@/src/coach-ui";
import { singaporeToday } from "@/src/mobile-analytics";
import { athleteLabel, readCoachAthletes, type CoachAthlete } from "@/src/organizations";
import { readMobileCoachTrainingPlans, type MobileTrainingPlan } from "@/src/training-plans-read";
import { MobileTrainingPlanForm } from "@/src/training-plans-ui";
import { singleTrainingPlanRouteParam } from "@/src/training-plan-route-params";

export default function EditCoachTrainingPlanScreen() {
  const { organizationId: rawOrganizationId, planId: rawPlanId } = useLocalSearchParams<{
    organizationId?: string | string[]; planId?: string | string[];
  }>();
  const organizationId = singleTrainingPlanRouteParam(rawOrganizationId);
  const planId = singleTrainingPlanRouteParam(rawPlanId);
  const { user } = useAuth();
  const [plan, setPlan] = useState<MobileTrainingPlan | null>(null);
  const [athletes, setAthletes] = useState<CoachAthlete[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!user || !organizationId || !planId) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const [plans, roster] = await Promise.all([
        readMobileCoachTrainingPlans(user.id, organizationId), readCoachAthletes(user.id, organizationId),
      ]);
      setPlan(plans?.find((item) => item.id === planId) ?? null); setAthletes(roster);
    } catch { setError("Training Plan editor could not be loaded."); }
    finally { setLoading(false); }
  }, [user, organizationId, planId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  if (loading || error || !plan || !athletes || !organizationId || !planId) return <CoachState loading={loading} error={error} unavailable="Training Plan is unavailable." retry={() => void load()}/>;
  return <MobileTrainingPlanForm organizationId={organizationId} plan={plan} today={singaporeToday(new Date())} athletes={athletes.map((athlete) => ({ userId: athlete.userId, name: athleteLabel(athlete) }))}/>;
}
