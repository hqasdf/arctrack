"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { buildCoachTeamAnalytics, DEFAULT_COACH_FILTERS } from "@arc-track/core/coach-analytics";
import { formatDateOnly } from "@arc-track/core/dates";
import type { CoachSession } from "../coach-read.server";
import { athleteName, type CoachAthlete } from "../coach-model";
import styles from "./coach.module.css";

export function CoachReviews({ organizationId, athletes, sessions, today }: { organizationId: string; athletes: CoachAthlete[]; sessions: CoachSession[]; today: string }) {
  const [athleteId, setAthleteId] = useState("all");
  const [period, setPeriod] = useState("30");
  const [type, setType] = useState("all");
  const result = useMemo(() => buildCoachTeamAnalytics(athletes.map((athlete) => ({ userId: athlete.userId, name: athleteName(athlete) })), sessions, { ...DEFAULT_COACH_FILTERS, period: period as "7" | "30" | "90" | "all", sessionType: type as "training" | "competition" | "all" }, today), [athletes, sessions, period, type, today]);
  const queue = result.reviewQueue.filter(({ session }) => athleteId === "all" || session.userId === athleteId);
  return <div className={styles.workspace}><header className={styles.heading}><p className={styles.eyebrow}>Head Coach · Workflow</p><h1>Reviews</h1><p>Recent completed or Competition Sessions worth a closer look.</p></header>
    <section className={styles.section}><div className={styles.filterGrid}>
      <label>Athlete<select value={athleteId} onChange={(event) => setAthleteId(event.target.value)}><option value="all">All athletes</option>{athletes.map((athlete) => <option key={athlete.userId} value={athlete.userId}>{athleteName(athlete)}</option>)}</select></label>
      <label>Period<select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="all">All time</option></select></label>
      <label>Session type<select value={type} onChange={(event) => setType(event.target.value)}><option value="all">All</option><option value="training">Training</option><option value="competition">Competition</option></select></label>
    </div><p className={styles.note}>Review status is not stored yet. This is a suggested queue, not a list of unread items.</p></section>
    <section className={styles.section}><h2>Suggested Reviews</h2>{queue.length ? <div className={styles.reviewQueue}>{queue.map(({ session, arrowCount, average, xCount, tenPlusXCount }) => <article key={session.id} className={styles.reviewRow}>
      <span className={styles.reviewIdentity}><strong><Link href={`/organization/${organizationId}/athletes/${session.userId}`}>{result.perAthlete.find((item) => item.userId === session.userId)?.name ?? "Archer"}</Link></strong><small>{session.title} · {session.sessionType} · {formatDateOnly(session.date)}</small></span>
      <span className={styles.reviewMetrics}>{arrowCount} Arrows · {average?.toFixed(2) ?? "—"} avg · {tenPlusXCount} 10+X · {xCount} X</span>
      <Link className={styles.reviewAction} href={`/organization/${organizationId}/athletes/${session.userId}/sessions/${session.id}`}>Review Session →</Link>
    </article>)}</div> : <p className={styles.empty}>No Sessions currently match this review queue.</p>}</section>
    <section className={styles.section}><h2>Competition Reviews</h2><p className={styles.note}>Competition Sessions in the selected period.</p>{queue.filter(({ session }) => session.sessionType === "competition").length ? <ul className={styles.athleteList}>{queue.filter(({ session }) => session.sessionType === "competition").map(({ session }) => <li key={session.id}><Link className={styles.athleteLink} href={`/organization/${organizationId}/athletes/${session.userId}/sessions/${session.id}`}><strong>{session.title}</strong><span>{formatDateOnly(session.date)} · {result.perAthlete.find((item) => item.userId === session.userId)?.name ?? "Archer"}</span></Link></li>)}</ul> : <p className={styles.empty}>No Competition Sessions found.</p>}</section>
  </div>;
}
