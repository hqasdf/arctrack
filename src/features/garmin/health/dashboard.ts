import type { HealthDay, HealthDataset } from "@/features/health/types";
import { singaporeDate } from "@/features/health/model";
import type { GarminHealthRecord } from "./types";

export function garminHealthDataset(records: GarminHealthRecord[], lastProcessedAt: string | null): HealthDataset {
  const days = new Map<string, HealthDay>();
  const activities: HealthDataset["activities"] = [];
  const chosen = new Map<string, GarminHealthRecord>();
  for (const row of records) {
    if (row.kind === "activities") {
      activities.push({ id: row.source_id, type: (row.metrics.activityType ?? "Activity").toLowerCase().split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" "),
        startedAt: new Date(row.start_seconds * 1000).toISOString(), durationMinutes: row.duration_seconds / 60,
        averageHeartRate: row.metrics.averageHeartRate ?? null, distanceKm: row.metrics.distanceMeters == null ? null : row.metrics.distanceMeters / 1000, source: "garmin" });
      continue;
    }
    const key = `${row.calendar_date}:${row.kind}`;
    const previous = chosen.get(key);
    // No summing overlapping Garmin daily/sleep summaries. Pick the largest
    // monitoring window; Body Battery uses the latest actual sample time.
    const order = row.kind === "stressDetails" ? row.metrics.bodyBatteryTime ?? -1 : row.duration_seconds;
    const priorOrder = row.kind === "stressDetails" ? previous?.metrics.bodyBatteryTime ?? -1 : previous?.duration_seconds ?? -1;
    if (!previous || order > priorOrder || (order === priorOrder && row.updated_at > previous.updated_at)) chosen.set(key, row);
  }
  for (const row of chosen.values()) {
    const day = days.get(row.calendar_date) ?? { date: row.calendar_date, sleepMinutes: null, sleepStages: null,
      restingHeartRate: null, stress: null, steps: null, bodyBattery: null, activityMinutes: null };
    const values = row.metrics;
    if (row.kind === "dailies") {
      day.restingHeartRate = values.restingHeartRate ?? null;
      day.steps = values.steps ?? null;
      day.stress = values.stress ?? null;
      day.activityMinutes = values.activeSeconds == null ? null : values.activeSeconds / 60;
    } else if (row.kind === "sleeps") {
      day.sleepMinutes = values.sleepSeconds == null ? null : values.sleepSeconds / 60;
      const { lightSeconds: light, deepSeconds: deep, remSeconds: rem, awakeSeconds: awake } = values;
      // The existing chart has no unknown-stage segment. Do not stretch known
      // stages over unmeasured sleep or turn an absent stage into zero.
      if (light != null && deep != null && rem != null && awake != null && values.sleepSeconds != null && light + deep + rem === values.sleepSeconds) {
        day.sleepStages = { light: light / 60, deep: deep / 60, rem: rem / 60, awake: awake / 60 };
      }
    } else if (row.kind === "stressDetails") day.bodyBattery = values.bodyBattery ?? null;
    days.set(row.calendar_date, day);
  }
  // Activities remain distinct from Garmin all-day active time; never double count.
  activities.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  for (const activity of activities) {
    const date = singaporeDate(new Date(activity.startedAt));
    if (!days.has(date)) days.set(date, { date, sleepMinutes: null, sleepStages: null, restingHeartRate: null, stress: null, steps: null, bodyBattery: null, activityMinutes: null });
  }
  return { kind: records.length ? "stored" : "empty", days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)), activities, lastSyncedAt: records.length ? lastProcessedAt : null };
}
