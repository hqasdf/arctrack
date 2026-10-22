import { targetFaceLabel } from "@arc-track/core/analytics";
import { formatDateOnly } from "@arc-track/core/dates";
import { roundTotal } from "@arc-track/core/scoring";
import type { SessionDraft } from "@arc-track/core/scoring";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "../../src/auth";
import { SessionWeatherHistory } from "../../src/session-weather";
import { readOwnSession } from "../../src/sessions";
import { scoreRoundHref } from "../../src/round-navigation";
import { PAGE_TOP_SPACING } from "../../src/theme";
import { createThemedStyles, useAppearance } from "../../src/appearance";
import { createMobileRound, deleteMobileRound, deleteMobileSession, saveMobileSessionArrowCount } from "../../src/writes";
import { MobileCoachFeedback, MobileSessionNotes } from "../../src/notes-feedback-ui";
import { singleTrainingPlanRouteParam } from "../../src/training-plan-route-params";

export default function SessionDetailScreen() {
  const styles = useStyles();
  const { colors } = useAppearance();
  const { sessionId: rawSessionId } = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const sessionId = singleTrainingPlanRouteParam(rawSessionId);
  const { user } = useAuth();
  const [session, setSession] = useState<SessionDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingRound, setStartingRound] = useState(false);
  const [roundError, setRoundError] = useState<string | null>(null);
  const [arrowCountText, setArrowCountText] = useState("0");
  const [savingCount, setSavingCount] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const starting = useRef(false);
  const request = useRef(0);
  const scope = `${user?.id ?? ""}:${sessionId ?? ""}`;
  const activeScope = useRef(scope);
  useEffect(() => { activeScope.current = scope; const pending = request; return () => { pending.current++; }; }, [scope]);
  const loadedScopeRef = useRef("");
  const [loadedScope, setLoadedScope] = useState("");

  const load = useCallback(async () => {
    if (!user || !sessionId) { setSession(null); setLoading(false); return; }
    const ticket = ++request.current, requestedScope = scope;
    const current = () => ticket === request.current && activeScope.current === requestedScope;
    if (loadedScopeRef.current !== requestedScope) setLoading(true);
    setError(null);
    try { const loaded = await readOwnSession(user.id, sessionId); if (!current()) return; setSession(loaded); loadedScopeRef.current = requestedScope; setLoadedScope(requestedScope); if (loaded) setArrowCountText(String(loaded.arrowCount)); }
    catch { if (current()) setError("This Session could not be loaded. Check your connection and try again."); }
    finally { if (current()) setLoading(false); }
  }, [user, sessionId, scope]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function startRound() {
    if (!sessionId || starting.current) return;
    starting.current = true;
    setStartingRound(true);
    setRoundError(null);
    try {
      const created = await createMobileRound(sessionId);
      router.push(scoreRoundHref(created.roundId));
    } catch (cause) {
      setRoundError(cause instanceof Error ? cause.message : "The Round could not be created. Check your connection and try again.");
    } finally {
      starting.current = false;
      setStartingRound(false);
    }
  }
  async function saveArrowCount() {
    if (!user || !sessionId || savingCount) return;
    setSavingCount(true); setRoundError(null);
    try {
      const count = /^\d+$/.test(arrowCountText) ? Number(arrowCountText) : NaN;
      const saved = await saveMobileSessionArrowCount(user.id, sessionId, count);
      setArrowCountText(String(saved)); setSession((current) => current ? { ...current, arrowCount: saved } : current);
    } catch (cause) { setRoundError(cause instanceof Error ? cause.message : "Arrow count could not be saved."); }
    finally { setSavingCount(false); }
  }
  function confirmDeleteRound(roundId: string, name: string) {
    Alert.alert(`Delete ${name}?`, "Its Ends and Arrows will also be deleted.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        if (!sessionId || deleting) return;
        setDeleting(true); setRoundError(null);
        try { await deleteMobileRound(sessionId, roundId); setSession((current) => current ? { ...current, rounds: current.rounds.filter((round) => round.id !== roundId) } : current); }
        catch { setRoundError("The Round could not be deleted. Try again."); }
        finally { setDeleting(false); }
      } },
    ]);
  }
  function confirmDeleteSession() {
    Alert.alert("Delete this Session?", "All its Rounds, Ends and Arrows will also be deleted.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        if (!user || !sessionId || deleting) return;
        setDeleting(true); setRoundError(null);
        try { await deleteMobileSession(user.id, sessionId); router.replace("/(tabs)/sessions"); }
        catch { setRoundError("The Session could not be deleted. Try again."); }
        finally { setDeleting(false); }
      } },
    ]);
  }

  if (loading || (loadedScope !== scope && !error && user && sessionId)) return <View style={styles.state}><ActivityIndicator color={colors.accent} accessibilityLabel="Loading Session" /></View>;
  if (error && (!session || loadedScope !== scope)) return <View style={styles.state}><Text style={styles.message}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable></View>;
  if (!session || !user || !sessionId) return <View style={styles.state}><Text style={styles.message}>Session not found or you do not have access.</Text></View>;

  return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    {error ? <Text accessibilityRole="alert" style={styles.startError}>{error}</Text> : null}
    <Text style={styles.eyebrow}>{session.sessionType === "competition" ? "COMPETITION" : "TRAINING"} · {formatDateOnly(session.date)}</Text>
    <Text style={styles.title}>{session.title}</Text>
    <Text style={styles.meta}>Arrow count: {session.arrowCount}</Text>
    <View style={styles.countEdit}><TextInput placeholderTextColor={colors.muted} selectionColor={colors.accent} accessibilityLabel="Session Arrow count" keyboardType="number-pad" value={arrowCountText}
      onChangeText={setArrowCountText} style={styles.countInput} selectTextOnFocus />
      <Pressable accessibilityRole="button" disabled={savingCount} onPress={() => void saveArrowCount()} style={styles.smallAction}><Text style={styles.actionText}>{savingCount ? "Saving…" : "Save count"}</Text></Pressable></View>
    <View style={styles.startPanel}>
      <Text style={styles.startHint}>Start a Round with Arc Track’s default setup.</Text>
      <Pressable accessibilityRole="button" disabled={startingRound} onPress={() => void startRound()} style={({ pressed }) => [styles.startButton, (pressed || startingRound) && styles.startPressed]}>
        {startingRound ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.startButtonText}>Start Round</Text>}
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/sessions/[sessionId]/configure-round", params: { sessionId } })}
        style={styles.configureButton}><Text style={styles.configureText}>Configure Round</Text></Pressable>
    </View>
    {roundError ? <Text accessibilityRole="alert" style={styles.startError}>{roundError}</Text> : null}
    <Text style={styles.sectionTitle}>Rounds</Text>
    {session.rounds.length === 0 ? <Text style={styles.message}>No Rounds in this Session yet.</Text> : session.rounds.map((round) => {
      const expected = round.ends * round.arrowsPerEnd;
      return <View key={round.id} style={styles.row}><Pressable accessibilityRole="button" accessibilityLabel={`Open ${round.name}`} onPress={() => router.push(scoreRoundHref(round.id))} style={({ pressed }) => pressed && styles.pressed}>
        <Text style={styles.roundName}>{round.name}</Text>
        <Text style={styles.meta}>{round.distanceMetres} m · {round.division} · {targetFaceLabel(round)}</Text>
        <Text style={styles.meta}>{round.ends} Ends × {round.arrowsPerEnd} Arrows/End</Text>
        <View style={styles.summary}><Text style={styles.score}>{roundTotal(round.arrows)} pts</Text><Text style={styles.count}>{round.arrows.length}/{expected} recorded · {round.arrows.length === expected && expected > 0 ? "Completed" : "In progress"}</Text></View>
      </Pressable><Pressable accessibilityRole="button" disabled={deleting} onPress={() => confirmDeleteRound(round.id, round.name)} style={styles.deleteAction}><Text style={styles.deleteText}>Delete Round</Text></Pressable></View>;
    })}
    <SessionWeatherHistory key={session.id} session={session}/>
    <MobileSessionNotes key={`notes:${scope}`} userId={user.id} sessionId={sessionId}/>
    <MobileCoachFeedback key={`feedback:${scope}`} userId={user.id} sessionId={sessionId}/>
    <Pressable accessibilityRole="button" disabled={deleting} onPress={confirmDeleteSession} style={styles.deleteAction}><Text style={styles.deleteText}>Delete Session</Text></Pressable>
  </ScrollView>;
}

