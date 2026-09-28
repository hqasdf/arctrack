import type { Metadata } from "next";
import { CoachAnalytics } from "@/features/organizations/components/coach-analytics";
import { readCoachAthletes, readCoachOrganizationSessions, requireCoachOrganization } from "@/features/organizations/coach-read.server";
import { singaporeDate } from "@/lib/date";

export const metadata: Metadata = { title: "Team Analytics" };
export default async function CoachAnalyticsPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  const organization = await requireCoachOrganization(organizationId);
  const [athletes, sessions] = await Promise.all([readCoachAthletes(organizationId), readCoachOrganizationSessions(organizationId)]);
  return <CoachAnalytics organization={organization} athletes={athletes} sessions={sessions} today={singaporeDate(new Date())}/>;
}
