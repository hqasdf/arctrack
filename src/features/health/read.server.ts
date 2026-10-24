import "server-only";
import { readGarminStatus } from "@/features/garmin/service.server";
import { singaporeDate } from "./model";
import type { HealthDashboardData } from "./types";
import { garminHealthEnabled } from "@/features/garmin/health/config.server";
import { readGarminHealth } from "@/features/garmin/health/read.server";
import { garminHealthDataset } from "@/features/garmin/health/dashboard";

export async function readHealthDashboard(userId: string): Promise<HealthDashboardData> {
  const today = singaporeDate();
  const connection = await readGarminStatus(userId);
  const access = !connection.available ? "unavailable" : connection.status === "connected" && !connection.error ? "connected"
    : connection.status === "disconnected" ? "connect" : connection.status === "reauthorization_required" ? "reconnect" : "unavailable";
  // Connection status is authoritative. Never fetch measurements in parallel
  // with authorization or pass retained measurements into a locked dashboard.
  const health = access === "connected" ? await readGarminHealth(userId, today) : { records: [], sync: null, control: null, unavailable: false };
  return { today, connection, access: health.unavailable ? "unavailable" : access, control: health.control ?? null, dataset: garminHealthDataset(health.records, health.sync?.last_processed_at ?? null),
    sync: { state: health.unavailable ? "error" : health.sync?.state ?? (garminHealthEnabled() ? "waiting" : "disabled"),
      lastReceivedAt: health.sync?.last_received_at ?? null, lastProcessedAt: health.sync?.last_processed_at ?? null } };
}