const useStyles = createThemedStyles((colors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingTop: 20 + PAGE_TOP_SPACING, paddingBottom: 36 },
  eyebrow: { color: colors.accent, fontSize: 12, fontWeight: "700", letterSpacing: 1.5 },
  title: { color: colors.text, fontSize: 29, fontWeight: "700", marginTop: 8 },
  meta: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  countEdit: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  countInput: { minWidth: 90, minHeight: 44, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 8, paddingHorizontal: 10, backgroundColor: colors.control, color: colors.text },
  smallAction: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  actionText: { color: colors.accent, fontWeight: "700" },
  deleteAction: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center", marginTop: 6 },
  deleteText: { color: colors.error, fontWeight: "700", fontSize: 13 },
  startPanel: { marginTop: 20, paddingTop: 17, borderTopWidth: 1, borderTopColor: colors.border, gap: 12 },
  startHint: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  startButton: { minHeight: 50, borderRadius: 10, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  startButtonText: { color: colors.onPrimary, fontSize: 15, fontWeight: "700" },
  startPressed: { opacity: 0.75 },
  configureButton: { minHeight: 46, borderRadius: 10, borderWidth: 1, borderColor: colors.accent, alignItems: "center", justifyContent: "center" },
  configureText: { color: colors.accent, fontWeight: "700" },
  startError: { color: colors.error, fontSize: 14, marginTop: 12, lineHeight: 20 },
  sectionTitle: { color: colors.text, fontSize: 21, fontWeight: "700", marginTop: 30, marginBottom: 14 },
  row: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 16, gap: 5, marginBottom: 10 },
  pressed: { opacity: 0.72 },
  roundName: { color: colors.text, fontSize: 18, fontWeight: "700" },
  summary: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: 10, marginTop: 8 },
  score: { color: colors.accent, fontSize: 18, fontWeight: "700" },
  count: { color: colors.muted, fontSize: 13 },
  state: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  message: { color: colors.muted, fontSize: 15, textAlign: "center" },
  retry: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 22, paddingVertical: 14 },
  retryText: { color: colors.onPrimary, fontWeight: "700" },
}));
