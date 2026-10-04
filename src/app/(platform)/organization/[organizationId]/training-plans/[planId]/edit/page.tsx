import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoachPlanForm } from "@/features/organizations/components/training-plan-ui";
import { readCoachAthletes } from "@/features/organizations/coach-read.server";
import { athleteName } from "@/features/organizations/coach-model";
import { readCoachTrainingPlans } from "@/features/organizations/training-plans-read.server";
import { singaporeDate } from "@/lib/date";

export const metadata: Metadata = { title: "Edit Training Plan" };
export default async function EditTrainingPlanPage({ params }: { params: Promise<{ organizationId: string; planId: string }> }) {
  const { organizationId, planId } = await params;
  const [plans, athletes] = await Promise.all([readCoachTrainingPlans(organizationId), readCoachAthletes(organizationId)]);
  const plan = plans.find((item) => item.id === planId);
  if (!plan) notFound();
  return <CoachPlanForm organizationId={organizationId} athletes={athletes.map((athlete) => ({ userId: athlete.userId, name: athleteName(athlete) }))} plan={plan} today={singaporeDate(new Date())}/>;
}
