"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { createFeedbackRequestId, notesFeedbackError, prepareFeedbackBody } from "@arc-track/core/notes-feedback";
import { loadCoachFeedback, removeCoachFeedback, saveCoachFeedback } from "./actions";
import { confirmDraftNavigation, useDraftGuard } from "./draft-guard";
import type { CoachFeedback, FeedbackContext } from "./types";
import styles from "./notes-feedback.module.css";

type CreationAttempt = { requestId: string; body: string; scope: string; context: FeedbackContext };
function contextScope(context: FeedbackContext) {
  return `${context.viewerId}:${context.organizationId ?? "own"}:${context.athleteUserId ?? "own"}:${context.sessionId ?? "all"}`;
}

export function CoachFeedbackPanel({ context, history = false }: { context: FeedbackContext; history?: boolean }) {
  const scope = contextScope(context);
  return <FeedbackEditor key={scope} context={context} history={history}/>;
}

function FeedbackEditor({ context, history }: { context: FeedbackContext; history: boolean }) {
  const fieldId = useId();
  const [entries, setEntries] = useState<CoachFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [editor, setEditor] = useState<"new" | CoachFeedback | null>(null);
  const [body, setBody] = useState("");
  const [creationAttempt, setCreationAttempt] = useState<CreationAttempt | null>(null);
  const attemptRef = useRef<CreationAttempt | null>(null);
  const [reload, setReload] = useState(0);
  const [pending, startTransition] = useTransition();
  const epoch = useRef(0);
  const busy = useRef(false);
  const [mutating, setMutating] = useState(false);
  const dirty = editor !== null && (body !== (editor === "new" ? "" : editor.body) || creationAttempt !== null);
  useDraftGuard(dirty || mutating);
  const { viewerId, organizationId, athleteUserId, sessionId } = context;
  const canAuthor = Boolean(organizationId && athleteUserId);
  const canCreate = canAuthor && Boolean(sessionId);
  useEffect(() => {
    const token = ++epoch.current;
    startTransition(async () => {
      await Promise.resolve();
      if (token !== epoch.current) return;
      setLoading(true); setLoadError(null);
      try {
        const result = await loadCoachFeedback({ viewerId, organizationId, athleteUserId, sessionId });
        if (token !== epoch.current) return;
        if (!result.ok) { setLoadError(result.message); return; }
        setEntries(result.data.entries); setHasMore(result.data.hasMore);
      } catch { if (token === epoch.current) setLoadError("Coach Feedback could not be loaded. Check your connection and try again."); }
      finally { if (token === epoch.current) setLoading(false); }
    });
    return () => { epoch.current = token + 1; };
  }, [viewerId, organizationId, athleteUserId, sessionId, reload]);

  function cancel() {
    if (!confirmDraftNavigation(dirty)) return;
    if (creationAttempt && !window.confirm("The previous submission may already have been saved. Cancel discards this draft and its retry identity; it does not delete any saved feedback. Continue?")) return;
    clearAttempt();
    setEditor(null); setBody(""); setError(null);
  }
  function clearAttempt() { attemptRef.current = null; setCreationAttempt(null); }
  function compose(entry: "new" | CoachFeedback) {
    if (busy.current || pending || !confirmDraftNavigation(dirty)) return;
    if (creationAttempt && !window.confirm("The previous submission may already exist. Discard its retry identity and open a different entry?")) return;
    clearAttempt();
    setEditor(entry); setBody(entry === "new" ? "" : entry.body); setError(null); setStatus("");
  }
  function startDifferentEntry() {
    if (busy.current || pending || !window.confirm("The previous submission may already have been saved. Check the feedback history before creating a different entry. Continue with the current text as a new entry?")) return;
    clearAttempt(); setError(null); setStatus("This is a new entry. Its next submission will receive a fresh request identifier.");
  }
  function save(retryOriginal = false) {
    if (!editor || busy.current || pending) return;
    let prepared;
    let attempt = attemptRef.current;
    try {
      if (editor === "new" && attempt) {
        if (attempt.scope !== contextScope(context)) throw new Error("The account or feedback context changed. Cancel and reopen the correct athlete before continuing.");
        if (!retryOriginal && body.trim() !== attempt.body) throw new Error("This submission is awaiting confirmation. Retry its original text or explicitly start a different entry with your changed text.");
        if (retryOriginal && body.trim() !== attempt.body && !window.confirm("Retry the original submitted text? If it is confirmed saved, your newer unsaved text in this composer will be discarded.")) return;
        prepared = attempt.body;
      } else {
        prepared = prepareFeedbackBody(body);
        if (editor === "new") {
          if (!window.crypto?.getRandomValues) throw new Error("Secure feedback submission is unavailable in this browser. Open Arc Track using HTTPS in a supported browser and try again.");
          const requestId = createFeedbackRequestId((length) => window.crypto.getRandomValues(new Uint8Array(length)));
          attempt = { requestId, body: prepared, scope: contextScope(context), context: { ...context } };
          attemptRef.current = attempt; setCreationAttempt(attempt);
        }
      }
    }
    catch (issue) { setError(issue instanceof Error ? issue.message : notesFeedbackError(issue)); return; }
    busy.current = true; setMutating(true); setError(null); setStatus("");
    const token = epoch.current;
    startTransition(async () => {
      try {
        const saveContext = editor === "new" ? attempt!.context : { ...context, sessionId: editor.sessionId ?? undefined };
        const result = await saveCoachFeedback(saveContext, editor === "new" ? null : editor.id, prepared, editor === "new" ? null : editor.updatedAt, editor === "new" ? attempt!.requestId : null);
        if (token !== epoch.current) return;
        if (!result.ok) { setError(result.message); return; }
        clearAttempt(); setEditor(null); setBody(""); setStatus("Feedback saved and shared with the athlete."); setReload((value) => value + 1);
      } catch { if (token === epoch.current) setError("Saving could not be confirmed. Your draft is preserved. Retry the original submission to safely confirm its result."); }
      finally { busy.current = false; if (token === epoch.current) setMutating(false); }
    });
  }
  function remove(entry: CoachFeedback) {
    if (busy.current || pending || !confirmDraftNavigation(dirty) || !window.confirm("Delete this feedback? The athlete will also lose access to this entry.")) return;
    busy.current = true; setMutating(true); setError(null); setStatus("");
    const token = epoch.current;
    startTransition(async () => {
      try {
        const result = await removeCoachFeedback(context, entry.id, entry.updatedAt);
        if (token !== epoch.current) return;
        if (!result.ok) { setError(result.message); return; }
        setEntries((current) => current.filter((item) => item.id !== entry.id));
        if (editor !== "new" && editor?.id === entry.id) { setEditor(null); setBody(""); }
        setStatus("Feedback deleted for you and the athlete.");
      } catch { if (token === epoch.current) setError("Feedback deletion could not be confirmed. Reload before trying again."); }
      finally { busy.current = false; if (token === epoch.current) setMutating(false); }
    });
  }
  function more() {
    const last = entries.at(-1);
    if (!last || pending || busy.current) return;
    const token = epoch.current;
    startTransition(async () => {
      try {
        const result = await loadCoachFeedback(context, { createdAt: last.createdAt, id: last.id });
        if (token !== epoch.current) return;
        if (!result.ok) { setLoadError(result.message); return; }
        setEntries((current) => [...current, ...result.data.entries.filter((entry) => !current.some((item) => item.id === entry.id))]);
        setHasMore(result.data.hasMore); setLoadError(null);
      } catch { if (token === epoch.current) setLoadError("Older feedback could not be loaded. Try again."); }
    });
  }
  return <section className={styles.panel} aria-labelledby={`${fieldId}-heading`} aria-busy={loading || pending}>
    <h2 id={`${fieldId}-heading`}>{history ? "Session Feedback history" : "Coach Feedback"}</h2>
    <p className={styles.hint}>{canAuthor ? "All feedback here is shared with this athlete. Only you and the recipient can read your entries while your coaching access is active. Other coaches cannot read them." : "Feedback shared with you by your coaches. Newest entries appear first."}</p>
    {history && <p className={styles.hint}>{canAuthor ? "Your Session feedback for this athlete, including feedback for deleted Sessions while your coaching access remains active." : "Session feedback remains in your history when a Session or organisation is deleted, or a coaching relationship ends."}</p>}
    {loading ? <p role="status">Loading Coach Feedback…</p> : <>
      {loadError && <div><p role="alert" className={styles.error}>{loadError}</p><button type="button" className={styles.secondary} disabled={pending} onClick={() => setReload((value) => value + 1)}>Reload feedback</button></div>}
      {!loadError && entries.length === 0 && <p className={styles.hint}>{canAuthor ? "No feedback from you in this view yet." : "No coach feedback in this view yet."}</p>}
      {entries.map((entry) => <article key={entry.id} className={styles.entry}>
        <h3>{entry.authorUserId ? entry.authorDisplayName?.trim() || "Coach" : "Former coach"}</h3>
        <p className={styles.meta}>{entry.sessionId ? "Session feedback" : "Session feedback · original Session deleted"} · {entry.organizationId ? `Organisation ${entry.organizationId.slice(0, 8)}` : "Organisation no longer available"}<br/>Created <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>{entry.updatedAt !== entry.createdAt && <> · Edited <time dateTime={entry.updatedAt}>{new Date(entry.updatedAt).toLocaleString()}</time></>}</p>
        <p className={styles.body}>{entry.body}</p>
        {canAuthor && entry.canEdit && entry.authorUserId === viewerId && entry.organizationId === organizationId && <div className={styles.actions}><button type="button" className={styles.secondary} disabled={pending} onClick={() => compose(entry)}>Edit feedback</button><button type="button" className={styles.danger} disabled={pending} onClick={() => remove(entry)}>Delete feedback</button></div>}
      </article>)}
      {hasMore && <button type="button" className={styles.secondary} disabled={pending} onClick={more}>{pending ? "Loading…" : "Load older feedback"}</button>}
      {canCreate && !loadError && !editor && <button type="button" className={styles.button} disabled={pending} onClick={() => compose("new")}>Add feedback</button>}
    </>}
    {editor && <form onSubmit={(event) => { event.preventDefault(); save(editor === "new" && creationAttempt !== null); }}>
      <label className={styles.field} htmlFor={`${fieldId}-body`}>{editor === "new" ? "New Session feedback" : "Edit your feedback"}<textarea id={`${fieldId}-body`} value={body} disabled={pending} onChange={(event) => setBody(event.target.value)} aria-describedby={`${fieldId}-limit`}/></label>
      <p id={`${fieldId}-limit`} className={styles.meta}>{Array.from(body).length} / 4,000 characters · shared with the athlete</p>
      {editor === "new" && creationAttempt && <div className={styles.notice}><p>A submission is awaiting confirmation. Retry sends its original text using the same request identifier. Your changed text is not included in that retry.</p><details><summary>Original submitted feedback</summary><p className={styles.body}>{creationAttempt.body}</p></details><button type="button" className={styles.secondary} disabled={pending} onClick={startDifferentEntry}>Start a different entry</button></div>}
      <div className={styles.actions}><button type="submit" disabled={pending || !dirty} className={styles.button}>{pending ? "Saving…" : editor === "new" && creationAttempt ? "Retry original submission" : "Save feedback"}</button><button type="button" disabled={pending} className={styles.secondary} onClick={cancel}>Cancel</button></div>
      {error && (editor === "new" ? <button type="button" className={styles.secondary} disabled={pending} onClick={() => setReload((value) => value + 1)}>Refresh history, keep draft</button> : <button type="button" className={styles.secondary} disabled={pending} onClick={() => { if (confirmDraftNavigation(dirty)) { clearAttempt(); setEditor(null); setBody(""); setError(null); setReload((value) => value + 1); } }}>Discard draft and reload latest feedback</button>)}
    </form>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {error && !editor && <button type="button" className={styles.secondary} disabled={pending} onClick={() => { setError(null); setReload((value) => value + 1); }}>Reload latest feedback</button>}
    {status && <p className={styles.status} role="status">{status}</p>}
  </section>;
}
