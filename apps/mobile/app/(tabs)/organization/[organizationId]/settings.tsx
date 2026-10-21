import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, Text, View } from "react-native";
import { useAuth } from "@/src/auth";
import { CoachNav, CoachSection, useCoachPalette, useCoachStyles } from "@/src/coach-ui";
import { athleteLabel, leaveOrganization, readCoachAthletes, readOwnOrganizations, regenerateJoinCode, type CoachAthlete, type OwnOrganization } from "@/src/organizations";

export default function CoachSettingsScreen() {
  const coachStyles = useCoachStyles();
  const coachPalette = useCoachPalette();

  const { organizationId } = useLocalSearchParams<{ organizationId: string }>();
  const { user } = useAuth();
  const [item, setItem] = useState<OwnOrganization | null>(null);
  const [athletes, setAthletes] = useState<CoachAthlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!user || !organizationId) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const own = (await readOwnOrganizations(user.id, true)).find((entry) => entry.id === organizationId && entry.role === "head_coach") ?? null;
      if (!own) { setItem(null); return; }
      setItem(own); setAthletes(await readCoachAthletes(user.id, organizationId) ?? []);
    } catch { setError("Organisation settings could not be loaded."); }
    finally { setLoading(false); }
  }, [user, organizationId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  async function regenerate() {
    if (!item || busy) return;
    setBusy(true); setError(null);
    try { await regenerateJoinCode(item.id); await load(); }
    catch { setError("The join code could not be regenerated."); }
    finally { setBusy(false); }
  }
  async function shareCode() {
    if (!item?.joinCode || busy) return;
    setError(null);
    try { await Share.share({ message: `${item.name} join code: ${item.joinCode}` }); }
    catch { setError("The join code could not be shared. Select the code to copy it."); }
  }
  function confirmRegenerate() { Alert.alert("Generate a new join code?", "The current code will stop working.", [{ text: "Cancel", style: "cancel" }, { text: "Generate", onPress: () => void regenerate() }]); }
  function confirmLeave() {
    if (!item) return;
    Alert.alert(`Leave ${item.name}?`, "Your active Coach membership will end.", [{ text: "Cancel", style: "cancel" }, { text: "Leave", style: "destructive", onPress: () => { void (async () => {
      setBusy(true); try { await leaveOrganization(item.id); router.replace("/(tabs)/organization"); }
      catch { setError("The organisation could not be left."); } finally { setBusy(false); }
    })(); } }]);
  }
  if (loading) return <View style={coachStyles.state}><ActivityIndicator color={coachPalette.accent}/></View>;
  if (!item) return <View style={coachStyles.state}><Text style={coachStyles.muted}>{error ?? "Coach access is unavailable."}</Text></View>;
  return <ScrollView style={coachStyles.page} contentContainerStyle={coachStyles.content}>
    <CoachNav organizationId={item.id} current="settings"/>
    <Text style={coachStyles.eyebrow}>HEAD COACH · ADMINISTRATION</Text><Text style={coachStyles.title}>Settings</Text>
    {error ? <Text accessibilityRole="alert" style={{ color: coachPalette.error }}>{error}</Text> : null}
    <CoachSection title="Organisation information"><Text style={coachStyles.cardTitle}>{item.name}</Text><Text style={coachStyles.muted}>Head Coach · active membership</Text></CoachSection>
    <CoachSection title="Membership"><Text style={coachStyles.muted}>{athletes.length} active Archer members</Text>
      {athletes.map((athlete) => <Pressable key={athlete.userId} accessibilityRole="button" onPress={() => router.push({ pathname: "/organization/[organizationId]/athletes/[userId]", params: { organizationId: item.id, userId: athlete.userId } })} style={coachStyles.card}><Text style={coachStyles.link}>{athleteLabel(athlete)}</Text><Text style={coachStyles.muted}>Archer · Joined {athlete.joinedAt.slice(0, 10)}</Text></Pressable>)}
      {!athletes.length ? <Text style={coachStyles.muted}>No active Archers yet.</Text> : null}
    </CoachSection>
    <CoachSection title="Join Code">
      <Text style={coachStyles.muted}>Share this code with an Archer you want to join.</Text>
      <Text selectable style={{ color: coachPalette.text, fontSize: 25, fontWeight: "800", letterSpacing: 2 }}>{item.joinCode ?? "Unavailable"}</Text>
      {item.joinCode ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void shareCode()} style={coachStyles.chip}><Text style={coachStyles.link}>Share Code</Text></Pressable> : null}
      <Pressable accessibilityRole="button" disabled={busy} onPress={confirmRegenerate} style={coachStyles.chip}><Text style={coachStyles.link}>Generate New Code</Text></Pressable>
    </CoachSection>
    <CoachSection title="Membership action"><Pressable accessibilityRole="button" disabled={busy} onPress={confirmLeave} style={coachStyles.chip}><Text style={{ color: coachPalette.error, fontWeight: "800" }}>Leave organisation</Text></Pressable></CoachSection>
  </ScrollView>;
}
