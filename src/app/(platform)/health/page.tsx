import { requireUser } from "@/lib/auth/session.server";
import { readHealthDashboard } from "@/features/health/read.server";
import { HealthDashboard } from "@/features/health/components/health-dashboard";

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ garmin?: string | string[] }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const data = await readHealthDashboard(user.id);
  return <HealthDashboard data={data} garminNotice={typeof params.garmin === "string" ? params.garmin : undefined} />;
}
