"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { buildCoachAthleteInsights, coachFilterOptions, DEFAULT_COACH_FILTERS, type CoachFilters, type CoachPeriod } from "@arc-track/core/coach-analytics";
import { formatDateOnly } from "@arc-track/core/dates";
import { targetFaceLabel } from "@arc-track/core/analytics";
import { summarizeCoachRound } from "@arc-track/core/coach-round";
import { trainingPlanStatus, type TrainingPlanProgress } from "@arc-track/core/training-plan";
import type { TrainingPlanRecord } from "../training-plans-read.server";
import { displayedWeek } from "./training-plan-ui";
import { athleteName, type CoachAthlete } from "../coach-model";
import type { SessionDraft } from "@/features/sessions/scoring-model";
import { CoachLineChart, VerticalBarChart } from "./coach-charts";
import styles from "./coach.module.css";

export function CoachAthleteDetail({ organization, athlete, sessions, today, trainingPlans }: { organization: { id: string; name: string }; athlete: CoachAthlete; sessions: SessionDraft[]; today: string; trainingPlans: Array<{ plan: TrainingPlanRecord; progress: TrainingPlanProgress }> | null }) {
  const [filters, setFilters] = useState<CoachFilters>(DEFAULT_COACH_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const identified = useMemo(() => sessions.map((session) => ({ ...session, userId: athlete.userId })), [sessions, athlete.userId]);
  const options = useMemo(() => coachFilterOptions(identified, today, filters), [identified, today, filters]);
  const result = useMemo(() => buildCoachAthleteInsights({ userId: athlete.userId, name: athleteName(athlete) }, identified, filters, today), [athlete, identified, filters, today]);
  const set = <K extends keyof CoachFilters>(key: K, value: CoachFilters[K]) => setFilters((current) => ({ ...current, [key]: value }));
  const base = `/organization/${organization.id}/athletes/${athlete.userId}`;
  const latest = result.filteredSessions.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
  const recentRounds = result.filteredRounds.filter(({ round }) => round.arrows.length > 0 && round.arrows.length === round.ends * round.arrowsPerEnd).sort((a, b) => b.session.date.localeCompare(a.session.date)).slice(0, 5);
  const noArrows = <p className={styles.empty}>No Arrow data available for these filters.</p>;
  const activePlans = (trainingPlans ?? []).filter(({ plan }) => trainingPlanStatus(plan.startDate, plan.endDate, today) === "Active");
  return <div className={styles.workspace}>
    <header className={`${styles.heading} ${styles.editorialHero}`}><Link href={`/organization/${organization.id}`} className={styles.back}>← {organization.name}</Link><p className={styles.eyebrow}>Head Coach · Athlete performance · Read only</p><h1>{athleteName(athlete)}</h1><p>{latest?.rounds.at(-1)?.division ?? "Division not recorded"} · Latest activity: {latest ? formatDateOnly(latest.date) : "No Session in this period"}</p><div className={styles.heroContext}>
      <div><strong className={styles.headlineMetric}>{result.overview.averagePerArrow?.toFixed(2) ?? "—"}</strong><span className={styles.headlineLabel}>Avg / Arrow</span></div>
      <div><strong>{result.overview.tenPlusXPercentage === null ? "—" : `${result.overview.tenPlusXPercentage.toFixed(1)}%`}</strong><span>10+X rate</span></div>
      <div><strong>{result.summary.arrowCount}</strong><span>Total Arrows</span></div>
    </div></header>
    {trainingPlans === null ? <p role="status">Training Plan progress could not be loaded. Refresh to retry.</p> : activePlans.length === 1 ? (() => { const { plan, progress } = activePlans[0]; const week = displayedWeek(progress, today); return <section className={styles.section}><p className={styles.chapterHeading}>Weekly training</p><h2>{plan.title}</h2><p>{week?.arrowTarget === null || !week ? "No weekly Arrow target" : `${week.arrowsCompleted} / ${week.arrowTarget} arrows · ${Math.round((week.progressRatio ?? 0) * 100)}% · ${week.goalReached ? week.amountAboveGoal ? `+${week.amountAboveGoal} above target` : "Goal complete" : `${week.arrowsRemaining} remaining`}`}</p><Link href={`/organization/${organization.id}/training-plans/${plan.id}`}>View Plan →</Link></section>; })() : activePlans.length > 1 ? <section className={styles.section}><h2>{activePlans.length} Active Training Plans</h2><ul className={styles.athleteList}>{activePlans.map(({ plan }) => <li key={plan.id}><Link className={styles.athleteLink} href={`/organization/${organization.id}/training-plans/${plan.id}`}>{plan.title} →</Link></li>)}</ul></section> : null}
    <section className={`${styles.section} ${styles.filterSection}`}><button type="button" className={styles.filterToggle} aria-expanded={filtersOpen} aria-controls="athlete-filters" onClick={() => setFiltersOpen((open) => !open)}>Filters{[filters.period !== DEFAULT_COACH_FILTERS.period, filters.sessionType !== "all", filters.distance !== "all", filters.division !== "all", filters.targetFace !== "all"].filter(Boolean).length ? ` · ${[filters.period !== DEFAULT_COACH_FILTERS.period, filters.sessionType !== "all", filters.distance !== "all", filters.division !== "all", filters.targetFace !== "all"].filter(Boolean).length} active` : ""}</button>{filtersOpen && <div id="athlete-filters" className={styles.filterGrid}>
      <label>Period<select value={filters.period} onChange={(event) => set("period", event.target.value as CoachPeriod)}><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="all">All time</option></select></label>
      <label>Session type<select value={filters.sessionType} onChange={(event) => set("sessionType", event.target.value as CoachFilters["sessionType"])}><option value="all">All</option><option value="training">Training</option><option value="competition">Competition</option></select></label>
      <label>Distance<select value={filters.distance} onChange={(event) => set("distance", event.target.value === "all" ? "all" : Number(event.target.value))}><option value="all">All distances</option>{options.distances.map((value) => <option key={value} value={value}>{value} m</option>)}</select></label>
      <label>Division<select value={filters.division} onChange={(event) => set("division", event.target.value)}><option value="all">All divisions</option>{options.divisions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Target face<select value={filters.targetFace} onChange={(event) => set("targetFace", event.target.value)}><option value="all">All faces</option>{options.targetFaces.map((face) => <option key={face.value} value={face.value}>{face.label}</option>)}</select></label>
    </div>}</section>
    <section className={`${styles.section} ${styles.leadSection}`}><h2>Performance Trend</h2>{result.sessionTrend.some((point) => point.average !== null) ? <CoachLineChart yLabel="Avg / Arrow" maxValue={10} points={result.sessionTrend.filter((point) => point.average !== null).map((point) => ({ label: formatDateOnly(point.session.date, false), value: point.average, tooltip: `${point.session.title} · ${formatDateOnly(point.session.date)} · ${point.average?.toFixed(2)} avg/Arrow · ${point.arrowCount} scored Arrows · ${point.session.sessionType}` }))}/> : noArrows}</section>
    <section className={styles.supportingMetrics} aria-label="Athlete summary">
      <Metric label="Sessions" value={String(result.summary.sessionCount)}/>
      <Metric label="X rate" value={result.overview.xPercentage === null ? "—" : `${result.overview.xPercentage.toFixed(1)}%`}/>
      <Metric label="Best completed Round" value={result.overview.bestRound ? `${result.overview.bestRound.name} · ${result.overview.bestRound.average.toFixed(2)}` : "—"}/>
      <Metric label="End variation" value={result.endVariation === null ? "Need 2 completed Ends" : `${result.endVariation.toFixed(2)} pts/Arrow`}/><Metric label="Avg group size" value={result.groupingTrend ? `${(result.groupingTrend.points.reduce((sum, point) => sum + point.groupSizeCm, 0) / result.groupingTrend.points.length).toFixed(1)} cm` : "—"}/>
      <Metric label="Latest Session" value={latest ? formatDateOnly(latest.date, false) : "—"}/>
    </section>
    <div className={styles.chartPair}>
      <section className={styles.section}><h2>Accuracy Trend</h2>{result.summary.scoredArrowCount ? <CoachLineChart yLabel="10+X %" secondaryLabel="X %" maxValue={100} points={result.sessionTrend.filter((point) => point.tenPlusXRate !== null).map((point) => ({ label: formatDateOnly(point.session.date, false), value: point.tenPlusXRate, secondary: point.xRate, tooltip: `${point.session.title}: ${point.tenPlusXRate?.toFixed(1)}% 10+X · ${point.xRate?.toFixed(1)}% X · ${point.arrowCount} scored Arrows` }))}/> : noArrows}</section>
      <section className={styles.section}><h2>Arrow Volume</h2>{result.summary.arrowCount ? <VerticalBarChart yLabel="Arrows" points={result.series.filter((point) => point.arrowCount).map((point) => ({ label: point.label, value: point.arrowCount, tooltip: `${point.label}: ${point.arrowCount} Session Arrows · ${point.sessionCount} Sessions` }))}/> : <p className={styles.empty}>No Session Arrow counts in this view.</p>}</section>
    </div>
    <div className={styles.chartPair}>
      <section className={styles.section}><h2>Grouping Trend</h2>{result.groupingTrend ? <><p className={styles.note}>Comparable format: {result.groupingTrend.format}. Group diameter from plotted Arrows only.</p><CoachLineChart yLabel="Group size cm" points={result.groupingTrend.points.map((point) => ({ label: formatDateOnly(point.date, false), value: point.groupSizeCm, tooltip: `${formatDateOnly(point.date)}: ${point.groupSizeCm.toFixed(1)} cm group size` }))}/></> : <p className={styles.empty}>Need at least two comparable Rounds with three plotted Arrows each.</p>}</section>
      <section className={styles.section}><h2>Score Distribution</h2>{result.summary.scoredArrowCount ? <VerticalBarChart yLabel="Scored Arrows" points={result.distribution.map((item) => ({ label: item.score, value: item.count, tooltip: `${item.score}: ${item.count} scored Arrows · ${item.percentage.toFixed(1)}%` }))}/> : noArrows}</section>
    </div>
    <div className={styles.chartPair}>
      <section className={styles.section}><h2>Performance by Distance</h2>{result.byDistance.length ? <VerticalBarChart yLabel="Avg / Arrow" points={result.byDistance.map((item) => ({ label: `${item.distance} m`, value: item.average, tooltip: `${item.distance} m: ${item.average.toFixed(2)} avg/Arrow · ${item.arrowCount} Arrows` }))}/> : noArrows}</section>
      <section className={styles.section}><h2>Training vs Competition</h2>{result.summary.sessionCount ? <div className={styles.typeCards}>{result.byType.map((item) => <div key={item.type}><strong>{item.type === "training" ? "Training" : "Competition"}</strong><span>{item.sessionCount} Sessions · {item.arrowCount} Session Arrows</span><span>{item.scoredArrowCount} scored · {item.average?.toFixed(2) ?? "—"} avg/Arrow</span><span>{item.tenPlusXRate?.toFixed(1) ?? "—"}% 10+X · {item.xRate?.toFixed(1) ?? "—"}% X</span></div>)}</div> : <p className={styles.empty}>No Sessions in this period.</p>}</section>
    </div>
    <section className={styles.section}><h2>End Consistency</h2><p className={styles.note}>Standard deviation of completed End averages; partial Ends are excluded.</p><p>{result.endVariation === null ? "Need at least two completed Ends." : `${result.endVariation.toFixed(2)} points per Arrow across ${result.completedEndCount} completed Ends.`}</p></section>
    <section className={styles.section}><h2>Recent Sessions</h2>{result.filteredSessions.length ? <ul className={styles.recordList}>{result.filteredSessions.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6).map((session) => {
      const trend = result.sessionTrend.find((item) => item.session.id === session.id);
      return <li key={session.id}><div><strong><Link href={`${base}/sessions/${session.id}`}>{session.title}</Link></strong><span>{formatDateOnly(session.date)} · {session.sessionType} · {session.rounds.length} Rounds</span></div><div><strong>{trend?.arrowCount ?? 0} scored Arrows</strong><span>{trend?.average?.toFixed(2) ?? "—"} avg/Arrow · {trend?.tenPlusXRate?.toFixed(1) ?? "—"}% 10+X · {trend?.xRate?.toFixed(1) ?? "—"}% X</span></div></li>;
    })}</ul> : <p className={styles.empty}>No Sessions recorded for these filters.</p>}</section>
    <section className={styles.section}><h2>Recent Rounds</h2>{recentRounds.length ? <ul className={styles.recordList}>{recentRounds.map(({ session, round }) => {
      const score = summarizeCoachRound(round);
      return <li key={round.id}><div><strong><Link href={`${base}/sessions/${session.id}/rounds/${round.id}`}>{round.name} · {round.distanceMetres} m</Link></strong><span>{formatDateOnly(session.date)} · {targetFaceLabel(round)}</span></div><div><strong>{score.total} pts</strong><span>{score.average?.toFixed(2) ?? "—"} avg/Arrow · {score.xCount} X</span></div></li>;
    })}</ul> : <p className={styles.empty}>No completed Rounds in these filters.</p>}</section>
  </div>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div><strong>{value}</strong><span>{label}</span></div>; }
