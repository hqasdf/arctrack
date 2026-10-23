"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { GarminView } from "../types";
import styles from "@/features/profile/components/profile.module.css";

const notices: Record<string, string> = {
  connected: "Your Garmin account is connected. Health and activity import is not enabled in this phase.",
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
const labels = { disconnected: "Not Connected", connected: "Connected", connecting: "Connecting", disconnecting: "Disconnecting", reauthorization_required: "Reauthorization Required", error: "Connection Error" };
const date = (value: string | null) => value ? new Intl.DateTimeFormat("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" }).format(new Date(value)) + " SGT" : "—";

export function GarminConnectionCard({ initialStatus, notice }: { initialStatus: GarminView; notice?: string }) {
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
    } catch { setError("Your Garmin connection status could not be refreshed. Please try again."); }
    finally { setPending(false); }
  }
  const working = view.status === "connecting" || view.status === "disconnecting" || view.error === "account_deletion_pending";
  const confirmedNotice = notice && (notice !== "connected" || view.status === "connected")
    && (notice !== "disconnected" || view.status === "disconnected")
    && (notice !== "revocation_unconfirmed" || view.error === "revocation_unconfirmed") ? notice : undefined;
  return <section className={styles.card} aria-labelledby="garmin-heading">
    <h2 id="garmin-heading">Garmin Connect</h2>
    <p className={styles.hint}>Authorize Garmin health and activity access through Garmin’s consent screen. This phase links your account only; it does not import records or share health data with coaches.</p>
    <dl className={styles.details}>
      <div><dt>Connection status</dt><dd role="status">{pending ? "Updating…" : labels[view.status]}</dd></div>
      {view.status === "connected" && <div><dt>Account</dt><dd>Your authorized Garmin account</dd></div>}
      <div><dt>Last authorized</dt><dd>{date(view.authorizedAt)}</dd></div>
      <div><dt>Last checked</dt><dd>{date(view.checkedAt)}</dd></div>
      {view.permissions.length > 0 && <div><dt>Granted permissions</dt><dd>{view.permissions.join(", ")}</dd></div>}
    </dl>
    {!view.available && <p className={styles.hint}>Garmin connection is not available yet.</p>}
    {confirmedNotice && notices[confirmedNotice] && <p className={confirmedNotice === "connected" || confirmedNotice === "disconnected" ? styles.success : styles.error} role="status">{notices[confirmedNotice]}</p>}
    {view.error && notices[view.error] && <p className={styles.error} role="status">{notices[view.error]}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.buttons}>
      {view.canConnect && view.status !== "connected" && <form method="post" action="/api/integrations/garmin/start" onSubmit={submitting}>
        <button className={styles.save} disabled={!view.available || pending || working}>{view.status === "reauthorization_required" ? "Reconnect Garmin" : "Connect Garmin"}</button>
      </form>}
      {view.available && <button type="button" className={styles.secondary} disabled={pending} onClick={() => void refresh()}>Refresh status</button>}
      {view.available && view.status !== "disconnected" && <form method="post" action="/api/integrations/garmin/disconnect" onSubmit={submitting}>
        <button className={styles.secondary} disabled={pending || working}>Disconnect Garmin</button>
      </form>}
    </div>
    <p className={styles.hint}>After Garmin confirms disconnection, Arc Track removes its saved connection credentials. It does not delete your account or activity records in Garmin.</p>
  </section>;
}
