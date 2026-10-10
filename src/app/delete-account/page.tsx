import Link from "next/link";
import type { Metadata } from "next";
import { readIdentity } from "@/lib/auth/session.server";
import { AccountDeletionForm } from "@/features/profile/components/account-deletion-form";
import authStyles from "@/features/auth/components/auth.module.css";
import styles from "@/features/profile/components/profile.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Delete account" };

export default async function DeleteAccountPage() {
  const { user, unavailable } = await readIdentity();
  return <main id="main-content" className={authStyles.page}>
    <Link href="/sessions" className={authStyles.brand}>ARC TRACK</Link>
    <section className={styles.card} aria-labelledby="deletion-heading">
      <h1 id="deletion-heading">Delete your Arc Track account</h1>
      <p className={styles.hint}>Deletion removes your account, profile, Sessions, Rounds, Ends, Arrows, organisation memberships, assigned Training Plan links, and operation-budget records.</p>
      <p className={styles.hint}>Shared organisations and their Training Plans, plan days, and other athletes’ records remain. Your creator and assigner references are cleared. An organisation can remain without a Head Coach.</p>
      <p className={styles.hint}>Ownership is verified using your signed-in account and current password. Successful deletion is confirmed on this page. This operation removes live application records; backup and provider-log retention must be confirmed in the published privacy policy.</p>
      {unavailable && <p role="alert" className={styles.error}>Account verification is temporarily unavailable. Please try again.</p>}
      <AccountDeletionForm email={user?.email ?? null} />
    </section>
  </main>;
}
