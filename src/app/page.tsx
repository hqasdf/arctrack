import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { CinematicScene } from "@/features/home/cinematic-scene";
import { PrecisionDemo } from "@/features/home/precision-demo";
import { CoachShowcase } from "@/features/home/coach-showcase";
import { publicPageMetadata } from "@/lib/seo";
import styles from "@/features/home/home.module.css";

export const metadata = {
  ...publicPageMetadata(
    "/",
    "Archery Training & Performance",
    "Record archery Sessions, explore grouping insights and follow training progress. Arc Track gives archers clarity and coaches athlete analytics and Session feedback.",
  ),
  title: { absolute: "Arc Track | Archery Training & Performance" },
};

export default function HomePage() {
  return <main id="main-content" className={styles.home}>
    <a href="#introduction" className={styles.skip}>Skip to content</a>
    <header className={styles.header}>
      <Link href="/" aria-label="Arc Track home" className={styles.brand}><Icon name="target" size={27} /><span>ARC TRACK</span></Link>
      <nav aria-label="Homepage navigation" className={styles.nav}><a href="#precision">The precision</a><a href="#performance">The insights</a><a href="#training">The progress</a><a href="#coaching">For coaches</a></nav>
      <Link href="/sign-in" className={styles.signIn}>Sign in <span aria-hidden="true" className={styles.directionUp}><Icon name="arrow" size={14} /></span></Link>
    </header>

    <div className={styles.story} data-archery-story>
      <CinematicScene />
      <section className={styles.hero} id="introduction" aria-labelledby="hero-heading">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}><span className={styles.liveDot} /> A MORE INTENTIONAL WAY TO TRAIN</p>
          <h1 id="hero-heading">EVERY ARROW.<br />EVERY INSIGHT.<br /><em>EVERY STEP<br className={styles.mobileBreak} /> FORWARD.</em></h1>
          <p className={styles.heroDescription}>Your practice has a story.<br />See it clearly. Share the perspective with your coach.</p>
          <div className={styles.actions}><Link href="/sign-up" className={styles.primary}>Get started <Icon name="arrow" size={19} /></Link><a href="#precision" className={styles.textLink}>Explore Arc Track <span aria-hidden="true" className={styles.directionDown}><Icon name="arrow" size={14} /></span></a></div>
        </div>
        <div className={styles.heroBottom}><span>BUILT FOR RECURVE &amp; COMPOUND</span><a href="#precision">SCROLL TO DISCOVER <span aria-hidden="true" className={styles.directionDown}><Icon name="arrow" size={14} /></span></a><span>01 — THE PURSUIT</span></div>
      </section>

      <section className={styles.storyChapter} id="precision" aria-labelledby="precision-heading">
        <div className={styles.chapterCopy}><p className={styles.eyebrow}>01 / PRECISION</p><h2 id="precision-heading">A shot is more<br />than a score.</h2><p>Capture where each Arrow lands. Score your Ends, revisit your target plots and see the detail behind the total.</p><div className={styles.chapterRule}><span>POSITION</span><span>SCORE</span><span>CONTEXT</span></div></div>
      </section>

      <section className={styles.storyChapter} aria-labelledby="grouping-heading">
        <div className={styles.chapterCopy}><p className={styles.eyebrow}>02 / PERSPECTIVE</p><h2 id="grouping-heading">Find the pattern<br /><em>in your practice.</em></h2><p>Bring your saved shots together. Explore group centres, spread and consistency with Round Insights and grouping reports.</p><a href="#performance" className={styles.textLink}>Look a little closer <span aria-hidden="true" className={styles.directionDiagonal}><Icon name="arrow" size={14} /></span></a><p className={styles.sceneNote}>Procedural scene · illustrative Arrow positions</p></div>
      </section>
    </div>

    <section className={styles.performance} id="performance" aria-labelledby="performance-heading">
      <div className={styles.sectionTop}><span>THE PRACTICE, MADE VISIBLE.</span><span>ARC TRACK / ROUND INSIGHTS</span></div>
      <div className={styles.performanceLayout}>
        <div className={styles.sectionCopy}><p className={styles.eyebrow}>03 / UNDERSTANDING</p><h2 id="performance-heading">Less guesswork.<br /><em>More perspective.</em></h2><p>Follow every End. Review your score, average per Arrow and X count. Keep the number and the picture together.</p><p className={styles.subtle}>Try the sample End selector. It uses Arc Track’s shared scoring calculations, without creating or changing any records.</p><Link href="/sign-up" className={styles.textLink}>Start your own journal <span aria-hidden="true" className={styles.directionUp}><Icon name="arrow" size={14} /></span></Link></div>
        <PrecisionDemo />
      </div>
      <div className={styles.featureLine}><span><Icon name="target" size={20} /> Plotted Arrows</span><span>End-by-End scores</span><span>Round Insights</span><span>Downloadable grouping reports</span></div>
    </section>

    <section className={styles.training} id="training" aria-labelledby="training-heading">
      <div className={styles.trainingHeading}><div><p className={styles.eyebrow}>04 / PROGRESS</p><h2 id="training-heading">The bigger picture.<br /><em>Built one Session at a time.</em></h2></div><p>From today’s practice to your next Competition. Keep your journal, explore your performance and give your training a direction.</p></div>
      <div className={styles.journal} aria-label="Illustrative Arc Track Sessions and Training Plan preview">
        <div className={styles.journalRail}><Icon name="target" size={29} /><span className={styles.railActive}><Icon name="sessions" /></span><Icon name="analytics" /><Icon name="organization" /><Icon name="profile" /></div>
        <div className={styles.journalContent}>
          <div className={styles.journalTitle}><div><p className={styles.eyebrow}>YOUR ARCHERY JOURNAL</p><h3>Your Sessions</h3></div><span className={styles.sampleLabel}>Illustrative interface · sample data</span></div>
          <div className={styles.journalColumns}>
            <div className={styles.sessionPreview}><div className={styles.previewTabs}><span>Training</span><span>Competition</span></div>{[{ name: "Evening practice", detail: "70 m · Recurve · 122 cm face", score: "60", tag: "6 Arrows" }, { name: "Indoor focus", detail: "18 m · Recurve · Triple face", score: "60", tag: "6 Arrows" }].map(session => <div key={session.name} className={styles.previewRow}><Icon name="sessions" size={20} /><div><strong>{session.name}</strong><p>{session.detail}</p></div><div><strong>{session.score}<small> pts</small></strong><p>{session.tag}</p></div></div>)}<p className={styles.previewFootnote}>Your Sessions. Your history. Always yours to review.</p></div>
            <div className={styles.planPreview}><p className={styles.eyebrow}>TRAINING PLAN</p><h4>A little further, every week.</h4><div className={styles.goal}><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="49" /><circle cx="60" cy="60" r="49" strokeDasharray="138.54 307.88" /></svg><div><strong>450<span> / 1000</span></strong><small>WEEKLY ARROW GOAL</small></div></div><p>Weekly goals. Daily targets.<br />A clearer direction for your practice.</p></div>
          </div>
        </div>
      </div>
      <div className={styles.productNotes}><article><span>01</span><div><h3>Your training, in context.</h3><p>Explore performance by distance, score trends and daily or weekly Arrow volume.</p></div></article><article><span>02</span><div><h3>A shared view of progress.</h3><p>Connect through an Organisation for Training Plans and a Coach’s Workspace with athlete insights.</p></div></article></div>
    </section>

    <CoachShowcase />

    <section className={styles.final} aria-labelledby="final-heading"><div className={styles.finalMark} aria-hidden="true"><Icon name="target" size={65} /></div><p className={styles.eyebrow}>THE NEXT ARROW IS YOURS.</p><h2 id="final-heading">Practice with purpose.<br /><em>Track with clarity.</em></h2><p>For the Arrows you shoot.<br />For the athletes you guide.</p><div className={styles.actions}><Link href="/sign-up" className={styles.primary}>Get started with Arc Track <Icon name="arrow" size={19} /></Link><Link href="/sessions" className={styles.textLink}>Open Sessions <span aria-hidden="true" className={styles.directionUp}><Icon name="arrow" size={14} /></span></Link></div></section>
    <footer className={styles.footer}><Link href="/" className={styles.brand}><Icon name="target" size={22} />ARC TRACK</Link><p>Every Arrow. Every insight. Every step forward.</p><nav aria-label="Footer"><Link href="/privacy">Privacy</Link><Link href="/delete-account">Account deletion</Link><Link href="/sign-in">Sign in</Link></nav></footer>
  </main>;
}
