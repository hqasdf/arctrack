"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { notesFeedbackError, prepareSessionNote } from "@arc-track/core/notes-feedback";
import { loadSessionNote, removeSessionNote, saveSessionNote } from "./actions";
import { confirmDraftNavigation, useDraftGuard } from "./draft-guard";
import type { NotesContext, SessionNote } from "./types";
import styles from "./notes-feedback.module.css";

export function SessionNotesPanel({ context, readOnly = false, onDirtyChange }: {
  context: NotesContext; readOnly?: boolean; onDirtyChange?: (dirty: boolean) => void;
}) {
  const scope = `${context.viewerId}:${context.organizationId ?? "own"}:${context.athleteUserId ?? "own"}:${context.sessionId}`;
  return <SessionNotesEditor key={scope} context={context} readOnly={readOnly} onDirtyChange={onDirtyChange}/>;
}

function SessionNotesEditor({ context, readOnly, onDirtyChange }: {
  context: NotesContext; readOnly: boolean; onDirtyChange?: (dirty: boolean) => void;
}) {
  const fieldId = useId();
  const [note, setNote] = useState<SessionNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagText, setTagText] = useState("");
  const [reload, setReload] = useState(0);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const [mutating, setMutating] = useState(false);
  const epoch = useRef(0);
  const dirty = editing && (body !== (note?.body ?? "") || JSON.stringify(tags) !== JSON.stringify(note?.techniqueTags ?? []) || tagText.trim() !== "");
  useDraftGuard(dirty || mutating);
  useEffect(() => { onDirtyChange?.(dirty || mutating); return () => onDirtyChange?.(false); }, [dirty, mutating, onDirtyChange]);
  const { viewerId, sessionId, organizationId, athleteUserId } = context;
  useEffect(() => {
    const token = ++epoch.current;
    startTransition(async () => {
      await Promise.resolve();
      if (token !== epoch.current) return;
      setLoading(true); setError(null);
      try {
        const result = await loadSessionNote({ viewerId, sessionId, organizationId, athleteUserId });
        if (token !== epoch.current) return;
        if (!result.ok) { setError(result.message); return; }
        setNote(result.data); setBody(result.data?.body ?? ""); setTags(result.data?.techniqueTags ?? []); setEditing(false); setTagText("");
      } catch { if (token === epoch.current) setError("Session Notes could not be loaded. Check your connection and try again."); }
      finally { if (token === epoch.current) setLoading(false); }
    });
    return () => { epoch.current = token + 1; };
  }, [viewerId, sessionId, organizationId, athleteUserId, reload]);

  function addTag() {
    const value = tagText.trim();
    if (!value) return;
    if (Array.from(value).length > 40 || tags.length >= 8) { setError("Use up to eight technique tags, each at most 40 characters."); return; }
    if (!tags.includes(value)) setTags([...tags, value]);
    setTagText(""); setError(null);
  }
  function cancel() {
    if (!confirmDraftNavigation(dirty)) return;
    setBody(note?.body ?? ""); setTags(note?.techniqueTags ?? []); setTagText(""); setEditing(false); setError(null);
  }
  function save() {
    if (busy.current || pending) return;
    let prepared;
    try { prepared = prepareSessionNote(body, tagText.trim() ? [...tags, tagText.trim()] : tags); }
    catch (issue) { setError(issue instanceof Error ? issue.message : notesFeedbackError(issue)); return; }
    busy.current = true; setMutating(true); setError(null); setStatus("");
    const token = epoch.current;
    startTransition(async () => {
      try {
        const result = await saveSessionNote(context, prepared.body, prepared.techniqueTags, note?.updatedAt ?? null);
        if (token !== epoch.current) return;
        if (!result.ok) { setError(result.message); return; }
        setNote(result.data); setBody(result.data.body); setTags(result.data.techniqueTags); setTagText(""); setEditing(false); setStatus("Session Notes saved.");
      } catch { if (token === epoch.current) setError("Saving could not be confirmed. Your draft is preserved. Reload the latest note before retrying."); }
      finally { busy.current = false; if (token === epoch.current) setMutating(false); }
    });
  }
  function remove() {
    if (!note || busy.current || pending || !window.confirm("Delete these Session Notes and technique tags? Your coach will also lose access to them.")) return;
    busy.current = true; setMutating(true); setError(null); setStatus("");
    const token = epoch.current;
    startTransition(async () => {
      try {
        const result = await removeSessionNote(context, note.updatedAt);
        if (token !== epoch.current) return;
        if (!result.ok) { setError(result.message); return; }
        setNote(null); setBody(""); setTags([]); setTagText(""); setEditing(false); setStatus("Session Notes deleted.");
      } catch { if (token === epoch.current) setError("Note deletion could not be confirmed. Reload before trying again."); }
      finally { busy.current = false; if (token === epoch.current) setMutating(false); }
    });
  }
  return <section className={styles.panel} aria-labelledby={`${fieldId}-heading`} aria-busy={loading || pending}>
    <h2 id={`${fieldId}-heading`}>Session Notes</h2>
    <p className={styles.hint}>{readOnly ? "Written by the athlete. Session Notes are read only for coaches." : "Your journal for this Session. Currently authorised Head Coaches can read it."}</p>
    {loading ? <p role="status">Loading Session Notes…</p> : error && !editing && !note ? <><p className={styles.error} role="alert">{error}</p><button type="button" className={styles.secondary} onClick={() => setReload((value) => value + 1)}>Retry loading notes</button></> : <>
      {editing ? <>
        <label className={styles.field} htmlFor={`${fieldId}-body`}>Your notes<textarea id={`${fieldId}-body`} value={body} onChange={(event) => setBody(event.target.value)} disabled={pending} aria-describedby={`${fieldId}-limit`} /></label>
        <p id={`${fieldId}-limit`} className={styles.meta}>{Array.from(body).length} / 4,000 characters</p>
        <details className={styles.prompts}><summary>Optional writing prompts</summary><p>Technical focus · Session observations · What went well · Areas to improve · Next-session focus</p></details>
        <div className={styles.tags}>{tags.map((tag) => <span key={tag} className={styles.tag}>{tag}<button type="button" disabled={pending} aria-label={`Remove ${tag} tag`} onClick={() => setTags(tags.filter((value) => value !== tag))}>×</button></span>)}</div>
        <label className={styles.field} htmlFor={`${fieldId}-tag`}>Technique tag · optional<input id={`${fieldId}-tag`} value={tagText} onChange={(event) => setTagText(event.target.value)} disabled={pending} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTag(); } }}/></label>
        <div className={styles.actions}><button type="button" disabled={pending || !tagText.trim()} className={styles.secondary} onClick={addTag}>Add tag</button><span className={styles.meta}>{tags.length} / 8 tags · 40 characters each</span></div>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.actions}><button type="button" className={styles.button} disabled={pending || !dirty} onClick={save}>{pending ? "Saving…" : "Save notes"}</button><button type="button" className={styles.secondary} disabled={pending} onClick={cancel}>Cancel</button></div>
        {error && <button type="button" className={styles.secondary} disabled={pending} onClick={() => { if (confirmDraftNavigation(dirty)) setReload((value) => value + 1); }}>Discard draft and reload latest note</button>}
      </> : <>
        {note ? <><p className={styles.body}>{note.body}</p><div className={styles.tags}>{note.techniqueTags.map((tag) => <span key={tag} className={styles.tag}>{tag}</span>)}</div><p className={styles.meta}>Last updated <time dateTime={note.updatedAt}>{new Date(note.updatedAt).toLocaleString()}</time></p></> : <p className={styles.hint}>{readOnly ? "The athlete has not added notes to this Session." : "No Session Notes yet. Record your focus, observations or next steps."}</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {!readOnly && <div className={styles.actions}><button type="button" className={styles.secondary} disabled={pending} onClick={() => { setEditing(true); setStatus(""); }}>{note ? "Edit notes" : "Add notes"}</button>{note && <button type="button" className={styles.danger} disabled={pending} onClick={remove}>Delete notes</button>}</div>}
      </>}
    </>}
    {status && <p role="status" className={styles.status}>{status}</p>}
  </section>;
}
