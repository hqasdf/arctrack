"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { requestEmailChange } from "../email-actions";
import { INITIAL_EMAIL_CHANGE_STATE } from "../email-validation";
import styles from "./profile.module.css";

export function AccountCard({ email, pendingEmail }: { email: string; pendingEmail: string | null }) {
  const [editing, setEditing] = useState(false);
  return (
    <section className={styles.card} aria-labelledby="account-heading">
      <h2 id="account-heading">Account</h2>
      <dl className={styles.details}><div><dt>Email</dt><dd>{email || "Unavailable"}</dd></div></dl>
      {pendingEmail && pendingEmail.toLowerCase() !== email.toLowerCase() && (
        <p className={styles.hint}>Confirmation pending for {pendingEmail}. Check both inboxes.
          Refresh this page after completing confirmation.</p>
      )}
      {editing ? <EmailChangeForm onCancel={() => setEditing(false)} /> : (
        <div className={styles.buttons}>
          <button type="button" className={styles.secondary} onClick={() => setEditing(true)}>Change email</button>
          <Link href="/update-password" className={styles.secondary}>Change password</Link>
          <Link href="/delete-account" className={styles.secondary}>Delete Account</Link>
        </div>
      )}
    </section>
  );
}

function EmailChangeForm({ onCancel }: { onCancel: () => void }) {
  const [state, action, pending] = useActionState(requestEmailChange, INITIAL_EMAIL_CHANGE_STATE);
  return (
    <form action={action} className={styles.form}>
      <fieldset disabled={pending}>
        <legend className={styles.legend}>Change email</legend>
        <div className={styles.field}>
          <label htmlFor="new-email">New email address</label>
          <input id="new-email" name="email" type="email" autoComplete="email" required maxLength={254}
            aria-describedby="email-change-note" />
          <p id="email-change-note" className={styles.hint}>You will need access to both your current and new inboxes.</p>
        </div>
        <div className={styles.buttons}>
          <button type="submit" className={styles.save}>{pending ? "Requesting…" : "Request email change"}</button>
          <button type="button" className={styles.secondary} onClick={onCancel}>
            {state.status === "success" ? "Close" : "Cancel"}
          </button>
        </div>
      </fieldset>
      <div aria-live="polite" aria-atomic="true">
        {state.message && <p className={state.status === "error" ? styles.error : styles.success}
          role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
      </div>
      {state.status === "success" && <p className={styles.hint}>Closing this form does not cancel the requested change.</p>}
      <Link href="/update-password" className={styles.passwordLink}>Change password</Link>
    </form>
  );
}
