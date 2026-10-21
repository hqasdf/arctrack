import { useAppearance } from "../../../src/appearance";
import { router, useFocusEffect } from "expo-router";
import { organizationEntry } from "@arc-track/core/organization-entry";
import { useCallback, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../../src/auth";
import {
  createOrganization, joinOrganization, readOwnOrganizations,
  type OwnOrganization,
} from "../../../src/organizations";
import { PAGE_TOP_SPACING } from "../../../src/theme";
import { organizationAppearance } from "../../../src/organization-appearance";

export default function OrganizationScreen({ manageMode = false }: { manageMode?: boolean }) {
  const { user } = useAuth();
  const [items, setItems] = useState<OwnOrganization[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showJoin, setShowJoin] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const palette = organizationAppearance(useAppearance().resolvedTheme, items.some(item => item.role === "head_coach"));
  const styles = makeStyles(palette);
  const insets = useSafeAreaInsets();
  const button = (label: string, onPress: () => void, disabled = false, secondary = false) =>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled, busy: disabled && busy }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.button, secondary && styles.secondary, (disabled || pressed) && styles.disabled]}>
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text>
    </Pressable>;

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true); setError(null);
    try {
      const memberships = await readOwnOrganizations(user.id);
      setItems(memberships);
      const entry = organizationEntry(memberships);
      if (!manageMode && entry.kind === "coach") router.replace({ pathname: "/organization/[organizationId]", params: { organizationId: entry.organizationId } });
      else if (!manageMode && entry.kind === "member") router.replace({ pathname: "/organization/member/[organizationId]", params: { organizationId: entry.organizationId } });
    }
    catch { setError("Organisations could not be loaded. Check your connection and try again."); }
    finally { setLoading(false); }
  }, [user, manageMode]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  async function run(task: () => Promise<string>, reload = true) {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try { const message = await task(); setNotice(message); if (reload) await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The organisation request could not be completed."); }
    finally { setBusy(false); }
  }
  if (loading && items.length === 0) return <View style={styles.state}><ActivityIndicator accessibilityLabel="Loading organisations" color={palette.primary} /></View>;
  return <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView style={styles.page} contentContainerStyle={[styles.content, {
      paddingTop: manageMode ? 18 : 18 + Math.max(insets.top, PAGE_TOP_SPACING),
      paddingBottom: Math.max(insets.bottom, 20) + 20,
    }]}
      keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>Coach&apos;s Workspace</Text>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    {error && items.length === 0 ? button("Retry", () => void load(), loading, true) : null}
    <View style={styles.panel}>
    <Text accessibilityRole="header" style={styles.heading}>Your organisations</Text>
    {items.length === 0 ? <Text style={styles.muted}>You have not joined an organisation yet.</Text> : items.map((item) =>
      <View key={item.id} style={styles.card}>
        <Text style={styles.cardTitle}>{item.name}</Text>
        <Text style={styles.muted}>{item.role === "head_coach" ? "Head Coach" : "Archer"} · Active</Text>
        {item.role === "head_coach" ? <>
          {button("Open Coach's Workspace", () => router.push({ pathname: "/organization/[organizationId]", params: { organizationId: item.id } }))}
          {button("Settings", () => router.push({ pathname: "/organization/[organizationId]/settings", params: { organizationId: item.id } }), false, true)}
        </> : null}
        {item.role === "archer" ? button("Open membership", () => router.push({ pathname: "/organization/member/[organizationId]", params: { organizationId: item.id } }), false, true) : null}
      </View>)}
    </View>
    {items.length > 0 && !showJoin ? button("Join another organisation", () => setShowJoin(true), false, true) : null}
    {(items.length === 0 || showJoin) ? <View style={styles.panel}><Text accessibilityRole="header" style={styles.heading}>Join an organisation</Text>
    <Text style={styles.label} nativeID="organisation-join-code-label">Join code</Text>
    <TextInput accessibilityLabel="Join code" value={code} onChangeText={setCode} autoCapitalize="characters"
      accessibilityLabelledBy="organisation-join-code-label" editable={!busy} autoCorrect={false}
      maxLength={16} placeholder="AB7K4M2Q" placeholderTextColor={palette.muted} style={styles.input} />
    {button(busy ? "Joining…" : "Join", () => void run(async () => {
      const before = new Set(items.map((item) => item.id));
      const result = await joinOrganization(code); setCode(""); setShowJoin(false);
      const refreshed = await readOwnOrganizations(user!.id);
      setItems(refreshed);
      const joined = refreshed.find((item) => !before.has(item.id));
      if (joined) router.replace({ pathname: joined.role === "head_coach" ? "/organization/[organizationId]" : "/organization/member/[organizationId]", params: { organizationId: joined.id } });
      return result === "already_member" ? "You are already a member." : "You joined as an Archer.";
    }, false), busy)} </View> : null}
    {items.length > 0 && !showCreate ? button("Create another workspace", () => setShowCreate(true), false, true) : null}
    {(items.length === 0 || showCreate) ? <View style={styles.panel}><Text accessibilityRole="header" style={styles.heading}>Create an organisation</Text>
    <Text style={styles.muted}>You become its first Head Coach.</Text>
    <Text style={styles.label} nativeID="organisation-name-label">Organisation name</Text>
    <TextInput accessibilityLabel="Organisation name" value={name} onChangeText={setName} maxLength={120}
      accessibilityLabelledBy="organisation-name-label" editable={!busy} placeholderTextColor={palette.muted}
      placeholder="Club or team name" style={styles.input} />
    {button(busy ? "Saving…" : "Create organisation", () => void run(async () => {
      const created = await createOrganization(user!.id, name); setName("");
      router.replace({ pathname: "/organization/[organizationId]", params: { organizationId: created.id } });
      return `${created.name} was created.`;
    }, false), busy)}</View> : null}
  </ScrollView></KeyboardAvoidingView>;
}
const makeStyles = (palette: ReturnType<typeof organizationAppearance>) => StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.background },
  content: { padding: 18, gap: 18 },
  title: { color: palette.text, fontSize: 28, fontWeight: "600", marginBottom: 8 },
  heading: { color: palette.text, fontSize: 20, fontWeight: "600" },
  panel: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 16, padding: 19, gap: 14, minWidth: 0 },
  card: { borderTopWidth: 1, borderColor: palette.border, paddingVertical: 14, gap: 9, minWidth: 0 },
  cardTitle: { color: palette.text, fontSize: 17, fontWeight: "700", flexShrink: 1 },
  muted: { color: palette.muted, fontSize: 14, lineHeight: 21 },
  label: { color: palette.text, fontSize: 14, fontWeight: "600", marginBottom: -7 },
  input: { backgroundColor: palette.control, color: palette.text, minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, minWidth: 0 },
  button: { minHeight: 46, borderRadius: 8, backgroundColor: palette.primary, justifyContent: "center", alignItems: "center", paddingHorizontal: 18, paddingVertical: 10 },
  buttonText: { color: palette.onPrimary, fontSize: 14, fontWeight: "700", textAlign: "center", flexShrink: 1 },
  secondary: { borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  secondaryText: { color: palette.primary },
  disabled: { opacity: .55 },
  notice: { color: palette.text, backgroundColor: palette.soft, padding: 12, borderRadius: 8, fontSize: 14 },
  error: { color: palette.error, fontSize: 14 },
  state: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: palette.background },
});
