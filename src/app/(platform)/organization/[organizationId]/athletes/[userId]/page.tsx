import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoachAthleteDetail } from "@/features/organizations/components/coach-athlete-detail";
import { readCoachAthleteSessions, readCoachAthletes, requireCoachOrganization } from "@/features/organizations/coach-read.server";
import { singaporeDate } from "@/lib/date";
import { readCoachAthleteTrainingPlanProgress } from "@/features/organizations/training-plans-read.server";

export const metadata: Metadata = { title: "Organisation athlete" };

export default async function CoachAthletePage({ params }: {
  params: Promise<{ organizationId: string; userId: string }>;
}) {
  const { organizationId, userId } = await params;
  const organization = await requireCoachOrganization(organizationId);
  const athletes = await readCoachAthletes(organizationId);
  const athlete = athletes.find((item) => item.userId === userId);
  if (!athlete) notFound();
  const today = singaporeDate(new Date());
  const [sessions, trainingPlans] = await Promise.all([
    readCoachAthleteSessions(organizationId, userId),
    readCoachAthleteTrainingPlanProgress(organizationId, userId, today).catch(() => null),
  ]);
  return <CoachAthleteDetail organization={organization} athlete={athlete} sessions={sessions} today={today} trainingPlans={trainingPlans}/>;
}
