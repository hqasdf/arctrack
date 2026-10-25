import { publicPageMetadata } from "@/lib/seo";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import styles from "./privacy.module.css";

export const metadata = publicPageMetadata(
  "/privacy",
  "Privacy Policy",
  "How Arc Track handles account information, archery records, organisation sharing and optional weather location.",
);

export default function PrivacyPage() {
  return <main id="main-content" className={styles.page}>
    <header className={styles.header}>
      <Link href="/sign-in" prefetch={false} className={styles.brand}><Icon name="target" size={28} />ARC TRACK</Link>
      <p className={styles.eyebrow}>Your archery journal</p>
      <h1>Privacy Policy</h1>
      <p className={styles.updated}>Last updated: <time dateTime="2026-10-25">25 October 2026</time></p>
      <p>This policy explains how the Arc Track website and mobile application handle information when you record archery practice, score Rounds, review performance and use organisation features.</p>
    </header>

    <aside className={styles.pending} aria-label="Your Garmin privacy choices">
      <strong>Your Garmin privacy choices</strong>
      <p>Garmin integration is optional. You can manage permissions, Pause or Resume Health Sync, Delete Health Data, or Disconnect Garmin using the available account controls.</p>
    </aside>

    <nav className={styles.contents} aria-label="Privacy Policy sections">
      <a href="#contact">Privacy contact</a><a href="#information">Information we use</a>
      <a href="#garmin">Garmin Health &amp; Activity</a><a href="#sharing">Organisations &amp; sharing</a><a href="#weather">Weather &amp; location</a>
      <a href="#device">On your device</a><a href="#providers">Service providers &amp; security</a>
      <a href="#retention">Retention &amp; deletion</a><a href="#controls">Your controls &amp; requests</a>
    </nav>

    <section id="contact" className={styles.section}>
      <h2>1. Privacy contact</h2>
      <p><strong>Privacy contact:</strong> <a href="mailto:wonghanqian123456@gmail.com">wonghanqian123456@gmail.com</a></p>
      <p>Use the privacy contact for questions about this policy, access or correction requests, deletion concerns and other privacy requests. The operator receives and reviews these enquiries, including failed-deletion concerns, and handles requests in accordance with applicable law. We may need to verify your identity before acting on an account-related request. Arc Track is the application covered by this policy; provider links below are not substitutes for the Arc Track privacy contact.</p>
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
      <h3 id="garmin">Optional Garmin account connection and Health synchronization</h3>
      <p>If you choose Connect Garmin in Health or Profile, Garmin handles sign-in and consent. Arc Track stores your Garmin API user identifier, granted permissions, connection and expiry timestamps, safe status/error information and encrypted access/refresh credentials to maintain or revoke the connection. Temporary authorization records contain hashed state/browser binding and an encrypted PKCE verifier. Credentials are server-only and are not available to coaches or ordinary client queries.</p>
      <p><strong>Optional synchronization.</strong> Automatic Garmin Health and Activity synchronization requires your connected Garmin account, the relevant permissions and an enabled synchronization service. Account connection alone does not confirm that measurements have arrived. Synchronization may be paused by your choice or limited by authorization, provider availability, maintenance or security controls.</p>
      <p><strong>Measurements and purpose.</strong> With the relevant Garmin permissions, Garmin can automatically send supported daily steps, sleep duration and available sleep stages, sleep-window times and official Garmin Sleep Score/quality when available, resting heart rate, stress, Body Battery samples and activity information. Supported activity fields include type, start time, duration, distance and average heart rate when available. Arc Track stores the supported measurements to display your private Health Dashboard, charts, activity history and descriptive trends alongside your training. Missing values remain unavailable; Arc Track does not invent replacement measurements.</p>
      <p><strong>Automatic delivery and processing.</strong> When synchronization is enabled, Garmin Connect uploads can produce notifications received by the Cloudflare ingress, forwarded to Arc Track’s Vercel-hosted server and saved in Supabase for processing. Vercel validates and reduces notifications to supported fields; the stored measurement model does not include GPS routes or full wearable sample arrays. Normalized notifications can retain health values while pending or quarantined for reconciliation. Processed or rejected notification payloads are cleared, while receipt metadata can remain. Conflicting same-day updates can be held for review rather than overwrite known data. Delivery and processing are not guaranteed to be immediate or uninterrupted.</p>
      <p><strong>Private access and consent.</strong> Garmin health and activity records are restricted to their signed-in Arc Track owner with a verified, valid Garmin connection. The Health Dashboard hides measurements when disconnected, reauthorization is required or connection status cannot be verified. A temporary status failure does not delete data. Organisation membership does not give coaches or other athletes access. Only records linked to the authorized Garmin account are accepted. You can review granted permissions in Manage connection, revoke Arc Track access in Garmin Connect or disconnect from Arc Track. Revoked categories are blocked and their affected stored measurements and quarantined values are removed when the permission change is processed; uncertain changes can pause imports pending verification.</p>
      <p>Arc Track does not send Garmin-derived information to AI training or evaluation services. Garmin’s own collection, account and device processing remains subject to Garmin’s privacy information and the permissions you choose there.</p>
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
        <li><strong>Cloudflare</strong> provides the Garmin notification ingress. When Health synchronization is enabled, it receives and forwards notification data and operates request limits before Vercel processes it. Application-level Worker logging, invocation logging and traces are disabled for this ingress. Cloudflare can still process network and operational metadata; these safeguards do not mean the provider or authorized diagnostic tools can never access request information. See <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare’s privacy policy</a>.</li>
        <li><strong>Open-Meteo</strong> processes rounded location coordinates and weather requests as described above.</li>
        <li><strong>Your email, device and app-store providers</strong> handle email delivery, permissions, distribution and user-selected sharing through their own services.</li>
      </ul>
      <p>The current application code does not integrate advertising, cross-app tracking, or a third-party behavioural analytics/crash-reporting SDK. This does not mean that hosting, authentication or weather providers keep no operational logs. Arc Track also maintains account-linked operation counters to limit abusive requests.</p>
      <p>Production connections use HTTPS endpoints. Application authentication, server-side checks and database access rules restrict access to saved records. Providers may process information in countries other than yours under their applicable service terms and safeguards; this policy does not represent that all processing happens in one country.</p>
    </section>

    <section id="retention" className={styles.section}>
      <h2>7. Retention and account deletion</h2>
      <p>Saved account and archery records remain available until removed through the applicable record or account-deletion controls. The current app does not automatically expire all saved Sessions after a fixed number of days.</p>
      <p>To delete your account, open <strong>Profile → Delete Account</strong> in Arc Track, or visit the <Link href="/delete-account" prefetch={false}>account deletion page</Link>. Sign in with your confirmed account, verify your current password and type <strong>DELETE</strong>. The page confirms whether deletion succeeded; an error does not confirm deletion.</p>
      <p>Disconnect Garmin requests remote deregistration before removing saved credentials. Account deletion performs Garmin cleanup before deleting your Arc Track account. If cleanup cannot be confirmed, the account and available encrypted credentials are retained for retry or secure recovery, and deletion is not reported as successful. A pending deletion pauses new Garmin connection operations. Successful account deletion removes local Garmin connection and authorization-transaction records; it does not delete your Garmin account or Garmin activity history. Uncompleted authorization records expire after ten minutes but can remain stored until replaced or removed with the account.</p>
      <p><strong>Garmin measurement deletion and retention.</strong> Imported measurements are kept while connected unless you request deletion, disconnect, delete your Arc Track account or permission restrictions require removal. No automatic measurement expiry period is configured; the dashboard’s 90-day reading window does not delete older records. A successfully confirmed Garmin disconnect removes Arc Track’s imported health/activity records, queued and quarantined payloads and measurement synchronization state together with saved connection credentials. Successful Arc Track account deletion removes these owned records too. Neither action deletes your original Garmin account or Garmin history. If remote cleanup cannot be confirmed, available encrypted credentials and records can remain for retry or administrator-controlled recovery; imports are blocked and success is not reported.</p>
      <p><strong>Session heart rate.</strong> Where Garmin provides Activity Details, Arc Track can import timestamped heart-rate measurements and the minimum activity identity, type and timing needed to match a recording to your confirmed shooting interval. Available all-day HR may be used as a clearly labelled, lower-resolution fallback. We do not retain GPS coordinates or device metadata for this feature. Session start and finish times can be recorded or corrected independently of Garmin. Activity associations require your confirmation. Detailed HR recordings remain private to the athlete; sharing a scorecard or granting coach access does not grant access to these measurements. Partial datasets are not published, and ambiguous recording revisions may be quarantined for review. The Health deletion, permission, disconnect and account-deletion controls below also cover detailed HR datasets and queued chunks. Local Session timing can remain after Health deletion; its Garmin association is cleared.</p>
      <p><strong>Delete Health Data, Pause and Resume.</strong> When Health import and its controls are available, Delete Health Data requires your explicit confirmation. It deletes Arc Track’s imported Garmin measurements and queued/quarantined payloads, keeps your Garmin OAuth connection and persistently pauses automatic imports. Pause Health Sync alone keeps already imported measurements while stopping measurement processing and clearing queued measurement payloads. Pending consent metadata may still be processed solely to remove revoked data or require verification. A minimal owner-linked pause state, processing generation, cutoff, action receipt and deletion timestamp remain to enforce your choice and prevent replay. A confirmed disconnect retains the minimal replay fence; successful Arc Track account deletion removes it.</p>
      <p>Resume Health Sync requires your explicit action, valid Garmin authorization, the relevant Health and Activity permissions and Arc Track’s activation/privacy gates. Resume permits future imports; it does not establish that new measurements have arrived. Notifications whose measurement starts at or before the new cutoff, including daily or sleep summaries spanning that cutoff, are excluded. Events without enough timing information are handled conservatively and may require connection verification. Arc Track does not claim that Garmin provides a delivery-generation guarantee or that deleted historical records will be restored.</p>
      <p><strong>Raw notifications and operational copies.</strong> Pending notifications and quarantined conflicts can contain normalized health values until processing, deletion, disconnect or applicable permission cleanup. Processed/rejected payloads are cleared; deduplication receipt metadata can remain. Delete Health Data removes all those user-owned inbox rows. Provider operational records and any separately maintained backups are distinct from the active application database and are subject to their applicable settings and retention requirements.</p>
      <p>Successful deletion removes the live account and its owned profile, Sessions, Rounds, Ends, Arrows and related weather records, membership rows, athlete Training Plan assignment links and operation-budget records. Shared organisations, Training Plans, plan days and other athletes’ records remain, with the deleted account’s creator/assigner references cleared. Text previously contributed to shared plans or notes can remain in those shared records; contact the operator about personal information in shared content.</p>
      <p>Session Notes are deleted with their Session. Session-specific coach feedback remains in the athlete history when the Session is deleted and is labelled as referring to a deleted Session. Feedback also remains available to the athlete after leaving an organisation or after an organisation or coach account is deleted, using neutral unavailable-organisation or Former coach labels where needed. Former coaches lose access when their authorisation ends. When an author deletes feedback, it is removed for the athlete too.</p>
      <p>Deleting an athlete account removes its Session Notes and feedback addressed to that athlete. Deleting a coach account preserves feedback already shared with other athletes, with the deleted author reference cleared. No additional automatic expiry period applies to this coaching history.</p>
      <p>Account deletion does not remotely erase Arrow Counter data, app caches or saved/exported images on other devices, or copies held by recipients. Use device/browser controls to clear those copies. Other signed-in devices lose account access when their account or session is checked again.</p>
      <p><strong>Current hosting and backup arrangements.</strong> Under the current Vercel Hobby plan, runtime logs are available for approximately one hour. This availability window is not a guarantee that every provider-held operational copy is erased at that time. The current Supabase Free plan does not include managed automatic daily database backups. No fixed retention period is promised for backups maintained separately from that service, or for provider-internal operational records. Authentication, security and abuse-prevention records may be retained as needed for their operational purposes and applicable legal requirements.</p>
      <p>Deleting records from the active database does not necessarily immediately remove information from external provider infrastructure, operational logs or separately maintained backups. These limits do not remove applicable privacy rights. If deletion is unavailable or you need help with retained/shared information, contact the operator using section 1; the operator will review the request and any failed cleanup without promising an outcome or response deadline beyond applicable law.</p>
    </section>

    <section id="controls" className={styles.section}>
      <h2>8. Your controls, privacy requests and changes</h2>
      <p>You can edit supported profile and scoring information, delete Sessions, leave organisations, disable optional biometric unlock and revoke location permission. Depending on applicable law, you may also request access, correction, deletion or other available privacy rights through the privacy contact. Identity may need to be verified before an account-related request is fulfilled.</p>
      <p>This page will be updated when the described data practices change. The Last updated date identifies the current policy revision.</p>
    </section>
    <footer className={styles.footer}><Link href="/sign-in" prefetch={false}>Back to Arc Track</Link><a href="#main-content">Back to top</a></footer>
  </main>;
}
