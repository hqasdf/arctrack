import * as SecureStore from "expo-secure-store";
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ActivityIndicator, AppState, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useAuth } from "./auth";
import { isMissingOrInvalidSession } from "./auth-flow";
import { supabase } from "./supabase";
import { authenticateBiometric, biometricAvailability } from "./biometrics";
import { BiometricLock, type BiometricAvailability, type LockSnapshot } from "./biometric-lock-model";
import { colors } from "./theme";

const LockContext = createContext<{ lock: BiometricLock; state: LockSnapshot } | null>(null);

export function BiometricLockProvider({ children }: { children: ReactNode }) {
  const { user, loading, authError, recoveryRequired, signOut } = useAuth();
  const [lock] = useState(() => new BiometricLock({
    readPreference: key => SecureStore.getItemAsync(key),
    writePreference: (key, value) => SecureStore.setItemAsync(key, value),
    removePreference: key => SecureStore.deleteItemAsync(key),
    authenticate: authenticateBiometric,
    verifySession: async userId => {
      if (!supabase) return "signed-out";
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) return isMissingOrInvalidSession(error) ? "signed-out" : "unavailable";
        return data.user?.id === userId && !!data.user.email_confirmed_at ? "valid" : "signed-out";
      } catch { return "unavailable"; }
    },
    onInvalidSession: signOut,
  }));
  const state = useSyncExternalStore(lock.subscribe, lock.getSnapshot, lock.getSnapshot);
  const userId = !loading && !authError && !recoveryRequired ? user?.id ?? null : null;
  useEffect(() => { lock.setUser(userId); }, [lock, userId]);
  useEffect(() => {
    lock.appStateChanged(AppState.currentState ?? "active");
    const lifecycle = AppState.addEventListener("change", next => lock.appStateChanged(next));
    const subscription = supabase?.auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") void lock.signedOut().catch(() => {
        if (__DEV__) console.warn("[AUTH] Biometric preference cleanup needs retry.");
      });
    });
    return () => { lifecycle.remove(); subscription?.data.subscription.unsubscribe(); lock.dispose(); };
  }, [lock]);
  const blocked = !!userId && (state.userId !== userId || !state.loaded || (state.enabled && (state.locked || state.obscured)));
  const [signOutError, setSignOutError] = useState(false);
  // Mount protected routes only after the first unlock. Later overlays keep active
  // scoring state/queues mounted, but remove their touch and accessibility access.
  const mountRoutes = !userId || !blocked || (state.userId === userId && state.hasUnlocked);
  return <LockContext.Provider value={{ lock, state }}><View style={styles.root}>
    {mountRoutes && <View style={styles.root} pointerEvents={blocked ? "none" : "auto"}
      accessibilityElementsHidden={blocked} importantForAccessibility={blocked ? "no-hide-descendants" : "auto"}>{children}</View>}
    {blocked && <View style={styles.cover} accessibilityViewIsModal>
      <View style={styles.panel}>
        <Text style={styles.title}>Arc Track locked</Text>
        <Text style={styles.note}>Unlock with device biometrics, or sign out to use your password.</Text>
        {!state.loaded || state.busy ? <ActivityIndicator color={colors.accent} accessibilityLabel="Checking biometric unlock" /> : null}
        {state.error ? <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={state.busy || !state.loaded || state.obscured}
          onPress={() => void lock.retry()} style={styles.button}><Text style={styles.buttonText}>Unlock</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => {
          setSignOutError(false);
          void signOut().catch(() => setSignOutError(true));
        }} style={styles.secondary}><Text style={styles.link}>Sign out and use password</Text></Pressable>
        {signOutError ? <Text accessibilityRole="alert" style={styles.error}>Sign-out could not be completed. Check your connection and retry.</Text> : null}
      </View>
    </View>}
  </View></LockContext.Provider>;
}

export function BiometricSetting() {
  const context = useContext(LockContext);
  const [availability, setAvailability] = useState<BiometricAvailability | null>(null);
  useEffect(() => {
    let active = true;
    void biometricAvailability().then(result => { if (active) setAvailability(result); });
    return () => { active = false; };
  }, []);
  if (!context) return null;
  const { lock, state } = context;
  return <View style={styles.setting}>
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{availability?.label ?? "Biometric Unlock"}</Text>
      <Switch accessibilityLabel={availability?.label ?? "Biometric Unlock"} value={state.enabled}
        disabled={!availability?.available || state.busy || !state.loaded}
        onValueChange={enabled => void lock.setEnabled(enabled)} trackColor={{ true: colors.accent }} />
    </View>
    <Text style={styles.note}>{availability?.reason ?? "Optional app unlock. Locks again after 60 seconds away."}</Text>
    {state.busy ? <ActivityIndicator color={colors.accent} accessibilityLabel="Updating biometric unlock" /> : null}
    {state.error ? <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  cover: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 1000, backgroundColor: colors.background, justifyContent: "center", padding: 24 },
  panel: { width: "100%", maxWidth: 440, alignSelf: "center", gap: 16 },
  title: { fontSize: 28, fontWeight: "700", color: colors.text },
  note: { fontSize: 14, color: colors.muted }, error: { fontSize: 14, color: colors.error },
  button: { minHeight: 52, backgroundColor: colors.accent, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  secondary: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  link: { color: colors.accent, fontWeight: "700" },
  setting: { marginTop: 12, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.border, gap: 8 },
  settingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  settingLabel: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "700" },
});
