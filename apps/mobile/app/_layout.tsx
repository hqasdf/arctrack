import { Stack, usePathname, ThemeProvider, DarkTheme, DefaultTheme } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { lazy, Suspense, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { AuthProvider, useAuth } from "../src/auth";
import { AppearanceProvider, useAppearance } from "../src/appearance";
import { startOfflineScoringSync } from "../src/offline-scoring";
import { OfflineRounds } from "../src/offline-rounds";
import { sessionAuthority } from "../src/supabase";
import { deviceScoringOwner } from "../src/offline-scoring-access";

const DeviceScore = lazy(() => import("./rounds/[roundId]/score"));

export const unstable_settings = { initialRouteName: "index" };

function Routes() {
  const { colors } = useAppearance();
  const { loading, user, recoveryRequired, authError, retry } = useAuth();
  const pathname = usePathname();
  const scoringOwner = user?.id;
  const [deviceRound, setDeviceRound] = useState<{ owner: string; id: string } | null>(null);
  useEffect(() => {
    if (!scoringOwner || loading || recoveryRequired || authError) return;
    return startOfflineScoringSync(scoringOwner);
  }, [scoringOwner, loading, recoveryRequired, authError]);
  useEffect(() => {
    if (__DEV__) console.debug("[ROUTE]", {
      pathname, loading, authError, protectedGuard: !!user && !recoveryRequired,
      destination: loading ? "loading" : authError ? "retry" : !user ? "sign-in" : recoveryRequired ? "recover" : "sessions",
    });
  }, [pathname, loading, authError, user, recoveryRequired]);
  const deviceOwner = !recoveryRequired ? deviceScoringOwner(sessionAuthority?.snapshot()) : null;
  if ((authError || loading) && deviceOwner && deviceRound?.owner === deviceOwner) return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <Pressable accessibilityRole="button" onPress={() => setDeviceRound(null)} style={{ minHeight: 48, padding: 14 }}><Text style={{ color: colors.accent }}>Back to device Rounds</Text></Pressable>
    <Suspense fallback={<ActivityIndicator accessibilityLabel="Opening device scoring" color={colors.accent} />}>
      <DeviceScore key={`${deviceOwner}:${deviceRound.id}`} offlineAccount={deviceOwner} offlineRoundId={deviceRound.id} />
    </Suspense>
  </View>;
  if (loading) return <View style={{ flex: 1, justifyContent: "center", gap: 16, padding: 24, backgroundColor: colors.background }}><ActivityIndicator color={colors.accent} accessibilityLabel="Checking sign-in" />{deviceOwner ? <OfflineRounds key={deviceOwner} deviceOwner={deviceOwner} onOpen={id => setDeviceRound({ owner: deviceOwner, id })} /> : null}</View>;
  if (authError) return <View style={{ flex: 1, justifyContent: "center", gap: 18, padding: 24, backgroundColor: colors.background }}>
    <Text style={{ color: colors.text, textAlign: "center" }}>Arc Track could not verify your sign-in. Check your connection and try again.</Text>
    <Pressable accessibilityRole="button" onPress={retry} style={{ padding: 16 }}><Text style={{ color: colors.accent, fontWeight: "700" }}>Retry</Text></Pressable>
    {deviceOwner ? <><Text style={{ color: colors.muted }}>Device-only scoring is available for the previously signed-in account. Normal app access remains locked until sign-in is verified.</Text>
      <OfflineRounds key={deviceOwner} deviceOwner={deviceOwner} onOpen={id => setDeviceRound({ owner: deviceOwner, id })} /></> : null}
  </View>;
  // A different accepted account must not inherit mounted screens/data from the
  // previous account. Refresh and ordinary navigation keep this identity stable.
  return <Stack key={user?.id ?? "signed-out"} screenOptions={{ headerShown: false }}>
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

function ThemedApp() {
  const { colors, resolvedTheme } = useAppearance();
  const base = resolvedTheme === "dark" ? DarkTheme : DefaultTheme;
  const navigationTheme = { ...base, colors: { ...base.colors, primary: colors.accent, background: colors.background, card: colors.surface, text: colors.text, border: colors.border, notification: colors.error } };
  return <ThemeProvider value={navigationTheme}><AuthProvider><StatusBar style={resolvedTheme === "dark" ? "light" : "dark"} /><Routes /></AuthProvider></ThemeProvider>;
}
export default function RootLayout() {
  return <AppearanceProvider><ThemedApp /></AppearanceProvider>;
}
