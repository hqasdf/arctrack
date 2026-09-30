"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { buildCoachTeamAnalytics, DEFAULT_COACH_FILTERS } from "@arc-track/core/coach-analytics";
import { formatDateOnly } from "@arc-track/core/dates";
import type { CoachSession } from "../coach-read.server";
import { athleteName, type CoachAthlete } from "../coach-model";
import styles from "./coach.module.css";

export function CoachDirectory({ organizationId, athletes, sessions, today }: { organizationId: string; athletes: CoachAthlete[]; sessions: CoachSession[]; today: string }) {
  const [search, setSearch] = useState("");
  const [division, setDivision] = useState("all");
  const [activity, setActivity] = useState("all");
  const [sort, setSort] = useState("name");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const result = useMemo(() => buildCoachTeamAnalytics(athletes.map((athlete) => ({ userId: athlete.userId, name: athleteName(athlete) })), sessions, DEFAULT_COACH_FILTERS, today), [athletes, sessions, today]);
  const divisions = [...new Set(result.perAthlete.flatMap((item) => item.latestSession?.rounds.map((round) => round.division) ?? []))].sort();
  const filtered = result.perAthlete.filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()) &&
    (division === "all" || item.latestSession?.rounds.some((round) => round.division === division)) &&
    (activity === "all" || (activity === "recent" ? item.sessionCount > 0 : item.sessionCount === 0)))
    .sort((a, b) => sort === "recent" ? (b.latestSession?.date ?? "").localeCompare(a.latestSession?.date ?? "") || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));
  return <div className={styles.workspace}><header className={`${styles.heading} ${styles.editorialHero}`}><p className={styles.eyebrow}>Head Coach · Directory</p><h1>Athletes</h1><p>{athletes.length} active Archers</p></header>
    <section className={`${styles.section} ${styles.filterSection}`}><div className={styles.filterGrid}><label>Search athletes<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Athlete name"/></label></div><button type="button" className={styles.filterToggle} aria-expanded={filtersOpen} aria-controls="directory-filters" onClick={() => setFiltersOpen((open) => !open)}>Filters{[division !== "all", activity !== "all", sort !== "name"].filter(Boolean).length ? ` · ${[division !== "all", activity !== "all", sort !== "name"].filter(Boolean).length} active` : ""}</button>{filtersOpen && <div id="directory-filters" className={styles.filterGrid}>
      <label>Division<select value={division} onChange={(event) => setDivision(event.target.value)}><option value="all">All divisions</option>{divisions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Activity<select value={activity} onChange={(event) => setActivity(event.target.value)}><option value="all">All athletes</option><option value="recent">Session in 30 days</option><option value="none">No Session in 30 days</option></select></label>
      <label>Sort<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="name">Name</option><option value="recent">Latest Session</option></select></label>
    </div>}</section>
    {filtered.length ? <div className={styles.directoryList}>{filtered.map((item) => <Link key={item.userId} href={`/organization/${organizationId}/athletes/${item.userId}`} className={styles.directoryRow}>
      <span className={styles.avatar} aria-hidden="true">{item.name.charAt(0).toUpperCase()}</span>
      <span className={styles.directoryIdentity}><strong>{item.name}</strong><small>{item.latestSession?.rounds.at(-1)?.division ?? "No division yet"} · Last Session {item.latestSession ? formatDateOnly(item.latestSession.date) : "None in 30 days"}</small></span>
      <span className={styles.directoryStats}><span><strong>{item.sessionCount}</strong> Sessions</span><span><strong>{item.arrowCount}</strong> Session Arrows</span><span><strong>{item.average?.toFixed(2) ?? "—"}</strong> avg/Arrow</span><span><strong>{item.tenPlusXRate?.toFixed(1) ?? "—"}%</strong> 10+X</span><span><strong>{item.xRate?.toFixed(1) ?? "—"}%</strong> X</span></span>
      <span className={styles.directoryArrow} aria-hidden="true">→</span>
    </Link>)}</div> : <p className={styles.empty}>No active Archers match these filters.</p>}
  </div>;
}
