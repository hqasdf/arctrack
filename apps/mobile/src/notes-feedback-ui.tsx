import { parseTechniqueTags, type CoachFeedback, type SessionNote } from "@arc-track/core/notes-feedback";
import { useFocusEffect, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useAppearance } from "./appearance";
import {
  createNotesRequestGuard, deleteMobileCoachFeedback, deleteMobileSessionNote, readMobileFeedback,
  prepareMobileFeedbackCreation, readMobileSessionNote, saveMobileCoachFeedback, saveMobileSessionNote, type FeedbackCursor, type MobileFeedbackCreation,
} from "./notes-feedback";

const message = (issue: unknown) => issue instanceof Error ? issue.message : "This request could not be completed. Check your connection and retry.";
const date = (value: string) => new Date(value).toLocaleString();

function useNotesStyles(coach: boolean) {
  const appearance = useAppearance();
  const colors = coach ? { ...appearance.coachColors, control: appearance.coachColors.raised } : appearance.colors;
  return { colors, styles: StyleSheet.create({
    section: { padding: 16, marginVertical: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 14, gap: 12 },
    heading: { color: colors.text, fontSize: 21, fontWeight: "700" }, text: { color: colors.text, fontSize: 15, lineHeight: 23 },
    muted: { color: colors.muted, fontSize: 13, lineHeight: 20 }, error: { color: colors.error, fontSize: 14, lineHeight: 21 },
    input: { color: colors.text, backgroundColor: colors.control, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 9, padding: 12, minHeight: 48, fontSize: 15 },
    body: { minHeight: 150, textAlignVertical: "top" }, actions: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
    button: { minHeight: 44, justifyContent: "center", paddingHorizontal: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
    link: { color: colors.accent, fontWeight: "700", fontSize: 14 }, entry: { gap: 7, paddingVertical: 13, borderTopWidth: 1, borderColor: colors.border },
  }) };
}

/** Native stack back, gesture, replace and parent removal all require an explicit discard. */
function useUnsavedNotes(dirty: boolean, busy: boolean, discard: () => void) {
  const navigation = useNavigation();
  const pending = useRef(false);
  usePreventRemove(dirty || busy, ({ data }) => {
    if (busy) { Alert.alert("Saving changes", "Wait for this request to finish before leaving."); return; }
    if (pending.current) return;
    pending.current = true;
    Alert.alert("Discard unsaved changes?", "Your notes or feedback draft has not been confirmed as saved.", [
      { text: "Keep editing", style: "cancel", onPress: () => { pending.current = false; } },
      { text: "Discard", style: "destructive", onPress: () => { pending.current = false; discard(); navigation.dispatch(data.action); } },
    ], { cancelable: false });
  });
}

function Action({ children, onPress, disabled = false, coach = false }: { children: string; onPress: () => void; disabled?: boolean; coach?: boolean }) {
  const { styles } = useNotesStyles(coach);
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && { opacity: .5 }]}><Text style={styles.link}>{children}</Text></Pressable>;
}

