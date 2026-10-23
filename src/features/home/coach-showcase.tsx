import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import styles from "./home.module.css";

// A server-rendered product illustration, never connected to athlete records.
export function CoachShowcase() {
  return <section className={styles.coaching} id="coaching" aria-labelledby="coaching-heading">
    <div className={styles.sectionTop}><span>INDIVIDUAL PRACTICE. SHARED PERSPECTIVE.</span><span>ARC TRACK / COACH DASHBOARD</span></div>
    <div className={styles.trainingHeading}>
      <div><p className={styles.eyebrow}>05 / COACHING</p><h2 id="coaching-heading">See the athlete.<br /><em>Understand the progress.</em></h2></div>
      <p>The Coach Dashboard brings your active Archer members into one workspace. Review their Sessions, compare performance over time and guide the next step.</p>
    </div>

    <div className={styles.coachFrame} aria-label="Illustrative Coach Dashboard with sample athlete data">
      <div className={styles.coachHeader}>
        <div><p className={styles.eyebrow}>HEAD COACH / OVERVIEW</p><h3>Team performance</h3><p>Read-only athlete insights. A clearer coaching perspective.</p></div>
        <span className={styles.sampleLabel}>Illustrative interface · sample data</span>
      </div>
      <dl className={styles.coachMetrics}>
        <div><dt>Active athletes</dt><dd>2</dd></div>
        <div><dt>Recent Sessions</dt><dd>6</dd></div>
        <div><dt>Latest average / Arrow</dt><dd>10.00</dd></div>
      </dl>
      <div className={styles.coachGrid}>
        <div className={styles.coachPanel}>
          <div className={styles.coachPanelTitle}><h4>Performance over time</h4><span>Average / Arrow</span></div>
          <svg className={styles.coachChart} viewBox="0 0 480 180" role="img" aria-label="Illustrative average score per Arrow rising from 9.2 to 10 across six Sessions">
            <g className={styles.coachGridLines}><path d="M42 22H456M42 82H456M42 142H456" /></g>
            <g className={styles.coachChartLabels}><text x="4" y="26">10.0</text><text x="4" y="86">9.5</text><text x="4" y="146">9.0</text><text x="42" y="173">Session 1</text><text x="400" y="173">Session 6</text></g>
            <path className={styles.coachTrendFill} d="M44 118L126 94L208 106L290 58L372 46L454 22V142H44Z" />
            <path className={styles.coachTrend} d="M44 118L126 94L208 106L290 58L372 46L454 22" />
            {[{ x: 44, y: 118 }, { x: 126, y: 94 }, { x: 208, y: 106 }, { x: 290, y: 58 }, { x: 372, y: 46 }, { x: 454, y: 22 }].map(point => <circle key={point.x} cx={point.x} cy={point.y} r="3.5" className={styles.coachTrendPoint} />)}
          </svg>
          <div className={styles.coachPanelTitle}><h4>Athlete overview</h4><span>Recent Sessions</span></div>
          <div className={styles.coachAthlete}><span className={styles.coachAvatar}>01</span><div><strong>Archer 01</strong><p>Outdoor practice · 70 m</p></div><div><strong>60 / 60</strong><p>Latest End · 6 Arrows</p></div></div>
          <div className={styles.coachAthlete}><span className={styles.coachAvatar}>02</span><div><strong>Archer 02</strong><p>Indoor practice · 18 m</p></div><div><strong>60 / 60</strong><p>Latest End · 6 Arrows</p></div></div>
        </div>
        <div className={styles.coachSide}>
          <div className={styles.coachPanel}>
            <div className={styles.coachPanelTitle}><h4>Training Plan progress</h4><Icon name="target" size={18} /></div>
            <p className={styles.coachPlanName}>Archer 01 · Weekly Arrow goal</p>
            <p className={styles.coachGoalValue}>450 <span>/ 1000 Arrows</span></p>
            <div className={styles.coachProgress} role="meter" aria-label="Sample weekly Arrow goal" aria-valuemin={0} aria-valuemax={1000} aria-valuenow={450}><span /></div>
            <p className={styles.coachCaption}>Weekly goals and daily targets give training a direction.</p>
          </div>
          <div className={styles.coachPanel}>
            <div className={styles.coachPanelTitle}><h4>Session feedback</h4><Icon name="sessions" size={18} /></div>
            <p className={styles.coachPlanName}>For Archer 01 · Outdoor practice</p>
            <blockquote className={styles.coachFeedback}>“Keep the same deliberate shot routine for the next Session. Compare the grouping across each End.”</blockquote>
            <p className={styles.coachCaption}>Session-specific feedback, shared with the athlete.</p>
          </div>
        </div>
      </div>
    </div>

    <div className={styles.coachBenefits}>
      <article><Icon name="organization" /><h3>One team. A clear overview.</h3><p>Review multiple active athletes and their recent Sessions from the Coach’s Workspace.</p></article>
      <article><Icon name="analytics" /><h3>Follow the work over time.</h3><p>Use score trends, athlete analytics and Training Plan progress to put results in context.</p></article>
      <article><Icon name="sessions" /><h3>Make feedback specific.</h3><p>Connect coaching feedback to a Session, so the athlete can revisit it alongside their practice.</p></article>
    </div>
    <Link href="/sign-up" className={styles.textLink}>Get started as an archer or coach <span aria-hidden="true">↗</span></Link>
  </section>;
}
