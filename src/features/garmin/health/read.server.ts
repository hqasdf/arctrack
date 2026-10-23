import "server-only";
import { createAuthClient } from "@/lib/supabase/server";
import { dateBefore } from "@/features/health/model";
import { garminHealthEnabled } from "./config.server";
import type { GarminHealthRecord, GarminHealthSync } from "./types";

export async function readGarminHealth(userId: string, today: string): Promise<{ records: GarminHealthRecord[]; sync: GarminHealthSync | null; unavailable: boolean }> {
  if (!garminHealthEnabled()) return { records: [], sync: null, unavailable: false };
  try {
    // Existing request-authenticated client, never the service client. RLS checks
    // auth.uid() as well as the explicit owner filter at both read boundaries.
    const db = await createAuthClient();
    const [records, sync] = await Promise.all([
      db.from("garmin_health_records").select("kind,source_id,record_key,calendar_date,start_seconds,duration_seconds,metrics,imported_at,updated_at")
        .eq("user_id", userId).gte("calendar_date", dateBefore(today, 89)).lte("calendar_date", today)
        .order("calendar_date", { ascending: false }).order("updated_at", { ascending: false }).limit(10000),
      db.from("garmin_health_sync_state").select("state,last_received_at,last_processed_at,error_code,granted_permissions").eq("user_id", userId).maybeSingle(),
    ]);
    if (records.error || sync.error) throw new Error("Health read unavailable.");
    return { records: (records.data ?? []) as GarminHealthRecord[], sync: sync.data as GarminHealthSync | null, unavailable: false };
  } catch { return { records: [], sync: null, unavailable: true }; }
}
