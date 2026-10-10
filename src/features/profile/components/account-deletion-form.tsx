"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { COUNTER_STORAGE_KEY } from "@/features/arrow-counter/counter-model";
import { deleteAccount } from "../account-deletion-actions";
import styles from "./profile.module.css";

export function AccountDeletionForm({ email }: { email: string | null }) {
  const [state, action, pending] = useActionState(deleteAccount, { status: "idle", message: "" });
  useEffect(() => {
    if (state.status === "success") {
      try { window.localStorage.removeItem(COUNTER_STORAGE_KEY); } catch { /* Browser storage can be unavailable. */ }
    }
  }, [state.status]);
  if (state.status === "success") return <p role="status" className={styles.success}>{state.message}</p>;
  if (!email) return <>
    <p className={styles.hint}>Sign in to verify the account you want to delete, then return to this page. You do not need the mobile app.</p>
    <div className={styles.buttons}><Link href="/sign-in" className={styles.secondary}>Sign in</Link><Link href="/forgot-password" className={styles.secondary}>Recover account access</Link></div>
  </>;
  return <form action={action} className={styles.form}>
    <p className={styles.hint}>Account: {email}. This cannot be undone.</p>
    <fieldset disabled={pending}>
      <div className={styles.field}><label htmlFor="deletion-password">Current password</label><input id="deletion-password" name="password" type="password" autoComplete="current-password" required maxLength={128} /></div>
      <div className={styles.field}><label htmlFor="deletion-confirmation">Type DELETE to confirm</label><input id="deletion-confirmation" name="confirmation" autoComplete="off" required pattern="DELETE" maxLength={6} /></div>
      <button type="submit" className={styles.save}>{pending ? "Deleting…" : "Permanently delete my account"}</button>
    </fieldset>
    {state.message && <p role="alert" className={styles.error}>{state.message}</p>}
  </form>;
}