export function MobileSessionNotes({ userId, sessionId, coach }: { userId: string; sessionId: string; coach?: { organizationId: string; athleteId: string } }) {
  const coachOrganizationId = coach?.organizationId, coachAthleteId = coach?.athleteId;
  const { colors, styles } = useNotesStyles(!!coach);
  const [note, setNote] = useState<SessionNote | null>(null);
  const [latest, setLatest] = useState<SessionNote | null | undefined>(undefined);
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [editing, setEditing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requests = useRef(createNotesRequestGuard());
  const writing = useRef(false), inFlight = useRef(false), mounted = useRef(true);
  const dirty = editing && (body !== (note?.body ?? "") || tags !== (note?.techniqueTags.join(", ") ?? ""));
  useEffect(() => { mounted.current = true; const guard = requests.current; return () => { mounted.current = false; guard.invalidate(); }; }, []);
  const load = useCallback(async () => {
    if (inFlight.current) return;
    const current = requests.current.begin();
    setLoading(true); setError(null);
    try {
      const result = await readMobileSessionNote(userId, sessionId, coachOrganizationId && coachAthleteId ? { organizationId: coachOrganizationId, athleteId: coachAthleteId } : undefined);
      if (!current()) return;
      // Refresh persisted data without replacing an open draft or its original concurrency token.
      if (!writing.current) { setNote(result); setBody(result?.body ?? ""); setTags(result?.techniqueTags.join(", ") ?? ""); }
      else setLatest(result);
      setLoaded(true);
    } catch (issue) { if (current()) setError(message(issue)); }
    finally { if (current()) setLoading(false); }
  }, [userId, sessionId, coachOrganizationId, coachAthleteId]);
  useFocusEffect(useCallback(() => { void load(); return () => requests.current.invalidate(); }, [load]));
  function cancel() {
    const saved = latest === undefined ? note : latest;
    setNote(saved); setEditing(false); writing.current = false; setBody(saved?.body ?? ""); setTags(saved?.techniqueTags.join(", ") ?? ""); setError(null); setLatest(undefined);
  }
  useUnsavedNotes(dirty, busy, cancel);
  async function save() {
    if (inFlight.current || coach) return;
    inFlight.current = true; setBusy(true); setError(null); requests.current.invalidate();
    try {
      const saved = await saveMobileSessionNote(userId, sessionId, body, parseTechniqueTags(tags), note?.updatedAt ?? null);
      if (!mounted.current) return;
      setNote(saved); setBody(saved.body); setTags(saved.techniqueTags.join(", ")); setEditing(false); setLatest(undefined); writing.current = false; setLoading(false);
    } catch (issue) { if (mounted.current) setError(message(issue)); }
    finally { inFlight.current = false; if (mounted.current) { setBusy(false); setLoading(false); } }
  }
  function remove() {
    const existing = note;
    if (!existing || coach || inFlight.current) return;
    Alert.alert("Delete Session Notes?", "These athlete notes will be removed for you and authorised coaches.", [
      { text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: async () => {
        if (inFlight.current) return;
        inFlight.current = true; setBusy(true); setError(null); requests.current.invalidate();
        try { await deleteMobileSessionNote(userId, sessionId, existing.updatedAt); if (mounted.current) { setNote(null); setBody(""); setTags(""); setEditing(false); writing.current = false; } }
        catch (issue) { if (mounted.current) setError(message(issue)); }
        finally { inFlight.current = false; if (mounted.current) { setBusy(false); setLoading(false); } }
      } },
    ]);
  }
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>Session Notes</Text>
    <Text style={styles.muted}>{coach ? "Athlete-authored notes. Read only for coaches." : "Your session journal. Authorised coaches can read these notes."}</Text>
    {loading ? <ActivityIndicator color={colors.accent} accessibilityLabel="Loading Session Notes"/> : null}
    {error ? <View style={{ gap: 8 }}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Action coach={!!coach} disabled={busy} onPress={() => void load()}>Retry / refresh saved note</Action></View> : null}
    {loaded && editing && !coach ? <>
      <Text style={styles.muted}>Optional prompts: Technical focus; observations; what went well; areas to improve; next-session focus.</Text>
      <TextInput accessibilityLabel="Session Notes body" multiline editable={!busy} value={body} onChangeText={setBody} style={[styles.input, styles.body]} placeholder="Write your Session Notes" placeholderTextColor={colors.muted} selectionColor={colors.accent}/>
      <Text style={styles.muted}>{Array.from(body).length}/4,000 characters</Text>
      <TextInput accessibilityLabel="Technique tags, separated by commas" editable={!busy} value={tags} onChangeText={setTags} style={styles.input} placeholder="Technique tags, separated by commas (optional)" placeholderTextColor={colors.muted} selectionColor={colors.accent}/>
      <Text style={styles.muted}>Up to 8 tags, 40 characters each. Clear a tag to remove it.</Text>
      {latest !== undefined && latest?.updatedAt !== note?.updatedAt ? <View style={{ gap: 8 }}>
        <Text style={styles.muted}>Latest saved version: {latest?.body ?? "This note was deleted on another device."}</Text>
        <Action disabled={busy} onPress={() => { setNote(latest); setLatest(undefined); setError(null); }}>Use latest version as edit baseline</Action>
        <Text style={styles.muted}>Your draft stays in the editor. Review both versions before saving.</Text>
      </View> : null}
      <View style={styles.actions}><Action disabled={busy} onPress={() => void save()}>{busy ? "Saving…" : "Save notes"}</Action><Action disabled={busy} onPress={cancel}>Cancel</Action></View>
    </> : loaded && !error ? <>
      <Text style={note ? styles.text : styles.muted}>{note?.body ?? "No Session Notes yet."}</Text>
      {note?.techniqueTags.length ? <Text style={styles.muted}>Technique: {note.techniqueTags.join(" · ")}</Text> : null}
      {note ? <Text style={styles.muted}>Updated {date(note.updatedAt)}</Text> : null}
      {!coach ? <View style={styles.actions}><Action disabled={busy || loading || !!error} onPress={() => { writing.current = true; setEditing(true); }}>{note ? "Edit notes" : "Add notes"}</Action>{note ? <Action disabled={busy || loading} onPress={remove}>Delete notes</Action> : null}</View> : null}
    </> : null}
  </View>;
}

type FeedbackProps = { userId: string; organizationId?: string; athleteId?: string; sessionId?: string };

export function MobileSessionFeedbackHistory(props: Omit<FeedbackProps, "sessionId">) {
  const [open, setOpen] = useState(false);
  const { styles } = useNotesStyles(!!props.organizationId);
  return <View><Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)}><Text style={styles.link}>Session Feedback history</Text></Pressable>{open ? <MobileCoachFeedback {...props}/> : null}</View>;
}

