import { useAppearance } from "../../src/appearance";
import { useState } from "react";
import { router } from "expo-router";
import { Pressable, Text, TextInput } from "react-native";
import { useAuth } from "../../src/auth";
import { safeAuthMessage } from "../../src/auth-flow";
import { AuthAction, AuthField, AuthScreen, useAuthStyles } from "../../src/auth-ui";
import { PasswordField } from "../../src/password-field";
import { PrivacyPolicyLink } from "../../src/privacy-policy-link";
import { SignInBiometricControl } from "../../src/passkeys/screen-controls";

export default function SignInScreen() {
  const styles = useAuthStyles();
  const { colors: authColors } = useAppearance();
  const { configError, signIn } = useAuth();
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

  return <AuthScreen title="Welcome back" description="Sign in to your archery journal.">
    <AuthField label="Email">
      <TextInput accessibilityLabel="Email" style={styles.input} placeholder="Email" placeholderTextColor={authColors.muted} keyboardType="email-address" autoCapitalize="none" autoComplete="email" returnKeyType="next" value={email} onChangeText={setEmail} editable={!busy} />
    </AuthField>
    <AuthField label="Password">
      <PasswordField accessibilityLabel="Password" style={styles.input} placeholder="Password" placeholderTextColor={authColors.muted} autoComplete="current-password" returnKeyType="go" onSubmitEditing={() => void submit()} value={password} onChangeText={setPassword} editable={!busy} />
    </AuthField>
    {configError ? <Text style={styles.error}>{configError}</Text> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <AuthAction label="Sign in" busy={busy} onPress={submit} disabled={!!configError || !email.trim() || !password} />
    <SignInBiometricControl disabled={busy || !!configError} onError={setError} />
    <Pressable accessibilityRole="button" onPress={() => router.push("/(auth)/sign-up")} style={styles.back}><Text style={styles.link}>Create account</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={() => router.push("/recover")} style={styles.back}><Text style={styles.link}>Forgot password?</Text></Pressable>
    <PrivacyPolicyLink color={authColors.primary} />
  </AuthScreen>;
}
