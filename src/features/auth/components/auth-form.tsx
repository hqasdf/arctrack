"use client";

import { useActionState, useState } from "react";
import { Icon } from "@/components/ui/icon";
import {
  signIn,
  signUp,
  requestPasswordReset,
  updatePassword,
} from "../actions";
import {
  INITIAL_AUTH_STATE,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type AuthMode,
} from "../validation";
import styles from "./auth.module.css";

const actions = {
  "sign-in": signIn,
  "sign-up": signUp,
  "forgot-password": requestPasswordReset,
  "update-password": updatePassword,
};
const labels = {
  "sign-in": "Sign in",
  "sign-up": "Create account",
  "forgot-password": "Send recovery code",
  "update-password": "Update password",
};

export function AuthForm({
  mode,
  configured,
}: {
  mode: AuthMode;
  configured: boolean;
}) {
  const [state, action, pending] = useActionState(
    actions[mode],
    INITIAL_AUTH_STATE,
  );
  const newPassword = mode === "sign-up" || mode === "update-password";
  const [visible, setVisible] = useState({ password: false, confirmPassword: false });
  return (
    <form action={action} className={styles.form}>
      <fieldset disabled={pending || !configured}>
        <legend className={styles.srOnly}>{labels[mode]}</legend>
        {mode !== "update-password" && (
          <div className={styles.field}>
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
            />
          </div>
        )}
        {mode !== "forgot-password" && (
          <div className={styles.field}>
            <label htmlFor="password">
              {newPassword ? "New password" : "Password"}
            </label>
            <div className={styles.passwordInput}><input
              id="password"
              name="password"
              type={visible.password ? "text" : "password"}
              autoComplete={newPassword ? "new-password" : "current-password"}
              minLength={newPassword ? PASSWORD_MIN_LENGTH : 1}
              maxLength={PASSWORD_MAX_LENGTH}
              aria-describedby={newPassword ? "password-hint" : undefined}
              required
            /><button type="button" aria-label={visible.password ? "Hide password" : "Show password"} onClick={() => setVisible((current) => ({ ...current, password: !current.password }))}><Icon name={visible.password ? "eyeOff" : "eye"} size={20}/></button></div>
            {newPassword && (
              <p id="password-hint" className={styles.hint}>
                Use 12–128 characters. A long, unique passphrase works well.
              </p>
            )}
          </div>
        )}
        {newPassword && (
          <div className={styles.field}>
            <label htmlFor="confirmPassword">Confirm password</label>
            <div className={styles.passwordInput}><input
              id="confirmPassword"
              name="confirmPassword"
              type={visible.confirmPassword ? "text" : "password"}
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              required
            /><button type="button" aria-label={visible.confirmPassword ? "Hide confirm password" : "Show confirm password"} onClick={() => setVisible((current) => ({ ...current, confirmPassword: !current.confirmPassword }))}><Icon name={visible.confirmPassword ? "eyeOff" : "eye"} size={20}/></button></div>
          </div>
        )}
        <button className={styles.submit} type="submit">
          {pending ? "Please wait…" : labels[mode]}
        </button>
      </fieldset>
      <div aria-live="polite" aria-atomic="true">
        {state.message && (
          <p
            className={state.status === "error" ? styles.error : styles.message}
            role={state.status === "error" ? "alert" : "status"}
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
