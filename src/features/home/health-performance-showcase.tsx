"use client";

import Link from "next/link";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import styles from "./health-performance.module.css";

const previews = [
  { label: "Overview", icon: "heart", title: "Your training has a wider story.", copy: "Keep available sleep, daily wellness and activity measurements alongside your archery journal. Look for context, without turning missing data into a result." },
  { label: "Sleep", icon: "moon", title: "See the night behind the next Session.", copy: "Explore total sleep, Light, Deep, REM and Awake periods, sleep timing and trends. Garmin’s official Sleep Score and quality description appear when supplied." },
  { label: "Daily health", icon: "battery", title: "A little more context. Every day.", copy: "Follow resting heart rate, stress, Body Battery, steps and recorded activity minutes. Each measurement depends on your device, permissions and Garmin delivery." },
  { label: "Activities", icon: "activity", title: "Keep the work between Sessions in view.", copy: "Browse imported Garmin activities by date and type. Review duration, available distance and average heart rate, then select an overlapping recording in Session Health." },
  { label: "Session HR", icon: "analytics", title: "Put recorded heart rate beside your shooting.", copy: "Choose a Garmin activity and inspect available timestamped samples across its recorded interval. Dedicated activity recordings and lower-resolution all-day fallback are identified separately." },
] as const;

// Public illustrations only. No athlete DTOs, authenticated readers or network requests.
const illustrativeRestingHR = [57, 55, 56, 54, 55, 53, 54];
const illustrativeSleepScores = [78, 82, null, 86, 81, 88, 86];
const illustrativeSessionHR = [82, 88, 96, 112, 104, null, 98, 126, 108, 92, 90, 86];
const sleepStages = [
  { label: "Light", duration: "4h 10m", minutes: 250, tone: "light" },
  { label: "Deep", duration: "1h 32m", minutes: 92, tone: "deep" },
  { label: "REM", duration: "2h 00m", minutes: 120, tone: "rem" },
  { label: "Awake", duration: "18m", minutes: 18, tone: "awake" },
] as const;

