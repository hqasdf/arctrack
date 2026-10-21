import { Pressable, StyleSheet, Text, View } from "react-native";
import { createThemedStyles, useAppearance } from "./appearance";
import type { ThemePreference } from "./theme";
export function AppearanceSettings() {
  const { preference, setPreference, error, retry } = useAppearance();
  const styles = useStyles();
  return <View style={styles.section}>
    <Text style={styles.title}>Appearance</Text>
    <View accessibilityRole="radiogroup" accessibilityLabel="Appearance" style={styles.choices}>
      {(["light", "dark", "system"] as ThemePreference[]).map((option) => <Pressable key={option} accessibilityRole="radio" accessibilityState={{ checked: preference === option }} accessibilityLabel={`${option[0].toUpperCase()}${option.slice(1)} appearance`} onPress={() => void setPreference(option)} style={[styles.option, preference === option && styles.selected]}>
        <Text style={styles.text}>{preference === option ? "● " : "○ "}{option[0].toUpperCase()}{option.slice(1)}</Text>
      </Pressable>)}
    </View>
    {error ? <><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void retry()} style={styles.option}><Text style={styles.text}>Retry loading appearance</Text></Pressable></> : null}
  </View>;
}
const useStyles = createThemedStyles((colors) => StyleSheet.create({
  section: { gap: 10, paddingVertical: 16 }, title: { color: colors.text, fontSize: 18, fontWeight: "700" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: { minHeight: 48, justifyContent: "center", paddingHorizontal: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 9 },
  selected: { borderColor: colors.accent, backgroundColor: colors.soft }, text: { color: colors.text }, error: { color: colors.error },
}));
