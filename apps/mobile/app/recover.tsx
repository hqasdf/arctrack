import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import { changeMobilePassword } from "../src/profile";
import { useAuth } from "../src/auth";
import { cancelRecovery, completeRecovery, safeAuthMessage } from "../src/auth-flow";
import { configError, supabase } from "../src/supabase";
import { colors, PAGE_TOP_SPACING } from "../src/theme";
import { PasswordField } from "../src/password-field";

export default function RecoverScreen() {
  const { recovery, recoveryRequired, setRecovery, signOut } = useAuth();
  const [email, setEmail] = useState(recovery?.email ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const stage = recovery?.stage === "password" && !recoveryRequired ? "verify" : recovery?.stage ?? "request";
  useEffect(() => { if (recovery?.email) setEmail(recovery.email); }, [recovery?.email]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  async function request() {
    if (!supabase || busy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setMessage("Enter a valid email address."); return; }
    setBusy(true); setMessage(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (error) throw error;
      await setRecovery({ active: true, email: email.trim(), stage: "verify" }); setCooldown(60);
    } catch (error) { setMessage(safeAuthMessage(error, "request")); }
    finally { setBusy(false); }
  }
  async function verify() {
    if (!supabase || busy) return;
    if (!/^\d{6}$/.test(code.trim())) { setMessage("Enter the six-digit code from your email."); return; }
    setBusy(true); setMessage(null);
    try {
      // Persist the gate before verifyOtp emits SIGNED_IN.
      await setRecovery({ active: true, email: email.trim(), stage: "password" });
      const { data, error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "recovery" });
      if (error || !data.session) throw error ?? new Error("No recovery session");
      try { await setRecovery({ active: true, email: email.trim(), stage: "password", userId: data.session.user.id }); }
      catch { /* The already-persisted password gate remains active. */ }
      setCode("");
    } catch (error) {
      try { await setRecovery({ active: true, email: email.trim(), stage: "verify" }); } catch { /* Keep the safer password gate if storage fails. */ }
      setMessage(safeAuthMessage(error, "otp"));
    }
    finally { setBusy(false); }
  }
  async function updatePassword() {
    if (busy) return;
    setBusy(true); setMessage(null);
    try { await completeRecovery(() => changeMobilePassword(password, confirm), () => setRecovery(null)); setPassword(""); setConfirm(""); router.replace("/(tabs)/sessions"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Password could not be updated."); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (busy) return;
    setBusy(true); setMessage(null);
    try {
      await cancelRecovery(recovery, recoveryRequired, signOut, () => setRecovery(null));
      router.replace("/(auth)/sign-in");
    } catch (error) { setMessage(safeAuthMessage(error, "sign-out")); }
    finally { setBusy(false); }
  }
  return <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>{stage === "request" ? "Reset password" : stage === "verify" ? "Verify recovery code" : "Choose new password"}</Text>
    {stage === "request" ? <>
      <TextInput accessibilityLabel="Email" placeholder="Account email" keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} style={styles.input} />
      <Action label="Send recovery code" busy={busy} onPress={() => void request()} />
    </> : stage === "verify" ? <>
      <Text style={styles.note}>Enter the six-digit code sent to {email.trim()}.</Text>
      <TextInput accessibilityLabel="Recovery code" keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} style={styles.input} />
      <Action label="Verify code" busy={busy} onPress={() => void verify()} />
      <Action label={cooldown > 0 ? `Resend code in ${cooldown}s` : "Request new code"} busy={busy || cooldown > 0} onPress={() => void request()} secondary />
    </> : <>
      <PasswordField accessibilityLabel="New password" placeholder="New password (12–128 characters)" autoCapitalize="none" value={password} onChangeText={setPassword} style={styles.input} />
      <PasswordField accessibilityLabel="Confirm new password" placeholder="Confirm new password" autoCapitalize="none" value={confirm} onChangeText={setConfirm} style={styles.input} />
      <Action label="Update password" busy={busy} onPress={() => void updatePassword()} />
    </>}
    {configError ? <Text style={styles.error}>{configError}</Text> : null}
    {message ? <Text accessibilityRole="alert" style={styles.error}>{message}</Text> : null}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void cancel()} style={styles.back}><Text style={styles.link}>{recovery?.stage === "password" ? "Cancel recovery and sign out" : "Back to sign in"}</Text></Pressable>
  </ScrollView>;
}
function Action({ label, busy, onPress, secondary }: { label: string; busy: boolean; onPress: () => void; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={busy || !!configError} onPress={onPress} style={[styles.button, secondary && styles.secondary]}>
    {busy && !secondary ? <ActivityIndicator color="#fff" /> : <Text style={[styles.buttonText, secondary && styles.link]}>{label}</Text>}
  </Pressable>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background }, content: { flexGrow: 1, justifyContent: "center", padding: 24, paddingTop: 24 + PAGE_TOP_SPACING, gap: 13 },
  title: { color: colors.text, fontSize: 28, fontWeight: "700" }, note: { color: colors.muted, fontSize: 14 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, color: colors.text, paddingHorizontal: 14, minHeight: 52, fontSize: 16 },
  button: { backgroundColor: colors.accent, minHeight: 52, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, buttonText: { color: "#fff", fontWeight: "700" },
  back: { minHeight: 44, justifyContent: "center", alignItems: "center" }, link: { color: colors.accent, fontWeight: "700" },
  error: { color: colors.error, fontSize: 13 },
});
