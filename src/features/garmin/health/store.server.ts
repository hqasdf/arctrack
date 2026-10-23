import "server-only";
import { createAdminClient } from "@/lib/supabase/admin.server";
import type { GarminHealthEvent } from "./types";

export interface GarminHealthInbox {
  stage(events: GarminHealthEvent[], allowedUsers: string[]): Promise<void>;
  process(allowedUsers: string[], limit: number): Promise<number>;
}
export function createGarminHealthInbox(): GarminHealthInbox {
  const db = createAdminClient();
  return {
    async stage(events, allowedUsers) {
      const { error } = await db.rpc("stage_garmin_health_push", { p_events: events, p_allowed_users: allowedUsers });
      if (error) throw new Error("Garmin health storage unavailable.");
    },
    async process(allowedUsers, limit) {
      const { data, error } = await db.rpc("process_garmin_health_queue", { p_allowed_users: allowedUsers, p_limit: limit });
      if (error || !Number.isInteger(data)) throw new Error("Garmin health processing unavailable.");
      return data as number;
    },
  };
}
