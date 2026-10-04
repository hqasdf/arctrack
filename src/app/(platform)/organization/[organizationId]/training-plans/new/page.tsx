import type { Metadata } from "next";
import { CoachPlanForm } from "@/features/organizations/components/training-plan-ui";
import { readCoachAthletes } from "@/features/organizations/coach-read.server";
import { athleteName } from "@/features/organizations/coach-model";
import { singaporeDate } from "@/lib/date";

export const metadata: Metadata = { title: "New Training Plan" };
export default async function NewTrainingPlanPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  const athletes = await readCoachAthletes(organizationId);
  return <CoachPlanForm organizationId={organizationId} athletes={athletes.map((athlete) => ({ userId: athlete.userId, name: athleteName(athlete) }))} plan={null} today={singaporeDate(new Date())}/>;
}
