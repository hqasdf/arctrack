import { router, useFocusEffect } from "expo-router";
import { organizationEntry } from "@arc-track/core/organization-entry";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "../../../src/auth";
import {
  createOrganization, joinOrganization, readOwnOrganizations,
  type OwnOrganization,
} from "../../../src/organizations";
import { colors, PAGE_TOP_SPACING } from "../../../src/theme";

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
  if (loading && items.length === 0) return <View style={styles.state}><ActivityIndicator color={colors.accent} /></View>;
  return <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>Coach&apos;s Workspace</Text>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    {error && items.length === 0 ? <Button label="Retry" onPress={() => void load()} /> : null}
    <Text style={styles.heading}>{items.filter((item) => item.role === "head_coach").length > 1 ? "Choose a workspace" : "Your memberships"}</Text>
    {items.length === 0 ? <Text style={styles.muted}>You have not joined an organisation yet.</Text> : items.map((item) =>
      <View key={item.id} style={styles.card}>
        <Text style={styles.cardTitle}>{item.name}</Text>
        <Text style={styles.muted}>{item.role === "head_coach" ? "Head Coach" : "Archer"} · Active</Text>
        {item.role === "head_coach" ? <>
          <Button label="Open Coach's Workspace" onPress={() => router.push({ pathname: "/organization/[organizationId]", params: { organizationId: item.id } })} />
          <Button label="Coach Settings" onPress={() => router.push({ pathname: "/organization/[organizationId]/settings", params: { organizationId: item.id } })} />
        </> : null}
        {item.role === "archer" ? <Button label="Open membership" onPress={() => router.push({ pathname: "/organization/member/[organizationId]", params: { organizationId: item.id } })} /> : null}
      </View>)}
    {items.length > 0 && !showJoin ? <Button label="Join another organisation" onPress={() => setShowJoin(true)} /> : null}
    {(items.length === 0 || showJoin) ? <><Text style={styles.heading}>Join an organisation</Text>
    <TextInput accessibilityLabel="Join code" value={code} onChangeText={setCode} autoCapitalize="characters"
      maxLength={16} placeholder="AB7K4M2Q" style={styles.input} />
    <Button label={busy ? "Working…" : "Join as Archer"} disabled={busy} onPress={() => void run(async () => {
      const before = new Set(items.map((item) => item.id));
      const result = await joinOrganization(code); setCode(""); setShowJoin(false);
      const refreshed = await readOwnOrganizations(user!.id);
      setItems(refreshed);
      const joined = refreshed.find((item) => !before.has(item.id));
      if (joined) router.replace({ pathname: joined.role === "head_coach" ? "/organization/[organizationId]" : "/organization/member/[organizationId]", params: { organizationId: joined.id } });
      return result === "already_member" ? "You are already a member." : "You joined as an Archer.";
    }, false)} /></> : null}
    {items.length > 0 && !showCreate ? <Button label="Create another workspace" onPress={() => setShowCreate(true)} /> : null}
    {(items.length === 0 || showCreate) ? <><Text style={styles.heading}>Create an organisation</Text>
    <TextInput accessibilityLabel="Organisation name" value={name} onChangeText={setName} maxLength={120}
      placeholder="Club or team name" style={styles.input} />
    <Button label="Create organisation" disabled={busy} onPress={() => void run(async () => {
      const created = await createOrganization(user!.id, name); setName("");
      router.replace({ pathname: "/organization/[organizationId]", params: { organizationId: created.id } });
      return `${created.name} was created.`;
    }, false)} /></> : null}
  </ScrollView>;
}
function Button({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={styles.button}>
    <Text style={[styles.buttonText, disabled && styles.disabled]}>{label}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { padding: 18, paddingTop: 18 + PAGE_TOP_SPACING, paddingBottom: 40, gap: 10 },
  title: { color: colors.text, fontSize: 27, fontWeight: "800" },
  heading: { color: colors.text, fontSize: 18, fontWeight: "700", marginTop: 12 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, gap: 9 },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: 13 },
  input: { backgroundColor: colors.surface, color: colors.text, minHeight: 48, borderRadius: 9, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, fontSize: 16 },
  button: { minHeight: 44, borderRadius: 9, borderWidth: 1, borderColor: colors.accent, justifyContent: "center", alignItems: "center", paddingHorizontal: 10 },
  buttonText: { color: colors.accent, fontSize: 14, fontWeight: "700" },
  disabled: { opacity: .4 },
  notice: { color: colors.accent, fontSize: 13 },
  error: { color: colors.error, fontSize: 13 },
  state: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
});
