import type { SessionType } from "@arc-track/core/scoring";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "../../src/auth";
import { singaporeToday } from "../../src/mobile-analytics";
import { PAGE_TOP_SPACING } from "../../src/theme";
import { createThemedStyles, useAppearance } from "../../src/appearance";
import { createMobileSession } from "../../src/writes";

export default function NewSessionScreen() {
  const styles = useStyles();
  const { colors } = useAppearance();
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => singaporeToday(new Date()));
  const [sessionType, setSessionType] = useState<SessionType>("training");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      if (!user) throw new Error("Sign in again before creating a Session.");
      const session = await createMobileSession(user.id, { title, date, sessionType });
      router.replace({ pathname: "/sessions/[sessionId]", params: { sessionId: session.id } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Session could not be created. Check your connection and try again.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>‹  Sessions</Text></Pressable>
      <Text style={styles.eyebrow}>YOUR TRAINING JOURNAL</Text>
      <Text style={styles.title}>New Session</Text>
      <Text style={styles.intro}>Add a Session to your journal.</Text>

      <Text style={styles.label}>Session type</Text>
      <View style={styles.typeChoices}>
        <TypeChoice label="Training Session" selected={sessionType === "training"} onPress={() => setSessionType("training")} />
        <TypeChoice label="Competition" selected={sessionType === "competition"} onPress={() => setSessionType("competition")} />
      </View>

      <Text style={styles.label}>Session date</Text>
      <TextInput placeholderTextColor={colors.muted} selectionColor={colors.accent} accessibilityLabel="Session date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" autoCapitalize="none" keyboardType="numbers-and-punctuation" style={styles.input} />

      <Text style={styles.label}>{sessionType === "competition" ? "Competition name (optional)" : "Title (optional)"}</Text>
      <TextInput placeholderTextColor={colors.muted} selectionColor={colors.accent} accessibilityLabel={sessionType === "competition" ? "Competition name" : "Session title"} value={title} onChangeText={setTitle} maxLength={80} placeholder={sessionType === "competition" ? "National Championships" : "Evening practice"} style={styles.input} returnKeyType="done" />

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" disabled={pending} onPress={() => void submit()} style={({ pressed }) => [styles.submit, (pressed || pending) && styles.pressed, pending && styles.disabled]}>
        {pending ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.submitText}>Create Session</Text>}
      </Pressable>
    </ScrollView>
  </KeyboardAvoidingView>;
}

function TypeChoice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const styles = useStyles();
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress} style={[styles.typeChoice, selected && styles.typeChoiceSelected]}>
    <Text style={[styles.typeText, selected && styles.typeTextSelected]}>{label}</Text>
  </Pressable>;
}

const useStyles = createThemedStyles((colors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { padding: 22, paddingTop: 22 + PAGE_TOP_SPACING, paddingBottom: 40, flexGrow: 1 },
  back: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start", marginBottom: 16, paddingRight: 14 },
  backText: { color: colors.accent, fontSize: 16, fontWeight: "700" },
  eyebrow: { color: colors.accent, fontSize: 12, fontWeight: "700", letterSpacing: 1.8 },
  title: { color: colors.text, fontSize: 30, fontWeight: "700", marginTop: 7 },
  intro: { color: colors.muted, fontSize: 15, marginTop: 7, marginBottom: 28 },
  label: { color: colors.text, fontSize: 14, fontWeight: "700", marginBottom: 9, marginTop: 18 },
  typeChoices: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  typeChoice: { minHeight: 48, justifyContent: "center", paddingHorizontal: 15, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  typeChoiceSelected: { borderColor: colors.accent, backgroundColor: colors.soft },
  typeText: { color: colors.muted, fontSize: 14, fontWeight: "600" },
  typeTextSelected: { color: colors.accent },
  input: { minHeight: 50, borderRadius: 10, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.control, paddingHorizontal: 14, color: colors.text, fontSize: 16 },
  error: { color: colors.error, fontSize: 14, marginTop: 18, lineHeight: 20 },
  submit: { minHeight: 52, borderRadius: 10, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, marginTop: 28 },
  submitText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.65 },
}));
