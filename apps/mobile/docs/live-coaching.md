# Android Live Coaching participation

Invitations are embedded in Organisations > the athlete membership screen. No new navigation tab, coach dashboard or native BLE feature is added.

## Existing backend contracts

- read_live_coaching_invitations(p_org): owner-scoped summaries including coach profile name.
- read_live_coaching(p_id, p_org: null): authoritative athlete participation and eligible owned training Sessions.
- live_coaching_command: join, decline, leave and link, always with the current expected version. No coach context is supplied.
- Existing private live-coaching:<training>:<athlete> Broadcast channels carry invalidations only. Reads reconcile authoritatively after reconnect.

Production history was checked read-only: all 35 migrations, including invitation summaries, were present. No migration is needed for mobile participation.

## Workflow and privacy

Join/Decline become available when the coach opens the training. Joined athletes explicitly select an existing eligible Session or create one with the existing createMobileSession writer. Its date and training type match the training. A known created Session ID is retained for association retries. If creation returns an uncertain failure, another creation is blocked and the athlete can reload and select the existing Session.

Continue Scoring opens /sessions/[sessionId] in Expo Router. It never opens a website. Normal Round configuration and native scoring continue unchanged. Existing arrow-save database triggers invalidate the website coaching view; the existing website scorer determines confirmed Ends, cumulative score, X-count and target coordinates. There is no second score upload path.

Leave Training requires confirmation and invokes only the participation command. It does not leave the organisation or delete scoring history. No HR reads, consent actions or uploads are added.

Reads/actions verify the mobile session authority and authenticated user before RPC dispatch, and reject account/epoch changes after completion. Screen blur/background clears private detail state and removes channels. Focus/resume re-reads; channel reconnection re-reads detail; foreground 60-second recovery handles missed notifications and network recovery. Duplicate actions are guarded and stale versions require reconciliation.

## Verification and release

Local results: 525 mobile tests, 116 shared-core tests, 30 website contract tests, 490 disposable PostgreSQL assertions; all passed. Mobile TypeScript, changed-file ESLint, migration consistency and Android Hermes JavaScript export passed.

No APK/AAB/EAS build, installation, deployment or production mutation was performed. Ship the mobile update using the existing approved release process. No native dependencies, configuration or signing changes were needed.

Physical acceptance remains required: coach invites a consenting athlete; athlete sees the invitation, joins and links an existing/new Session on Android; scores and corrects Ends with coordinates; coach verifies total/latest End/progress/X-count/target plots; test offline recovery, app resume, leaving and membership revocation. Check narrow Android layouts and both appearances. Automated fixtures are not proof of genuine Android-to-website Realtime delivery.
