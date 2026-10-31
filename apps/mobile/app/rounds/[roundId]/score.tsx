import { targetFaceLabel } from "@arc-track/core/analytics";
import { DIVISIONS, type Division } from "@arc-track/core/presets";
import {
  arrowKey, endTotal, roundTotal, xCount,
  type ArrowEntry, type Plot, type RoundDraft, type ScoreLabel, type SessionDraft,
} from "@arc-track/core/scoring";
import { usePathname, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { openOfflineScoring, type OfflineScoring } from "../../../src/offline-scoring";
import type { OfflineView } from "../../../src/offline-scoring-store";
import { enqueueArrowWrite, waitForRoundWrites } from "../../../src/arrow-save-queue";
import { useAuth } from "../../../src/auth";
import { ArcIcon } from "../../../src/icons";
import { GroupingExportButton } from "../../../src/grouping-export";
import { ScoringWeather } from "../../../src/session-weather";
import { NativeTarget } from "../../../src/native-target";
import { RoundGroupPosition, RoundInsights } from "../../../src/round-insights";
import { canConfigureRound, type RoundSettingsInput } from "../../../src/round-update-model";
import {
  applyArrowSaveResult, clearArrowPlot, correctArrowScore, firstEmptySlot, latestScore, plotCurrentArrow, previousPlottedArrow, restoreDeletedArrow,
  type ArrowSlot,
} from "../../../src/scoring-state";
import { PAGE_TOP_SPACING } from "../../../src/theme";
import { createThemedStyles, useAppearance } from "../../../src/appearance";
import { RecentRoundConfigs } from "../../../src/recent-round-configs";
import { DeviceSaveNavigationGuard } from "../../../src/device-save-navigation-guard";
import { roundUpdateEnabled, updateMobileRoundSettings } from "../../../src/writes";

type LoadedRound = { session: SessionDraft; round: RoundDraft };
const CORRECTION_SCORES: ScoreLabel[] = ["X", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "M"];

function scoreText(score: ScoreLabel | null) { return score === "X" ? "10X" : score ?? "—"; }
function conflictText(entry: ArrowEntry | null) {
  if (!entry) return "deleted Arrow";
  return `${scoreText(entry.score)}, ${entry.plot ? `target position (${entry.plot.x.toFixed(2)}, ${entry.plot.y.toFixed(2)})${entry.plot.faceIndex === undefined ? "" : `, face ${entry.plot.faceIndex + 1}`}` : "no target coordinates"}`;
}

function scoreColours(score: ScoreLabel | null, colors: import("../../../src/theme").ThemeColors) {
  if (score === "X" || score === "10" || score === "9") return { backgroundColor: "#f5cf3d", color: "#332b17" };
  if (score === "8" || score === "7") return { backgroundColor: "#e65a55", color: "#fff" };
  if (score === "6" || score === "5") return { backgroundColor: "#429aca", color: "#fff" };
  if (score === "4" || score === "3") return { backgroundColor: "#262321", color: "#fff" };
  if (score === "2" || score === "1") return { backgroundColor: "#f3f0e9", color: "#332c27" };
  if (score === "M") return { backgroundColor: "#e9e4dc", color: "#594e46" };
  return { backgroundColor: colors.surface, color: colors.muted };
}

export default function ScoreRoundScreen({ offlineAccount, offlineRoundId }: { offlineAccount?: string; offlineRoundId?: string } = {}) {
  const styles = useStyles();
  const { colors } = useAppearance();
  const params = useLocalSearchParams<{ roundId: string }>();
  const roundId = offlineRoundId ?? params.roundId;
  const { user } = useAuth();
  const userId = user?.id ?? offlineAccount;
  const localOnly = !!offlineAccount;
  const pathname = usePathname();
  const screenActive = localOnly || pathname === `/rounds/${roundId}/score`;
  const lifecycle = useRef(0);
  const loadVersion = useRef(0);
  const loadingRound=useRef(false);
  const [revalidating,setRevalidating]=useState(false);
  const mounted = useRef(false);
  const focused = useRef(false);
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
  const shownOwner=useRef<string|null>(null);
  const [loaded, setLoaded] = useState<LoadedRound | null>(null);
  const [arrows, setArrows] = useState<ArrowEntry[]>([]);
  const arrowsRef = useRef<ArrowEntry[]>([]);
  const [slot, setSlot] = useState<ArrowSlot>({ end: 1, arrow: 1 });
  const slotRef = useRef<ArrowSlot>({ end: 1, arrow: 1 });
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const editingKeyRef = useRef<string | null>(null);
  const [latestPlotKey, setLatestPlotKey] = useState<string | null>(null);
  const persistence = useRef<OfflineScoring | null>(null);
  const [offline, setOffline] = useState<OfflineView | null>(null);
  const [preparing, setPreparing] = useState("");
  const localChanges = useRef(new Map<string, { version: number; entry: ArrowEntry | null }>());
  const [localSaving, setLocalSaving] = useState(0);
  const [unstored,setUnstored]=useState(false);
  const versions = useRef(new Map<string, number>());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showInsights, setShowInsights] = useState(false);
  const [showCorrection, setShowCorrection] = useState(false);
  const [showConfigure, setShowConfigure] = useState(false);
  const [configureDraft, setConfigureDraft] = useState<RoundSettingsInput | null>(null);
  const [configureError, setConfigureError] = useState<string | null>(null);
  const [savingConfigure, setSavingConfigure] = useState(false);
  const pageScroll = useRef<ScrollViewInstance>(null);
  const pageOffset = useRef({ x: 0, y: 0 });
  const setTargetMultiTouch = useCallback((active: boolean) => {
    // Update the native scroller in the touch callback, not after a React render.
    pageScroll.current?.setNativeProps({ scrollEnabled: !active });
    if (active) pageScroll.current?.scrollTo({ ...pageOffset.current, animated: false });
  }, []);

  const selectSlot = useCallback((next: ArrowSlot, explicit = false) => { slotRef.current = next; editingKeyRef.current = explicit ? arrowKey(next.end, next.arrow) : null; setEditingKey(editingKeyRef.current); setSlot(next); }, []);
  const showOffline = useCallback((view: OfflineView) => {
    setUnstored(persistence.current?.hasUnstored?.()??false);
    const visible = new Map(view.arrows.map(a => [arrowKey(a.end, a.arrow), a]));
    for (const [key, change] of localChanges.current) {
      if (change.entry) visible.set(key, change.entry); else visible.delete(key);
    }
    const currentArrows = [...visible.values()];
    setOffline(view); arrowsRef.current = currentArrows; setArrows(currentArrows);
    setLoaded({ ...view.loaded, round: { ...view.loaded.round, arrows: currentArrows } });
  }, []);
  const load = useCallback(async (preferredSlot?: ArrowSlot) => {
    if(loadingRound.current)return;loadingRound.current=true;setRevalidating(true);
    const request = ++loadVersion.current;
    const generation = lifecycle.current;
    if (!userId || !roundId) { loadingRound.current=false;setRevalidating(false);setLoaded(null); setLoading(false); return; }
    const current = () => mounted.current && focused.current && generation === lifecycle.current && request === loadVersion.current;
    if(shownOwner.current!==`${userId}:${roundId}`)setLoading(true);
    setLoadError(null);
    try {
      await waitForRoundWrites(userId, roundId);
      if (!current()) return;
      persistence.current?.stop();
      const writer = await openOfflineScoring(userId, roundId, (done, total) => {
        if (current()) setPreparing(`Preparing offline scoring: ${done}/${total} slots`);
      }, localOnly);
      if (!current()) { writer.stop(); return; }
      persistence.current = writer;
      localChanges.current.clear(); setLocalSaving(0);
      const cached = writer.view(), result = cached.loaded;
      result.round = { ...result.round, arrows: cached.arrows };
      versions.current = new Map();
      arrowsRef.current = cached.arrows;
      setArrows(cached.arrows);
      setOffline(cached);
      writer.start((view) => {
        if (!current()) return;
        showOffline(view);
      });
      const defaultSlot = firstEmptySlot(result.round, result.round.arrows);
      const resumeSlot=preferredSlot??(shownOwner.current===`${userId}:${roundId}`?slotRef.current:defaultSlot);
      selectSlot(resumeSlot.end<=result.round.ends&&resumeSlot.arrow<=result.round.arrowsPerEnd?resumeSlot:defaultSlot);
      if(shownOwner.current!==`${userId}:${roundId}`)setLatestPlotKey(null);
      setLoaded(result);
      setLoadedOwner(`${userId}:${roundId}`);
      shownOwner.current=`${userId}:${roundId}`;
    } catch (issue) {
      if (current()) setLoadError(issue instanceof Error ? issue.message : "This Round could not be loaded. Check your connection and try again.");
    } finally {
      if(request===loadVersion.current){loadingRound.current=false;setRevalidating(false);}
      if (current()) setLoading(false);
    }
  }, [userId, roundId, selectSlot, localOnly, showOffline]);
  const invalidateLoad = useCallback(() => { ++loadVersion.current;loadingRound.current=false;persistence.current?.stop(); }, []);

  useEffect(() => {
    mounted.current = true;
    const generation = lifecycle.current;
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active" && focused.current) void load();
      else { ++loadVersion.current;loadingRound.current=false;persistence.current?.stop(); }
    });
    return () => { mounted.current = false; lifecycle.current = generation + 1; persistence.current?.stop(); subscription.remove(); };
  }, [load]);
  useEffect(() => {
    focused.current = screenActive;
    if (!screenActive) return;
    queueMicrotask(() => { if (mounted.current) void load(); });
    return () => { focused.current = false; invalidateLoad(); };
  }, [load, screenActive, invalidateLoad]);

  function commitArrows(next: ArrowEntry[]) { arrowsRef.current = next; setArrows(next); }
  function replaceEntry(key: string, change: (entry: ArrowEntry) => ArrowEntry) {
    commitArrows(arrowsRef.current.map((item) => arrowKey(item.end, item.arrow) === key ? change(item) : item));
  }
  function nextVersion(key: string) {
    const version = (versions.current.get(key) ?? 0) + 1;
    versions.current.set(key, version);
    return version;
  }
  function enqueue(key: string, task: () => Promise<void>) {
    if (userId) void enqueueArrowWrite(userId, roundId, key, task);
  }
  function persist(entry: ArrowEntry) {
    const key = arrowKey(entry.end, entry.arrow);
    const version = nextVersion(key);
    localChanges.current.set(key, { version, entry }); setLocalSaving(localChanges.current.size);
    const generation = lifecycle.current, writer = persistence.current, slotVersions = versions.current;
    enqueue(key, async () => {
      try {
        if (!writer) throw new Error("The scoring writer is unavailable.");
        await writer.save(entry);
      } catch {
        if (mounted.current && generation === lifecycle.current) commitArrows(applyArrowSaveResult(arrowsRef.current, key, version, slotVersions.get(key) ?? 0, { failed: true }));
      } finally {
        if (mounted.current && generation === lifecycle.current && localChanges.current.get(key)?.version === version) {
          localChanges.current.delete(key); setLocalSaving(localChanges.current.size);
          try { if (writer) showOffline(writer.view()); } catch { /* Retired account: keep its data private. */ }
        }
      }
    });
  }
  function handlePlot(plot: Plot) {
    if(loadingRound.current||loadError)return;
    if (!loaded) return;
    const current = slotRef.current;
    const key = arrowKey(current.end, current.arrow);
    if (arrowsRef.current.some((item) => item.end === current.end && item.arrow === current.arrow) && editingKeyRef.current !== key) return;
    const result = plotCurrentArrow(loaded.round, arrowsRef.current, current, plot);
    commitArrows(result.arrows);
    selectSlot(result.slot);
    setLatestPlotKey(arrowKey(current.end, current.arrow));
    setActionError(null);
    persist(result.entry);
    setShowCorrection(false);
  }
  function correctScore(score: ScoreLabel) {
    if(loadingRound.current||loadError)return;
    const current = slotRef.current;
    const selected = arrowsRef.current.find((item) => item.end === current.end && item.arrow === current.arrow);
    if (!selected) return;
    const entry = correctArrowScore(selected, score);
    replaceEntry(arrowKey(entry.end, entry.arrow), () => entry);
    persist(entry);
    setShowCorrection(false);
  }
  function clearMarker() {
    if(loadingRound.current||loadError)return;
    const current = slotRef.current;
    const selected = arrowsRef.current.find((item) => item.end === current.end && item.arrow === current.arrow);
    if (!selected?.plot) return;
    const entry = clearArrowPlot(selected);
    replaceEntry(arrowKey(entry.end, entry.arrow), () => entry);
    persist(entry);
  }
  function retrySelected() {
    if(loadingRound.current||loadError)return;
    const current = slotRef.current;
    const selected = arrowsRef.current.find((item) => item.end === current.end && item.arrow === current.arrow);
    if (!selected || selected.syncState !== "failed") return;
    const entry: ArrowEntry = { ...selected, syncState: "saving" };
    replaceEntry(arrowKey(entry.end, entry.arrow), () => entry);
    persist(entry);
  }
  function removePrevious() {
    if(loadingRound.current||loadError)return;
    if (!loaded) return;
    const removed = previousPlottedArrow(arrowsRef.current, slotRef.current);
    if (!removed) return;
    const key = arrowKey(removed.end, removed.arrow);
    const version = nextVersion(key);
    localChanges.current.set(key, { version, entry: null }); setLocalSaving(localChanges.current.size);
    const generation = lifecycle.current, writer = persistence.current, slotVersions = versions.current;
    commitArrows(arrowsRef.current.filter((item) => arrowKey(item.end, item.arrow) !== key));
    selectSlot({ end: removed.end, arrow: removed.arrow });
    setActionError(null);
    enqueue(key, async () => {
      try {
        if (!writer) throw new Error("The scoring writer is unavailable.");
        await writer.remove(removed);
      } catch {
        if (mounted.current && generation === lifecycle.current && slotVersions.get(key) === version) {
          commitArrows(restoreDeletedArrow(arrowsRef.current, {...removed,syncState:"failed"}));
          selectSlot({ end: removed.end, arrow: removed.arrow });
          setActionError("The Arrow could not be deleted. Try again.");
        }
      } finally {
        if (mounted.current && generation === lifecycle.current && localChanges.current.get(key)?.version === version) {
          localChanges.current.delete(key); setLocalSaving(localChanges.current.size);
          try { if (writer) showOffline(writer.view()); } catch { /* Retired account: keep its data private. */ }
        }
      }
    });
  }

  function openConfigure() {
    if(loadingRound.current||loadError)return;
    if (!loaded || localOnly || localChanges.current.size || offline?.pending || arrowsRef.current.length > 0) return;
    setConfigureDraft({ name: loaded.round.name, division: loaded.round.division, distanceMetres: loaded.round.distanceMetres,
      faceDiameterCm: loaded.round.faceDiameterCm, plannedEnds: loaded.round.ends });
    setConfigureError(null);
    setShowConfigure(true);
  }

  async function saveConfigure() {
    if(loadingRound.current||loadError)return;
    if (!loaded || localOnly || localChanges.current.size || offline?.pending || !configureDraft || !roundUpdateEnabled || arrowsRef.current.length > 0 || savingConfigure) return;
    setSavingConfigure(true);
    const generation = lifecycle.current;
    setConfigureError(null);
    try {
      await updateMobileRoundSettings(loaded.round.id, loaded.round.ends, configureDraft);
      if (!mounted.current || generation !== lifecycle.current) return;
      setShowConfigure(false);
      await load(slotRef.current);
    } catch (issue) {
      if (mounted.current && generation === lifecycle.current) setConfigureError(issue instanceof Error ? issue.message : "Round settings could not be saved.");
    } finally {
      if (mounted.current && generation === lifecycle.current) setSavingConfigure(false);
    }
  }

  if (loading || loaded && loadedOwner !== `${userId}:${roundId}`) return <View style={styles.state}><ActivityIndicator color={colors.accent} accessibilityLabel="Loading scoring Round" /><Text style={styles.message}>{preparing || "Loading scoring Round"}</Text></View>;
  if (loadError&&!loaded) return <View style={styles.state}><Text style={styles.message}>{loadError}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable></View>;
  if (!loaded) return <View style={styles.state}><Text style={styles.message}>Round not found or you do not have access.</Text></View>;

  const round = loaded.round;
  const selected = editingKey === arrowKey(slot.end, slot.arrow) ? arrows.find((item) => item.end === slot.end && item.arrow === slot.arrow) ?? null : null;
  const previous = previousPlottedArrow(arrows, slot);
  const latest = latestScore(arrows, latestPlotKey);
  const failedCount = arrows.filter((item) => item.syncState === "failed").length;
  const plottedCount = arrows.filter((item) => item.plot !== null).length;
  const enteredEnds = Array.from(new Set(arrows.map((item) => item.end))).sort((a, b) => a - b);


  return <ScrollView ref={pageScroll} style={styles.page} contentContainerStyle={styles.content}
    scrollEventThrottle={16} onScroll={(event) => { pageOffset.current = event.nativeEvent.contentOffset; }}>
    {!localOnly&&<DeviceSaveNavigationGuard pending={localSaving>0||unstored} wait={()=>userId?waitForRoundWrites(userId,roundId):Promise.resolve()}
      ready={()=>localChanges.current.size===0&&!persistence.current?.hasUnstored?.()}/>}
    <Text style={styles.eyebrow}>{loaded.session.title} · ROUND {round.roundNumber}</Text>
    {revalidating&&<Text accessibilityLiveRegion="polite" style={styles.meta}>Refreshing this Round. Device scores remain preserved.</Text>}
    {loadError&&<View><Text accessibilityRole="alert" style={styles.warning}>{loadError} Device scores are shown for recovery; retry before editing.</Text><Pressable accessibilityRole="button" onPress={()=>void load()}><Text style={styles.retryText}>Retry Round refresh</Text></Pressable></View>}
    <View style={styles.titleRow}><Text style={styles.title}>{round.name}</Text>
      {!localOnly && !localSaving && !offline?.pending && canConfigureRound({ ...round, arrows }) ? <Pressable accessibilityRole="button" accessibilityLabel="Configure Round settings" onPress={openConfigure} style={styles.configureButton}>
        <ArcIcon name="settings" color={colors.accent} size={21} />
      </Pressable> : null}
    </View>
    {localOnly ? <Text style={styles.warning}>Device scoring only. Reconnect and verify sign-in before synchronizing. Normal app access remains locked.</Text> : null}
    <Text style={styles.meta}>{round.division} · {round.distanceMetres} m · {targetFaceLabel(round)}</Text>

    <View style={styles.totals} accessibilityLiveRegion="polite">
      <View style={{ flex: 1 }}><Text style={styles.smallLabel}>SCORING SYNC</Text>
        <Text style={styles.meta}>{localSaving ? "Saving on device..." : offline?.status === "synced" ? "Synced" : offline?.status === "syncing" ? "Synchronizing" : offline?.status === "conflict" ? "Conflict requiring review" : offline?.status === "failed" ? offline.message ?? "Scoring synchronization failed. Your pending changes are preserved." : offline?.status === "waiting" ? "Saved on device. Waiting for internet or sign-in." : "Saved on device"}</Text>
        {offline?.pending ? <Text style={styles.meta}>{offline.pending} pending change{offline.pending === 1 ? "" : "s"}. Live Coaching receives confirmed server scores only.</Text> : null}
      </View>
      <Pressable accessibilityRole="button" onPress={() => { void persistence.current?.retry().catch(() => setActionError("Device save is still unavailable. Keep this screen open; do not clear app storage.")); }} style={styles.editButton}><Text style={styles.editText}>{localOnly ? "Retry device save" : "Retry sync"}</Text></Pressable>
    </View>
    {offline?.conflicts.map(conflict => <View key={arrowKey(conflict.slot.end, conflict.slot.arrow)} style={styles.totals}>
      <View style={{ flex: 1 }}><Text style={styles.warning}>End {conflict.slot.end} ? Arrow {conflict.slot.arrow}: device {conflictText(conflict.device)}; server {conflictText(conflict.server)}.</Text>
        <Text style={styles.meta}>Choose which version to use. Both versions remain in device recovery history. Keeping this device version will explicitly replace the reviewed server version if it has not changed again.</Text>
        {(["server", "device"] as const).map(choice => <Pressable key={choice} accessibilityRole="button" disabled={localOnly} style={styles.editButton} onPress={() => {
          void persistence.current?.resolve(conflict.slot, choice).catch(issue => setActionError(issue instanceof Error ? issue.message : "Conflict resolution could not be saved. Your pending scores were kept."));
        }}><Text style={styles.editText}>{choice === "server" ? "Use server version" : "Keep device version"}</Text></Pressable>)}
      </View>
    </View>)}

    <View style={styles.targetArea}><NativeTarget arrows={arrows} selectedId={selected?.id ?? null} currentEnd={slot.end}
      faceType={round.faceType} faceDiameterCm={round.faceDiameterCm} onPlot={handlePlot} onMultiTouchChange={setTargetMultiTouch} /></View>

    <RoundGroupPosition round={{ ...round, arrows }} />
    <GroupingExportButton round={{ ...round, arrows }} context={`${loaded.session.title} · ${loaded.session.date}`} />

    <View style={styles.currentRow}>
      <View><Text style={styles.smallLabel}>CURRENT</Text><Text style={styles.currentText}>End {slot.end} · Arrow {slot.arrow}</Text></View>
      <View style={styles.latestWrap}><View style={[styles.latestCircle, { backgroundColor: scoreColours(latest, colors).backgroundColor }]}>
        <Text style={[styles.latestText, { color: scoreColours(latest, colors).color }]}>{scoreText(latest)}</Text>
      </View><Text style={styles.smallLabel}>LATEST SCORE</Text></View>
    </View>

    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scoreRow} accessibilityLabel={`Scores in End ${slot.end}`}>
      {Array.from({ length: round.arrowsPerEnd }, (_, index) => {
        const arrow = arrows.find((item) => item.end === slot.end && item.arrow === index + 1);
        const active = slot.arrow === index + 1 && (!arrow || selected !== null);
        const palette = scoreColours(arrow?.score ?? null, colors);
        return <Pressable key={index} accessibilityRole="button" accessibilityLabel={`Arrow ${index + 1}, ${arrow ? scoreText(arrow.score) : "empty"}${arrow?.syncState === "failed" ? ", save failed" : ""}`}
          accessibilityState={{ selected: active }} onPress={() => selectSlot({ end: slot.end, arrow: index + 1 }, true)}
          style={[styles.scoreSlot, { backgroundColor: palette.backgroundColor }, active && styles.scoreSlotSelected]}>
          <Text style={[styles.scoreSlotText, { color: palette.color }]}>{scoreText(arrow?.score ?? null)}</Text>
          {arrow?.syncState === "failed" ? <Text style={styles.failedMark}>!</Text> : null}
        </Pressable>;
      })}
    </ScrollView>

    <View style={styles.endNav}>
      <Pressable accessibilityRole="button" disabled={slot.end === 1} onPress={() => selectSlot({ end: slot.end - 1, arrow: 1 })} style={styles.endNavButton}><Text style={[styles.endNavText, slot.end === 1 && styles.disabled]}>Previous</Text></Pressable>
      <Text style={styles.endNavMiddle}>End {slot.end} of {round.ends}</Text>
      <Pressable accessibilityRole="button" disabled={slot.end === round.ends} onPress={() => selectSlot({ end: slot.end + 1, arrow: 1 })} style={styles.endNavButton}><Text style={[styles.endNavText, slot.end === round.ends && styles.disabled]}>Next</Text></Pressable>
    </View>

    <View style={styles.totals}>
      <Metric label={`END ${slot.end}`} value={String(endTotal(arrows, slot.end))} />
      <Metric label="ROUND" value={String(roundTotal(arrows))} />
      <Metric label="PLOTTED" value={`${plottedCount}/${round.ends * round.arrowsPerEnd}`} />
      <Metric label="X" value={String(xCount(arrows))} />
    </View>

    <View style={styles.editActions}>
      {selected ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: showCorrection }} onPress={() => setShowCorrection((open) => !open)} style={styles.editButton}><Text style={styles.editText}>Correct score</Text></Pressable> : null}
      {selected?.plot ? <Pressable accessibilityRole="button" onPress={clearMarker} style={styles.editButton}><Text style={styles.editText}>Clear marker</Text></Pressable> : null}
      {selected?.syncState === "failed" ? <Pressable accessibilityRole="button" onPress={retrySelected} style={styles.editButton}><Text style={styles.editText}>Retry save</Text></Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={previous ? `Delete End ${previous.end}, Arrow ${previous.arrow}` : "Delete previous Arrow"}
        accessibilityState={{ disabled: !previous }} disabled={!previous} onPress={removePrevious}
        style={[styles.deleteButton, !previous && styles.disabled]}><ArcIcon name="trash" color={previous ? colors.error : colors.muted} size={22} /></Pressable>
    </View>
    {selected && showCorrection ? <View style={styles.corrections} accessibilityLabel="Correct recorded score">
      {CORRECTION_SCORES.map((score) => <Pressable key={score} accessibilityRole="button" accessibilityState={{ selected: selected.score === score }}
        onPress={() => correctScore(score)} style={[styles.correction, selected.score === score && styles.correctionSelected]}>
        <Text style={styles.correctionText}>{score}</Text></Pressable>)}
    </View> : null}
    {failedCount > 0 ? <Text style={styles.warning}>{failedCount} Arrow{failedCount === 1 ? "" : "s"} not saved. Select the marked score to retry.</Text> : null}
    {actionError ? <Text accessibilityRole="alert" style={styles.warning}>{actionError}</Text> : null}

    <View style={styles.history}>
      <Text style={styles.historyTitle}>End history</Text>
      {enteredEnds.length === 0 ? <Text style={styles.message}>No Arrows yet.</Text> : enteredEnds.map((end) => {
        const endArrows = arrows.filter((item) => item.end === end).sort((a, b) => a.arrow - b.arrow);
        const countX = xCount(endArrows);
        return <View key={end} style={[styles.historyRow, end === slot.end && styles.historyCurrent]}>
          <Text style={styles.historyLabel}>END {end}</Text>
          <Text style={styles.historyTotal}>{endTotal(endArrows, end)} pts</Text>
          {countX > 0 ? <Text style={styles.historyX}>{countX}X</Text> : null}
          <View style={styles.historyScores}>{endArrows.map((arrow) => <Pressable key={arrow.arrow} style={styles.historyScoreValue}
            accessibilityRole="button" accessibilityLabel={`End ${end}, Arrow ${arrow.arrow}, ${scoreText(arrow.score)}${arrow.syncState === "failed" ? ", save failed" : ""}`}
            onPress={() => selectSlot({ end, arrow: arrow.arrow }, true)}>
            <Text style={[styles.historyScore, selected?.end === end && selected.arrow === arrow.arrow && styles.historySelected]}>{scoreText(arrow.score)}{arrow.syncState === "failed" ? "!" : ""}</Text>
          </Pressable>)}</View>
        </View>;
      })}
    </View>
    {!localOnly && <ScoringWeather key={round.id} session={loaded.session} round={round} arrows={arrows}/>}

    <Pressable accessibilityRole="button" accessibilityState={{ expanded: showInsights }}
      onPress={() => setShowInsights((value) => !value)} style={styles.insightsButton}>
      <Text style={styles.insightsButtonText}>{showInsights ? "Hide Round Insights" : "Round Insights"}</Text>
    </Pressable>
    {showInsights ? <RoundInsights round={{ ...round, arrows }} showGroupPosition={false} /> : null}
    <Modal visible={showConfigure} animationType="slide" onRequestClose={() => setShowConfigure(false)}>
      <SafeAreaProvider style={styles.configurePage}>
      <SafeAreaView style={styles.configurePage} edges={["top", "right", "bottom", "left"]}>
      <ScrollView style={styles.configurePage} contentContainerStyle={styles.configureContent} keyboardShouldPersistTaps="handled">
        <View style={styles.configureTitleRow}><Text style={styles.configureTitle}>Configure Round</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close Round settings" onPress={() => setShowConfigure(false)} style={styles.closeButton}><Text style={styles.closeText}>Close</Text></Pressable>
        </View>
        {configureDraft ? <>
          {showConfigure&&userId&&<RecentRoundConfigs key={userId} userId={userId} disabled={savingConfigure} compatible={(c)=>c.faceType===round.faceType&&c.arrowsPerEnd===round.arrowsPerEnd&&c.ends>=round.ends} onSelect={(c)=>{setConfigureDraft({name:c.name,division:c.division,distanceMetres:c.distanceMetres,faceDiameterCm:c.faceDiameterCm,plannedEnds:c.ends});setConfigureError(null);}}/>}
          <Text style={styles.configureLabel}>ROUND NAME</Text>
          <TextInput placeholderTextColor={colors.muted} selectionColor={colors.accent} accessibilityLabel="Round name" value={configureDraft.name} maxLength={80}
            onChangeText={(name) => setConfigureDraft((draft) => draft ? { ...draft, name } : draft)} style={styles.configureInput} />
          <Text style={styles.configureLabel}>DIVISION</Text>
          <View style={styles.configureChoices}>{DIVISIONS.map((division) => <Pressable key={division} accessibilityRole="button"
            accessibilityState={{ selected: configureDraft.division === division }} onPress={() => setConfigureDraft((draft) => draft ? { ...draft, division: division as Division } : draft)}
            style={[styles.configureChoice, configureDraft.division === division && styles.configureChoiceActive]}>
            <Text style={[styles.configureChoiceText, configureDraft.division === division && styles.configureChoiceTextActive]}>{division}</Text></Pressable>)}</View>
          {([["distanceMetres", "DISTANCE (M)"], ["faceDiameterCm", "FACE DIAMETER (CM)"], ["plannedEnds", "PLANNED ENDS"]] as const).map(([key, label]) => (
            <View key={key}><Text style={styles.configureLabel}>{label}</Text><TextInput placeholderTextColor={colors.muted} selectionColor={colors.accent} accessibilityLabel={label} keyboardType="number-pad" selectTextOnFocus
              value={String(configureDraft[key])} onChangeText={(value) => setConfigureDraft((draft) => draft ? { ...draft, [key]: value === "" ? 0 : Number(value) } : draft)}
              style={styles.configureInput} /></View>))}
          <Text style={styles.configureNote}>Target layout and arrows per End stay fixed. Planned Ends can increase, not decrease.</Text>
          {!roundUpdateEnabled ? <Text style={styles.configureNote}>Saving settings is unavailable until the owner Round-update backend is enabled.</Text> : null}
          {configureError ? <Text accessibilityRole="alert" style={styles.configureError}>{configureError}</Text> : null}
          <Pressable accessibilityRole="button" disabled={!roundUpdateEnabled || savingConfigure} onPress={() => void saveConfigure()}
            style={[styles.configureSave, (!roundUpdateEnabled || savingConfigure) && styles.disabled]}>
            {savingConfigure ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.configureSaveText}>Save settings</Text>}
          </Pressable>
        </> : null}
      </ScrollView>
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  </ScrollView>;
}

