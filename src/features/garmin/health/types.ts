export type GarminHealthKind = "dailies" | "sleeps" | "stressDetails" | "activities" | "userPermissionsChange" | "deregistrations";
export type GarminHealthValues = {
  sleepSeconds?: number | null; lightSeconds?: number | null; deepSeconds?: number | null;
  remSeconds?: number | null; awakeSeconds?: number | null;
  restingHeartRate?: number | null; steps?: number | null; stress?: number | null;
  activeSeconds?: number | null; bodyBattery?: number | null; bodyBatteryTime?: number | null;
  activityType?: string; averageHeartRate?: number | null; distanceMeters?: number | null;
};
export type GarminHealthEvent = {
  garminUserId: string; kind: GarminHealthKind; sourceId: string; recordKey: string;
  calendarDate: string | null; startTimeInSeconds: number | null; durationInSeconds: number | null;
  values: GarminHealthValues; permissions: string[] | null; changeTimeInSeconds: number | null; hash: string;
};
export type GarminHealthRecord = {
  kind: Exclude<GarminHealthKind, "userPermissionsChange" | "deregistrations">;
  source_id: string; record_key: string; calendar_date: string; start_seconds: number;
  duration_seconds: number; metrics: GarminHealthValues; imported_at: string; updated_at: string;
};
export type GarminHealthSync = {
  state: "waiting" | "received" | "error" | "permission_revoked" | "reconciliation_required";
  last_received_at: string | null; last_processed_at: string | null;
  error_code: string | null; granted_permissions: string[] | null;
};
