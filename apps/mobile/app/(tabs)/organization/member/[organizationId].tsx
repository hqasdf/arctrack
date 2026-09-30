import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useAuth } from "@/src/auth";
import { leaveOrganization, readOwnOrganizations, type OwnOrganization } from "@/src/organizations";
import { coachStyles } from "@/src/coach-ui";
import { colors } from "@/src/theme";

export default function ArcherMemberScreen() {
  const { organizationId } = useLocalSearchParams<{ organizationId: string }>();
  const { user } = useAuth();
  const [membership, setMembership] = useState<OwnOrganization | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true); setError(null);
    try { setMembership((await readOwnOrganizations(user.id)).find((item) => item.id === organizationId && item.role === "archer") ?? null); }
    catch { setError("Membership could not be loaded."); }
    finally { setLoading(false); }
  }, [user, organizationId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  function confirmLeave() {
    if (!membership) return;
    Alert.alert(`Leave ${membership.name}?`, "Your active membership will end.", [
      { text: "Cancel", style: "cancel" },
      { text: "Leave", style: "destructive", onPress: () => void (async () => {
        setBusy(true); setError(null);
        try { await leaveOrganization(membership.id); setMembership(null); router.replace("/(tabs)/organization"); }
        catch { setError("The organisation could not be left."); }
        finally { setBusy(false); }
      })() },
    ]);
  }
  if (loading) return <View style={coachStyles.state}><ActivityIndicator color={colors.accent}/></View>;
  if (!membership) return <View style={coachStyles.state}><Text style={coachStyles.muted}>{error ?? "This membership is no longer active."}</Text>
    <Pressable onPress={() => router.replace("/(tabs)/organization")}><Text style={coachStyles.link}>Coach&apos;s Workspace</Text></Pressable></View>;
  return <ScrollView style={coachStyles.page} contentContainerStyle={coachStyles.content}>
    <Text style={coachStyles.eyebrow}>COACH&apos;S WORKSPACE</Text>
    <Text style={coachStyles.title}>{membership.name}</Text>
    <Text style={coachStyles.muted}>Archer · Active membership</Text>
    <Pressable accessibilityRole="button" onPress={() => router.push("/organization/manage")} style={coachStyles.chip}><Text style={coachStyles.link}>Manage memberships</Text></Pressable>
    {error ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{error}</Text> : null}
    <Pressable accessibilityRole="button" disabled={busy} onPress={confirmLeave} style={coachStyles.chip}>
      <Text style={coachStyles.link}>Leave organisation</Text>
    </Pressable>
  </ScrollView>;
}
