import "react-native-url-polyfill/auto";
import { secureAuthStorage, secureAuthorityStorage } from "./secure-auth-storage";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createMobileSessionClient } from "./session-client";
import { parseRecoveryContext, RECOVERY_STORAGE_KEY, recoveryBlocksApp } from "./auth-flow";
import { AppState } from "react-native";
import { nativeAuthPrompt } from "./auth-native-prompt";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

export const configError = !url || !key?.startsWith("sb_publishable_")
  ? "Arc Track mobile needs its Supabase URL and publishable key."
  : null;

const runtime = configError ? null : createMobileSessionClient(url!, key!, {
  records: secureAuthorityStorage,
  legacy: secureAuthStorage,
  legacyRecovery: async session => recoveryBlocksApp(session.user,
    parseRecoveryContext(await AsyncStorage.getItem(RECOVERY_STORAGE_KEY))),
  reportCleanupFailure: () => { console.warn("[AUTH] Legacy session cleanup needs retry."); },
});
export const supabase = runtime?.client ?? null;
export const mobileAuthentication = runtime?.authentication ?? null;
export const sessionAuthority = runtime?.authority ?? null;

if (supabase) {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else {
      supabase.auth.stopAutoRefresh();
      if (!nativeAuthPrompt.active) void mobileAuthentication?.abandonPasskey().catch(() => {});
    }
  });
}
