import type { Metadata } from "next";
import { CoachPlanList } from "@/features/organizations/components/training-plan-ui";
import { readCoachTrainingPlans } from "@/features/organizations/training-plans-read.server";
import { singaporeDate } from "@/lib/date";

export const metadata: Metadata = { title: "Training Plans" };
export default async function TrainingPlansPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  const plans = await readCoachTrainingPlans(organizationId);
  return <CoachPlanList organizationId={organizationId} plans={plans} today={singaporeDate(new Date())}/>;
}