export function MobileCoachFeedback(props: FeedbackProps) {
  const { userId, organizationId, athleteId, sessionId } = props;
  const isCoach = !!organizationId && !!athleteId;
  const { colors, styles } = useNotesStyles(isCoach);
  const [entries, setEntries] = useState<CoachFeedback[]>([]);
  const [next, setNext] = useState<FeedbackCursor | null>(null);
  const [loading, setLoading] = useState(false), [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null), [formError, setFormError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false), [target, setTarget] = useState<CoachFeedback | null>(null);
  const [body, setBody] = useState(""), [busy, setBusy] = useState(false);
  const [hasPendingCreation, setHasPendingCreation] = useState(false);
  const creation = useRef<MobileFeedbackCreation | null>(null);
  const requests = useRef(createNotesRequestGuard()), inFlight = useRef(false), paging = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; const guard = requests.current; return () => { mounted.current = false; guard.invalidate(); }; }, []);
  const load = useCallback(async (before: FeedbackCursor | null = null) => {
    if (before && paging.current) return;
    paging.current = true;
    const current = requests.current.begin(); setLoading(true); setError(null);
    try {
      const page = await readMobileFeedback(userId, { organizationId, athleteId, sessionId }, before);
      if (!current()) return;
      setEntries((previous) => before ? [...previous, ...page.entries.filter((entry) => !previous.some((item) => item.id === entry.id))] : page.entries);
      setNext(page.next); setLoaded(true);
    } catch (issue) { if (current()) setError(message(issue)); }
    finally { if (current()) { setLoading(false); paging.current = false; } }
  }, [userId, organizationId, athleteId, sessionId]);
  useFocusEffect(useCallback(() => { if (!inFlight.current) void load(); return () => { requests.current.invalidate(); paging.current = false; }; }, [load]));
  function cancel() { creation.current = null; setHasPendingCreation(false); setEditing(false); setTarget(null); setBody(""); setFormError(null); }
  function confirmCancel() {
    if (!creation.current) { cancel(); return; }
    Alert.alert("Cancel this submission?", "The earlier request may already have saved feedback. Cancel closes this draft. Refresh the history before creating a separate entry.", [
      { text: "Keep draft", style: "cancel" }, { text: "Cancel draft", style: "destructive", onPress: cancel },
    ]);
  }
  const dirty = editing && body !== (target?.body ?? "");
  const latestTarget = target ? entries.find((entry) => entry.id === target.id) : undefined;
  useUnsavedNotes(dirty || hasPendingCreation, busy, cancel);
  function start(entry: CoachFeedback | null) {
    if (dirty || creation.current) { Alert.alert("Unsaved feedback", "Save or cancel your current draft before editing another entry."); return; }
    creation.current = null; setTarget(entry); setBody(entry?.body ?? ""); setEditing(true); setFormError(null);
  }
  async function save() {
    if (!isCoach || inFlight.current || (!target && !sessionId)) return;
    inFlight.current = true; setBusy(true); setFormError(null);
    try {
      if (!target) { if (!sessionId) throw new Error("Open a Session before creating coach feedback."); creation.current = prepareMobileFeedbackCreation(userId, { organizationId, athleteId, sessionId }, body, creation.current); setHasPendingCreation(true); }
      await saveMobileCoachFeedback(userId, { organizationId, athleteId, sessionId }, body, target, target ? null : creation.current!.requestId);
      if (!mounted.current) return;
      cancel(); await load();
    } catch (issue) { if (mounted.current) setFormError(message(issue)); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  function remove(entry: CoachFeedback) {
    if (!organizationId || inFlight.current) return;
    Alert.alert("Delete shared feedback?", "The athlete will also lose access to this entry. This cannot be undone.", [
      { text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: async () => {
        if (inFlight.current) return;
        inFlight.current = true; setBusy(true); setFormError(null);
        try { await deleteMobileCoachFeedback(userId, organizationId, entry); if (mounted.current) { if (target?.id === entry.id) cancel(); await load(); } }
        catch (issue) { if (mounted.current) setFormError(message(issue)); }
        finally { inFlight.current = false; if (mounted.current) setBusy(false); }
      } },
    ]);
  }
  const history = <>
    {loading ? <ActivityIndicator color={colors.accent} accessibilityLabel="Loading Coach Feedback"/> : null}
    {error ? <><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Action coach={isCoach} disabled={loading} onPress={() => void load()}>Retry feedback</Action></> : null}
    {loaded && !entries.length && !error ? <Text style={styles.muted}>{isCoach ? "You have not shared feedback in this view yet." : "No Coach Feedback in this view yet."}</Text> : null}
    {!error ? entries.map((entry) => <View key={entry.id} style={styles.entry}>
      <Text style={styles.link}>{entry.authorDisplayName || (entry.authorUserId ? "Coach" : "Former coach")}</Text>
      <Text style={styles.muted}>{entry.sessionId ? "Session-specific feedback" : "Session-specific feedback · deleted session"}{entry.organizationId ? "" : " · Organisation unavailable"}</Text>
      <Text style={styles.text}>{entry.body}</Text>
      <Text style={styles.muted}>Created {date(entry.createdAt)}{entry.updatedAt !== entry.createdAt ? ` · Edited ${date(entry.updatedAt)}` : ""}</Text>
      {isCoach && entry.canEdit && entry.authorUserId === userId && entry.organizationId === organizationId ? <View style={styles.actions}><Action coach={isCoach} disabled={busy} onPress={() => start(entry)}>Edit feedback</Action><Action coach={isCoach} disabled={busy || dirty} onPress={() => remove(entry)}>Delete feedback</Action></View> : null}
    </View>) : null}
    {next && !error ? <Action coach={isCoach} disabled={loading} onPress={() => void load(next)}>Load older feedback</Action> : null}
  </>;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>{sessionId ? "Coach Feedback" : "Session Feedback history"}</Text>
    <Text style={styles.muted}>{isCoach ? "All feedback is shared with this athlete. This view contains only Session feedback you authored in this organisation." : "Session feedback shared by your coaches, including retained feedback for deleted Sessions."}</Text>
      {isCoach && sessionId && !editing ? <Action coach={isCoach} disabled={busy || loading || !!error || !loaded} onPress={() => start(null)}>Add session feedback</Action> : null}
      {editing && isCoach ? <>
        <Text style={styles.muted}>{target ? "Edit shared feedback" : "New session feedback"} · Visible to the athlete</Text>
        <TextInput accessibilityLabel="Shared Coach Feedback body" multiline editable={!busy} value={body} onChangeText={setBody} style={[styles.input, styles.body]} placeholder="Share your coaching feedback" placeholderTextColor={colors.muted} selectionColor={colors.accent}/>
        <Text style={styles.muted}>{Array.from(body).length}/4,000 characters</Text>
        <Action coach={isCoach} disabled={busy || loading} onPress={() => void load()}>Refresh saved feedback</Action>
        {target && latestTarget && target.updatedAt !== latestTarget.updatedAt ? <>
          <Text style={styles.muted}>Latest saved version: {latestTarget.body}</Text>
          <Action coach={isCoach} disabled={busy} onPress={() => { setTarget(latestTarget); setFormError(null); }}>Use latest entry as edit baseline</Action>
          <Text style={styles.muted}>Your draft stays in the editor. Review both versions before saving.</Text>
        </> : null}
        <View style={styles.actions}><Action coach={isCoach} disabled={busy} onPress={() => void save()}>{busy ? "Saving…" : "Save feedback"}</Action><Action coach={isCoach} disabled={busy} onPress={confirmCancel}>Cancel</Action></View>
      </> : null}
      {formError ? <Text accessibilityRole="alert" style={styles.error}>{formError}</Text> : null}
      {history}
  </View>;
}
