import { requireUser } from "@/lib/auth/session.server";
import { readHealthDashboard } from "@/features/health/read.server";
import { HealthDashboard } from "@/features/health/components/health-dashboard";

<<<<<<< HEAD
export default async function HealthPage({ searchParams }: { searchParams: Promise<{ garmin?: string | string[] }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const data = await readHealthDashboard(user.id);
=======
export default async function HealthPage({ searchParams }: { searchParams: Promise<{ preview?: string | string[]; garmin?: string | string[] }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const host = (await headers()).get("host") ?? "";
  const data = await readHealthDashboard(user.id, host, params.preview);
>>>>>>> f021ef8ba002fe90f6810bd7fb86d3c0de4a8357
  return <HealthDashboard data={data} garminNotice={typeof params.garmin === "string" ? params.garmin : undefined} />;
}
