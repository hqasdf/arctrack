import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { connectionState, formatMetric, METRICS, wellnessSummary } from "../model";
import type { HealthActivity, HealthDashboardData, HealthDay } from "../types";
import styles from "./health.module.css";

export function ConnectionNotice({ data }: { data: HealthDashboardData }) {
  if (data.dataset.kind === "demo") return <aside className={styles.demoNotice}><strong>Demo Data</strong><span>Fictional, local design preview. These measurements are not your health records and have not been synced from Garmin.</span></aside>;
  if (data.sync?.state === "error") return <aside className={styles.connectionNotice}><div><h2>Health import needs attention.</h2><p>We could not confirm the latest import. Any measurements below are previously saved records, not confirmation of a new sync.</p><Link href="/profile">View connection settings</Link></div></aside>;
  if (data.sync?.state === "permission_revoked" || data.sync?.state === "reconciliation_required") return <aside className={styles.connectionNotice}><div><h2>Garmin sharing needs review.</h2><p>{data.sync.state === "permission_revoked" ? "Some Garmin sharing permissions are missing or were revoked. Affected measurements have been removed; imports require the relevant permission." : "Garmin reported a sharing change that needs verification. Imports are paused pending connection verification; this does not confirm account cleanup."}</p><Link href="/profile">View connection settings</Link></div></aside>;
  if (data.dataset.kind === "stored") return <aside className={styles.demoNotice}><strong>Garmin measurements</strong><span>Showing imported records for your account. Missing measurements remain unavailable.</span></aside>;
  const state = connectionState(data.connection);
  const messages = {
    connected: data.sync?.state === "waiting" ? ["Garmin connected. Waiting for the first measurements.", "No health measurements have been processed yet. Garmin account connection and health-data delivery are separate steps."] : ["Garmin is connected. Health import is next.", "Your account connection is ready. Automatic health-data import has not been activated; no measurements have been imported here."],
    unavailable: ["Your health overview, ready for what comes next.", "New Garmin connections are currently unavailable. Once connection and health import are available, your private measurements will appear here."],
    disconnected: ["Bring your everyday health into focus.", "Use Connect Garmin above to link your account. Health-data import is a separate step and is not available yet."],
    attention: ["Your Garmin connection needs attention.", "Review your connection in Profile. No new health measurements are available here."],
  };
  return <aside className={styles.connectionNotice}><span className={styles.noticeIcon}><Icon name="heart" size={25} /></span><div><h2>{messages[state][0]}</h2><p>{messages[state][1]}</p><Link href="/profile">{state === "disconnected" ? "Open Garmin settings" : "View connection settings"} <span aria-hidden="true">↗</span></Link></div></aside>;
}

export function MetricCards({ current, previous }: { current: HealthDay | undefined; previous: HealthDay | undefined }) {
  return <div className={styles.metrics}>{METRICS.map((metric) => {
    const value = current?.[metric.key] ?? null;
    const before = previous?.[metric.key] ?? null;
    const difference = value !== null && before !== null ? value - before : null;
    return <article className={styles.metric} key={metric.key} data-tone={metric.tone}>
      <div className={styles.metricHeading}><span className={styles.metricIcon}><Icon name={metric.icon} /></span><h2>{metric.label}</h2><details className={styles.info}><summary aria-label={`About ${metric.label}`}>i</summary><p>{metric.explanation}</p></details></div>
      <p className={styles.metricValue}>{formatMetric(metric.key, value)}{value !== null && <small>{metric.unit}</small>}</p>
      <p className={styles.comparison}>{difference === null ? value === null ? "No data available" : "No prior-day comparison" : `${difference > 0 ? "+" : difference < 0 ? "−" : ""}${formatMetric(metric.key, Math.abs(difference))}${metric.key === "sleepMinutes" ? "" : ` ${metric.unit}`} vs previous day`}</p>
    </article>;
  })}</div>;
}

export function WellnessSummary({ days }: { days: HealthDay[] }) {
  return <section className={`${styles.card} ${styles.wellness}`} aria-labelledby="wellness-heading">
    <div className={styles.wellnessArt} aria-hidden="true"><span /><span /><span /><Icon name="heart" size={38} /></div>
    <span className={styles.eyebrow}>THE BIGGER PICTURE</span><h2 id="wellness-heading">A little perspective.<br />A clearer picture.</h2>
    <p>{wellnessSummary(days)}</p><span className={styles.privacyNote}><Icon name="check" size={15} />Private to you. Never shared with coaches.</span>
  </section>;
}

export function ActivityList({ activities, demo }: { activities: HealthActivity[]; demo: boolean }) {
  if (!activities.length) return <div className={styles.activityEmpty}><Icon name="activity" size={28} /><h3>No imported activities</h3><p>Garmin exercise activities will appear after health import is available. Arc Track scoring Sessions are kept separate.</p></div>;
  return <ul className={styles.activityList}>{activities.map((activity) => <li key={activity.id}>
    <span className={styles.activityIcon}><Icon name={activity.type === "Walking" ? "steps" : "activity"} size={21} /></span>
    <div className={styles.activityDescription}><h3>{activity.type}</h3><time dateTime={activity.startedAt}>{new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Singapore" }).format(new Date(activity.startedAt))} SGT</time><span className={styles.activitySource}>{demo || activity.source === "demo" ? "Demo Data" : "Garmin"}</span></div>
    <div className={styles.activityValues}><strong>{Number(activity.durationMinutes.toFixed(1))} <small>min</small></strong><span>{activity.distanceKm === null ? "Distance unavailable" : `${activity.distanceKm.toLocaleString("en-SG", { maximumFractionDigits: 2 })} km`} · {activity.averageHeartRate === null ? "HR unavailable" : `${activity.averageHeartRate} bpm`}</span></div>
  </li>)}</ul>;
}
