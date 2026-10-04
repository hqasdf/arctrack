import { Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { AuthProvider, useAuth } from "../src/auth";
import { colors } from "../src/theme";

function Routes() {
  const { loading, user, recoveryRequired, authError, retry } = useAuth();
  const pathname = usePathname();
  useEffect(() => {
    if (__DEV__) console.debug("[ROUTE]", {
      pathname, loading, authError, protectedGuard: !!user && !recoveryRequired,
      destination: loading ? "loading" : authError ? "retry" : !user ? "sign-in" : recoveryRequired ? "recover" : "sessions",
    });
  }, [pathname, loading, authError, user, recoveryRequired]);
  if (loading) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}><ActivityIndicator color={colors.accent} accessibilityLabel="Checking sign-in" /></View>;
  if (authError) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 18, padding: 24, backgroundColor: colors.background }}>
    <Text style={{ color: colors.text, textAlign: "center" }}>Arc Track could not verify your sign-in. Check your connection and try again.</Text>
    <Pressable accessibilityRole="button" onPress={retry} style={{ padding: 16 }}><Text style={{ color: colors.accent, fontWeight: "700" }}>Retry</Text></Pressable>
  </View>;
  return <Stack initialRouteName="index" screenOptions={{ headerShown: false }}>
    <Stack.Screen name="index" />
    <Stack.Protected guard={!!user && !recoveryRequired}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="sessions/new" options={{ headerShown: false }} />
      <Stack.Screen name="sessions/[sessionId]" options={{ headerShown: true, title: "Session", headerTintColor: colors.text, headerStyle: { backgroundColor: colors.background } }} />
      <Stack.Screen name="sessions/training-plans/[planId]" options={{ headerShown: true, title: "Training Plan", headerTintColor: colors.text, headerStyle: { backgroundColor: colors.background } }} />
      <Stack.Screen name="sessions/[sessionId]/configure-round" options={{ headerShown: true, title: "Round Configuration", headerTintColor: colors.text, headerStyle: { backgroundColor: colors.background } }} />
      <Stack.Screen name="rounds/[roundId]" options={{ headerShown: true, title: "Round", headerTintColor: colors.text, headerStyle: { backgroundColor: colors.background } }} />
      <Stack.Screen name="rounds/[roundId]/score" options={{ headerShown: true, title: "Score Round", headerTintColor: colors.text, headerStyle: { backgroundColor: colors.background } }} />
    </Stack.Protected>
    <Stack.Protected guard={!user}><Stack.Screen name="(auth)" /></Stack.Protected>
    <Stack.Protected guard={!user || recoveryRequired}>
      <Stack.Screen name="recover" options={{ headerShown: true, title: "Password recovery", headerTintColor: colors.text, headerStyle: { backgroundColor: colors.background } }} />
    </Stack.Protected>
  </Stack>;
}

export default function RootLayout() {
  return <AuthProvider><StatusBar style="dark" /><Routes /></AuthProvider>;
}
