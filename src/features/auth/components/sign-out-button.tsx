"use client";

import { useActionState } from "react";
import { signOut } from "../actions";
import { INITIAL_AUTH_STATE } from "../validation";
import styles from "./auth.module.css";

export function SignOutButton() {
  const [state, action, pending] = useActionState(signOut, INITIAL_AUTH_STATE);
  return (
    <form action={action} className={styles.signOut} data-account-sign-out>
      <button type="submit" disabled={pending}>
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {state.message && <p role="alert">{state.message}</p>}
    </form>
  );
}
