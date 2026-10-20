import { router } from "expo-router";
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Pressable, Text, TextInput } from "react-native";
import { configError, mobileAuthentication, supabase } from "../../src/supabase";
import { SIGNUP_STORAGE_KEY, parseSignupContext, safeAuthMessage, serializeSignupContext } from "../../src/auth-flow";
import { AuthAction as Action, AuthField, AuthScreen, authColors, authStyles as styles } from "../../src/auth-ui";
import { OtpInput } from "../../src/otp-input";
import { PasswordField } from "../../src/password-field";
import { PrivacyPolicyLink } from "../../src/privacy-policy-link";

export default function SignUpScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(SIGNUP_STORAGE_KEY).then((stored) => {
      const pending = parseSignupContext(stored);
      if (active && pending) { setEmail(pending.email); setSent(true); }
    }).catch(() => { /* Signup remains available without restored progress. */ });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  async function signUp() {
    if (!supabase || busy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError("Enter a valid email address."); return; }
    if (password.length < 12 || password.length > 128) { setError("Choose a password between 12 and 128 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setBusy(true); setError(null);
    try {
      const { data, error: issue } = await mobileAuthentication!.signUp({ email: email.trim(), password });
      if (issue) throw issue;
      if (data.session) { void AsyncStorage.removeItem(SIGNUP_STORAGE_KEY).catch(() => {}); router.replace("/(tabs)/sessions"); return; }
      try { await AsyncStorage.setItem(SIGNUP_STORAGE_KEY, serializeSignupContext(email)); } catch { /* Code entry still works for this app session. */ }
      setSent(true); setCooldown(60); setPassword(""); setConfirm("");
    } catch (issue) { setError(safeAuthMessage(issue, "request")); }
    finally { setBusy(false); }
  }
  async function verify() {
    if (!supabase || busy) return;
    if (!/^\d{6}$/.test(code.trim())) { setError("Enter the six-digit code from your email."); return; }
    setBusy(true); setError(null);
    try {
      const { data, error: issue } = await mobileAuthentication!.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
      if (issue || !data.session) throw issue;
      void AsyncStorage.removeItem(SIGNUP_STORAGE_KEY).catch(() => {});
      router.replace("/(tabs)/sessions");
    } catch (issue) { setError(safeAuthMessage(issue, "otp")); }
    finally { setBusy(false); }
  }
  async function resend() {
    if (!supabase || busy || cooldown > 0) return;
    setBusy(true); setError(null);
    try {
      const { error: issue } = await supabase.auth.resend({ type: "signup", email: email.trim() });
      if (issue) throw issue;
      setCooldown(60);
    } catch (issue) { setError(safeAuthMessage(issue, "request")); }
    finally { setBusy(false); }
  }
  return <AuthScreen title={sent ? "Verify email" : "Create account"}
    description={sent ? undefined : "Create your account with an email address and a password."}>
    {sent ? <>
      <Text style={styles.note}>Enter the six-digit code sent to {email.trim()}.</Text>
      <AuthField label="Email verification code">
        <OtpInput accessibilityLabel="Email verification code" placeholder="Six-digit code" placeholderTextColor={authColors.muted} keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} style={styles.input} />
      </AuthField>
      <Action label="Verify email" busy={busy} disabled={!!configError} onPress={() => void verify()} />
      <Action label={cooldown > 0 ? `Resend code in ${cooldown}s` : "Request new code"} busy={busy || cooldown > 0} disabled={!!configError} onPress={() => void resend()} secondary />
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void AsyncStorage.removeItem(SIGNUP_STORAGE_KEY).catch(() => {}); setSent(false); setEmail(""); setCode(""); setCooldown(0); setError(null); }} style={styles.back}><Text style={styles.link}>Use a different email</Text></Pressable>
    </> : <>
      <AuthField label="Email">
        <TextInput accessibilityLabel="Email" placeholder="Email" placeholderTextColor={authColors.muted} keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} style={styles.input} />
      </AuthField>
      <AuthField label="Password" hint="Use 12–128 characters. A long, unique passphrase works well.">
        <PasswordField accessibilityLabel="Password" placeholder="Password (12–128 characters)" placeholderTextColor={authColors.muted} autoCapitalize="none" value={password} onChangeText={setPassword} style={styles.input} />
      </AuthField>
      <AuthField label="Confirm password">
        <PasswordField accessibilityLabel="Confirm password" placeholder="Confirm password" placeholderTextColor={authColors.muted} autoCapitalize="none" value={confirm} onChangeText={setConfirm} style={styles.input} />
      </AuthField>
      <Action label="Create account" busy={busy} disabled={!!configError} onPress={() => void signUp()} />
    </>}
    {configError ? <Text style={styles.error}>{configError}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Pressable accessibilityRole="button" onPress={() => router.replace("/(auth)/sign-in")} style={styles.back}><Text style={styles.link}>Back to sign in</Text></Pressable>
    <PrivacyPolicyLink color={authColors.primary} />
  </AuthScreen>;
}
