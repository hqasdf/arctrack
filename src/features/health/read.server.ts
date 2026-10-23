import "server-only";
import { readGarminStatus } from "@/features/garmin/service.server";
import { canPreviewHealth, singaporeDate } from "./model";
import type { HealthDashboardData } from "./types";
import { garminHealthEnabled } from "@/features/garmin/health/config.server";
import { readGarminHealth } from "@/features/garmin/health/read.server";
import { garminHealthDataset } from "@/features/garmin/health/dashboard";

export async function readHealthDashboard(userId: string, host: string, preview: unknown): Promise<HealthDashboardData> {
  if (canPreviewHealth(process.env.NODE_ENV, host, preview)) {
    const { createHealthDemo } = await import("./demo.server");
    return {
      today: "2026-10-23", dataset: createHealthDemo(),
      connection: { available: false, canConnect: false, status: "disconnected", permissions: [], authorizedAt: null, checkedAt: null, expiresAt: null, error: null },
    };
  }
  const today = singaporeDate();
  const [connection, health] = await Promise.all([readGarminStatus(userId), readGarminHealth(userId, today)]);
  return { today, connection, dataset: garminHealthDataset(health.records, health.sync?.last_processed_at ?? null),
    sync: { state: health.unavailable ? "error" : health.sync?.state ?? (garminHealthEnabled() ? "waiting" : "disabled"),
      lastReceivedAt: health.sync?.last_received_at ?? null, lastProcessedAt: health.sync?.last_processed_at ?? null } };
}
