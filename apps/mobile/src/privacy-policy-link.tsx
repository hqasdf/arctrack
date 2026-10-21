import { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { createThemedStyles, useAppearance } from "./appearance";

export const PRIVACY_POLICY_URL = "https://archery-website.vercel.app/privacy";

export function PrivacyPolicyLink({ color }: { color?: string } = {}) {
  const { colors } = useAppearance();
  const styles = useStyles();
  const [error, setError] = useState<string | null>(null);
  async function open() {
    setError(null);
    try { await Linking.openURL(PRIVACY_POLICY_URL); }
    catch { setError("The Privacy Policy could not be opened. Please try again."); }
  }
  return <View>
    <Pressable accessibilityRole="link" accessibilityLabel="Privacy Policy" onPress={() => void open()} style={styles.link}>
      <Text style={[styles.label, { color: color ?? colors.accent }]}>Privacy Policy</Text>
    </Pressable>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </View>;
}

const useStyles = createThemedStyles((colors) => StyleSheet.create({
  link: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start", paddingVertical: 8 },
  label: { color: colors.accent, fontWeight: "700", fontSize: 14 },
  error: { color: colors.error, fontSize: 13 },
}));
