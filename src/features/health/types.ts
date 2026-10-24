import type { GarminView } from "@/features/garmin/types";
import type { GarminHealthControl } from "@/features/garmin/health/types";

export type HealthMetric = "sleepMinutes" | "restingHeartRate" | "stress" | "steps" | "bodyBattery" | "activityMinutes";
export type HealthDay = {
  date: string;
  sleepMinutes: number | null;
  sleepStages: { light: number; deep: number; rem: number; awake: number } | null;
  restingHeartRate: number | null;
  stress: number | null;
  steps: number | null;
  bodyBattery: number | null;
  activityMinutes: number | null;
};
export type HealthActivity = {
  id: string;
  type: string;
  startedAt: string;
  durationMinutes: number;
  averageHeartRate: number | null;
  distanceKm: number | null;
  source: "garmin";
};
export type HealthDataset = {
  kind: "empty" | "stored";
  days: HealthDay[];
  activities: HealthActivity[];
  lastSyncedAt: string | null;
};
export type HealthDashboardData = {
  connection: GarminView; dataset: HealthDataset; today: string;
  access: "connected" | "connect" | "reconnect" | "unavailable";
  control: GarminHealthControl | null;
  sync?: { state: "disabled" | "waiting" | "received" | "error" | "permission_revoked" | "reconciliation_required"; lastReceivedAt: string | null; lastProcessedAt: string | null };
};
