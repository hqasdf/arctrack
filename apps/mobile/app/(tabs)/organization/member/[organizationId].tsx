import { useAppearance } from "../../../../src/appearance";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useAuth } from "@/src/auth";
import { leaveOrganization, readOwnOrganizations, type OwnOrganization } from "@/src/organizations";
import { useCoachStyles } from "@/src/coach-ui";
import { organizationAppearance } from "@/src/organization-appearance";

import {MobileTrainingInvitations} from '@/src/live-coaching-ui';

export default function ArcherMemberScreen() {
  const coachStyles = useCoachStyles();
  const { colors } = useAppearance();
  const { organizationId } = useLocalSearchParams<{ organizationId: string }>();
  const { user } = useAuth();
  const [membership, setMembership] = useState<OwnOrganization | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const palette = organizationAppearance(useAppearance().resolvedTheme);
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
    <Pressable onPress={() => router.replace("/(tabs)/organization")}><Text style={coachStyles.link}>Organisations</Text></Pressable></View>;
  return <ScrollView style={{ flex: 1, backgroundColor: palette.background }} contentContainerStyle={coachStyles.content}>
    <Text style={[coachStyles.eyebrow, { color: palette.muted }]}>ORGANISATIONS</Text>
    <Text style={[coachStyles.title, { color: palette.text }]}>{membership.name}</Text>
    <Pressable accessibilityRole="button" onPress={() => router.push("/organization/manage")} style={[coachStyles.chip, { borderColor: palette.border, backgroundColor: palette.surface }]}><Text style={{ color: palette.primary, fontWeight: "700" }}>Manage memberships</Text></Pressable>
    <View style={{ padding: 19, borderWidth: 1, borderColor: palette.border, borderRadius: 16, backgroundColor: palette.surface, gap: 14 }}>
      <Text accessibilityRole="header" style={{ color: palette.text, fontSize: 20, fontWeight: "600" }}>Your membership</Text>
      <Text style={{ color: palette.muted, fontSize: 14, lineHeight: 21 }}>You are an active Archer in {membership.name}.</Text>
      {error ? <Text accessibilityRole="alert" style={{ color: palette.error }}>{error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={confirmLeave}
        style={[coachStyles.chip, { borderColor: palette.border, backgroundColor: palette.surface, borderRadius: 8 }, busy && { opacity: .55 }]}>
        <Text style={{ color: palette.primary, fontWeight: "700" }}>Leave organisation</Text>
      </Pressable>
    </View>
    {user&&<MobileTrainingInvitations key={user.id+':'+organizationId} userId={user.id} organizationId={organizationId}/>}
  </ScrollView>;
}
