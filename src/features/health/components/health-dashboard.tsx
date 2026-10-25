"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { GarminConnectionCard } from "@/features/garmin/components/garmin-connection-card";
import { average, chartDays, dateBefore, filterActivities, formatDay, formatMetric, METRICS, periodDays, supportsRange } from "../model";
import type { HealthDashboardData } from "../types";
import { ActivityList, ConnectionNotice, MetricCards, SleepDetails, WellnessSummary } from "./health-cards";
import { HealthChart } from "./health-chart";
import { HealthSyncControls } from "./health-sync-controls";
import type { GarminHealthControl } from "@/features/garmin/health/types";
import type { GarminView } from "@/features/garmin/types";
import styles from "./health.module.css";

export function HealthDashboard({ data, garminNotice }: { data: HealthDashboardData; garminNotice?: string }) {
  const router = useRouter();
  const [blockedData, setBlockedData] = useState<{ data: HealthDashboardData; message?: string } | null>(null);
  const [override, setOverride] = useState<{ control: GarminHealthControl; deleted: boolean } | null>(null);
  const control = override && (!data.control || Date.parse(override.control.changedAt) > Date.parse(data.control.changedAt)) ? override.control : data.control;
  const deletedLocally = override?.deleted && control === override.control;
  const refreshEnabled = !!data.sync && data.sync.state !== "disabled";
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    const visible = () => { if (document.visibilityState === "visible") { setBlockedData({ data }); router.refresh(); } };
    const timer = refreshEnabled ? window.setInterval(refresh, 60000) : undefined;
    document.addEventListener("visibilitychange", visible);
    return () => { if (timer !== undefined) window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [router, refreshEnabled, data]);
  useEffect(() => {
    if (data.access !== "connected" || !data.connection.expiresAt) return;
    const timer = window.setTimeout(() => { setBlockedData({ data }); router.refresh(); }, Math.max(0, Math.min(2147483647, Date.parse(data.connection.expiresAt) - Date.now())));
    return () => window.clearTimeout(timer);
  }, [data, router]);
  const invalidate = useCallback((message: string) => { setBlockedData({ data, message }); router.refresh(); }, [data, router]);
  const statusChanged = useCallback((status: GarminView) => {
    if (!status.available || status.status !== "connected" || status.error) setBlockedData({ data });
    router.refresh();
  }, [data, router]);
  const dataset = deletedLocally ? { kind: "empty" as const, days: [], activities: [], lastSyncedAt: null } : data.dataset;
  const { connection } = data;
  const latestDate = dataset.days.map((day) => day.date).sort().at(-1) ?? data.today;
  const [view, setView] = useState<"Overview" | "Trends" | "Activities">("Overview");
  // Follow newly imported dates until the user explicitly selects a date.
  const [selectedEnd, setEnd] = useState<string | null>(null);
  const end = selectedEnd ?? latestDate;
  const [range, setRange] = useState<7 | 30 | 90>(7);
  const [activityType, setActivityType] = useState("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "duration">("newest");
  const week = chartDays(dataset.days, end, 7);
  const selectedDays = periodDays(dataset.days, end, 7);
  const current = dataset.days.find((day) => day.date === end);
  const previous = dataset.days.find((day) => day.date === dateBefore(end, 1));
  const activities = filterActivities(dataset.activities, activityType, sort, end);
  function selectDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    setEnd(value);
    if (!supportsRange(dataset.days, value, range)) setRange(7);
  }
  const connectionControl = <GarminConnectionCard key={[connection.status, connection.available, connection.canConnect, connection.checkedAt, connection.expiresAt, connection.error].join(":")} initialStatus={connection} notice={garminNotice} placement="health" onStatusChange={statusChanged} />;
  const access = blockedData?.data === data ? "unavailable" : data.access;
  if (access !== "connected") return <div className={styles.dashboard} data-health-dashboard>
    <section className={styles.connectionGate} aria-labelledby="health-access-title">
      <span className={styles.eyebrow}>ARC TRACK · HEALTH</span><Icon name="heart" size={38} />
      <h1 id="health-access-title">{access === "connect" ? "Connect Garmin to view Health" : access === "reconnect" ? "Reconnect Garmin to view Health" : "Your Garmin connection could not be verified"}</h1>
      <p>{access === "unavailable" ? "Your measurements are hidden until the connection can be verified. This does not mean your Garmin account was disconnected or your data was deleted."
        : "Connect your Garmin account to see your private sleep, recovery and activity measurements alongside your archery training."}</p>
      {connectionControl}<p><a href="/privacy#garmin">How Arc Track uses Garmin data</a></p>
      {blockedData?.message && <p role="alert">{blockedData.message}</p>}
      {access === "unavailable" && <button type="button" onClick={() => router.refresh()}>Retry connection check</button>}
    </section>
  </div>;
  return <div className={styles.dashboard} data-health-dashboard>
    <header className={styles.header}><div><span className={styles.eyebrow}>ARC TRACK · HEALTH</span><h1>Health Overview</h1><p>Track your recovery, sleep, activity and overall wellness alongside your archery training.</p></div>
      <div className={styles.connectionStatus}>{connectionControl}{dataset.kind === "stored" && dataset.lastSyncedAt && <small>Last health sync: {new Intl.DateTimeFormat("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" }).format(new Date(dataset.lastSyncedAt))} SGT</small>}</div>
    </header>
    {blockedData?.message && <p role="alert">{blockedData.message}</p>}
    {control && <HealthSyncControls control={control} onUnconfirmed={invalidate} onChanged={(value, deleted) => { setBlockedData(null); setOverride({ control: value, deleted: deleted || !!deletedLocally }); router.refresh(); }} />}
    <ConnectionNotice data={{ ...data, dataset, control }} />
    <div className={styles.toolbar}><nav aria-label="Health views" className={styles.tabs}>{(["Overview", "Trends", "Activities"] as const).map((tab) => <button type="button" key={tab} aria-pressed={view === tab} onClick={() => setView(tab)}>{tab}</button>)}</nav><label className={styles.dateControl}>Through <input type="date" value={end} max={latestDate} onChange={(event) => selectDate(event.target.value)} aria-label="Health period ending date" /></label></div>
    {view === "Overview" && <>
      <div className={styles.sectionHeading}><h2>Your daily snapshot</h2><span>{formatDay(end)}</span></div>
      <MetricCards current={current} previous={previous} />
      <div className={styles.chartGrid}>
        <section className={styles.card}><div className={styles.cardHeading}><span className={styles.cardIcon} data-tone="lavender"><Icon name="moon" /></span><h2>Sleep</h2><span>7 days</span></div><p className={styles.chartValue}>{formatMetric("sleepMinutes", current?.sleepMinutes ?? null)}<small>Average {formatMetric("sleepMinutes", average(selectedDays, "sleepMinutes"))}</small></p><SleepDetails day={current} /><HealthChart days={week} metric="sleepMinutes" label="Sleep" tone="lavender" stacked />{selectedDays.some(day => day.sleepScore != null) && <details className={styles.sleepTrend}><summary>Garmin Sleep Score trend</summary><HealthChart days={week} metric="sleepScore" label="Garmin Sleep Score" tone="lavender" /></details>}</section>
        <section className={styles.card}><div className={styles.cardHeading}><span className={styles.cardIcon} data-tone="coral"><Icon name="heart" /></span><h2>Resting heart rate</h2><span>7 days</span></div><p className={styles.chartValue}>{formatMetric("restingHeartRate", current?.restingHeartRate ?? null)}<small>bpm · Average {formatMetric("restingHeartRate", average(selectedDays, "restingHeartRate"))}</small></p><HealthChart days={week} metric="restingHeartRate" label="Resting heart rate" tone="coral" /></section>
        <section className={styles.card}><div className={styles.cardHeading}><span className={styles.cardIcon} data-tone="blue"><Icon name="activity" /></span><h2>Activity</h2><span>7 days</span></div><p className={styles.chartValue}>{formatMetric("activityMinutes", current?.activityMinutes ?? null)}<small>min on selected day · {selectedDays.some((day) => day.activityMinutes !== null) ? `${selectedDays.reduce((sum, day) => sum + (day.activityMinutes ?? 0), 0)} recorded min over 7 days` : "Weekly total unavailable"}</small></p><HealthChart days={week} metric="activityMinutes" label="Activity minutes" tone="blue" /></section>
      </div>
      <div className={styles.lowerGrid}><WellnessSummary days={selectedDays} /><section className={styles.card}><div className={styles.sectionHeading}><div><span className={styles.eyebrow}>KEEP MOVING</span><h2>Recent activities</h2></div><button className={styles.textButton} type="button" onClick={() => setView("Activities")}>View all <span aria-hidden="true">↗</span></button></div><ActivityList activities={filterActivities(dataset.activities, "all", "newest", end).slice(0, 3)} /></section></div>
    </>}
    {view === "Trends" && <section aria-labelledby="trends-heading"><div className={styles.sectionHeading}><div><h2 id="trends-heading">Your health, over time</h2><p className={styles.muted}>Recorded measurements through {formatDay(end, true)}. Missing days stay empty.</p></div><div className={styles.range} aria-label="Trend period">{([7, 30, 90] as const).map((count) => <button type="button" key={count} disabled={!supportsRange(dataset.days, end, count)} aria-pressed={range === count} onClick={() => setRange(count)} title={supportsRange(dataset.days, end, count) ? `${count} days` : `Requires ${count} days of stored records`}>{count} days</button>)}</div></div><div className={styles.trendsGrid}>{METRICS.map((metric) => <section key={metric.key} className={styles.card}><div className={styles.cardHeading}><span className={styles.cardIcon} data-tone={metric.tone}><Icon name={metric.icon} /></span><h3>{metric.label}</h3></div><p className={styles.chartValue}>{formatMetric(metric.key, average(periodDays(dataset.days, end, range), metric.key))}<small>{metric.unit} · period average</small></p><HealthChart days={chartDays(dataset.days, end, range)} metric={metric.key} label={metric.label} tone={metric.tone} /></section>)}</div></section>}
    {view === "Activities" && <section className={styles.card} aria-labelledby="activities-heading"><div className={styles.sectionHeading}><div><span className={styles.eyebrow}>ACTIVITY HISTORY</span><h2 id="activities-heading">Every move, in one place</h2><p className={styles.muted}>Exercise activities only · times shown in Singapore time</p></div></div><div className={styles.activityFilters}><label>Activity type<select value={activityType} onChange={(event) => setActivityType(event.target.value)}><option value="all">All activities</option>{[...new Set(dataset.activities.map((activity) => activity.type))].sort().map((type) => <option key={type}>{type}</option>)}</select></label><label>Sort by<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="duration">Longest duration</option></select></label></div><ActivityList activities={activities} /></section>}
    <footer className={styles.footer}><span><Icon name="heart" size={14} />A broader view of your training life.</span><span>{dataset.kind === "stored" ? "Source: imported Garmin records" : data.sync && data.sync.state !== "disabled" ? "No processed health measurements available" : "Garmin health import is not yet active"}</span></footer>
  </div>;
}
