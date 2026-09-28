import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { targetFaceLabel } from "@arc-track/core/analytics";
import { summarizeCoachRound } from "@arc-track/core/coach-round";
import { formatDateOnly } from "@arc-track/core/dates";
import { RoundInsights } from "@/features/sessions/components/session-insights";
import { readCoachRoundDetail } from "@/features/organizations/coach-read.server";
import { CoachReadonlyTarget } from "@/features/organizations/components/coach-readonly-target";
import { CoachLineChart, VerticalBarChart } from "@/features/organizations/components/coach-charts";
import styles from "@/features/organizations/components/coach.module.css";

export const metadata: Metadata = { title: "Athlete Round" };

export default async function CoachRoundPage({ params }: {
  params: Promise<{ organizationId: string; userId: string; sessionId: string; roundId: string }>;
}) {
  const { organizationId, userId, sessionId, roundId } = await params;
  const detail = await readCoachRoundDetail(organizationId, userId, sessionId, roundId);
  if (!detail) notFound();
  const { round, ends } = detail.selected;
  const score = summarizeCoachRound(round);
  const base = `/organization/${organizationId}/athletes/${userId}/sessions/${sessionId}`;
  return <div className={styles.workspace}>
    <header className={styles.heading}>
      <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href={`/organization/${organizationId}`}>Organisation</Link><span>/</span><Link href={`/organization/${organizationId}/athletes/${userId}`}>Athlete</Link><span>/</span><Link href={base}>{detail.session.title}</Link><span>/</span><span>{round.name}</span></nav>
      <p className={styles.eyebrow}>Read only · {formatDateOnly(detail.session.date)}</p>
      <h1>{round.name}</h1>
      <p>Round {round.roundNumber} · {round.division} · {round.distanceMetres} m · {targetFaceLabel(round)}</p>
      <p>{round.ends} Ends × {round.arrowsPerEnd} Arrows/End</p>
    </header>
    <section className={styles.overview} aria-label="Round score">
      <div><strong>{score.total}</strong><span>Points</span></div>
      <div><strong>{score.average?.toFixed(2) ?? "—"}</strong><span>Average / Arrow</span></div>
      <div><strong>{score.arrowCount}/{score.expectedArrows}</strong><span>Recorded Arrows</span></div>
      <div><strong>{score.xCount}X</strong><span>X count</span></div>
      <div><strong>{score.tenPlusXCount}</strong><span>10 + X</span></div>
    </section>
    <div className={styles.roundLead}><CoachReadonlyTarget round={round}/>
    <section className={styles.section}><h2>End score sheet</h2>
      <ul className={styles.recordList}>{ends.map((end) => <li key={end.id}><div><strong>End {end.endNumber}</strong>
        <span>{end.arrows.length ? end.arrows.map((arrow) => `${arrow.score === "X" ? "10X" : arrow.score}${arrow.plot ? " ●" : ""}`).join(" · ") : "No Arrows recorded"}</span>
      </div><div><strong>{score.progression[end.endNumber - 1]?.total ?? 0} pts</strong>
        <span>{end.arrows.length}/{round.arrowsPerEnd} Arrows</span></div></li>)}</ul>
    </section></div>
    <RoundInsights round={round} showTarget={false}/>
    <div className={styles.chartPair}><section className={styles.section}><h2>Score distribution</h2>
      {score.arrowCount ? <VerticalBarChart yLabel="Arrows" points={score.distribution.map((item) => ({ label: item.score, value: item.count, tooltip: `${item.score}: ${item.count} Arrows · ${(item.count / score.arrowCount * 100).toFixed(1)}%` }))}/> : <p className={styles.empty}>No scored Arrows yet.</p>}
    </section>
    <section className={styles.section}><h2>Round progression</h2><p className={styles.note}>Running average score after each saved Arrow.</p>{score.arrowProgression.length ? <CoachLineChart yLabel="Avg / Arrow" maxValue={10} points={score.arrowProgression.map((item) => ({ label: String(item.sequence), value: item.average, tooltip: `Arrow ${item.sequence} · End ${item.endNumber}, Arrow ${item.arrowNumber}: ${item.average.toFixed(2)} running avg · ${item.cumulative} pts` }))}/> : <p className={styles.empty}>No scored Arrows yet.</p>}</section></div>
  </div>;
}
