import "server-only";
import { readGarminStatus } from "@/features/garmin/service.server";
import { singaporeDate } from "./model";
import type { HealthDashboardData } from "./types";
import { garminHealthEnabled } from "@/features/garmin/health/config.server";
import { readGarminHealth } from "@/features/garmin/health/read.server";
import { garminHealthDataset } from "@/features/garmin/health/dashboard";

export async function readHealthDashboard(userId: string): Promise<HealthDashboardData> {
  const today = singaporeDate();
  const [connection, health] = await Promise.all([readGarminStatus(userId), readGarminHealth(userId, today)]);
  return { today, connection, dataset: garminHealthDataset(health.records, health.sync?.last_processed_at ?? null),
    sync: { state: health.unavailable ? "error" : health.sync?.state ?? (garminHealthEnabled() ? "waiting" : "disabled"),
      lastReceivedAt: health.sync?.last_received_at ?? null, lastProcessedAt: health.sync?.last_processed_at ?? null } };
}
