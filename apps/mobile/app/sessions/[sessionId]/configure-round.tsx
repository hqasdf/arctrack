import { DIVISIONS, ROUND_PRESETS, TARGET_FACE_OPTIONS, type Division } from "@arc-track/core/presets";
import type { TargetFaceType } from "@arc-track/core/scoring";
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { buildRoundRpcArgs, configFromPreset, type RoundConfig } from "../../../src/round-config";
import { scoreRoundHref } from "../../../src/round-navigation";
import { PAGE_TOP_SPACING } from "../../../src/theme";
import { createThemedStyles, useAppearance } from "../../../src/appearance";
import { createMobileRound } from "../../../src/writes";

type NumericField = "distanceMetres" | "faceDiameterCm" | "ends" | "arrowsPerEnd";
const numericLabels: [NumericField, string][] = [
  ["distanceMetres", "Distance (m)"], ["faceDiameterCm", "Face diameter (cm)"],
  ["ends", "Planned Ends"], ["arrowsPerEnd", "Arrows per End"],
];
function numberTexts(config: RoundConfig) {
  return Object.fromEntries(numericLabels.map(([key]) => [key, String(config[key])])) as Record<NumericField, string>;
}

export default function ConfigureRoundScreen() {
  const styles = useStyles();
  const { colors } = useAppearance();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [config, setConfig] = useState<RoundConfig>(configFromPreset);
  const [numbers, setNumbers] = useState(() => numberTexts(configFromPreset()));
  const [selectedPreset, setSelectedPreset] = useState<string | null>(ROUND_PRESETS[3].id);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);

  function choosePreset(preset: (typeof ROUND_PRESETS)[number]) {
    const next = { ...configFromPreset(preset), division: config.division };
    setConfig(next);
    setNumbers(numberTexts(next));
    setSelectedPreset(preset.id);
  }
  function editNumber(key: NumericField, value: string) {
    setNumbers((current) => ({ ...current, [key]: value }));
    setSelectedPreset(null);
  }
  async function start() {
    if (!sessionId || submitting.current) return;
    setError(null);
    const input = {
      ...config,
      ...Object.fromEntries(numericLabels.map(([key]) => [key, numbers[key].trim() === "" ? 0 : Number(numbers[key])])),
    } as RoundConfig;
    try { buildRoundRpcArgs(sessionId, input); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Check the Round settings."); return; }
    submitting.current = true;
    setBusy(true);
    try {
      const created = await createMobileRound(sessionId, input);
      router.replace(scoreRoundHref(created.roundId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Round could not be created.");
    } finally { submitting.current = false; setBusy(false); }
  }

  return <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>Round Configuration</Text>
    <Text style={styles.label}>PRESET</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
      {ROUND_PRESETS.map((preset) => <Choice key={preset.id} label={preset.name} active={selectedPreset === preset.id} onPress={() => choosePreset(preset)} />)}
    </ScrollView>
    <Text style={styles.label}>ROUND NAME</Text>
    <TextInput placeholderTextColor={colors.muted} selectionColor={colors.accent} accessibilityLabel="Round name" value={config.name} onChangeText={(name) => { setConfig((current) => ({ ...current, name })); setSelectedPreset(null); }} maxLength={80} style={styles.input} />
    <Text style={styles.label}>DIVISION</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
      {DIVISIONS.map((division) => <Choice key={division} label={division} active={config.division === division}
        onPress={() => setConfig((current) => ({ ...current, division: division as Division }))} />)}
    </ScrollView>
    {numericLabels.filter(([key]) => key !== "faceDiameterCm").map(([key, label]) => <View key={key} style={styles.field}>
      <Text style={styles.label}>{label.toUpperCase()}</Text>
      <TextInput placeholderTextColor={colors.muted} selectionColor={colors.accent} accessibilityLabel={label} value={numbers[key]} onChangeText={(value) => editNumber(key, value)}
        keyboardType="number-pad" style={styles.input} selectTextOnFocus />
    </View>)}
    <Text style={styles.label}>TARGET FACE</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
      {TARGET_FACE_OPTIONS.map((option) => <Choice key={option.id} label={option.label}
        active={config.faceType === option.faceType && numbers.faceDiameterCm === String(option.diameterCm)}
        onPress={() => { setConfig((current) => ({ ...current, faceType: option.faceType })); setNumbers((current) => ({ ...current, faceDiameterCm: String(option.diameterCm) })); setSelectedPreset(null); }} />)}
    </ScrollView>
    <View style={styles.field}><Text style={styles.label}>FACE DIAMETER (CM)</Text>
      <TextInput placeholderTextColor={colors.muted} selectionColor={colors.accent} accessibilityLabel="Face diameter in centimetres" value={numbers.faceDiameterCm}
        onChangeText={(value) => editNumber("faceDiameterCm", value)} keyboardType="number-pad" selectTextOnFocus style={styles.input} /></View>
    <Text style={styles.label}>FACE LAYOUT</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
      {([["full_face", "Full"], ["six_ring", "6-ring"], ["triple_face", "Triple"]] as const).map(([type, label]) =>
        <Choice key={type} label={label} active={config.faceType === type}
          onPress={() => { setConfig((current) => ({ ...current, faceType: type as TargetFaceType })); setSelectedPreset(null); }} />)}
    </ScrollView>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void start()} style={styles.start}>
      {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.startText}>Start Round</Text>}
    </Pressable>
  </ScrollView>;
}

function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const styles = useStyles();
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress}
    style={[styles.choice, active && styles.choiceActive]}><Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text></Pressable>;
}
const useStyles = createThemedStyles((colors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { padding: 18, paddingTop: 18 + PAGE_TOP_SPACING, paddingBottom: 38, gap: 10 },
  title: { color: colors.text, fontSize: 25, fontWeight: "800", marginBottom: 6 },
  label: { color: colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: .6 },
  choices: { gap: 7, paddingVertical: 3 },
  choice: { minHeight: 44, borderRadius: 9, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, justifyContent: "center", backgroundColor: colors.surface },
  choiceActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  choiceText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  choiceTextActive: { color: colors.onPrimary },
  field: { gap: 7 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.control, borderRadius: 9, paddingHorizontal: 12, color: colors.text, fontSize: 16 },
  error: { color: colors.error, fontSize: 13 },
  start: { minHeight: 54, backgroundColor: colors.accent, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 12 },
  startText: { color: colors.onPrimary, fontSize: 16, fontWeight: "800" },
}));