export function HealthPerformanceShowcase() {
  const [selected, setSelected] = useState(0);
  const id = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const preview = previews[selected];
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? previews.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + previews.length) % previews.length;
    setSelected(next); buttons.current[next]?.focus();
  }
  return <section id="health-performance" className={styles.section} aria-labelledby="health-performance-heading">
    <div className={styles.sectionTop}><span>THE ATHLETE. BEYOND THE SCORE.</span><span>ARC TRACK / HEALTH &amp; PERFORMANCE</span></div>
    <div className={styles.intro}>
      <div><p className={styles.eyebrow}>06 / THE CONNECTED PICTURE</p><h2 id="health-performance-heading">Your performance.<br /><em>Beyond the target.</em></h2></div>
      <div><p>Bring your archery journal and available Garmin health insights into one experience. From the night before to the work on the line, give your training a little more context.</p><Link className={styles.inlineLink} href="/analytics/health">Explore Health <Icon name="arrow" size={17} /></Link></div>
    </div>

    <div className={styles.showcase}>
      <div className={styles.story}>
        <span className={styles.connection}><Icon name="check" size={15} /> CONNECT WITH GARMIN</span>
        <div role="tablist" aria-label="Explore illustrative Health features" className={styles.tabs}>
          {previews.map((item, index) => <button key={item.label} ref={element => { buttons.current[index] = element; }} type="button" role="tab" id={`${id}-tab-${index}`} aria-selected={selected === index} aria-controls={`${id}-panel`} tabIndex={selected === index ? 0 : -1} onClick={() => setSelected(index)} onKeyDown={event => navigate(event, index)}><Icon name={item.icon} size={18} /><span>{item.label}</span><span className={styles.tabArrow} aria-hidden="true">↗</span></button>)}
        </div>
        <div className={styles.storyCopy}><h3>{preview.title}</h3><p>{preview.copy}</p></div>
        <p className={styles.availability}>New records arrive after Garmin Connect syncs and Garmin delivers them. Historical backfill is not included.</p>
      </div>
      <div className={styles.preview} role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${selected}`} tabIndex={0}>
        <div className={styles.previewHeader}><span><Icon name={preview.icon} size={19} /> ARC TRACK HEALTH</span><span className={styles.sample}>Illustrative data · not your measurements</span></div>
        <div className={styles.previewBody} key={selected}>
          {selected === 0 && <>
            <PanelTitle eyebrow="YOUR DAILY PERSPECTIVE" title="Health Overview" detail="An example of a connected account" />
            <div className={styles.metrics}><Metric label="Sleep" value="7h 42m" icon="moon" /><Metric label="Resting HR" value="54" unit="bpm" icon="heart" /><Metric label="Steps" value="8,420" icon="steps" /><Metric label="Body Battery" value="76" unit="/ 100" icon="battery" /></div>
            <div className={styles.chartCard}><div className={styles.cardHeading}><h4>Resting heart rate</h4><span>7 illustrative days · bpm</span></div><Trend values={illustrativeRestingHR} min={50} max={60} label="Illustrative resting heart rate: 57, 55, 56, 54, 55, 53 and 54 bpm" /></div>
            <p className={styles.previewNote}><Icon name="check" size={15} /> Private measurements. Clear gaps when data is unavailable.</p>
          </>}
          {selected === 1 && <>
            <PanelTitle eyebrow="RECOVERY STARTS OVERNIGHT" title="A closer look at sleep" detail="Illustrative overnight record · Singapore time" />
            <div className={styles.sleepHeadline}><div><span>Total time asleep</span><strong>7h <small>42m</small></strong><p>22:30 → 06:30 · overnight</p></div><div className={styles.score}><span>Garmin Sleep Score</span><strong>86<small>/ 100</small></strong><span>Good · example qualifier</span></div></div>
            <div className={styles.stageBar} role="img" aria-label="Illustrative sleep window: Light 4 hours 10 minutes, Deep 1 hour 32 minutes, REM 2 hours, Awake 18 minutes. Awake is excluded from total time asleep.">{sleepStages.map(stage => <span key={stage.label} data-stage={stage.tone} style={{ flex: stage.minutes }} />)}</div>
            <dl className={styles.stageLegend}>{sleepStages.map(stage => <div key={stage.label}><dt><i data-stage={stage.tone} aria-hidden="true" />{stage.label}</dt><dd>{stage.duration}</dd></div>)}</dl>
            <div className={styles.chartCard}><div className={styles.cardHeading}><h4>Sleep Score trend</h4><span>0–100 · missing days stay missing</span></div><Trend values={illustrativeSleepScores} min={0} max={100} label="Illustrative Sleep Scores: 78, 82, no record, 86, 81, 88 and 86. The missing day is not connected." /></div>
            <p className={styles.previewNote}>Duration and score trends are supported. Scores, stages and later refinements depend on the record Garmin supplies.</p>
          </>}
          {selected === 2 && <>
            <PanelTitle eyebrow="THE EVERYDAY CONTEXT" title="Daily health, clearly presented." detail="Illustrative values · availability varies" />
            <div className={styles.dailyMetrics}><Metric label="Resting heart rate" value="54" unit="bpm" icon="heart" /><Metric label="Average stress" value="34" unit="/ 100" icon="activity" /><Metric label="Body Battery" value="76" unit="/ 100" icon="battery" /><Metric label="Steps" value="8,420" icon="steps" /><Metric label="Activity time" value="48" unit="min" icon="activity" /><Metric label="Time asleep" value="7h 42m" icon="moon" /></div>
            <div className={styles.quietCard}><Icon name="analytics" size={26} /><div><h4>Follow the days. Keep the context.</h4><p>Review daily values and trends with date filters. Unavailable measurements stay unavailable, rather than becoming zero.</p></div></div>
          </>}
          {selected === 3 && <>
            <PanelTitle eyebrow="MOVEMENT BETWEEN THE ARROWS" title="Your activity history" detail="Illustrative recordings · no real account connected" />
            <div className={styles.activityList}>{[{ type: "Archery", time: "09:00 · example day", duration: "75 min", hr: "98 bpm", distance: "Distance unavailable" }, { type: "Walking", time: "18:20 · example day", duration: "28 min", hr: "107 bpm", distance: "2.1 km" }].map(activity => <div className={styles.activityRow} key={activity.type}><span className={styles.activityIcon}><Icon name="activity" size={22} /></span><div><h4>{activity.type}</h4><p>{activity.time}</p><small>{activity.distance}</small></div><div><strong>{activity.duration}</strong><p>{activity.hr} average</p></div></div>)}</div>
            <div className={styles.quietCard}><Icon name="sessions" size={26} /><div><h4>Choose the recording. Keep scoring independent.</h4><p>Find recordings that overlap your Session date, then explicitly choose the right activity. Linking a recording does not import a scorecard or change your scores.</p></div></div>
            <p className={styles.previewNote}>Activity summaries and detailed HR are separate deliveries. A summary does not guarantee recorded HR samples.</p>
          </>}
          {selected === 4 && <>
            <PanelTitle eyebrow="PRIVATE SESSION HEALTH" title="The rhythm of a Session" detail="Feature preview · detailed activity delivery verification pending" />
            <div className={styles.interval}><span><Icon name="sessions" size={17} /> Garmin recording</span><strong>09:00–10:15 SGT</strong><span>Illustrative linked activity</span></div>
            <div className={styles.chartCard}><div className={styles.cardHeading}><h4>Recorded heart rate</h4><span>Illustrative samples · bpm</span></div><Trend values={illustrativeSessionHR} min={60} max={140} label="Illustrative Session heart-rate samples, between 82 and 126 bpm, with a break for missing data. Not a live recording." /><div className={styles.chartEnds}><span>09:00</span><span>Gaps remain gaps</span><span>10:15</span></div></div>
            <div className={styles.hrFacts}><div><span>Inspect</span><strong>Original samples</strong></div><div><span>Review</span><strong>Average · min · max</strong></div><div><span>Understand</span><strong>Recording coverage</strong></div></div>
            <p className={styles.previewNote}>The released interface supports interactive inspection. Actual workout HR depends on Garmin Activity Details delivery; all-day fallback is lower resolution when available. No live streaming or historical backfill is promised.</p>
          </>}
        </div>
      </div>
    </div>

    <div className={styles.connectionFlow} aria-label="How Garmin measurements reach Arc Track">{["Connect Garmin & grant permission", "Record & sync with Garmin Connect", "Garmin delivers supported records", "Review your private measurements"].map((step, index) => <div key={step}><span>0{index + 1}</span><p>{step}</p></div>)}</div>
    <div className={styles.privacy}>
      <div><p className={styles.eyebrow}>YOUR DATA. YOUR DECISION.</p><h3>Connected to your training.<br /><em>Private to you.</em></h3><p>Health measurements are owner-only. Joining an Organisation or sharing a Session does not share your Garmin heart rate with coaches.</p></div>
      <ul><li><Icon name="check" size={17} /><span><strong>Pause and explicitly resume.</strong> Control when eligible measurements can be imported.</span></li><li><Icon name="check" size={17} /><span><strong>Delete Health Data.</strong> Remove Arc Track’s imported copies, keep Garmin connected and pause syncing until you choose to resume.</span></li><li><Icon name="check" size={17} /><span><strong>Disconnect with control.</strong> Successful disconnection removes Arc Track’s imported Health data. Your Garmin originals remain with Garmin.</span></li></ul>
      <Link href="/privacy#garmin" className={styles.inlineLink}>Read the Garmin privacy details <Icon name="arrow" size={17} /></Link>
    </div>
    <div className={styles.cta}><p>Start with your next Arrow.<br /><strong>Build the wider picture over time.</strong></p><Link href="/sign-up">Create your Arc Track account <Icon name="arrow" size={18} /></Link></div>
  </section>;
}

function PanelTitle({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return <div className={styles.panelTitle}><p>{eyebrow}</p><h3>{title}</h3><span>{detail}</span></div>;
}
function Metric({ label, value, unit, icon }: { label: string; value: string; unit?: string; icon: "heart" | "moon" | "steps" | "battery" | "activity" }) {
  return <div className={styles.metric}><span><Icon name={icon} size={17} />{label}</span><strong>{value}{unit && <small>{unit}</small>}</strong></div>;
}
function Trend({ values, min, max, label }: { values: ReadonlyArray<number | null>; min: number; max: number; label: string }) {
  const segments: Array<Array<[number, number]>> = []; let segment: Array<[number, number]> = [];
  values.forEach((value, index) => { if (value === null) { if (segment.length) segments.push(segment); segment = []; } else segment.push([32 + index / (values.length - 1) * 456, 126 - (value - min) / (max - min) * 108]); });
  if (segment.length) segments.push(segment);
  const labels: ReactNode = <g className={styles.axis}><text x="0" y="22">{max}</text><text x="0" y="130">{min}</text></g>;
  return <svg className={styles.trend} viewBox="0 0 510 145" role="img" aria-label={label}><path className={styles.grid} d="M32 18H492M32 72H492M32 126H492" />{labels}{segments.map((points, i) => <g key={i}><polyline className={styles.line} points={points.map(p => p.join(",")).join(" ")} />{points.map(([x, y]) => <circle key={x} cx={x} cy={y} r="3.5"><title>{`Illustrative value: ${Math.round(min + (126 - y) / 108 * (max - min))}`}</title></circle>)}</g>)}</svg>;
}
