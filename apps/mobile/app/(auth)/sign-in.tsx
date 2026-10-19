import { useState } from "react";
import { router } from "expo-router";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../src/auth";
import { safeAuthMessage } from "../../src/auth-flow";
import { colors, PAGE_TOP_SPACING } from "../../src/theme";
import { PasswordField } from "../../src/password-field";
import { PrivacyPolicyLink } from "../../src/privacy-policy-link";

export default function SignInScreen() {
  const { configError, signIn } = useAuth();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (issue) {
      setError(safeAuthMessage(issue));
    } finally {
      setBusy(false);
    }
  }

  return <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[styles.content, {
      paddingTop: Math.max(height < 600 ? 24 : 24 + PAGE_TOP_SPACING, insets.top + 16),
      paddingBottom: Math.max(24, insets.bottom + 12),
      paddingLeft: Math.max(24, insets.left + 16),
      paddingRight: Math.max(24, insets.right + 16),
    }]}><View style={styles.panel}>
    <Text style={styles.brand}>ARC TRACK</Text>
    <Text style={styles.title}>Welcome back</Text>
    <Text style={styles.subtitle}>Sign in to view your Sessions.</Text>
    <TextInput accessibilityLabel="Email" style={styles.input} placeholder="Email" placeholderTextColor={colors.muted} keyboardType="email-address" autoCapitalize="none" autoComplete="email" returnKeyType="next" value={email} onChangeText={setEmail} editable={!busy} />
    <PasswordField accessibilityLabel="Password" style={styles.input} placeholder="Password" placeholderTextColor={colors.muted} autoComplete="current-password" returnKeyType="go" onSubmitEditing={() => void submit()} value={password} onChangeText={setPassword} editable={!busy} />
    {configError ? <Text style={styles.error}>{configError}</Text> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Pressable accessibilityRole="button" onPress={submit} disabled={busy || !!configError || !email.trim() || !password} style={({ pressed }) => [styles.button, (busy || pressed) && styles.buttonDim]}>
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
    </Pressable>
    <Pressable accessibilityRole="button" onPress={() => router.push("/(auth)/sign-up")} style={styles.linkButton}><Text style={styles.link}>Create account</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={() => router.push("/recover")} style={styles.linkButton}><Text style={styles.link}>Forgot password?</Text></Pressable>
    <PrivacyPolicyLink />
  </View></ScrollView></KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: "center" },
  panel: { width: "100%", maxWidth: 440, alignSelf: "center", gap: 14 },
  brand: { color: colors.accent, fontSize: 13, fontWeight: "800", letterSpacing: 3 },
  title: { color: colors.text, fontSize: 31, fontWeight: "700" },
  subtitle: { color: colors.muted, fontSize: 15, marginBottom: 12 },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, color: colors.text, paddingHorizontal: 16, minHeight: 54, fontSize: 16 },
  button: { backgroundColor: colors.accent, minHeight: 54, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 8 },
  buttonDim: { opacity: 0.75 },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  error: { color: colors.error, fontSize: 14 },
  linkButton: { minHeight: 44, justifyContent: "center", alignItems: "center" },
  link: { color: colors.accent, fontWeight: "700" },
});
