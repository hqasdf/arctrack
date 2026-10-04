import { targetFaceLabel } from "@arc-track/core/analytics";
import { DIVISIONS, type Division } from "@arc-track/core/presets";
import {
  arrowKey, endTotal, roundTotal, xCount,
  type ArrowEntry, type Plot, type RoundDraft, type ScoreLabel, type SessionDraft,
} from "@arc-track/core/scoring";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { deleteArrowRecord, readRoundEndIds, saveArrowRecord } from "../../../src/arrow-writes";
import { useAuth } from "../../../src/auth";
import { ArcIcon } from "../../../src/icons";
import { GroupingExportButton } from "../../../src/grouping-export";
import { NativeTarget } from "../../../src/native-target";
import { RoundGroupPosition, RoundInsights } from "../../../src/round-insights";
import { canConfigureRound, type RoundSettingsInput } from "../../../src/round-update-model";
import {
  applyArrowSaveResult, clearArrowPlot, correctArrowScore, firstEmptySlot, latestScore, plotCurrentArrow, previousPlottedArrow, restoreDeletedArrow,
  type ArrowSlot,
} from "../../../src/scoring-state";
import { readOwnRound } from "../../../src/sessions";
import { colors, PAGE_TOP_SPACING } from "../../../src/theme";
import { roundUpdateEnabled, updateMobileRoundSettings } from "../../../src/writes";

type LoadedRound = { session: SessionDraft; round: RoundDraft };
const CORRECTION_SCORES: ScoreLabel[] = ["X", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "M"];

function scoreText(score: ScoreLabel | null) { return score === "X" ? "10X" : score ?? "—"; }

function scoreColours(score: ScoreLabel | null) {
  if (score === "X" || score === "10" || score === "9") return { backgroundColor: "#f5cf3d", color: "#332b17" };
  if (score === "8" || score === "7") return { backgroundColor: "#e65a55", color: "#fff" };
  if (score === "6" || score === "5") return { backgroundColor: "#429aca", color: "#fff" };
  if (score === "4" || score === "3") return { backgroundColor: "#262321", color: "#fff" };
  if (score === "2" || score === "1") return { backgroundColor: "#f3f0e9", color: "#332c27" };
  if (score === "M") return { backgroundColor: "#e9e4dc", color: "#594e46" };
  return { backgroundColor: "#fff", color: colors.muted };
}

