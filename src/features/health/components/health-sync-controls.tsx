"use client";

import { useRef, useState } from "react";
import type { GarminHealthControl } from "@/features/garmin/health/types";
import styles from "./health.module.css";

export function HealthSyncControls({ control, onChanged, onUnconfirmed }: {
  control: GarminHealthControl;
  onChanged: (value: GarminHealthControl, deleted: boolean) => void;
  onUnconfirmed: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const request = useRef<{ action: string; generation: string; requestId: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function run(action: "delete" | "pause" | "resume") {
    if (busy.current) return;
    busy.current = true;
    setPending(true); setMessage(""); setError("");
    if (request.current?.action !== action || request.current.generation !== control.generation) {
      request.current = { action, generation: control.generation, requestId: crypto.randomUUID() };
    }
    try {
      const response = await fetch("/api/integrations/garmin/health/control", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request.current, confirm: action === "delete" }), cache: "no-store", signal: AbortSignal.timeout(45000) });
      const result = await response.json();
      if (!response.ok || !result.control) throw new Error(result.error || "The action could not be confirmed. Refresh Health and retry.");
      request.current = null;
      onChanged(result.control as GarminHealthControl, action === "delete");
      dialog.current?.close();
      setMessage(action === "delete" ? "Arc Track’s imported Health data was deleted. Garmin remains connected and Health Sync is paused."
        : action === "pause" ? "Health Sync is paused. Your existing imported measurements are kept."
        : "Health Sync may receive new measurements again. This does not confirm that a new measurement has arrived.");
    } catch (failure) {
      const message = failure instanceof Error && failure.name === "Error" ? failure.message : "The action could not be confirmed. Refresh Health and retry.";
      setError(message);
      onUnconfirmed(message);
    } finally { busy.current = false; setPending(false); }
  }
  return <section className={styles.syncControls} aria-label="Health data and synchronization">
    <div><strong>{control.paused ? "Health Sync Paused" : "Health synchronization"}</strong><p>{control.paused
      ? "Automatic imports are paused. Resume explicitly to allow new measurements; deleted history will not be restored."
      : "Supported Garmin measurements arrive automatically when Health synchronization is active."}</p></div>
    <div className={styles.controlActions}>
      <button type="button" disabled={pending} onClick={() => void run(control.paused ? "resume" : "pause")}>{pending ? "Updating…" : control.paused ? "Resume Health Sync" : "Pause Health Sync"}</button>
      <button type="button" disabled={pending} onClick={() => dialog.current?.showModal()}>Delete Health Data</button>
    </div>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <dialog ref={dialog} className={styles.controlDialog} aria-labelledby="delete-health-title" aria-describedby="delete-health-description" onCancel={event => { if (pending) event.preventDefault(); }}>
      <h2 id="delete-health-title">Delete Health Data?</h2>
      <p id="delete-health-description">This deletes Arc Track’s imported Garmin health and activity records, queued notifications and quarantined payloads. Garmin stays connected, and automatic Health Sync is paused until you explicitly resume it. Your originals in Garmin are not deleted.</p>
      <p>After Resume, older deliveries and summaries that start before the new cutoff are not imported.</p>
      {error && <p role="alert">{error}</p>}
      <div className={styles.controlActions}><button type="button" disabled={pending} onClick={() => dialog.current?.close()} autoFocus>Cancel</button><button type="button" disabled={pending} onClick={() => void run("delete")}>{pending ? "Deleting…" : "Confirm Delete Health Data"}</button></div>
    </dialog>
  </section>;
}
