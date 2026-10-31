import type { CoachAnalyticsSession } from "@arc-track/core/coach-analytics";
import { useCallback } from "react";
import {useScopedFocusRead} from './use-scoped-focus-read';
import { useAuth } from "./auth";
import { readCoachAthletes, readCoachOrganization, readCoachOrganizationSessions, type CoachAthlete } from "./organizations";

export type CoachWorkspaceData = { organization: { id: string; name: string }; athletes: CoachAthlete[]; sessions: Array<CoachAnalyticsSession & { createdAt: string }> };

export function useCoachWorkspace(organizationId: string | undefined) {
  const { user } = useAuth();
  const userId=user?.id;
  const read=useCallback(async(current:()=>boolean):Promise<CoachWorkspaceData|null>=>{
    if(!userId||!organizationId)return null;
    const organization=await readCoachOrganization(userId,organizationId);
    if(!current()||!organization)return null;
    const athletes=await readCoachAthletes(userId,organizationId);
    if(!current()||!athletes)return null;
    const sessions=await readCoachOrganizationSessions(userId,organizationId,athletes);
    if(!sessions)return null;
    return {organization,athletes,sessions};
  },[userId,organizationId]);
  return useScopedFocusRead(userId&&organizationId?JSON.stringify([userId,organizationId]):null,read,"Coach workspace could not be loaded. Try again.");
}
