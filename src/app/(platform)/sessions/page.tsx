import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session.server";
import { readOwnDisplayName } from "@/features/profile/read.server";
import { SessionsWorkspace } from "@/features/sessions/components/sessions-workspace";
import { readSessions } from "@/features/sessions/read.server";
import { AthletePlanCard } from "@/features/organizations/components/training-plan-ui";
import { readOwnTrainingPlanProgress } from "@/features/organizations/training-plans-read.server";
import { singaporeDate } from "@/lib/date";
import styles from "@/styles/pages.module.css";
export const metadata: Metadata = { title: "Sessions" };
export default async function SessionsPage() {
  await requireUser();
  const today = singaporeDate(new Date());
  const [displayName, sessions, plans] = await Promise.all([
    readOwnDisplayName(), readSessions(), readOwnTrainingPlanProgress(today).catch(() => null),
  ]);
  return <>
    <div className={styles.intro}>
      <h1 style={{ overflowWrap: "anywhere" }}>Your sessions, {displayName}</h1>
    </div>
    {plans === null ? <p role="status">Training Plans could not be loaded. Refresh to try again.</p> : <AthletePlanCard plans={plans} today={today}/>}
    <SessionsWorkspace initialSessions={sessions}/>
  </>;
}
