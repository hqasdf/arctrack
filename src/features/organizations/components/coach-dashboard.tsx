import Link from "next/link";
import { buildCoachTeamAnalytics, DEFAULT_COACH_FILTERS, type CoachPeriod } from "@arc-track/core/coach-analytics";
import { formatDateOnly } from "@arc-track/core/dates";
import type { CoachSession } from "../coach-read.server";
import { athleteName, type CoachAthlete } from "../coach-model";
import { CoachLineChart, VerticalBarChart } from "./coach-charts";
import styles from "./coach.module.css";

export function CoachDashboard({ organization, athletes, sessions, today, period }: {
  organization: { id: string; name: string }; athletes: CoachAthlete[]; sessions: CoachSession[]; today: string; period: CoachPeriod;
}) {
  const result = buildCoachTeamAnalytics(athletes.map((athlete) => ({ userId: athlete.userId, name: athleteName(athlete) })), sessions, { ...DEFAULT_COACH_FILTERS, period }, today);
  const nameById = new Map(result.perAthlete.map((item) => [item.userId, item.name]));
  const athleteHref = (userId: string) => `/organization/${organization.id}/athletes/${userId}`;
  const sessionHref = (session: CoachSession) => `${athleteHref(session.userId)}/sessions/${session.id}`;
  const arrowCount = result.summary.arrowCount;
  const scoreTotal = result.distribution.reduce((total, item) => total + item.count * (item.score === "X" ? 10 : item.score === "M" ? 0 : Number(item.score)), 0);
  const tenPlusXCount = result.distribution.filter((item) => item.score === "X" || item.score === "10").reduce((total, item) => total + item.count, 0);
  const xCount = result.distribution.find((item) => item.score === "X")?.count ?? 0;
  const tenPlusXRate = arrowCount ? tenPlusXCount / arrowCount * 100 : null;
  const spotlight = [...result.perAthlete].sort((a, b) => (b.latestSession?.date ?? "").localeCompare(a.latestSession?.date ?? ""))[0];

  return <div className={`${styles.workspace} ${styles.dashboard}`}>
    <header className={styles.dashboardIntro}>
      <div><p className={styles.eyebrow}>Head Coach · Overview</p><h1>Team performance</h1><p>{organization.name} · Read-only view of active Archer members</p></div>
      <nav className={styles.periodTabs} aria-label="Overview period">{(["7", "30", "90", "all"] as CoachPeriod[]).map((value) => <Link key={value} aria-current={period === value ? "page" : undefined} href={value === "30" ? `/organization/${organization.id}` : `/organization/${organization.id}?period=${value}`}>{value === "all" ? "All time" : `${value} days`}</Link>)}</nav>
    </header>
    <section className={styles.overview} aria-label="Organisation summary">
      <Metric label="Active Archers" value={result.summary.activeArchers}/><Metric label="Active this period" value={result.summary.activeThisPeriod}/><Metric label="Sessions" value={result.summary.sessionCount}/>
      <Metric label="Scored Arrows" value={arrowCount}/><Metric label="Avg / Arrow" value={arrowCount ? (scoreTotal / arrowCount).toFixed(2) : "—"}/><Metric label="10+X rate" value={tenPlusXRate === null ? "—" : `${tenPlusXRate.toFixed(1)}%`}/>
    </section>
    <div className={styles.dashboardGrid}>
      <section className={`${styles.section} ${styles.performancePanel}`}><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Saved scoring</p><h2>Team Performance</h2></div><Link href={`/organization/${organization.id}/analytics`}>Explore analytics →</Link></div><p className={styles.note}>Average score per Arrow over time</p>
        {arrowCount ? <CoachLineChart yLabel="Avg / Arrow" maxValue={10} points={result.series.filter((point) => point.scoreAverage !== null).map((point) => ({ label: point.label, value: point.scoreAverage, tooltip: `${point.label}: ${point.scoreAverage?.toFixed(2)} avg/Arrow · ${point.arrowCount} Arrows` }))}/> : <p className={styles.empty}>No scored Arrows in this period.</p>}
      </section>
      <section className={`${styles.section} ${styles.targetPanel}`} aria-label="Team accuracy"><div><p className={styles.eyebrow}>Team accuracy</p><h2>On target</h2></div><div className={styles.targetVisual} aria-hidden="true"><span>{tenPlusXRate === null ? "—" : `${tenPlusXRate.toFixed(1)}%`}</span></div>
        <div className={styles.accuracyDetails}><div><strong>{tenPlusXRate === null ? "—" : `${tenPlusXRate.toFixed(1)}%`}</strong><span>10+X rate</span></div><div><strong>{arrowCount ? `${(xCount / arrowCount * 100).toFixed(1)}%` : "—"}</strong><span>X rate</span></div></div><p className={styles.note}>{result.summary.trainingSessions} Training · {result.summary.competitionSessions} Competition Sessions</p>
      </section>
      <section className={`${styles.section} ${styles.volumePanel}`}><h2>Arrow Volume</h2><p className={styles.note}>Saved scored Arrows · {period === "all" ? "all time" : `last ${period} days`}</p>
        {arrowCount ? <VerticalBarChart yLabel="Arrows" points={result.series.filter((point) => point.arrowCount).map((point) => ({ label: point.label, value: point.arrowCount, tooltip: `${point.label}: ${point.arrowCount} scored Arrows · ${point.sessionCount} Sessions` }))}/> : <p className={styles.empty}>No Arrow Volume in this period.</p>}
      </section>
      <section className={`${styles.section} ${styles.distributionPanel}`}><h2>Score Distribution</h2><p className={styles.note}>From saved Arrow scores</p>
        {arrowCount ? <VerticalBarChart yLabel="Arrows" points={result.distribution.map((item) => ({ label: item.score, value: item.count, tooltip: `${item.score}: ${item.count} Arrows · ${item.percentage.toFixed(1)}%` }))}/> : <p className={styles.empty}>No scored Arrows in this period.</p>}
      </section>
      <section className={`${styles.section} ${styles.suggestedPanel}`}><div className={styles.sectionHeading}><h2>Suggested Reviews</h2><Link href={`/organization/${organization.id}/reviews`}>View all →</Link></div><p className={styles.note}>Recent completed or Competition Sessions. Review status is not stored.</p>
        {result.reviewQueue.length ? <ul className={styles.compactList}>{result.reviewQueue.slice(0, 3).map(({ session, arrowCount: count, average }) => <li key={session.id}><Link href={sessionHref(session)}><strong>{nameById.get(session.userId) ?? "Archer"}</strong><span>{session.title} · {formatDateOnly(session.date)}</span><small>{count} Arrows · {average?.toFixed(2) ?? "—"} avg/Arrow →</small></Link></li>)}</ul> : <p className={styles.empty}>No Sessions suggested for review.</p>}
      </section>
      <section className={`${styles.section} ${styles.spotlightPanel}`}><div className={styles.sectionHeading}><h2>Athlete Spotlight</h2><Link href={`/organization/${organization.id}/athletes`}>All athletes →</Link></div>
        {spotlight ? <><div className={styles.spotlightIdentity}><span className={styles.avatar} aria-hidden="true">{spotlight.name.trim().slice(0, 1).toUpperCase()}</span><div><strong>{spotlight.name}</strong><span>{spotlight.latestSession?.rounds.at(-1)?.division ?? "Division not recorded"}</span><small>Latest Session: {spotlight.latestSession ? formatDateOnly(spotlight.latestSession.date) : "None yet"}</small></div></div>
          <div className={styles.accuracyDetails}><div><strong>{spotlight.average?.toFixed(2) ?? "—"}</strong><span>Avg / Arrow</span></div><div><strong>{spotlight.tenPlusXRate === null ? "—" : `${spotlight.tenPlusXRate.toFixed(1)}%`}</strong><span>10+X rate</span></div><div><strong>{spotlight.arrowCount}</strong><span>Scored Arrows</span></div></div><Link className={styles.spotlightLink} href={athleteHref(spotlight.userId)}>View athlete performance →</Link></> : <p className={styles.empty}>No active Archers in this organisation yet.</p>}
      </section>
      <section className={`${styles.section} ${styles.recentPanel}`}><h2>Recent Sessions</h2>{result.recent.length ? <ul className={styles.recordList}>{result.recent.slice(0, 5).map(({ session, arrowCount: count, average }) => <li key={session.id}><div><strong><Link href={athleteHref(session.userId)}>{nameById.get(session.userId) ?? "Archer"}</Link></strong><span>{formatDateOnly(session.date)} · {session.sessionType}</span></div><div><strong><Link href={sessionHref(session)}>{session.title}</Link></strong><span>{count} Arrows · {average?.toFixed(2) ?? "—"} avg/Arrow</span></div></li>)}</ul> : <p className={styles.empty}>No athlete Sessions in this period.</p>}</section>
    </div>
  </div>;
}

function Metric({ value, label }: { value: number | string; label: string }) { return <div><strong>{value}</strong><span>{label}</span></div>; }
