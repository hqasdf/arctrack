import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import styles from "./privacy.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Arc Track handles account information, archery records, organisation sharing and optional weather location.",
  alternates: { canonical: "https://archery-website.vercel.app/privacy" },
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return <main id="main-content" className={styles.page}>
    <header className={styles.header}>
      <Link href="/sign-in" prefetch={false} className={styles.brand}><Icon name="target" size={28} />ARC TRACK</Link>
      <p className={styles.eyebrow}>Your archery journal</p>
      <h1>Privacy Policy</h1>
      <p className={styles.updated}>Last updated: <time dateTime="2026-10-22">22 October 2026</time></p>
      <p>This policy explains how the Arc Track website and mobile application handle information when you record archery practice, score Rounds, review performance and use organisation features.</p>
    </header>

    <aside className={styles.pending} aria-label="Publication details awaiting confirmation">
      <strong>Publication details awaiting confirmation</strong>
      <p>The backup/log retention details below must be confirmed before this policy is published for a store submission.</p>
    </aside>

    <nav className={styles.contents} aria-label="Privacy Policy sections">
      <a href="#contact">Privacy contact</a><a href="#information">Information we use</a>
      <a href="#sharing">Organisations &amp; sharing</a><a href="#weather">Weather &amp; location</a>
      <a href="#device">On your device</a><a href="#providers">Service providers &amp; security</a>
      <a href="#retention">Retention &amp; deletion</a><a href="#controls">Your controls &amp; requests</a>
    </nav>

    <section id="contact" className={styles.section}>
      <h2>1. Privacy contact</h2>
      <p><strong>Privacy contact:</strong> <a href="mailto:wonghanqian123456@gmail.com">wonghanqian123456@gmail.com</a></p>
      <p>Use the privacy contact for questions about this policy, access or correction requests, deletion concerns and other privacy requests. Arc Track is the application covered by this policy; provider links below are not substitutes for the Arc Track privacy contact.</p>
    </section>

    <section id="information" className={styles.section}>
      <h2>2. Information we use and why</h2>
      <ul>
        <li><strong>Account information.</strong> Your email address, account identifier, verification/recovery information and authentication sessions are used to register, verify, sign in, recover and protect your account. Passwords and verification codes are submitted to Supabase Auth; Arc Track does not keep a separate password field in its application tables.</li>
        <li><strong>Profile information.</strong> Optional display name, club or team, division, shooting hand and experience level are used to personalise your profile and archery experience.</li>
        <li><strong>Training and Competition records.</strong> Saved Session titles, dates, types and entered Arrow counts; Round names and formats; Ends; Arrow scores and X status; and plotted target coordinates and face indices are used to save and reopen scorecards and derive totals, averages, trends, grouping and other performance views.</li>
        <li><strong>Session Notes and shared feedback.</strong> Athlete-authored Session Notes contain plain text, optional technique tags and timestamps. Coach feedback contains text, its athlete recipient, coach author, organisation context, its scoring Session association and timestamps. These records support your journal and coaching history.</li>
        <li><strong>Organisation information.</strong> Organisation names, join codes, membership roles, status and membership dates are used to manage membership and determine coach access.</li>
        <li><strong>Training Plans.</strong> Plan titles, notes, dates, targets, assignments and day-specific coach notes are used to provide assigned plans and derive progress from saved Sessions and scoring records.</li>
      </ul>
      <p>The Analytics and Round Insights features analyse your archery records. They are not a separate advertising or cross-app tracking service.</p>
    </section>

    <section id="sharing" className={styles.section}>
      <h2>3. Organisations and information you share</h2>
      <p>When you are an active Archer member of an organisation, its active Head Coaches can read your display name, account identifier and membership context, and your saved Training and Competition Sessions, Rounds, Ends and Arrows. This includes saved history from before you joined; Sessions are not limited to organisation-tagged records. Coach access to your scoring records and athlete-authored Session Notes is read only. Only you can edit your Session Notes.</p>
      <p>All Session-specific coach feedback is shared with its athlete recipient. A feedback entry is readable by that athlete and its original author while the author remains an active authorised Head Coach for that athlete in the exact organisation recorded on the entry. Other coaches cannot automatically read it, including other Head Coaches in the same organisation. Only the original author can edit or delete it while authorised; athletes cannot edit coach-authored feedback.</p>
      <p>Normal Archer membership does not give you access to other athletes’ records. Leaving the organisation removes the coach access based on that membership; rejoining can restore it. Membership history and shared Training Plan records can remain. Leaving cannot retract information someone has already copied or exported.</p>
      <p>Assigned athletes can view their Training Plans and coach notes. Head Coaches manage plans and view assigned athletes’ progress through the organisation features. If you export or share a grouping PNG, the image can contain Session/Round metadata, plotted impacts, performance statistics and End scores. The people or apps you choose in the save/share flow receive that exported information.</p>
    </section>

    <section id="weather" className={styles.section}>
      <h2>4. Optional weather and foreground location</h2>
      <p>When automatic weather is enabled and location permission is granted, Arc Track requests a foreground location fix to retrieve shooting conditions. Collection is limited to an active, focused scoring screen, a Session dated today in Asia/Singapore, a Round with an empty planned Arrow slot and a distance other than 18 m. It does not use background location tracking.</p>
      <p>The browser or operating system supplies a location fix. The app rounds latitude and longitude to two decimal places before sending them to the Arc Track weather API. That API sends the rounded coordinates to Open-Meteo to obtain weather conditions; it does not send your account email, Arrow plots or authentication token to Open-Meteo.</p>
      <p>The saved weather records contain Session/Round references, temperature, wind, gusts, direction, humidity, weather condition and timestamps. They do not contain latitude or longitude. Rounded coordinates are processed transiently for the weather request, but service providers can retain request information in operational logs. Open-Meteo describes its processing in its <a href="https://open-meteo.com/en/terms">Terms &amp; Privacy</a>.</p>
      <p>You can deny or revoke location permission in your browser or device settings. Weather collection will be unavailable without permission; scoring and saving do not require location permission.</p>
    </section>

    <section id="device" className={styles.section}>
      <h2>5. Cookies, local storage, biometrics and exports</h2>
      <ul>
        <li><strong>Website.</strong> Authentication cookies maintain your sign-in. Local browser storage remembers appearance preferences and Arrow Counter values.</li>
        <li><strong>Mobile sign-in.</strong> Authentication-session credentials are kept through the app’s SecureStore-backed storage. Pending signup/recovery email and recovery-stage information, which can include an account identifier, are stored separately on the device to resume those flows.</li>
        <li><strong>Arrow Counter.</strong> The total, selected increment and Undo history are stored on the device, not in an Arc Track counter database table.</li>
        <li><strong>Optional biometric unlock.</strong> The mobile app asks the operating system to perform biometric authentication and receives its result. Arc Track does not receive fingerprint or face templates. The setting is stored locally and does not replace your account sign-in.</li>
        <li><strong>Grouping images.</strong> The web export creates a local download; mobile export writes a PNG to the app cache and lets you choose Save to Device or Share Image. Save to Device adds the image to Photos/Gallery when the operating system permits it; Share Image opens the share sheet. Cached images can remain until the device or app cache is cleared. Copies you save or share are separate from your account records.</li>
      </ul>
    </section>

    <section id="providers" className={styles.section}>
      <h2>6. Service providers, technical records and security</h2>
      <ul>
        <li><strong>Supabase</strong> provides account authentication and backend storage for saved application records. It also processes authentication and database requests. See <a href="https://supabase.com/privacy">Supabase’s privacy information</a>.</li>
        <li><strong>Vercel</strong> hosts the Arc Track website and its server endpoints. Requests can include IP addresses, browser/device information, timestamps and technical/error information used to deliver, secure and troubleshoot the service. See <a href="https://vercel.com/legal/privacy-notice">Vercel’s privacy notice</a>.</li>
        <li><strong>Open-Meteo</strong> processes rounded location coordinates and weather requests as described above.</li>
        <li><strong>Your email, device and app-store providers</strong> handle email delivery, permissions, distribution and user-selected sharing through their own services.</li>
      </ul>
      <p>The current application code does not integrate advertising, cross-app tracking, or a third-party behavioural analytics/crash-reporting SDK. This does not mean that hosting, authentication or weather providers keep no operational logs. Arc Track also maintains account-linked operation counters to limit abusive requests.</p>
      <p>Production connections use HTTPS endpoints. Application authentication, server-side checks and database access rules restrict access to saved records. Providers may process information in countries other than yours; the configured hosting regions, provider agreements and retention settings require operator confirmation rather than an assumption that all processing happens in one country.</p>
    </section>

    <section id="retention" className={styles.section}>
      <h2>7. Retention and account deletion</h2>
      <p>Saved account and archery records remain available until removed through the applicable record or account-deletion controls. The current app does not automatically expire all saved Sessions after a fixed number of days.</p>
      <p>To delete your account, open <strong>Profile → Delete Account</strong> in Arc Track, or visit the <Link href="/delete-account" prefetch={false}>account deletion page</Link>. Sign in with your confirmed account, verify your current password and type <strong>DELETE</strong>. The page confirms whether deletion succeeded; an error does not confirm deletion.</p>
      <p>Successful deletion removes the live account and its owned profile, Sessions, Rounds, Ends, Arrows and related weather records, membership rows, athlete Training Plan assignment links and operation-budget records. Shared organisations, Training Plans, plan days and other athletes’ records remain, with the deleted account’s creator/assigner references cleared. Text previously contributed to shared plans or notes can remain in those shared records; contact the operator about personal information in shared content.</p>
      <p>Session Notes are deleted with their Session. Session-specific coach feedback remains in the athlete history when the Session is deleted and is labelled as referring to a deleted Session. Feedback also remains available to the athlete after leaving an organisation or after an organisation or coach account is deleted, using neutral unavailable-organisation or Former coach labels where needed. Former coaches lose access when their authorisation ends. When an author deletes feedback, it is removed for the athlete too.</p>
      <p>Deleting an athlete account removes its Session Notes and feedback addressed to that athlete. Deleting a coach account preserves feedback already shared with other athletes, with the deleted author reference cleared. No additional automatic expiry period applies to this coaching history.</p>
      <p>Account deletion does not remotely erase Arrow Counter data, app caches or saved/exported images on other devices, or copies held by recipients. Use device/browser controls to clear those copies. Other signed-in devices lose account access when their account or session is checked again.</p>
      <p className={styles.placeholder}>[Backup, authentication-log, hosting-log and abuse-prevention retention periods, and any required legal-retention exceptions — to be confirmed before publication.]</p>
      <p>Deleting live records is not a promise of immediate deletion from every provider backup or operational log. If deletion is unavailable or you need help with retained/shared information, use the privacy contact in section 1.</p>
    </section>

    <section id="controls" className={styles.section}>
      <h2>8. Your controls, privacy requests and changes</h2>
      <p>You can edit supported profile and scoring information, delete Sessions, leave organisations, disable optional biometric unlock and revoke location permission. Depending on applicable law, you may also request access, correction, deletion or other available privacy rights through the privacy contact. Identity may need to be verified before an account-related request is fulfilled.</p>
      <p>This page will be updated when the described data practices change. The Last updated date identifies the current policy revision.</p>
    </section>
    <footer className={styles.footer}><Link href="/sign-in" prefetch={false}>Back to Arc Track</Link><a href="#main-content">Back to top</a></footer>
  </main>;
}
