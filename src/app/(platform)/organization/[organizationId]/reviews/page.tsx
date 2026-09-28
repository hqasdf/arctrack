import type { Metadata } from "next";
import { CoachReviews } from "@/features/organizations/components/coach-reviews";
import { readCoachAthletes, readCoachOrganizationSessions, requireCoachOrganization } from "@/features/organizations/coach-read.server";
import { singaporeDate } from "@/lib/date";

export const metadata: Metadata = { title: "Coach Reviews" };
export default async function CoachReviewsPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  await requireCoachOrganization(organizationId);
  const [athletes, sessions] = await Promise.all([readCoachAthletes(organizationId), readCoachOrganizationSessions(organizationId)]);
  return <CoachReviews organizationId={organizationId} athletes={athletes} sessions={sessions} today={singaporeDate(new Date())}/>;
}
