import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session.server";
import { readOwnDisplayName } from "@/features/profile/read.server";
import { SessionsWorkspace } from "@/features/sessions/components/sessions-workspace";
import { readSessions } from "@/features/sessions/read.server";
import { AthletePlanProgress } from "@/features/organizations/components/athlete-plan-progress";
import { readOwnTrainingPlanProgress } from "@/features/organizations/training-plans-read.server";
import { singaporeDate } from "@/lib/date";
import styles from "@/styles/pages.module.css";
export const metadata: Metadata = { title: "Sessions" };
export default async function SessionsPage({searchParams}:{searchParams:Promise<{session?:string}>}) {
  const user = await requireUser();
  const {session:initialSessionId}=await searchParams;
  const today = singaporeDate(new Date());
  const [displayName, sessions, plans] = await Promise.all([
    readOwnDisplayName(), readSessions(), readOwnTrainingPlanProgress(today).catch(() => null),
  ]);
  return <>
    <div className={styles.intro}>
      <h1 style={{ overflowWrap: "anywhere" }}>Your sessions, {displayName}</h1>
    </div>
    <SessionsWorkspace initialSessions={sessions} trainingPlanContent={plans === null ? <p key="training-plan-error" role="status">Training Plans could not be loaded. Refresh to try again.</p> : <AthletePlanProgress plans={plans} today={today} key={user.id}/>} key={user.id+':'+(initialSessionId??'')} viewerId={user.id} initialSessionId={initialSessionId}/>
  </>;
}
