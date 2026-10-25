import "server-only";
import { createHash } from "node:crypto";
import { singaporeDate } from "@/features/health/model";
import type { GarminHealthEvent, GarminHealthKind, GarminHealthValues } from "./types";

export class GarminHealthPayloadError extends Error {
  constructor() { super("Unsupported or invalid Garmin notification."); }
}
const fail = (): never => { throw new GarminHealthPayloadError(); };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 256): string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value) ? value : fail();
}
function number(value: unknown, max: number, minimum = 0, integer = true): number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= max && (!integer || Number.isSafeInteger(value)) ? value : fail();
}
function optional(row: Record<string, unknown>, key: string, max: number, minimum = 0, integer = true): number | null {
  return row[key] == null ? null : number(row[key], max, minimum, integer);
}
function date(value: unknown): string {
  const result = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || result < "2000-01-01" || result > "2100-01-01") return fail();
  const parsed = new Date(`${result}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === result ? result : fail();
}
const unix = (value: unknown) => number(value, 4102444800, 946684800);

// Provider fields verified against Health API 2.0 §§4–6 and Activity API 2.0 §§4–6.
// Drop GPS, device names, sample series and all fields not needed by the dashboard.
export function normalizeGarminPush(input: unknown): GarminHealthEvent[] {
  const root = object(input);
  const events: GarminHealthEvent[] = [];
  const supported = new Set(["dailies", "sleeps", "stressDetails", "activities", "manuallyUpdatedActivities", "userPermissionsChange", "deregistrations"]);
  if (!Object.keys(root).length) return fail();
  for (const [type, list] of Object.entries(root)) {
    if (!supported.has(type) || !Array.isArray(list) || !list.length || list.length > 100) return fail();
    for (const item of list) {
      if (events.length >= 100) return fail();
      const row = object(item);
      const kind = (type === "manuallyUpdatedActivities" ? "activities" : type) as GarminHealthKind;
      const garminUserId = text(row.userId);
      let sourceId = kind === "deregistrations" ? "deregistration" : text(row.summaryId);
      let recordKey = sourceId;
      let calendarDate: string | null = null, startTimeInSeconds: number | null = null, durationInSeconds: number | null = null;
      let permissions: string[] | null = null, changeTimeInSeconds: number | null = null;
      let values: GarminHealthValues = {};
      if (kind === "userPermissionsChange") {
        if (!Array.isArray(row.permissions) || row.permissions.length > 100) return fail();
        permissions = [...new Set(row.permissions.map((value) => text(value, 80)))].sort();
        changeTimeInSeconds = unix(row.changeTimeInSeconds);
      } else if (kind !== "deregistrations") {
        startTimeInSeconds = unix(row.startTimeInSeconds);
        durationInSeconds = number(row.durationInSeconds, kind === "activities" ? 604800 : 172800);
        if (row.startTimeOffsetInSeconds != null) number(row.startTimeOffsetInSeconds, 86400, -86400);
        calendarDate = kind === "activities" ? singaporeDate(new Date(startTimeInSeconds * 1000)) : date(row.calendarDate);
        recordKey = String(startTimeInSeconds);
        if (kind === "dailies") {
          values = { restingHeartRate: optional(row, "restingHeartRateInBeatsPerMinute", 300, 1), steps: optional(row, "steps", 2000000),
            stress: row.averageStressLevel === -1 ? null : optional(row, "averageStressLevel", 100, 1),
            activeSeconds: optional(row, "activeTimeInSeconds", durationInSeconds) };
        } else if (kind === "sleeps") {
          const score = row.overallSleepScore && typeof row.overallSleepScore === "object" && !Array.isArray(row.overallSleepScore)
            ? row.overallSleepScore as Record<string, unknown> : {};
          const scoreValue = typeof score.value === "number" && Number.isInteger(score.value) && score.value >= 0 && score.value <= 100 ? score.value : null;
          const qualifier = typeof score.qualifierKey === "string" && ["EXCELLENT", "GOOD", "FAIR", "POOR"].includes(score.qualifierKey) ? score.qualifierKey : null;
          const awake = optional(row, "awakeDurationInSeconds", 172800);
          values = { sleepSeconds: durationInSeconds, lightSeconds: optional(row, "lightSleepDurationInSeconds", 172800),
            deepSeconds: optional(row, "deepSleepDurationInSeconds", 172800), remSeconds: optional(row, "remSleepInSeconds", 172800),
            awakeSeconds: awake, sleepScore: scoreValue, sleepScoreQualifier: scoreValue === null ? null : qualifier,
            sleepValidation: typeof row.validation === "string" && /^[A-Z_]{1,64}$/.test(row.validation) ? row.validation : null,
            // Garmin duration excludes awake time. Do not invent an end if awake is missing.
            sleepEndSeconds: awake === null ? null : startTimeInSeconds + durationInSeconds + awake };
        } else if (kind === "stressDetails") {
          let latest: number | null = null, latestOffset = -1;
          if (row.timeOffsetBodyBatteryValues != null) {
            const samples = object(row.timeOffsetBodyBatteryValues);
            if (Object.keys(samples).length > 20000) return fail();
            for (const [offset, value] of Object.entries(samples)) {
              if (!/^\d+$/.test(offset)) return fail();
              const seconds = number(Number(offset), durationInSeconds);
              const battery = number(value, 100);
              if (seconds > latestOffset) { latest = battery; latestOffset = seconds; }
            }
          }
          values = { bodyBattery: latest, bodyBatteryTime: latest === null ? null : startTimeInSeconds + latestOffset };
        } else {
          // activityId links ordinary and manually updated summaries when supplied.
          // The official field table says string; its JSON example uses a number.
          if (row.activityId != null) sourceId = typeof row.activityId === "number" ? String(number(row.activityId, Number.MAX_SAFE_INTEGER)) : text(row.activityId);
          recordKey = sourceId;
          values = { activityType: text(row.activityType, 100), averageHeartRate: optional(row, "averageHeartRateInBeatsPerMinute", 300, 1),
            distanceMeters: optional(row, "distanceInMeters", 10000000, 0, false) };
        }
      }
      const normalized = { garminUserId, kind, sourceId, recordKey, calendarDate, startTimeInSeconds, durationInSeconds, values, permissions, changeTimeInSeconds };
      events.push({ ...normalized, hash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex") });
    }
  }
  return events;
}
