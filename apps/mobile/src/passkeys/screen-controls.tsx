import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Alert, AppState, Platform, Pressable, Text, View } from "react-native";
import type { PasskeyListItem } from "@supabase/supabase-js";
import { authStyles } from "../auth-ui";
import { colors } from "../theme";
import { nativeAuthPrompt } from "../auth-native-prompt";
import { canShowBiometricSignIn, canShowBiometricSignInSetting } from "./feature";
import { BiometricSignInAction, BiometricSignInSetting } from "./prepared-ui";
import type { createPasskeyManagement } from "./runtime";

const supported = () => Platform.OS === "android" && Number(Platform.Version) >= 28;
function message(error: unknown): string | null {
  // Native and server error payloads may contain sensitive details. Only use
  // fixed user-facing messages; cancellation is a normal, quiet outcome.
  if (error instanceof Error && error.name === "NativePasskeyError" && "code" in error && error.code === "cancelled") return null;
  return "Device authentication could not complete. Please try again or use your password.";
}

export function SignInBiometricControl({ disabled, onError }: {
  disabled: boolean; onError: (message: string | null) => void;
}) {
  if (!canShowBiometricSignIn() || !supported()) return null;
  return <SignInPasskeyAction disabled={disabled} onError={onError} />;
}

function SignInPasskeyAction({ disabled, onError }: {
  disabled: boolean; onError: (message: string | null) => void;
}) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  return <BiometricSignInAction available={!disabled} busy={busy} onPress={async () => {
    if (disabled || pending.current) return;
    pending.current = true; setBusy(true);
    // Only an explicit button press starts native authentication.
    try {
      const { signInWithPasskey } = await import("./runtime");
      await signInWithPasskey();
    } catch (error) { onError(message(error)); }
    finally { pending.current = false; setBusy(false); }
  }} />;
}

export function ProfileBiometricControl({ userId }: { userId: string | null }) {
  if (!canShowBiometricSignInSetting() || !supported() || !userId) return null;
  return <ProfilePasskeySettings key={userId} userId={userId} />;
}

function ProfilePasskeySettings({ userId }: { userId: string }) {
  const management = useRef<ReturnType<typeof createPasskeyManagement> | null>(null);
  const [credentials, setCredentials] = useState<PasskeyListItem[]>([]);
  const [registeredHere, setRegisteredHere] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const focusGeneration = useRef(0);
  useFocusEffect(useCallback(() => {
    focusGeneration.current++;
    active.current = true;
    let cancelled = false;
    setBusy(true); setError(null); setCredentials([]); setRegisteredHere(null);
    void import("./runtime").then(async ({ createPasskeyManagement }) => {
      if (cancelled) return;
      const controller = createPasskeyManagement(userId);
      management.current = controller;
      const state = await controller.readState();
      if (!cancelled) { setCredentials(state.credentials); setRegisteredHere(state.registeredHere); }
    }).catch(error => { if (!cancelled) setError(message(error)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    const subscription = AppState.addEventListener("change", state => {
      if (state !== "active" && !nativeAuthPrompt.active) management.current?.invalidate();
    });
    return () => {
      cancelled = true; active.current = false;
      focusGeneration.current++;
      management.current?.dispose(); management.current = null;
      subscription.remove();
    };
  }, [userId]));

  async function enable() {
    if (busy || !management.current) return;
    const focus = focusGeneration.current;
    setBusy(true); setError(null); setRegisteredHere(null);
    try {
      const state = await management.current.register();
      if (!active.current || focus !== focusGeneration.current) return;
      setCredentials(state.credentials);
      setRegisteredHere(state.registeredHere);
    } catch (error) { if (active.current && focus === focusGeneration.current) setError(message(error)); }
    finally { if (active.current && focus === focusGeneration.current) setBusy(false); }
  }
  async function remove(id: string) {
    if (busy || !management.current) return;
    const focus = focusGeneration.current;
    setBusy(true); setError(null); setRegisteredHere(null);
    try {
      const state = await management.current.remove(id);
      if (!active.current || focus !== focusGeneration.current) return;
      setCredentials(state.credentials);
      setRegisteredHere(state.registeredHere);
    } catch (error) { if (active.current && focus === focusGeneration.current) setError(message(error)); }
    finally { if (active.current && focus === focusGeneration.current) setBusy(false); }
  }
  function confirmRemoval(id: string) {
    const credential = credentials.find(item => item.id === id);
    if (!credential) return;
    Alert.alert("Remove Biometric Sign-In?", `Remove ${credential.friendly_name || "credential"} (${id.slice(0, 8)})? This may affect another device using this credential.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => { void remove(id); } },
    ]);
  }
  const serverConfirmed = !!registeredHere && credentials.some(item => item.id === registeredHere);
  return <View>
    <BiometricSignInSetting available serverConfirmed={serverConfirmed} busy={busy} onEnable={enable}
      onRemove={async () => { if (registeredHere) confirmRemoval(registeredHere); }} />
    {serverConfirmed ? <Text style={{ color: colors.text }}>Enabled</Text> : null}
    {serverConfirmed ? <Text style={{ color: colors.muted }}>Registered from this app. Your passkey provider may sync this credential to other devices.</Text> : null}
    {credentials.filter(item => item.id !== registeredHere).map(item => <Pressable key={item.id}
      accessibilityRole="button" accessibilityLabel={`Remove credential ${item.friendly_name || item.id}`}
      disabled={busy} style={{ minHeight: 44, justifyContent: "center" }} onPress={() => confirmRemoval(item.id)}>
      <Text style={authStyles.link}>Remove {item.friendly_name || "credential"} · {item.id.slice(0, 8)}</Text>
    </Pressable>)}
    {error ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{error}</Text> : null}
  </View>;
}
