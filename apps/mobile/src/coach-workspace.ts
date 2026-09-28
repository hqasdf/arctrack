import type { CoachAnalyticsSession } from "@arc-track/core/coach-analytics";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { useAuth } from "./auth";
import { readCoachAthletes, readCoachOrganization, readCoachOrganizationSessions, type CoachAthlete } from "./organizations";

export type CoachWorkspaceData = { organization: { id: string; name: string }; athletes: CoachAthlete[]; sessions: Array<CoachAnalyticsSession & { createdAt: string }> };

export function useCoachWorkspace(organizationId: string | undefined) {
  const { user } = useAuth();
  const [data, setData] = useState<CoachWorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!user || !organizationId) { setLoading(false); setData(null); return; }
    setLoading(true); setError(null);
    try {
      const organization = await readCoachOrganization(user.id, organizationId);
      if (!organization) { setData(null); return; }
      const athletes = await readCoachAthletes(user.id, organizationId);
      if (!athletes) { setData(null); return; }
      const sessions = await readCoachOrganizationSessions(user.id, organizationId, athletes);
      setData({ organization, athletes, sessions: sessions ?? [] });
    } catch { setError("Coach workspace could not be loaded. Try again."); }
    finally { setLoading(false); }
  }, [user, organizationId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  return { data, loading, error, reload: load };
}
