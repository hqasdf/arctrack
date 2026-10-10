import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getAuthConfig } from "@/lib/auth/config";

/** No cookies or caller headers: this credential is used only by trusted server code. */
export function createAdminClient() {
  const config = getAuthConfig();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!config || !secret) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[account-deletion] admin_configuration", {
        reason: !secret ? "SUPABASE_SECRET_KEY missing" : "Auth configuration unavailable",
      });
    }
    throw new Error("Account deletion is not configured.");
  }
  return createClient(config.url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
