import "server-only";
import { createAdminClient } from "@/lib/supabase/admin.server";
import type { GarminHealthEvent } from "./types";

export interface GarminHealthInbox {
  stage(events: GarminHealthEvent[]): Promise<void>;
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
      const { error } = await db.rpc("stage_garmin_health_push", { p_events: events });
      if (error) throw new Error("Garmin health storage unavailable.");
    },
    async process(limit) {
      const { data, error } = await db.rpc("process_garmin_health_queue", { p_limit: limit });
      if (error || !Number.isInteger(data)) throw new Error("Garmin health processing unavailable.");
      return data as number;
    },
  };
}
