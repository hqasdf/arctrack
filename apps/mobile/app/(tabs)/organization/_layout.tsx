import { Stack } from "expo-router";
import { coachPalette } from "@/src/coach-ui";
import { colors } from "@/src/theme";

export default function OrganizationTabLayout() {
  return <Stack screenOptions={{ headerShown: true, headerTintColor: colors.text, headerStyle: { backgroundColor: coachPalette.background } }}>
    <Stack.Screen name="index" options={{ headerShown: false }} />
    <Stack.Screen name="manage" options={{ title: "Manage memberships", headerStyle: { backgroundColor: colors.background } }} />
    <Stack.Screen name="member/[organizationId]" options={{ title: "Membership", headerStyle: { backgroundColor: colors.background } }} />
    <Stack.Screen name="[organizationId]" options={{ title: "Coach's Workspace" }} />
    <Stack.Screen name="[organizationId]/athletes/index" options={{ title: "Athletes" }} />
    <Stack.Screen name="[organizationId]/reviews" options={{ title: "Reviews" }} />
    <Stack.Screen name="[organizationId]/analytics" options={{ title: "Team Analytics" }} />
    <Stack.Screen name="[organizationId]/settings" options={{ title: "Settings" }} />
    <Stack.Screen name="[organizationId]/athletes/[userId]" options={{ title: "Athlete" }} />
    <Stack.Screen name="[organizationId]/athletes/[userId]/sessions/[sessionId]" options={{ title: "Athlete Session" }} />
    <Stack.Screen name="[organizationId]/athletes/[userId]/sessions/[sessionId]/rounds/[roundId]" options={{ title: "Athlete Round" }} />
  </Stack>;
}
