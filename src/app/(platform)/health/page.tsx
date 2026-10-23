import { headers } from "next/headers";
import { requireUser } from "@/lib/auth/session.server";
import { readHealthDashboard } from "@/features/health/read.server";
import { HealthDashboard } from "@/features/health/components/health-dashboard";

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ preview?: string | string[] }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const host = (await headers()).get("host") ?? "";
  const data = await readHealthDashboard(user.id, host, params.preview);
  return <HealthDashboard data={data} />;
}
