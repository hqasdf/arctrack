"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import type { GarminView } from "../types";
import styles from "./garmin-connection.module.css";

const notices: Record<string, string> = {
  disconnected: "Garmin is disconnected and its saved connection credentials have been removed.",
  cancelled: "Garmin authorization was cancelled. Your previous connection, if any, was kept.",
  invalid_transaction: "This authorization link expired, was already used, or belongs to a different signed-in account. Start again.",
  invalid_callback: "Garmin authorization could not be completed. Start again.",
  sign_in_required: "Sign in to the Arc Track account that started authorization, then try again.",
  already_connected: "That Garmin account is already associated with another Arc Track account. No account was overwritten.",
  account_mismatch: "This is a different Garmin account. Disconnect the existing Garmin connection before linking another account.",
  account_deletion_pending: "Account deletion is pending. Garmin connection changes are paused. Return to Delete Account to retry and complete deletion.",
  deregistration_failed: "Garmin disconnection could not be confirmed. Encrypted credentials were kept so you can retry.",
  rotation_uncertain: "Garmin token refresh could not be confirmed. Saved credentials were retained; authorization recovery is needed before cleanup can complete.",
  deregistration_recovery_required: "Garmin authorization cleanup needs recovery. Your account has not been deleted. Contact Arc Track support if retrying does not resolve this.",
  busy: "A Garmin connection operation is already in progress. Please try again shortly.",
  connection_error: "Your Garmin connection could not be updated. Please refresh its status and try again.",
  provider_unavailable: "Garmin could not be reached. Please try again later.",
  provider_configuration: "Garmin connection configuration needs attention. Password sign-in is unaffected.",
  reauthorization_required: "Garmin authorization is no longer valid. Connect again to grant access.",
  revocation_unconfirmed: "Disconnected from Arc Track and saved credentials removed. Garmin revocation could not be confirmed; review Arc Track’s app access in Garmin Connect as well.",
};
export function GarminConnectionCard({ initialStatus, notice, placement = "profile" }: { initialStatus: GarminView; notice?: string; placement?: "health" | "profile" }) {
  const [view, setView] = useState(initialStatus);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  // A tab left open must not continue advertising an expired access token as healthy.
  useEffect(() => {
    if (view.status !== "connected" || !view.expiresAt) return;
    const wait = Math.max(0, Math.min(2147483647, Date.parse(view.expiresAt) - Date.now()));
    const timer = setTimeout(() => {
      setView(previous => ({ ...previous, status: "error" }));
      setError("Refresh your Garmin connection status before continuing.");
    }, wait);
    return () => clearTimeout(timer);
  }, [view.status, view.expiresAt]);
  function submitting(event: FormEvent) {
    if (pending) event.preventDefault();
    else setPending(true);
  }
  async function refresh() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/integrations/garmin/status", { cache: "no-store", signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error();
      setView(await response.json() as GarminView);
    } catch {
      setView(previous => ({ ...previous, status: "error" }));
      setError("Your Garmin connection status could not be refreshed. Please try again.");
    }
    finally { setPending(false); }
  }
  const working = view.status === "connecting" || view.status === "disconnecting" || view.error === "account_deletion_pending";
  const confirmedNotice = notice && notice !== "connected"
    && (notice !== "disconnected" || view.status === "disconnected")
    && (notice !== "revocation_unconfirmed" || view.error === "revocation_unconfirmed") ? notice : undefined;
  const message = error || (confirmedNotice && notices[confirmedNotice]) || (view.error && notices[view.error]);
  const connected = view.available && view.status === "connected";
  const reconnect = view.status === "reauthorization_required" || view.status === "error";
  return <div className={styles.integration} data-garmin-connection aria-label="Garmin connection">
    <div className={styles.row}>
      {connected ? <span className={styles.connected} role="status"><span aria-hidden="true">✓</span>Garmin Connected</span>
        : placement === "health" ? <form method="post" action="/api/integrations/garmin/start" onSubmit={submitting}>
          <button className={styles.connect} disabled={!view.available || !view.canConnect || pending || working}>
            <Image src="/garmin-connect.png" alt="" width={100} height={27} />
            <span>{pending || working ? "Updating…" : !view.available || !view.canConnect ? "Garmin unavailable" : reconnect ? "Reconnect Garmin" : message ? "Try Again" : "Connect Garmin"}</span>
          </button>
        </form> : <a className={styles.link} href="/health">{reconnect ? "Reconnect Garmin" : "Connect Garmin"}<span aria-hidden="true"> ↗</span></a>}
    </div>
    {placement === "health" && !connected && <p className={styles.privacyNotice}>Your Garmin data stays private to you. <a href="/privacy#garmin">Garmin privacy details</a></p>}
    {message && <p className={styles.message} role={confirmedNotice === "disconnected" && !error ? "status" : "alert"}>{message}</p>}
    <details className={styles.management}>
      <summary>Manage connection</summary>
      <div className={styles.managementBody}>
        <p>Link your account through Garmin’s consent screen. Linking does not confirm health synchronization or share health data with coaches.</p>
        <p><strong>Granted permissions:</strong> {view.permissions.length ? view.permissions.join(", ") : "No sharing permissions confirmed."}</p>
        <div className={styles.buttons}>
          {view.available && <button type="button" className={styles.secondary} disabled={pending} onClick={() => void refresh()}>Refresh status</button>}
          {view.available && view.status !== "disconnected" && <form method="post" action="/api/integrations/garmin/disconnect" onSubmit={submitting}>
            <button className={styles.secondary} disabled={pending || working}>Disconnect Garmin</button>
          </form>}
          <a className={styles.link} href="/privacy">Privacy policy</a>
        </div>
        <p>After Garmin confirms disconnection, Arc Track removes its saved connection credentials. It does not delete your account or activity records in Garmin.</p>
      </div>
    </details>
  </div>;
}