export default function ScoreRoundScreen() {
  const { roundId } = useLocalSearchParams<{ roundId: string }>();
  const { user } = useAuth();
  const [loaded, setLoaded] = useState<LoadedRound | null>(null);
  const [arrows, setArrows] = useState<ArrowEntry[]>([]);
  const arrowsRef = useRef<ArrowEntry[]>([]);
  const [slot, setSlot] = useState<ArrowSlot>({ end: 1, arrow: 1 });
  const slotRef = useRef<ArrowSlot>({ end: 1, arrow: 1 });
  const [latestPlotKey, setLatestPlotKey] = useState<string | null>(null);
  const endIds = useRef(new Map<number, string>());
  const persistedIds = useRef(new Map<string, string>());
  const versions = useRef(new Map<string, number>());
  const queues = useRef(new Map<string, Promise<void>>());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showInsights, setShowInsights] = useState(false);
  const [showCorrection, setShowCorrection] = useState(false);
  const [showConfigure, setShowConfigure] = useState(false);
  const [configureDraft, setConfigureDraft] = useState<RoundSettingsInput | null>(null);
  const [configureError, setConfigureError] = useState<string | null>(null);
  const [savingConfigure, setSavingConfigure] = useState(false);

  const load = useCallback(async (preferredSlot?: ArrowSlot) => {
    if (!user || !roundId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await readOwnRound(user.id, roundId);
      if (!result) { setLoaded(null); return; }
      const plannedEnds = await readRoundEndIds(roundId);
      if (plannedEnds.size !== result.round.ends) throw new Error("The planned Ends could not be loaded.");
      endIds.current = plannedEnds;
      persistedIds.current = new Map(result.round.arrows.map((arrow) => [arrowKey(arrow.end, arrow.arrow), arrow.id]));
      versions.current.clear();
      queues.current.clear();
      arrowsRef.current = result.round.arrows;
      setArrows(result.round.arrows);
      const defaultSlot = firstEmptySlot(result.round, result.round.arrows);
      selectSlot(preferredSlot && preferredSlot.end <= result.round.ends ? preferredSlot : defaultSlot);
      setLatestPlotKey(null);
      setLoaded(result);
    } catch {
      setLoadError("This Round could not be loaded. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [user, roundId]);

  useEffect(() => { void load(); }, [load]);

  function commitArrows(next: ArrowEntry[]) { arrowsRef.current = next; setArrows(next); }
  function selectSlot(next: ArrowSlot) { slotRef.current = next; setSlot(next); }
  function replaceEntry(key: string, change: (entry: ArrowEntry) => ArrowEntry) {
    commitArrows(arrowsRef.current.map((item) => arrowKey(item.end, item.arrow) === key ? change(item) : item));
  }
  function nextVersion(key: string) {
    const version = (versions.current.get(key) ?? 0) + 1;
    versions.current.set(key, version);
    return version;
  }
  function enqueue(key: string, task: () => Promise<void>) {
    const previous = queues.current.get(key) ?? Promise.resolve();
    const job = previous.catch(() => {}).then(task);
    queues.current.set(key, job);
    void job.finally(() => { if (queues.current.get(key) === job) queues.current.delete(key); });
  }
  function persist(entry: ArrowEntry) {
    const key = arrowKey(entry.end, entry.arrow);
    const version = nextVersion(key);
    enqueue(key, async () => {
      try {
        const endId = endIds.current.get(entry.end);
        if (!endId) throw new Error("The planned End could not be found.");
        const id = await saveArrowRecord(entry, endId, persistedIds.current.get(key));
        persistedIds.current.set(key, id);
        commitArrows(applyArrowSaveResult(arrowsRef.current, key, version, versions.current.get(key) ?? 0, { id }));
      } catch {
        commitArrows(applyArrowSaveResult(arrowsRef.current, key, version, versions.current.get(key) ?? 0, { failed: true }));
      }
    });
  }
  function handlePlot(plot: Plot) {
    if (!loaded) return;
    const current = slotRef.current;
    const result = plotCurrentArrow(loaded.round, arrowsRef.current, current, plot);
    commitArrows(result.arrows);
    selectSlot(result.slot);
    setLatestPlotKey(arrowKey(current.end, current.arrow));
    setActionError(null);
    persist(result.entry);
    setShowCorrection(false);
  }
  function correctScore(score: ScoreLabel) {
    const current = slotRef.current;
    const selected = arrowsRef.current.find((item) => item.end === current.end && item.arrow === current.arrow);
    if (!selected) return;
    const entry = correctArrowScore(selected, score);
    replaceEntry(arrowKey(entry.end, entry.arrow), () => entry);
    persist(entry);
    setShowCorrection(false);
  }
  function clearMarker() {
    const current = slotRef.current;
    const selected = arrowsRef.current.find((item) => item.end === current.end && item.arrow === current.arrow);
    if (!selected?.plot) return;
    const entry = clearArrowPlot(selected);
    replaceEntry(arrowKey(entry.end, entry.arrow), () => entry);
    persist(entry);
  }
  function retrySelected() {
    const current = slotRef.current;
    const selected = arrowsRef.current.find((item) => item.end === current.end && item.arrow === current.arrow);
    if (!selected || selected.syncState !== "failed") return;
    const entry: ArrowEntry = { ...selected, syncState: "saving" };
    replaceEntry(arrowKey(entry.end, entry.arrow), () => entry);
    persist(entry);
  }
  function removePrevious() {
    if (!loaded) return;
    const removed = previousPlottedArrow(arrowsRef.current, slotRef.current);
    if (!removed) return;
    const key = arrowKey(removed.end, removed.arrow);
    const version = nextVersion(key);
    commitArrows(arrowsRef.current.filter((item) => arrowKey(item.end, item.arrow) !== key));
    selectSlot({ end: removed.end, arrow: removed.arrow });
    setActionError(null);
    enqueue(key, async () => {
      const id = persistedIds.current.get(key);
      if (!id) return;
      try {
        const endId = endIds.current.get(removed.end);
        if (!endId) throw new Error("The planned End could not be found.");
        await deleteArrowRecord(id, endId);
        persistedIds.current.delete(key);
      } catch {
        if (versions.current.get(key) === version) {
          commitArrows(restoreDeletedArrow(arrowsRef.current, removed));
          selectSlot({ end: removed.end, arrow: removed.arrow });
          setActionError("The Arrow could not be deleted. Try again.");
        }
      }
    });
  }

  function openConfigure() {
    if (!loaded || arrowsRef.current.length > 0) return;
    setConfigureDraft({ name: loaded.round.name, division: loaded.round.division, distanceMetres: loaded.round.distanceMetres,
      faceDiameterCm: loaded.round.faceDiameterCm, plannedEnds: loaded.round.ends });
    setConfigureError(null);
    setShowConfigure(true);
  }

  async function saveConfigure() {
    if (!loaded || !configureDraft || !roundUpdateEnabled || arrowsRef.current.length > 0 || savingConfigure) return;
    setSavingConfigure(true);
    setConfigureError(null);
    try {
      await updateMobileRoundSettings(loaded.round.id, loaded.round.ends, configureDraft);
      setShowConfigure(false);
      await load(slotRef.current);
    } catch (issue) {
      setConfigureError(issue instanceof Error ? issue.message : "Round settings could not be saved.");
    } finally {
      setSavingConfigure(false);
    }
  }

  if (loading) return <View style={styles.state}><ActivityIndicator color={colors.accent} accessibilityLabel="Loading scoring Round" /></View>;
  if (loadError) return <View style={styles.state}><Text style={styles.message}>{loadError}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable></View>;
  if (!loaded) return <View style={styles.state}><Text style={styles.message}>Round not found or you do not have access.</Text></View>;

  const round = loaded.round;
  const selected = arrows.find((item) => item.end === slot.end && item.arrow === slot.arrow) ?? null;
  const previous = previousPlottedArrow(arrows, slot);
  const latest = latestScore(arrows, latestPlotKey);
  const failedCount = arrows.filter((item) => item.syncState === "failed").length;
  const plottedCount = arrows.filter((item) => item.plot !== null).length;
  const enteredEnds = Array.from(new Set(arrows.map((item) => item.end))).sort((a, b) => a - b);


  return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <Text style={styles.eyebrow}>{loaded.session.title} · ROUND {round.roundNumber}</Text>
    <View style={styles.titleRow}><Text style={styles.title}>{round.name}</Text>
      {canConfigureRound({ ...round, arrows }) ? <Pressable accessibilityRole="button" accessibilityLabel="Configure Round settings" onPress={openConfigure} style={styles.configureButton}>
        <ArcIcon name="settings" color={colors.accent} size={21} />
      </Pressable> : null}
    </View>
    <Text style={styles.meta}>{round.division} · {round.distanceMetres} m · {targetFaceLabel(round)}</Text>

    <NativeTarget arrows={arrows} selectedId={selected?.id ?? null} currentEnd={slot.end}
      faceType={round.faceType} faceDiameterCm={round.faceDiameterCm} onPlot={handlePlot} />

    <RoundGroupPosition round={{ ...round, arrows }} />
    <GroupingExportButton round={{ ...round, arrows }} context={`${loaded.session.title} · ${loaded.session.date}`} />

    <View style={styles.currentRow}>
      <View><Text style={styles.smallLabel}>CURRENT</Text><Text style={styles.currentText}>End {slot.end} · Arrow {slot.arrow}</Text></View>
      <View style={styles.latestWrap}><View style={[styles.latestCircle, { backgroundColor: scoreColours(latest).backgroundColor }]}>
        <Text style={[styles.latestText, { color: scoreColours(latest).color }]}>{scoreText(latest)}</Text>
      </View><Text style={styles.smallLabel}>LATEST SCORE</Text></View>
    </View>

    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scoreRow} accessibilityLabel={`Scores in End ${slot.end}`}>
      {Array.from({ length: round.arrowsPerEnd }, (_, index) => {
        const arrow = arrows.find((item) => item.end === slot.end && item.arrow === index + 1);
        const active = slot.arrow === index + 1;
        const palette = scoreColours(arrow?.score ?? null);
        return <Pressable key={index} accessibilityRole="button" accessibilityLabel={`Arrow ${index + 1}, ${arrow ? scoreText(arrow.score) : "empty"}${arrow?.syncState === "failed" ? ", save failed" : ""}`}
          accessibilityState={{ selected: active }} onPress={() => selectSlot({ end: slot.end, arrow: index + 1 })}
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
          <View style={styles.historyScores}>{endArrows.map((arrow) => <Pressable key={arrow.arrow}
            accessibilityRole="button" accessibilityLabel={`End ${end}, Arrow ${arrow.arrow}, ${scoreText(arrow.score)}${arrow.syncState === "failed" ? ", save failed" : ""}`}
            onPress={() => selectSlot({ end, arrow: arrow.arrow })}>
            <Text style={[styles.historyScore, selected?.end === end && selected.arrow === arrow.arrow && styles.historySelected]}>{scoreText(arrow.score)}{arrow.syncState === "failed" ? "!" : ""}</Text>
          </Pressable>)}</View>
        </View>;
      })}
    </View>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: showInsights }}
      onPress={() => setShowInsights((value) => !value)} style={styles.insightsButton}>
      <Text style={styles.insightsButtonText}>{showInsights ? "Hide Round Insights" : "Round Insights"}</Text>
    </Pressable>
    {showInsights ? <RoundInsights round={{ ...round, arrows }} showGroupPosition={false} /> : null}
    <Modal visible={showConfigure} animationType="slide" onRequestClose={() => setShowConfigure(false)}>
      <ScrollView style={styles.configurePage} contentContainerStyle={styles.configureContent} keyboardShouldPersistTaps="handled">
        <View style={styles.configureTitleRow}><Text style={styles.configureTitle}>Configure Round</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close Round settings" onPress={() => setShowConfigure(false)} style={styles.closeButton}><Text style={styles.closeText}>Close</Text></Pressable>
        </View>
        {configureDraft ? <>
          <Text style={styles.configureLabel}>ROUND NAME</Text>
          <TextInput accessibilityLabel="Round name" value={configureDraft.name} maxLength={80}
            onChangeText={(name) => setConfigureDraft((draft) => draft ? { ...draft, name } : draft)} style={styles.configureInput} />
          <Text style={styles.configureLabel}>DIVISION</Text>
          <View style={styles.configureChoices}>{DIVISIONS.map((division) => <Pressable key={division} accessibilityRole="button"
            accessibilityState={{ selected: configureDraft.division === division }} onPress={() => setConfigureDraft((draft) => draft ? { ...draft, division: division as Division } : draft)}
            style={[styles.configureChoice, configureDraft.division === division && styles.configureChoiceActive]}>
            <Text style={[styles.configureChoiceText, configureDraft.division === division && styles.configureChoiceTextActive]}>{division}</Text></Pressable>)}</View>
          {([["distanceMetres", "DISTANCE (M)"], ["faceDiameterCm", "FACE DIAMETER (CM)"], ["plannedEnds", "PLANNED ENDS"]] as const).map(([key, label]) => (
            <View key={key}><Text style={styles.configureLabel}>{label}</Text><TextInput accessibilityLabel={label} keyboardType="number-pad" selectTextOnFocus
              value={String(configureDraft[key])} onChangeText={(value) => setConfigureDraft((draft) => draft ? { ...draft, [key]: value === "" ? 0 : Number(value) } : draft)}
              style={styles.configureInput} /></View>))}
          <Text style={styles.configureNote}>Target layout and arrows per End stay fixed. Planned Ends can increase, not decrease.</Text>
          {!roundUpdateEnabled ? <Text style={styles.configureNote}>Saving settings is unavailable until the owner Round-update backend is enabled.</Text> : null}
          {configureError ? <Text accessibilityRole="alert" style={styles.configureError}>{configureError}</Text> : null}
          <Pressable accessibilityRole="button" disabled={!roundUpdateEnabled || savingConfigure} onPress={() => void saveConfigure()}
            style={[styles.configureSave, (!roundUpdateEnabled || savingConfigure) && styles.disabled]}>
            {savingConfigure ? <ActivityIndicator color="#fff" /> : <Text style={styles.configureSaveText}>Save settings</Text>}
          </Pressable>
        </> : null}
      </ScrollView>
    </Modal>
  </ScrollView>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <View style={styles.metric}><Text style={styles.smallLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingTop: 16 + PAGE_TOP_SPACING, paddingBottom: 42, gap: 11 },
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
  correctionSelected: { borderColor: colors.accent, backgroundColor: "#e7efeb" },
  correctionText: { color: colors.text, fontWeight: "700" },
  editButton: { minHeight: 44, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderRadius: 9, borderWidth: 1, borderColor: colors.accent },
  editText: { color: colors.accent, fontWeight: "700" },
  deleteButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 9, borderWidth: 1, borderColor: colors.border },
  warning: { color: colors.error, fontSize: 13, lineHeight: 18 },
  insightsButton: { minHeight: 44, alignItems: "center", justifyContent: "center", borderColor: colors.border, borderWidth: 1, borderRadius: 10, marginTop: 5 },
  insightsButtonText: { color: colors.accent, fontWeight: "700" },
  history: { marginTop: 7, borderTopWidth: 1, borderColor: colors.border, paddingTop: 13 },
  historyTitle: { color: colors.text, fontSize: 16, fontWeight: "700", marginBottom: 6 },
  historyRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.border },
  historyCurrent: { backgroundColor: "#edf2ed" },
  historyLabel: { color: colors.text, fontSize: 11, fontWeight: "800" },
  historyTotal: { color: colors.text, fontSize: 12, fontWeight: "700" },
  historyX: { color: colors.accent, fontSize: 11, fontWeight: "700" },
  historyScores: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 5 },
  historyScore: { color: colors.text, fontSize: 12, fontWeight: "600", paddingVertical: 5 },
  historySelected: { color: colors.accent, textDecorationLine: "underline", fontWeight: "800" },
  state: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  configurePage: { flex: 1, backgroundColor: colors.background },
  configureContent: { padding: 24, paddingTop: 56 + PAGE_TOP_SPACING, paddingBottom: 40, gap: 12 },
  configureTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  configureTitle: { color: colors.text, fontSize: 25, fontWeight: "800" },
  closeButton: { minWidth: 56, minHeight: 44, alignItems: "center", justifyContent: "center" },
  closeText: { color: colors.accent, fontWeight: "700" },
  configureLabel: { color: colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: .6, marginTop: 6 },
  configureInput: { minHeight: 48, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 9, paddingHorizontal: 12, color: colors.text, fontSize: 16 },
  configureChoices: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  configureChoice: { minHeight: 42, justifyContent: "center", paddingHorizontal: 11, borderWidth: 1, borderColor: colors.border, borderRadius: 9 },
  configureChoiceActive: { borderColor: colors.accent, backgroundColor: colors.accent },
  configureChoiceText: { color: colors.text, fontWeight: "600" },
  configureChoiceTextActive: { color: "#fff" },
  configureNote: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  configureError: { color: colors.error, fontSize: 13 },
  configureSave: { minHeight: 52, backgroundColor: colors.accent, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  configureSaveText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  message: { color: colors.muted, fontSize: 14 },
  retry: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 22, paddingVertical: 14 },
  retryText: { color: "#fff", fontWeight: "700" },
});
