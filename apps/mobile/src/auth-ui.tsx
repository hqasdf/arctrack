import type { ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// The website's standard Light auth palette, scoped to these mobile forms only.
export const authColors = {
  background: "#f7f5f1", surface: "#fffefa", text: "#382a24", muted: "#75665c",
  primary: "#563d30", border: "#ded6cd", inputBorder: "#9f9083",
  error: "#8b2920", errorBackground: "#fff0ed", errorBorder: "#c68478",
} as const;

export function AuthScreen({ title, description, nativeHeader = false, children }: {
  title: string; description?: string; nativeHeader?: boolean; children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const horizontal = width < 360 ? 16 : 24;
  return <ScrollView style={authStyles.page}
    keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
    automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
    automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never"
    contentContainerStyle={[authStyles.content, {
      // Recovery already sits below the native navigation header and its top inset.
      paddingTop: nativeHeader ? 16 : insets.top + (height < 600 ? 16 : 24),
      paddingBottom: Math.max(24, insets.bottom + 16),
      paddingLeft: Math.max(horizontal, insets.left + 12),
      paddingRight: Math.max(horizontal, insets.right + 12),
    }]}>
    <View style={authStyles.panel}>
      <Text style={authStyles.brand}>ARC TRACK</Text>
      <View style={[authStyles.card, { padding: width < 360 ? 16 : 24 }]}>
        <View style={authStyles.heading}>
          <Text style={authStyles.eyebrow}>YOUR ARCHERY JOURNAL</Text>
          <Text accessibilityRole="header" style={authStyles.title}>{title}</Text>
          {description ? <Text style={authStyles.note}>{description}</Text> : null}
        </View>
        {children}
      </View>
    </View>
  </ScrollView>;
}

export function AuthField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <View style={authStyles.field}>
    <Text style={authStyles.label}>{label}</Text>
    {children}
    {hint ? <Text style={authStyles.hint}>{hint}</Text> : null}
  </View>;
}

export function AuthAction({ label, busy, onPress, secondary = false, disabled = false }: {
  label: string; busy: boolean; onPress: () => void; secondary?: boolean; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled: busy || disabled, busy }} disabled={busy || disabled} onPress={onPress}
    style={({ pressed }) => [authStyles.button, secondary && authStyles.secondary, (busy || disabled || pressed) && authStyles.dim]}>
    {busy && !secondary ? <ActivityIndicator color="#fff" />
      : <Text style={[authStyles.buttonText, secondary && authStyles.link]}>{label}</Text>}
  </Pressable>;
}

export const authStyles = StyleSheet.create({
  page: { flex: 1, backgroundColor: authColors.background },
  content: { flexGrow: 1, justifyContent: "flex-start" },
  panel: { width: "100%", maxWidth: 480, alignSelf: "center", gap: 20 },
  brand: { color: authColors.primary, fontSize: 16, fontWeight: "700", letterSpacing: 2, textAlign: "center" },
  card: { backgroundColor: authColors.surface, borderWidth: 1, borderColor: authColors.border, borderRadius: 16, gap: 16 },
  heading: { gap: 10, marginBottom: 4 },
  eyebrow: { color: authColors.muted, fontSize: 10, letterSpacing: 1.4 },
  title: { color: authColors.text, fontSize: 28, fontWeight: "500" },
  note: { color: authColors.muted, fontSize: 15, lineHeight: 22 },
  field: { gap: 7 }, label: { color: authColors.text, fontSize: 14, fontWeight: "600" },
  input: { backgroundColor: authColors.surface, borderWidth: 1, borderColor: authColors.inputBorder,
    borderRadius: 8, color: authColors.text, paddingHorizontal: 12, paddingVertical: 12, minHeight: 52, fontSize: 16 },
  hint: { color: authColors.muted, fontSize: 12, lineHeight: 18 },
  button: { backgroundColor: authColors.primary, minHeight: 52, padding: 12, borderRadius: 8, justifyContent: "center", alignItems: "center" },
  secondary: { backgroundColor: authColors.surface, borderWidth: 1, borderColor: authColors.border },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 16, textAlign: "center" },
  dim: { opacity: 0.65 },
  back: { minHeight: 44, justifyContent: "center", alignItems: "center", paddingVertical: 8 },
  link: { color: authColors.primary, fontWeight: "600", fontSize: 14, textDecorationLine: "underline", textAlign: "center" },
  error: { color: authColors.error, backgroundColor: authColors.errorBackground, borderColor: authColors.errorBorder,
    borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 14, lineHeight: 20 },
});