function Metric({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return <View style={styles.metric}><Text style={styles.smallLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>;
}

const useStyles = createThemedStyles((colors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingTop: 16 + PAGE_TOP_SPACING, paddingBottom: 42, gap: 11 },
  targetArea: { marginHorizontal: -10 },
  eyebrow: { color: colors.accent, fontSize: 11, fontWeight: "700", letterSpacing: 1.2 },
  title: { color: colors.text, fontSize: 25, fontWeight: "700" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  configureButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  meta: { color: colors.muted, fontSize: 13, marginBottom: 4 },
  currentRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  smallLabel: { color: colors.muted, fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  currentText: { color: colors.text, fontSize: 17, fontWeight: "700", marginTop: 3 },
  latestWrap: { alignItems: "center", gap: 3 },
  latestCircle: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  latestText: { fontSize: 17, fontWeight: "800" },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 3 },
  scoreSlot: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  scoreSlotSelected: { borderWidth: 3, borderColor: colors.accent },
  scoreSlotText: { fontSize: 14, fontWeight: "800" },
  failedMark: { position: "absolute", right: 3, top: 1, color: colors.error, fontSize: 11, fontWeight: "800" },
  endNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  endNavButton: { minHeight: 42, minWidth: 66, justifyContent: "center" },
  endNavText: { color: colors.accent, fontSize: 13, fontWeight: "700" },
  endNavMiddle: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  disabled: { opacity: .35 },
  totals: { flexDirection: "row", justifyContent: "space-between", gap: 6, paddingVertical: 9, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  metric: { alignItems: "center", flex: 1 },
  metricValue: { color: colors.text, fontSize: 18, fontWeight: "800", marginTop: 3 },
  editActions: { flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: 8 },
  corrections: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  correction: { minWidth: 42, minHeight: 42, paddingHorizontal: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  correctionSelected: { borderColor: colors.accent, backgroundColor: colors.soft },
  correctionText: { color: colors.text, fontWeight: "700" },
  editButton: { minHeight: 44, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderRadius: 9, borderWidth: 1, borderColor: colors.accent },
  editText: { color: colors.accent, fontWeight: "700" },
  deleteButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 9, borderWidth: 1, borderColor: colors.border },
  warning: { color: colors.error, fontSize: 13, lineHeight: 18 },
  insightsButton: { minHeight: 44, alignItems: "center", justifyContent: "center", borderColor: colors.border, borderWidth: 1, borderRadius: 10, marginTop: 5 },
  insightsButtonText: { color: colors.accent, fontWeight: "700" },
  history: { marginTop: 7, borderTopWidth: 1, borderColor: colors.border, paddingTop: 13 },
  historyTitle: { color: colors.text, fontSize: 16, fontWeight: "700", marginBottom: 6 },
  historyRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingRight: 24, borderBottomWidth: 1, borderColor: colors.border },
  historyCurrent: { backgroundColor: colors.soft },
  historyLabel: { color: colors.text, fontSize: 11, fontWeight: "800" },
  historyTotal: { color: colors.text, fontSize: 12, fontWeight: "700" },
  historyX: { color: colors.accent, fontSize: 11, fontWeight: "700" },
  historyScores: { flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 5 },
  historyScoreValue: { flexShrink: 0 },
  historyScore: { color: colors.text, fontSize: 12, fontWeight: "600", paddingVertical: 5 },
  historySelected: { color: colors.accent, textDecorationLine: "underline", fontWeight: "800" },
  state: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  configurePage: { flex: 1, backgroundColor: colors.background },
  configureContent: { padding: 24, paddingBottom: 24, gap: 12 },
  configureTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  configureTitle: { color: colors.text, fontSize: 25, fontWeight: "800" },
  closeButton: { minWidth: 56, minHeight: 44, alignItems: "center", justifyContent: "center" },
  closeText: { color: colors.accent, fontWeight: "700" },
  configureLabel: { color: colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: .6, marginTop: 6 },
  configureInput: { minHeight: 48, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.control, borderRadius: 9, paddingHorizontal: 12, color: colors.text, fontSize: 16 },
  configureChoices: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  configureChoice: { minHeight: 42, justifyContent: "center", paddingHorizontal: 11, borderWidth: 1, borderColor: colors.border, borderRadius: 9 },
  configureChoiceActive: { borderColor: colors.accent, backgroundColor: colors.accent },
  configureChoiceText: { color: colors.text, fontWeight: "600" },
  configureChoiceTextActive: { color: colors.onPrimary },
  configureNote: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  configureError: { color: colors.error, fontSize: 13 },
  configureSave: { minHeight: 52, backgroundColor: colors.accent, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  configureSaveText: { color: colors.onPrimary, fontWeight: "800", fontSize: 16 },
  message: { color: colors.muted, fontSize: 14 },
  retry: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 22, paddingVertical: 14 },
  retryText: { color: colors.onPrimary, fontWeight: "700" },
}));
