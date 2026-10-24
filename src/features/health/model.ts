import type { GarminView } from "@/features/garmin/types";
import type { HealthActivity, HealthDay, HealthMetric } from "./types";

export const METRICS = [
  { key: "sleepMinutes", label: "Sleep", unit: "", tone: "lavender", icon: "moon", explanation: "Total recorded sleep duration. Sleep stages are shown only when available." },
  { key: "restingHeartRate", label: "Resting Heart Rate", unit: "bpm", tone: "coral", icon: "heart", explanation: "Recorded resting heart rate, not exercise heart rate." },
  { key: "stress", label: "Stress", unit: "/ 100", tone: "amber", icon: "activity", explanation: "Garmin's reported stress level on a 0–100 scale. Not a medical assessment." },
  { key: "steps", label: "Steps", unit: "steps", tone: "blue", icon: "steps", explanation: "Steps reported for the selected day. Missing records are not counted as zero." },
  { key: "bodyBattery", label: "Body Battery", unit: "/ 100", tone: "green", icon: "battery", explanation: "Garmin's Body Battery estimate on a 0–100 scale, not an Arc Track readiness score." },
] as const;

export function singaporeDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function dateBefore(date: string, count: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - count);
  return value.toISOString().slice(0, 10);
}

export function periodDays(days: HealthDay[], end: string, count: number): HealthDay[] {
  const start = dateBefore(end, count - 1);
  return days.filter((day) => day.date >= start && day.date <= end).sort((a, b) => a.date.localeCompare(b.date));
}

// Preserve gaps explicitly so the chart never joins missing days or invents zeroes.
export function chartDays(days: HealthDay[], end: string, count: number): HealthDay[] {
  const byDate = new Map(days.map((day) => [day.date, day]));
  return Array.from({ length: count }, (_, index) => {
    const date = dateBefore(end, count - index - 1);
    return byDate.get(date) ?? { date, sleepMinutes: null, sleepStages: null, restingHeartRate: null, stress: null, steps: null, bodyBattery: null, activityMinutes: null };
  });
}

export function average(days: HealthDay[], key: HealthMetric): number | null {
  const values = days.map((day) => day[key]).filter((value): value is number => value !== null);
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

export function formatMetric(key: HealthMetric, value: number | null): string {
  if (value === null) return "—";
  if (key === "sleepMinutes") {
    const rounded = Math.round(value);
    return `${Math.floor(rounded / 60)}h ${String(rounded % 60).padStart(2, "0")}m`;
  }
  return Math.round(value).toLocaleString("en-SG");
}

export function formatDay(date: string, short = false): string {
  return new Intl.DateTimeFormat("en-SG", { day: "numeric", month: short ? "short" : "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

export function supportsRange(days: HealthDay[], end: string, count: number): boolean {
  // Enable a range only when its complete calendar span has stored records.
  return new Set(periodDays(days, end, count).map((day) => day.date)).size === count;
}

export function connectionState(connection: GarminView): "connected" | "unavailable" | "disconnected" | "attention" {
  if (connection.status === "connected") return "connected";
  if (connection.status === "reauthorization_required" || connection.status === "error") return "attention";
  if (!connection.available || !connection.canConnect) return "unavailable";
  return "disconnected";
}

export function filterActivities(activities: HealthActivity[], type: string, sort: "newest" | "oldest" | "duration", end: string): HealthActivity[] {
  return activities.filter((activity) => (type === "all" || activity.type === type) && singaporeDate(new Date(activity.startedAt)) <= end)
    .sort((a, b) => sort === "duration" ? b.durationMinutes - a.durationMinutes : sort === "oldest" ? a.startedAt.localeCompare(b.startedAt) : b.startedAt.localeCompare(a.startedAt));
}

export function wellnessSummary(days: HealthDay[]): string {
  const sleep = average(days, "sleepMinutes");
  const heart = average(days, "restingHeartRate");
  if (sleep === null && heart === null) return "Your health overview will take shape here as supported measurements become available. Connecting Garmin alone does not import health data.";
  const parts = [];
  if (sleep !== null) parts.push(`Average recorded sleep: ${formatMetric("sleepMinutes", sleep)}.`);
  if (heart !== null) parts.push(`Average resting heart rate: ${Math.round(heart)} bpm.`);
  return `${parts.join(" ")} Based on ${days.length} recorded day${days.length === 1 ? "" : "s"} in this period. These are descriptive measurements, not a readiness or medical assessment.`;
}
