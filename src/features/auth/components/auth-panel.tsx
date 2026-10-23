import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { getAuthConfig } from "@/lib/auth/config";
import { AuthForm } from "./auth-form";
import type { AuthMode, VerificationMode } from "../validation";
import { VerificationForm } from "./verification-form";
import styles from "./auth.module.css";

export function AuthPanel({
  title,
  description,
  mode,
  verificationMode,
  verificationEmail,
  notice,
  children,
}: {
  title: string;
  description: string;
  mode: AuthMode;
  verificationMode?: VerificationMode;
  verificationEmail?: string;
  notice?: string;
  children?: ReactNode;
}) {
  const configured = Boolean(getAuthConfig());
  return (
    <main id="main-content" className={styles.page}>
      <Link href={mode === "sign-in" ? "/" : "/sign-in"} className={styles.brand} aria-label={mode === "sign-in" ? "Arc Track home" : "Arc Track sign in"}>
        <Icon name="target" size={28} />
        ARC TRACK
      </Link>
      <section className={styles.card} aria-labelledby="auth-heading">
        <p className={styles.eyebrow}>Your archery journal</p>
        <h1 id="auth-heading">{title}</h1>
        <p className={styles.description}>{description}</p>
        {!configured && (
          <div className={styles.message} role="status">
            <strong>Account setup is in progress.</strong>
            <p>
              Sign-in will be available once this app is connected. These fields
              are disabled until then.
            </p>
          </div>
        )}
        {notice && (
          <p className={styles.message} role="status">
            {notice}
          </p>
        )}
        {verificationMode ? (
          <VerificationForm mode={verificationMode} configured={configured} initialEmail={verificationEmail} />
        ) : (
          <AuthForm mode={mode} configured={configured} />
        )}
        <div className={styles.links}>{children}<Link href="/privacy" prefetch={false}>Privacy Policy</Link></div>
      </section>
      <p className={styles.footnote}>Recurve & compound</p>
    </main>
  );
}
