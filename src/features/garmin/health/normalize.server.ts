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

// Enterprise Ping/Pull is a separate delivery entitlement from Starter Push.
// Its bearer callback URL must be encrypted before persistence.
function activityPull(row: Record<string, unknown>, kind: "activities" | "activityDetails"): GarminHealthEvent {
  const garminUserId = text(row.userId);
  const raw = text(row.callbackURL, 8192);
  let callback: URL;
  try { callback = new URL(raw); } catch { return fail(); }
  if (callback.protocol !== "https:" || callback.hostname !== "apis.garmin.com" || callback.port
    || callback.username || callback.password || callback.hash
    || callback.pathname !== `/wellness-api/rest/${kind}` || callback.searchParams.size !== 3) return fail();
  const keys = [...callback.searchParams.keys()];
  if (new Set(keys).size !== 3 || keys.some(key => !["uploadStartTimeInSeconds", "uploadEndTimeInSeconds", "token"].includes(key))) return fail();
  const start = unix(Number(callback.searchParams.get("uploadStartTimeInSeconds")));
  const end = unix(Number(callback.searchParams.get("uploadEndTimeInSeconds")));
  if (end <= start || end - start > 2678400 || !callback.searchParams.get("token") || callback.searchParams.get("token")!.length > 4096) return fail();
  // Hash only to form an opaque dedupe key; never expose the bearer URL in JSON
  // retained by the database or in diagnostic errors.
  const callbackHash = createHash("sha256").update(callback.href).digest("hex");
  const sourceId = `activity-pull:${callbackHash}`;
  const normalized = { garminUserId, kind: "activities" as const, sourceId, recordKey: sourceId,
    calendarDate: singaporeDate(new Date(end * 1000)), startTimeInSeconds: end,
    durationInSeconds: 0, values: {}, permissions: null, changeTimeInSeconds: null,
    activityDetailsPull: { kind, callbackUrl: callback.href } };
  return { ...normalized, hash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex") };
}

// Provider fields verified against Health API 2.0 §§4–6 and Activity API 2.0 §§4–6.
// Drop GPS/device metadata. HR series are separate bounded inbox chunks, never dashboard metrics.
export function normalizeGarminPush(input: unknown, options: { heartRate?: boolean; enterprisePull?: boolean } = {}): GarminHealthEvent[] {
  const root = object(input);
  const events: GarminHealthEvent[] = [];
  const supported = new Set(["dailies", "sleeps", "stressDetails", "activities", "manuallyUpdatedActivities", "activityDetails", "userPermissionsChange", "deregistrations"]);
  if (!Object.keys(root).length) return fail();
  for (const [type, list] of Object.entries(root)) {
    if (!supported.has(type) || !Array.isArray(list) || !list.length || list.length > 100) return fail();
    for (const item of list) {
      if (events.length >= 512) return fail();
      const row = object(item);
      if ((type === "activityDetails" || type === "activities") && row.callbackURL != null) {
        if (!options.heartRate || !options.enterprisePull) return fail();
        events.push(activityPull(row, type === "activityDetails" ? "activityDetails" : "activities"));
        continue;
      }
      if (type === "activityDetails") {
        if (!options.heartRate) return fail();
        const userId = text(row.userId);
        const summary = object(row.summary);
        // Starter Push includes the complete Details record, with its owner on
        // the outer object. Never trust a conflicting nested owner.
        const hr = normalizeGarminActivityDetails([row], userId);
        const summaryEvents = normalizeGarminPush({ activities: [{ ...summary, userId,
          summaryId: text(row.summaryId), activityId: row.activityId }] });
        events.push(...hr, ...summaryEvents);
        if (events.length > 512) return fail();
        continue;
      }
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
          if(row.activityName!=null)values.activityName=text(row.activityName,256);
          if(row.deviceName!=null)values.deviceName=text(row.deviceName,256);
          if(row.maxHeartRateInBeatsPerMinute!=null)values.maxHeartRate=optional(row,'maxHeartRateInBeatsPerMinute',300,1);
          if(row.activeKilocalories!=null)values.activeCalories=optional(row,'activeKilocalories',10000000);
          if(row.averageSpeedInMetersPerSecond!=null)values.averageSpeed=optional(row,'averageSpeedInMetersPerSecond',200,0,false);
          if(row.totalElevationGainInMeters!=null)values.elevationGain=optional(row,'totalElevationGainInMeters',1000000,0,false);
          if(row.totalElevationLossInMeters!=null)values.elevationLoss=optional(row,'totalElevationLossInMeters',1000000,0,false);
          if(row.averageRunCadenceInStepsPerMinute!=null)values.runCadence=optional(row,'averageRunCadenceInStepsPerMinute',1000,0,false);
          if(row.averageBikeCadenceInRoundsPerMinute!=null)values.bikeCadence=optional(row,'averageBikeCadenceInRoundsPerMinute',1000,0,false);
        }
      }
      const normalized = { garminUserId, kind, sourceId, recordKey, calendarDate, startTimeInSeconds, durationInSeconds, values, permissions, changeTimeInSeconds };
      if (options.heartRate && kind === "dailies" && row.timeOffsetHeartRateSamples != null) events.push(...heartRateEvents(row, false));
      if (events.length >= 512) return fail();
      events.push({ ...normalized, hash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex") });
    }
  }
  if (events.length > 100 && !events.some(event => event.heartRate)) return fail();
  return events;
}

// Shared sample validation for Starter full-data Push and explicitly entitled
// Enterprise responses. The authenticated delivery owner is authoritative.
export function normalizeGarminActivityDetails(input: unknown, expectedGarminUserId: string): GarminHealthEvent[] {
  const rows = input;
  if (!Array.isArray(rows) || rows.length > 100) return fail();
  const userId = text(expectedGarminUserId);
  const output: GarminHealthEvent[] = [];
  for (const value of rows) {
    const row = object(value);
    if (row.userId != null && text(row.userId) !== userId) return fail();
    if (row.summary != null) {
      const summary = object(row.summary);
      if (summary.userId != null && text(summary.userId) !== userId) return fail();
    }
    const events = heartRateEvents({ ...row, userId }, true);
    if (events[0]?.heartRate?.count) output.push(...events);
    if (output.length > 30000) return fail();
  }
  return output;
}

// Bounded chunks travel through the existing atomic inbox admission. They are NOT
// dashboard metrics. SQL publishes a dataset only once every chunk is present.
function heartRateEvents(row: Record<string, unknown>, activity: boolean): GarminHealthEvent[] {
  const summary = activity ? object(row.summary) : row;
  const start = unix(summary.startTimeInSeconds);
  const duration = number(summary.durationInSeconds, activity ? 86400 : 172800);
  const sourceId = activity ? (typeof row.activityId === "number" ? String(number(row.activityId, Number.MAX_SAFE_INTEGER)) : text(row.activityId, 180)) : text(row.summaryId, 180);
  const samples = new Map<number, number | null>();
  const add = (time: unknown, value: unknown) => {
    const timestamp = unix(time);
    if (timestamp < start || timestamp > start + duration) return fail();
    const bpm = value == null || value === 0 ? null : number(value, 300, 1);
    if (samples.has(timestamp) && samples.get(timestamp) !== bpm) return fail();
    samples.set(timestamp, bpm);
  };
  if (activity) {
    if (row.samples != null && !Array.isArray(row.samples)) return fail();
    const list = (row.samples ?? []) as unknown[];
    if (list.length > 86401) return fail();
    for (const item of list) { const sample = object(item); add(sample.startTimeInSeconds, sample.heartRate); }
  } else {
    const series = object(row.timeOffsetHeartRateSamples);
    if (Object.keys(series).length > 18000) return fail();
    for (const [offset, value] of Object.entries(series)) {
      if (!/^\d+$/.test(offset)) return fail();
      add(start + number(Number(offset), duration), value);
    }
  }
  const pairs = [...samples].sort((a,b) => a[0]-b[0]);
  const source = activity ? "activity" : "daily";
  const activityType = activity ? text(summary.activityType, 100) : null;
  const revision = createHash("sha256").update(JSON.stringify({ sourceId, start, duration, pairs, activityType })).digest("hex");
  if (pairs.length > 86401) return fail();
  if (activity && !pairs.some(([, bpm]) => bpm !== null)) return [];
  const parts = Math.max(1, Math.ceil(pairs.length / 300));
  return Array.from({length: parts}, (_, part) => {
    const normalized = { garminUserId: text(row.userId), kind: activity ? "activities" as const : "dailies" as const,
      sourceId, recordKey: sourceId, calendarDate: activity ? singaporeDate(new Date(start*1000)) : date(row.calendarDate),
      startTimeInSeconds: start, durationInSeconds: duration, values: {}, permissions: null, changeTimeInSeconds: null,
      heartRate: { source, revision, part, parts, count: pairs.length, activityType, samples: pairs.slice(part*300, (part+1)*300) } };
    return { ...normalized, hash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex") };
  });
}
