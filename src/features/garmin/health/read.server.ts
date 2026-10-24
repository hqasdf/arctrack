import "server-only";
import { createAuthClient } from "@/lib/supabase/server";
import { dateBefore } from "@/features/health/model";
import { garminHealthEnabled } from "./config.server";
import type { GarminHealthControl, GarminHealthRecord, GarminHealthSync } from "./types";

export async function readGarminHealth(userId: string, today: string): Promise<{ records: GarminHealthRecord[]; sync: GarminHealthSync | null; control: GarminHealthControl | null; unavailable: boolean }> {
  if (!garminHealthEnabled()) return { records: [], sync: null, control: null, unavailable: false };
  try {
    // Existing request-authenticated client, never the service client. RLS checks
    // auth.uid() and the live connection guard inside one consistent snapshot.
    const db = await createAuthClient();
    const { data, error } = await db.rpc("read_garmin_health_dashboard", { p_user_id: userId, p_start: dateBefore(today, 89), p_end: today });
    if (error || !data || !Array.isArray(data.records) || !data.control) throw new Error("Health read unavailable.");
    return { records: data.records as GarminHealthRecord[], sync: data.sync as GarminHealthSync | null,
      control: data.control as GarminHealthControl, unavailable: false };
  } catch { return { records: [], sync: null, control: null, unavailable: true }; }
}
