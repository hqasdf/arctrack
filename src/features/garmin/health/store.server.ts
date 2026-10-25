import "server-only";
import { createAdminClient } from "@/lib/supabase/admin.server";
import { getGarminConfig } from "@/features/garmin/config.server";
import { seal, unseal } from "@/features/garmin/crypto.server";
import { createGarminActivityPullProcessor, GarminActivityPullError, type GarminActivityPullJob } from "./activity-pull.server";
import type { GarminHealthEvent } from "./types";

export type GarminAdmissionResult = {
  status: "accepted" | "duplicate" | "ineligible" | "temporary" | "storage_failure";
  accepted: number; duplicate: number; ineligible: number;
};
const storageFailure: GarminAdmissionResult = { status: "storage_failure", accepted: 0, duplicate: 0, ineligible: 0 };

export interface GarminHealthInbox {
  stage(events: GarminHealthEvent[]): Promise<GarminAdmissionResult>;
  process(limit: number): Promise<number>;
  refreshDue(refresh: (userId: string) => Promise<unknown>): Promise<void>;
}
export function createGarminHealthInbox(): GarminHealthInbox {
  const db = createAdminClient();
  async function stage(events: GarminHealthEvent[]): Promise<GarminAdmissionResult> {
    const config = events.some(event => event.activityDetailsPull) ? getGarminConfig() : null;
    if (events.some(event => event.activityDetailsPull) && !config) return storageFailure;
    const safeEvents = events.map(event => {
      if (!event.activityDetailsPull) return event;
      const callbackUrl = event.activityDetailsPull.callbackUrl;
      if (!config || !callbackUrl) throw new Error("Garmin callback encryption unavailable.");
      const pull = { ...event.activityDetailsPull };
      delete pull.callbackUrl;
      delete pull.callbackCiphertext;
      return { ...event, activityDetailsPull: { ...pull,
        callbackCiphertext: seal({ callbackUrl }, config.encryptionKey, `activity-pull:${event.garminUserId}:${event.sourceId}`) } };
    });
    const rpc = safeEvents.some(event => event.heartRate) || safeEvents.length > 100
      ? "admit_garmin_hr_push" : "admit_garmin_health_push";
    const { data, error } = await db.rpc(rpc, { p_events: safeEvents });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) return storageFailure;
    const result = data as GarminAdmissionResult;
    const counts = [result.accepted, result.duplicate, result.ineligible];
    if (counts.some(value => !Number.isInteger(value) || value < 0 || value > events.length)) return storageFailure;
    if (result.status === "temporary") return counts.every(value => value === 0) ? result : storageFailure;
    if (counts.reduce((sum, value) => sum + value, 0) !== events.length) return storageFailure;
    if (result.status === "accepted" && result.accepted > 0
      || result.status === "duplicate" && result.accepted === 0 && result.duplicate > 0
      || result.status === "ineligible" && result.accepted === 0 && result.duplicate === 0) return result;
    return storageFailure;
  }
  return {
    async refreshDue(refresh) {
      const { data, error } = await db.rpc("garmin_health_refresh_candidates", { p_limit: 3 });
      if (error || !Array.isArray(data) || data.some(userId => typeof userId !== "string")) throw new Error("Garmin health authorization maintenance unavailable.");
      // Existing OAuth leases serialize token rotation; one unavailable account must not block others.
      await Promise.allSettled(data.map(userId => refresh(userId)));
    },
    stage,
    async process(limit) {
      const { data, error } = await db.rpc("process_garmin_health_queue", { p_limit: limit });
      if (error || !Number.isInteger(data)) throw new Error("Garmin health processing unavailable.");
      const config = getGarminConfig();
      const processPulls = createGarminActivityPullProcessor({
        claim: async (p_limit) => {
          const { data: rows, error: claimError } = await db.rpc("claim_garmin_activity_detail_pulls", { p_limit });
          if (claimError || !Array.isArray(rows)) throw new Error("Garmin Activity processing unavailable.");
          return rows as GarminActivityPullJob[];
        },
        finish: async (p_id, p_lease_token, p_outcome, p_error_code) => {
          const { error: finishError } = await db.rpc("finish_garmin_activity_detail_pull", { p_id, p_lease_token, p_outcome, p_error_code });
          if (finishError) throw new Error("Garmin Activity processing unavailable.");
        },
        decrypt: (job) => {
          if (!config) throw new GarminActivityPullError("storage_retryable");
          let value: { callbackUrl: string };
          try { value = unseal<{ callbackUrl: string }>(job.callback_ciphertext, config.encryptionKey,
            `activity-pull:${job.garmin_user_id}:${job.source_id}`); }
          catch { throw new GarminActivityPullError("invalid_callback"); }
          if (typeof value.callbackUrl !== "string") throw new Error("Invalid encrypted Garmin callback.");
          return value.callbackUrl;
        },
        stage,
      });
      const enterprisePullEnabled = process.env.GARMIN_SESSION_HR_ENABLED === "true"
        && process.env.GARMIN_ACTIVITY_ENTERPRISE_PULL_ENABLED === "true";
      if (enterprisePullEnabled && !config) throw new Error("Garmin Activity decryption unavailable.");
      const pulled = enterprisePullEnabled ? await processPulls(Math.min(3, limit)) : 0;
      return (data as number) + pulled;
    },
  };
}
