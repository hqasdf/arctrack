import { Tabs } from "expo-router";
import { Text } from "react-native";
import { ArcIcon } from "../../src/icons";
import { MAIN_TAB_ICONS } from "../../src/navigation-model";
import { colors } from "../../src/theme";

export default function TabsLayout() {
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.accent, tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border } }}>
    <Tabs.Screen name="sessions" options={{ title: "Sessions", tabBarIcon: ({ color }) => <ArcIcon name={MAIN_TAB_ICONS.sessions} color={String(color)} /> }} />
    <Tabs.Screen name="analytics" options={{ title: "Analytics", tabBarIcon: ({ color }) => <ArcIcon name={MAIN_TAB_ICONS.analytics} color={String(color)} /> }} />
    <Tabs.Screen name="counter" options={{ title: "Counter", tabBarIcon: ({ color }) => <ArcIcon name={MAIN_TAB_ICONS.counter} color={String(color)} /> }} />
    <Tabs.Screen name="organization" options={{ title: "Coach's Workspace", tabBarLabel: ({ color }) => <Text style={{ color: String(color), fontSize: 10, lineHeight: 11, textAlign: "center" }}>Coach&apos;s{"\n"}Workspace</Text>, tabBarIcon: ({ color }) => <ArcIcon name={MAIN_TAB_ICONS.organization} color={String(color)} /> }} />
    <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: ({ color }) => <ArcIcon name={MAIN_TAB_ICONS.profile} color={String(color)} /> }} />
  </Tabs>;
}
