import "server-only";
import { createAdminClient } from "@/lib/supabase/admin.server";
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
  return {
    async refreshDue(refresh) {
      const { data, error } = await db.rpc("garmin_health_refresh_candidates", { p_limit: 3 });
      if (error || !Array.isArray(data) || data.some(userId => typeof userId !== "string")) throw new Error("Garmin health authorization maintenance unavailable.");
      // Existing OAuth leases serialize token rotation; one unavailable account must not block others.
      await Promise.allSettled(data.map(userId => refresh(userId)));
    },
    async stage(events) {
      const { data, error } = await db.rpc("admit_garmin_health_push", { p_events: events });
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
    },
    async process(limit) {
      const { data, error } = await db.rpc("process_garmin_health_queue", { p_limit: limit });
      if (error || !Number.isInteger(data)) throw new Error("Garmin health processing unavailable.");
      return data as number;
    },
  };
}
