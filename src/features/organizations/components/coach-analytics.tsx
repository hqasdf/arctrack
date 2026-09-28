"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { buildCoachTeamAnalytics, coachFilterOptions, DEFAULT_COACH_FILTERS, type CoachFilters, type CoachPeriod } from "@arc-track/core/coach-analytics";
import { formatDateOnly } from "@arc-track/core/dates";
import type { CoachSession } from "../coach-read.server";
import { athleteName, type CoachAthlete } from "../coach-model";
import { CoachLineChart, VerticalBarChart } from "./coach-charts";
import styles from "./coach.module.css";

export function CoachAnalytics({ organization, athletes, sessions, today }: {
  organization: { id: string; name: string }; athletes: CoachAthlete[]; sessions: CoachSession[]; today: string;
}) {
  const [filters, setFilters] = useState<CoachFilters>(DEFAULT_COACH_FILTERS);
  const options = useMemo(() => coachFilterOptions(sessions, today, filters), [sessions, today, filters]);
  const result = useMemo(() => buildCoachTeamAnalytics(athletes.map((athlete) => ({ userId: athlete.userId, name: athleteName(athlete) })), sessions, filters, today), [athletes, sessions, filters, today]);
  const set = <K extends keyof CoachFilters>(key: K, value: CoachFilters[K]) => setFilters((current) => ({ ...current, [key]: value }));
  const short = (name: string) => name.length > 18 ? `${name.slice(0, 17)}…` : name;
  const noArrows = <p className={styles.empty}>No Arrow data available for these filters.</p>;
  const hasArrows = result.summary.arrowCount > 0;
  return <div className={styles.workspace}>
    <header className={styles.heading}><p className={styles.eyebrow}>Head Coach · Deep analytics</p><h1>Team Analytics</h1><p>{organization.name} · Read-only analysis of active Archer members.</p></header>
    <section className={styles.section} aria-label="Team filters"><h2>Filters</h2><div className={styles.filterGrid}>
      <label>Period<select value={filters.period} onChange={(event) => set("period", event.target.value as CoachPeriod)}><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="all">All time</option></select></label>
      <label>Session type<select value={filters.sessionType} onChange={(event) => set("sessionType", event.target.value as CoachFilters["sessionType"])}><option value="all">All</option><option value="training">Training</option><option value="competition">Competition</option></select></label>
      <label>Distance<select value={filters.distance} onChange={(event) => set("distance", event.target.value === "all" ? "all" : Number(event.target.value))}><option value="all">All distances</option>{options.distances.map((value) => <option key={value} value={value}>{value} m</option>)}</select></label>
      <label>Division<select value={filters.division} onChange={(event) => set("division", event.target.value)}><option value="all">All divisions</option>{options.divisions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Target face<select value={filters.targetFace} onChange={(event) => set("targetFace", event.target.value)}><option value="all">All faces</option>{options.targetFaces.map((face) => <option key={face.value} value={face.value}>{face.label}</option>)}</select></label>
    </div><p className={styles.note}>Arrow metrics count saved scored Arrows, so Round filters apply consistently. With a Round filter, Sessions without a matching Round are excluded.</p></section>
    <section className={styles.overview} aria-label="Organisation summary"><Metric label="Active Archers" value={result.summary.activeArchers}/><Metric label="Active this period" value={result.summary.activeThisPeriod}/><Metric label="Sessions" value={result.summary.sessionCount}/><Metric label="Scored Arrows" value={result.summary.arrowCount}/><Metric label="Training Sessions" value={result.summary.trainingSessions}/><Metric label="Competition Sessions" value={result.summary.competitionSessions}/></section>
    <div className={styles.analyticsLead}>
      <section className={styles.section}><h2>Team Performance Trend</h2><p className={styles.note}>Team Average Score / Arrow across saved scores in each period.</p>{hasArrows ? <CoachLineChart yLabel="Avg / Arrow" maxValue={10} points={result.series.filter((point) => point.scoreAverage !== null).map((point) => ({ label: point.label, value: point.scoreAverage, tooltip: `${point.label}: ${point.scoreAverage?.toFixed(2)} avg/Arrow · ${point.arrowCount} Arrows` }))}/> : noArrows}</section>
      <section className={styles.section}><h2>Team Arrow Volume</h2>{hasArrows ? <VerticalBarChart yLabel="Arrows" points={result.series.filter((point) => point.arrowCount).map((point) => ({ label: point.label, value: point.arrowCount, tooltip: `${point.label}: ${point.arrowCount} scored Arrows · ${point.sessionCount} Sessions` }))}/> : noArrows}</section>
    </div>
    <div className={styles.chartPair}>
      <section className={styles.section}><h2>Arrow Volume by Athlete</h2>{hasArrows ? <VerticalBarChart yLabel="Arrows" points={result.perAthlete.filter((item) => item.arrowCount).map((item) => ({ label: short(item.name), value: item.arrowCount, tooltip: `${item.name}: ${item.arrowCount} scored Arrows · ${item.sessionCount} Sessions`, href: `/organization/${organization.id}/athletes/${item.userId}` }))}/> : noArrows}</section>
      <section className={styles.section}><h2>Average Score by Athlete</h2>{hasArrows ? <VerticalBarChart yLabel="Avg / Arrow" points={result.perAthlete.filter((item) => item.average !== null).map((item) => ({ label: short(item.name), value: item.average!, tooltip: `${item.name}: ${item.average!.toFixed(2)} avg/Arrow · ${item.arrowCount} Arrows · ${item.sessionCount} Sessions`, href: `/organization/${organization.id}/athletes/${item.userId}` }))}/> : noArrows}</section>
    </div>
    <div className={styles.chartPair}>
      <section className={styles.section}><h2>Team Accuracy Trend</h2>{hasArrows ? <CoachLineChart yLabel="10+X %" secondaryLabel="X %" maxValue={100} points={result.series.filter((point) => point.tenPlusXRate !== null).map((point) => ({ label: point.label, value: point.tenPlusXRate, secondary: point.xRate, tooltip: `${point.label}: ${point.tenPlusXRate?.toFixed(1)}% 10+X · ${point.xRate?.toFixed(1)}% X · ${point.arrowCount} Arrows` }))}/> : noArrows}</section>
      <section className={styles.section}><h2>Team Session Activity</h2>{result.summary.sessionCount ? <CoachLineChart yLabel="Sessions" points={result.series.filter((point) => point.sessionCount).map((point) => ({ label: point.label, value: point.sessionCount, tooltip: `${point.label}: ${point.sessionCount} Sessions` }))}/> : <p className={styles.empty}>No team Sessions in this period.</p>}</section>
    </div>
    <div className={styles.chartPair}>
      <section className={styles.section}><h2>Accuracy by Athlete</h2>{hasArrows ? <VerticalBarChart yLabel="Percent" secondaryLabel="X %" points={result.perAthlete.filter((item) => item.tenPlusXRate !== null).map((item) => ({ label: short(item.name), value: item.tenPlusXRate!, secondary: item.xRate ?? 0, tooltip: `${item.name}: ${item.tenPlusXRate!.toFixed(1)}% 10+X · ${item.xRate!.toFixed(1)}% X · ${item.arrowCount} Arrows`, href: `/organization/${organization.id}/athletes/${item.userId}` }))}/> : noArrows}</section>
      <section className={styles.section}><h2>Team Performance by Distance</h2>{result.byDistance.length ? <VerticalBarChart yLabel="Avg / Arrow" points={result.byDistance.map((item) => ({ label: `${item.distance} m`, value: item.average, tooltip: `${item.distance} m: ${item.average.toFixed(2)} avg/Arrow · ${item.arrowCount} Arrows · ${item.athleteCount} athletes` }))}/> : noArrows}</section>
    </div>
    <section className={styles.section}><h2>Team Score Distribution</h2>{hasArrows ? <VerticalBarChart yLabel="Arrows" points={result.distribution.map((item) => ({ label: item.score, value: item.count, tooltip: `${item.score}: ${item.count} Arrows · ${item.percentage.toFixed(1)}%` }))}/> : noArrows}</section>
    <section className={styles.section}><h2>Team Training vs Competition</h2>{result.summary.sessionCount ? <div className={styles.typeCards}>{result.byType.map((item) => <div key={item.type}><strong>{item.type === "training" ? "Training" : "Competition"}</strong><span>{item.sessionCount} Sessions</span><span>{item.arrowCount} scored Arrows</span><span>{item.average === null ? "No score data" : `${item.average.toFixed(2)} avg/Arrow`}</span></div>)}</div> : <p className={styles.empty}>No team Sessions in this period.</p>}</section>
    <div className={styles.chartPair}>
      <section className={styles.section}><h2>Athlete Roster</h2>{athletes.length ? <ul className={styles.athleteList}>{result.perAthlete.map((item) => <li key={item.userId}><Link className={styles.athleteLink} href={`/organization/${organization.id}/athletes/${item.userId}`}><strong>{item.name}</strong><span>{item.sessionCount ? `${item.sessionCount} Sessions · ${item.arrowCount} scored Arrows` : "No Sessions in this period"}</span></Link></li>)}</ul> : <p className={styles.empty}>No active Archers in this organisation yet.</p>}</section>
      <section className={styles.section}><h2>Recent Athlete Activity</h2>{result.recent.length ? <ul className={styles.recordList}>{result.recent.map(({ session, arrowCount, average }) => <li key={session.id}><div><strong><Link href={`/organization/${organization.id}/athletes/${session.userId}`}>{result.perAthlete.find((item) => item.userId === session.userId)?.name ?? "Archer"}</Link></strong><span>{formatDateOnly(session.date)} · {session.sessionType}</span></div><div><strong><Link href={`/organization/${organization.id}/athletes/${session.userId}/sessions/${session.id}`}>{session.title}</Link></strong><span>{arrowCount} scored Arrows · {average?.toFixed(2) ?? "—"} avg/Arrow</span></div></li>)}</ul> : <p className={styles.empty}>No team Sessions in this period.</p>}</section>
    </div>
  </div>;
}

function Metric({ value, label }: { value: number; label: string }) { return <div><strong>{value}</strong><span>{label}</span></div>; }
