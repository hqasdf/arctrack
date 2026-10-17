import Link from "next/link";
import type { Metadata } from "next";
import { readIdentity } from "@/lib/auth/session.server";
import { AccountDeletionForm } from "@/features/profile/components/account-deletion-form";
import authStyles from "@/features/auth/components/auth.module.css";
import styles from "@/features/profile/components/profile.module.css";
import pageStyles from "./delete-account.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Delete account",
  description: "How to delete your Arc Track account and associated data, with or without the mobile app.",
  alternates: { canonical: "https://archery-website.vercel.app/delete-account" },
};

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
    <section className={`${styles.card} ${pageStyles.information}`} aria-labelledby="deletion-options-heading">
      <h2 id="deletion-options-heading">Account deletion options</h2>
      <h3>From the Arc Track app</h3>
      <ol>
        <li>Open Profile and choose Delete Account. This opens the existing Arc Track account-deletion webpage in your browser.</li>
        <li>If asked, sign in with the account you want to delete, then return to this page.</li>
        <li>Enter your current password, type <strong>DELETE</strong> and choose <strong>Permanently delete my account</strong>.</li>
        <li>Wait for the success message. Deletion cannot be undone; an error message does not confirm deletion.</li>
      </ol>

      <h3>Without installing or opening the app</h3>
      <p>You can use this webpage directly in a mobile or desktop browser. Sign in using the existing Sign in option above, return here and complete the same password and DELETE confirmation. You do not need to install Arc Track.</p>
      <p>If you have forgotten your password, use the existing Recover account access option above before returning here.</p>

      <h3>Contact for deletion requests</h3>
      <p>If you cannot access your account, or need help requesting deletion of account-related information, contact Arc Track support. Ownership must be verified before a request can be fulfilled. Do not send your password or verification codes.</p>
      <p className={pageStyles.pending}>[Monitored account-deletion support email or contact URL — to be confirmed before publication.]</p>

      <h3>Data removed when deletion succeeds</h3>
      <ul>
        <li>Your Supabase Auth account and saved profile.</li>
        <li>Your Training and Competition Sessions, Rounds, Ends and Arrows, including scores and plotted coordinates. Derived score, grouping and progress views no longer have those deleted records as inputs.</li>
        <li>Weather snapshots and collection-state records associated with your Sessions.</li>
        <li>Your organisation memberships, athlete Training Plan assignment links and account-linked operation-budget records.</li>
      </ul>

      <h3>Data that may remain</h3>
      <p>Shared organisations, Training Plans and plan days remain for other members. Your creator/assigner account references are cleared, but shared titles, notes and coach notes can remain. Other athletes’ records are not deleted. The app does not define an automatic expiry period for these shared records; contact support about personal information in shared text.</p>
      <p>The web deletion page also attempts to clear the Arrow Counter in that browser. It does not remotely erase other devices’ local counters or caches, downloaded PNGs, or copies you shared with other people or apps. Those copies remain until removed through the relevant device, browser or recipient’s controls.</p>
      <p>Provider backups and operational/security logs are separate from live application records. Their retention reasons, applicable periods and any legal exceptions require operator confirmation; immediate removal from every backup or log is not guaranteed.</p>
      <p className={pageStyles.pending}>[Backup, authentication-log, hosting-log and abuse-prevention retention reasons and periods, and any legal exceptions — to be confirmed before publication.]</p>

      <h3>When deletion happens</h3>
      <p>The existing self-service flow processes deletion during the confirmed request; it has no scheduled waiting period. It reports success only after the account-deletion operation succeeds. Other signed-in devices lose account access when their account or session is checked again.</p>
      <p>A response time for support-assisted requests has not yet been confirmed. Contact details and retention information must be completed before this page is published as a finished store resource.</p>
      <Link href="/privacy" prefetch={false} className={pageStyles.policyLink}>Arc Track Privacy Policy</Link>
    </section>
  </main>;
}
