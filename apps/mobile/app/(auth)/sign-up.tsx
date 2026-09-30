import { router } from "expo-router";
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { configError, supabase } from "../../src/supabase";
import { SIGNUP_STORAGE_KEY, parseSignupContext, safeAuthMessage, serializeSignupContext } from "../../src/auth-flow";
import { colors, PAGE_TOP_SPACING } from "../../src/theme";
import { PasswordField } from "../../src/password-field";

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
      const { data, error: issue } = await supabase.auth.signUp({ email: email.trim(), password });
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
      const { data, error: issue } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
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
  return <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>{sent ? "Verify email" : "Create account"}</Text>
    {sent ? <>
      <Text style={styles.note}>Enter the six-digit code sent to {email.trim()}.</Text>
      <TextInput accessibilityLabel="Email verification code" keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} style={styles.input} />
      <Action label="Verify email" busy={busy} onPress={() => void verify()} />
      <Action label={cooldown > 0 ? `Resend code in ${cooldown}s` : "Request new code"} busy={busy || cooldown > 0} onPress={() => void resend()} secondary />
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void AsyncStorage.removeItem(SIGNUP_STORAGE_KEY).catch(() => {}); setSent(false); setEmail(""); setCode(""); setCooldown(0); setError(null); }} style={styles.back}><Text style={styles.link}>Use a different email</Text></Pressable>
    </> : <>
      <TextInput accessibilityLabel="Email" placeholder="Email" keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} style={styles.input} />
      <PasswordField accessibilityLabel="Password" placeholder="Password (12–128 characters)" autoCapitalize="none" value={password} onChangeText={setPassword} style={styles.input} />
      <PasswordField accessibilityLabel="Confirm password" placeholder="Confirm password" autoCapitalize="none" value={confirm} onChangeText={setConfirm} style={styles.input} />
      <Action label="Create account" busy={busy} onPress={() => void signUp()} />
    </>}
    {configError ? <Text style={styles.error}>{configError}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Pressable accessibilityRole="button" onPress={() => router.replace("/(auth)/sign-in")} style={styles.back}><Text style={styles.link}>Back to sign in</Text></Pressable>
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
