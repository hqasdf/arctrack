import "react-native-url-polyfill/auto";
import { secureAuthStorage } from "./secure-auth-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState } from "react-native";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

export const configError = !url || !key?.startsWith("sb_publishable_")
  ? "Arc Track mobile needs its Supabase URL and publishable key."
  : null;

export const supabase = configError ? null : createClient(url!, key!, {
  auth: {
    storage: secureAuthStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

if (supabase) {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
