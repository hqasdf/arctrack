import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AthletePlanDetail } from "@/features/organizations/components/training-plan-ui";
import { readOwnTrainingPlanProgress } from "@/features/organizations/training-plans-read.server";
import { singaporeDate } from "@/lib/date";

export const metadata: Metadata = { title: "Your Training Plan" };
export default async function AthleteTrainingPlanPage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params;
  const today = singaporeDate(new Date());
  const plans = await readOwnTrainingPlanProgress(today);
  const found = plans.find(({ plan }) => plan.id === planId);
  if (!found) notFound();
  return <AthletePlanDetail {...found} today={today}/>;
}
