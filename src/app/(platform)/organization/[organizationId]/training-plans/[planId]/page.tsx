import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoachPlanDetail } from "@/features/organizations/components/training-plan-ui";
import { athleteName } from "@/features/organizations/coach-model";
import { readCoachTrainingPlanProgress } from "@/features/organizations/training-plans-read.server";
import { singaporeDate } from "@/lib/date";

export const metadata: Metadata = { title: "Training Plan" };
export default async function TrainingPlanPage({ params }: { params: Promise<{ organizationId: string; planId: string }> }) {
  const { organizationId, planId } = await params;
  const today = singaporeDate(new Date());
  const result = await readCoachTrainingPlanProgress(organizationId, planId, today);
  if (!result) notFound();
  return <CoachPlanDetail plan={result.plan} athletes={result.athletes.map((athlete) => ({ userId: athlete.userId, name: athleteName(athlete), progress: athlete.progress }))} today={today}/>;
}
