import type { Metadata } from "next";
import { CoachDashboard } from "@/features/organizations/components/coach-dashboard";
import { readCoachAthletes, readCoachOrganizationSessions, requireCoachOrganization } from "@/features/organizations/coach-read.server";
import { singaporeDate } from "@/lib/date";
import type { CoachPeriod } from "@arc-track/core/coach-analytics";

export const metadata: Metadata = { title: "Coach Dashboard" };

export default async function CoachDashboardPage({ params, searchParams }: { params: Promise<{ organizationId: string }>; searchParams: Promise<{ period?: string }> }) {
  const { organizationId } = await params;
  const requestedPeriod = (await searchParams).period;
  const period: CoachPeriod = requestedPeriod === "7" || requestedPeriod === "90" || requestedPeriod === "all" ? requestedPeriod : "30";
  const organization = await requireCoachOrganization(organizationId);
  const [athletes, sessions] = await Promise.all([
    readCoachAthletes(organizationId), readCoachOrganizationSessions(organizationId),
  ]);
  const today = singaporeDate(new Date());
  return <CoachDashboard organization={organization} athletes={athletes} sessions={sessions} today={today} period={period}/>;
}
