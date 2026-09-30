import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { targetFaceLabel } from "@arc-track/core/analytics";
import { summarizeCoachRound } from "@arc-track/core/coach-round";
import { calculateOverview } from "@arc-track/core/analytics";
import { formatDateOnly } from "@arc-track/core/dates";
import { athleteName } from "@/features/organizations/coach-model";
import { readCoachAthleteSessionIndex, readCoachAthletes, readCoachSessionDetail, requireCoachOrganization } from "@/features/organizations/coach-read.server";
import styles from "@/features/organizations/components/coach.module.css";

export const metadata: Metadata = { title: "Athlete Session" };

export default async function CoachSessionPage({ params }: {
  params: Promise<{ organizationId: string; userId: string; sessionId: string }>;
}) {
  const { organizationId, userId, sessionId } = await params;
  const [organization, athletes, detail, index] = await Promise.all([
    requireCoachOrganization(organizationId), readCoachAthletes(organizationId),
    readCoachSessionDetail(organizationId, userId, sessionId), readCoachAthleteSessionIndex(organizationId, userId),
  ]);
  const athlete = athletes.find((item) => item.userId === userId);
  if (!athlete || !detail) notFound();
  const { session, rounds } = detail;
  const overview = calculateOverview(rounds.map(({ round }) => ({ sessionId, sessionTitle: session.title, sessionType: session.sessionType, date: session.date, round })));
  const currentIndex = index.findIndex((item) => item.id === sessionId);
  const newer = currentIndex > 0 ? index[currentIndex - 1] : null;
  const older = currentIndex >= 0 ? index[currentIndex + 1] : null;
  const athleteBase = `/organization/${organizationId}/athletes/${userId}`;
  return <div className={styles.workspace}>
    <header className={`${styles.heading} ${styles.sessionHeading}`}>
      <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href={`/organization/${organizationId}`}>{organization.name}</Link><span>/</span><Link href={athleteBase}>{athleteName(athlete)}</Link><span>/</span><span>{session.title}</span></nav>
      <p className={styles.eyebrow}>{athleteName(athlete)} · {organization.name} · Read only</p>
      <h1>{session.title}</h1>
      <p>{formatDateOnly(session.date)} · {session.sessionType === "competition" ? "Competition" : "Training"} · {session.arrowCount} Session arrows</p>
      <p>Recorded {detail.createdAt.slice(0, 16).replace("T", " ")} UTC</p>
    </header>
    <section className={styles.supportingMetrics} aria-label="Session summary"><div><strong>{overview.totalArrows}</strong><span>Scored Arrows</span></div><div><strong>{overview.averagePerArrow?.toFixed(2) ?? "—"}</strong><span>Avg / Arrow</span></div><div><strong>{overview.tenPlusXPercentage === null ? "—" : `${overview.tenPlusXPercentage.toFixed(1)}%`}</strong><span>10+X rate</span></div><div><strong>{overview.xCount}</strong><span>X count</span></div><div><strong>{rounds.length}</strong><span>Rounds</span></div></section>
    <nav className={styles.sessionPager} aria-label="Athlete Sessions">{older ? <Link href={`${athleteBase}/sessions/${older.id}`}>← Previous Session</Link> : <span/>}{newer ? <Link href={`${athleteBase}/sessions/${newer.id}`}>Next Session →</Link> : <span/>}</nav>
    <section className={`${styles.section} ${styles.leadSection}`}>
      <h2>Rounds</h2>
      {rounds.length === 0 ? <p className={styles.empty}>No Rounds in this Session yet.</p> :
        <ul className={styles.recordList}>{rounds.map(({ round, ends }) => {
          const score = summarizeCoachRound(round);
          return <li key={round.id}><div>
            <strong><Link href={`/organization/${organizationId}/athletes/${userId}/sessions/${sessionId}/rounds/${round.id}`}>{round.name}</Link></strong>
            <span>Round {round.roundNumber} · {round.distanceMetres} m · {round.division} · {targetFaceLabel(round)}</span>
            <span>{ends.length}/{round.ends} Ends · {round.arrowsPerEnd} Arrows/End</span>
          </div><div><strong>{score.total}/{score.expectedArrows * 10} pts</strong>
            <span>{score.average?.toFixed(2) ?? "—"} avg/Arrow · {score.tenPlusXCount} 10+X · {score.xCount} X</span><span>{score.arrowCount}/{score.expectedArrows} recorded · {score.arrowCount === score.expectedArrows && score.expectedArrows > 0 ? "Complete" : "In progress"}</span>
            <Link href={`${athleteBase}/sessions/${sessionId}/rounds/${round.id}`}>Inspect Round →</Link>
          </div></li>;
        })}</ul>}
    </section>
  </div>;
}
