import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "../../src/auth";
import { safeAuthMessage } from "../../src/auth-flow";
import { changeMobilePassword, DIVISIONS, EMPTY_PROFILE, EXPERIENCE_LEVELS, readMobileProfile, saveMobileProfile, SHOOTING_HANDS, type MobileProfile } from "../../src/profile";
import { PasswordField } from "../../src/password-field";
import { colors, PAGE_TOP_SPACING } from "../../src/theme";

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<MobileProfile>(EMPTY_PROFILE);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const load = useCallback(async () => {
    if (!user) return;
    try { setProfile(await readMobileProfile(user.id)); setProfileLoaded(true); setError(null); }
    catch { setProfileLoaded(false); setError("Profile could not be loaded."); }
  }, [user]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  async function save() {
    if (!user) return;
    setBusy(true); setError(null);
    try { setProfile(await saveMobileProfile(user.id, profile)); setEditing(false); }
    catch (issue) { setError(issue instanceof Error ? issue.message : "Profile could not be saved."); }
    finally { setBusy(false); }
  }
  async function updatePassword() {
    setBusy(true); setError(null);
    try { await changeMobilePassword(password, confirmPassword); setPassword(""); setConfirmPassword(""); setChangingPassword(false); }
    catch (issue) { setError(issue instanceof Error ? issue.message : "Password could not be updated."); }
    finally { setBusy(false); }
  }
  async function submit() {
    setBusy(true);
    setError(null);
    try { await signOut(); }
    catch (issue) { setError(safeAuthMessage(issue, "sign-out")); }
    finally { setBusy(false); }
  }
  return <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>Profile</Text>
    <Text style={styles.label}>SIGNED IN AS</Text>
    <Text style={styles.email}>{user?.email ?? "Arc Track account"}</Text>
    {!profileLoaded ? <Pressable accessibilityRole="button" onPress={() => void load()}><Text style={styles.link}>Retry loading profile</Text></Pressable> : editing ? <>
      {([ ["display_name", "Display name"], ["club_or_team", "Club / Team"] ] as const).map(([field, label]) =>
        <View key={field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} value={profile[field] ?? ""}
          onChangeText={(value) => setProfile((current) => ({ ...current, [field]: value }))} style={styles.input} /></View>)}
      {([ ["division", "Division", DIVISIONS], ["shooting_hand", "Shooting hand", SHOOTING_HANDS], ["experience_level", "Experience", EXPERIENCE_LEVELS] ] as const).map(([field, label, choices]) =>
        <View key={field}><Text style={styles.label}>{label}</Text><View style={styles.choices}>
          {["Not specified", ...choices].map((choice) => <Pressable key={choice} accessibilityRole="button"
            accessibilityState={{ selected: profile[field] === (choice === "Not specified" ? null : choice) }}
            onPress={() => setProfile((current) => ({ ...current, [field]: choice === "Not specified" ? null : choice }))}
            style={[styles.choice, profile[field] === (choice === "Not specified" ? null : choice) && styles.selected]}>
            <Text style={styles.choiceText}>{choice}</Text></Pressable>)}
        </View></View>)}
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void save()} style={styles.button}><Text style={styles.buttonText}>Save profile</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => { setEditing(false); void load(); }}><Text style={styles.link}>Cancel</Text></Pressable>
    </> : <>
      <Text style={styles.name}>{profile.display_name || "Archer"}</Text>
      <Text style={styles.detail}>Club / Team: {profile.club_or_team || "Not specified"}</Text>
      <Text style={styles.detail}>Division: {profile.division || "Not specified"}</Text>
      <Text style={styles.detail}>Shooting hand: {profile.shooting_hand || "Not specified"}</Text>
      <Text style={styles.detail}>Experience: {profile.experience_level || "Not specified"}</Text>
      <Pressable accessibilityRole="button" onPress={() => setEditing(true)}><Text style={styles.link}>Edit profile</Text></Pressable>
    </>}
    <Pressable accessibilityRole="button" onPress={() => setChangingPassword(!changingPassword)}><Text style={styles.link}>Change password</Text></Pressable>
    {changingPassword ? <>
      <PasswordField accessibilityLabel="New password" placeholder="New password" autoCapitalize="none" value={password} onChangeText={setPassword} style={styles.input} />
      <PasswordField accessibilityLabel="Confirm new password" placeholder="Confirm new password" autoCapitalize="none" value={confirmPassword} onChangeText={setConfirmPassword} style={styles.input} />
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void updatePassword()} style={styles.button}><Text style={styles.buttonText}>Update password</Text></Pressable>
    </> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Pressable accessibilityRole="button" onPress={submit} disabled={busy} style={styles.button}><Text style={styles.buttonText}>{busy ? "Signing out…" : "Sign out"}</Text></Pressable>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingTop: 40 + PAGE_TOP_SPACING, paddingBottom: 40, gap: 12 },
  title: { color: colors.text, fontSize: 30, fontWeight: "700", marginBottom: 24 },
  label: { color: colors.muted, fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  email: { color: colors.text, fontSize: 18 },
  name: { color: colors.text, fontSize: 21, fontWeight: "700", marginTop: 14 },
  detail: { color: colors.text, fontSize: 14 },
  link: { color: colors.accent, fontWeight: "700", paddingVertical: 8 },
  input: { minHeight: 48, borderColor: colors.border, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, backgroundColor: colors.surface, color: colors.text },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 5 },
  choice: { minHeight: 42, justifyContent: "center", borderColor: colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 9 },
  selected: { borderColor: colors.accent, backgroundColor: "#e3eee9" },
  choiceText: { color: colors.text, fontSize: 13 },
  error: { color: colors.error, fontSize: 14 },
  button: { alignSelf: "flex-start", backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 15, marginTop: 22 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
