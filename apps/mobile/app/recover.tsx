import { useAppearance } from "../src/appearance";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput } from "react-native";
import { changeMobilePassword } from "../src/profile";
import { useAuth } from "../src/auth";
import { cancelRecovery, completeRecovery, safeAuthMessage } from "../src/auth-flow";
import { configError, mobileAuthentication, supabase } from "../src/supabase";
import { AuthAction as Action, AuthField, AuthScreen, useAuthStyles } from "../src/auth-ui";
import { OtpInput } from "../src/otp-input";
import { PasswordField } from "../src/password-field";

export default function RecoverScreen() {
  const styles = useAuthStyles();
  const { colors: authColors } = useAppearance();
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
      const { data, error } = await mobileAuthentication!.verifyOtp({ email: email.trim(), token: code.trim(), type: "recovery" });
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
  return <AuthScreen nativeHeader title={stage === "request" ? "Reset password" : stage === "verify" ? "Verify recovery code" : "Choose new password"}
    description={stage === "request" ? "Enter your email address to request a six-digit recovery code."
      : stage === "password" ? "Use a unique password for your archery journal." : undefined}>
    {stage === "request" ? <>
      <AuthField label="Account email">
        <TextInput accessibilityLabel="Email" placeholder="Account email" placeholderTextColor={authColors.muted} keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} style={styles.input} />
      </AuthField>
      <Action label="Send recovery code" busy={busy} disabled={!!configError} onPress={() => void request()} />
    </> : stage === "verify" ? <>
      <Text style={styles.note}>Enter the six-digit code sent to {email.trim()}.</Text>
      <AuthField label="Recovery verification code">
        <OtpInput accessibilityLabel="Recovery code" placeholder="Six-digit code" placeholderTextColor={authColors.muted} keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} style={styles.input} />
      </AuthField>
      <Action label="Verify code" busy={busy} disabled={!!configError} onPress={() => void verify()} />
      <Action label={cooldown > 0 ? `Resend code in ${cooldown}s` : "Request new code"} busy={busy || cooldown > 0} disabled={!!configError} onPress={() => void request()} secondary />
    </> : <>
      <AuthField label="New password" hint="Use 12–128 characters. A long, unique passphrase works well.">
        <PasswordField accessibilityLabel="New password" placeholder="New password (12–128 characters)" placeholderTextColor={authColors.muted} autoCapitalize="none" value={password} onChangeText={setPassword} style={styles.input} />
      </AuthField>
      <AuthField label="Confirm new password">
        <PasswordField accessibilityLabel="Confirm new password" placeholder="Confirm new password" placeholderTextColor={authColors.muted} autoCapitalize="none" value={confirm} onChangeText={setConfirm} style={styles.input} />
      </AuthField>
      <Action label="Update password" busy={busy} disabled={!!configError} onPress={() => void updatePassword()} />
    </>}
    {configError ? <Text style={styles.error}>{configError}</Text> : null}
    {message ? <Text accessibilityRole="alert" style={styles.error}>{message}</Text> : null}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void cancel()} style={styles.back}><Text style={styles.link}>{recovery?.stage === "password" ? "Cancel recovery and sign out" : "Back to sign in"}</Text></Pressable>
  </AuthScreen>;
}
