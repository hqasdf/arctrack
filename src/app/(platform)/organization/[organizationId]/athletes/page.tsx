import type { Metadata } from "next";
import { CoachDirectory } from "@/features/organizations/components/coach-directory";
import { readCoachAthletes, readCoachOrganizationSessions, requireCoachOrganization } from "@/features/organizations/coach-read.server";
import { singaporeDate } from "@/lib/date";

export const metadata: Metadata = { title: "Team Athletes" };
export default async function CoachAthletesPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  await requireCoachOrganization(organizationId);
  const [athletes, sessions] = await Promise.all([readCoachAthletes(organizationId), readCoachOrganizationSessions(organizationId)]);
  return <CoachDirectory organizationId={organizationId} athletes={athletes} sessions={sessions} today={singaporeDate(new Date())}/>;
}
