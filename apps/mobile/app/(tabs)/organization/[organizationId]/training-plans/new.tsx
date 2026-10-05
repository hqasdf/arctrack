import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { useAuth } from "@/src/auth";
import { CoachState } from "@/src/coach-ui";
import { singaporeToday } from "@/src/mobile-analytics";
import { athleteLabel, readCoachAthletes, type CoachAthlete } from "@/src/organizations";
import { MobileTrainingPlanForm } from "@/src/training-plans-ui";
import { singleTrainingPlanRouteParam } from "@/src/training-plan-route-params";

export default function NewCoachTrainingPlanScreen() {
  const { organizationId: rawOrganizationId } = useLocalSearchParams<{ organizationId?: string | string[] }>();
  const organizationId = singleTrainingPlanRouteParam(rawOrganizationId);
  const { user } = useAuth();
  const [athletes, setAthletes] = useState<CoachAthlete[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!user || !organizationId) { setLoading(false); return; }
    setLoading(true); setError(null);
    try { setAthletes(await readCoachAthletes(user.id, organizationId)); }
    catch { setError("Athlete picker could not be loaded."); }
    finally { setLoading(false); }
  }, [user, organizationId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  if (loading || error || !athletes || !organizationId) return <CoachState loading={loading} error={error} unavailable="Coach access is unavailable." retry={() => void load()}/>;
  return <MobileTrainingPlanForm organizationId={organizationId} plan={null} today={singaporeToday(new Date())} athletes={athletes.map((athlete) => ({ userId: athlete.userId, name: athleteLabel(athlete) }))}/>;
}
