# Live Coaching HR acceptance and operations

Live Coaching role access and the HR schema are installed. Live HR remains gated by
both `LIVE_COACHING_BLE_ENABLED` and `NEXT_PUBLIC_LIVE_COACHING_BLE_ENABLED`.
Synthetic tests cannot satisfy the physical sensor gate. Garmin cloud measurements
are a separate pipeline and cannot demonstrate Bluetooth acceptance.

## Quick local sensor diagnostic

Open the normal local website in supported Chrome or Edge, sign in as an authorized
coach, then go to **Coach Workspace → Live Coaching → Test Heart Rate Sensor**.
Enable standard Bluetooth HR broadcasting on the Venu 4, click **Connect & Test**,
and select the watch in the browser picker. Confirm changing BPM and the received time.
Use **Disconnect**, **Retry tested sensor**, or **Close test** as needed.

This diagnostic requires no training Session, athlete invitation, sharing consent,
HR feature flag, database fixture, or production ingestion. It keeps only the latest
reading in component memory and performs no upload or retained-history write. Closing
the test, leaving the page or backgrounding it stops local notifications. A permitted
device reference can be reused within the same coach/organization in this tab's memory;
a reload starts fresh and the browser still enforces device permissions.

Actual training still requires athlete consent and the existing server-side admission
checks. Diagnostic success does not establish hosted sharing or HR retention acceptance.
Garmin Venu 4 hardware compatibility remains unverified until this test is performed.

## Retention operations

The reviewed job is `arctrack-live-coaching-hr-retention`, every minute, running
`select public.prune_live_coaching_hr();`. Activate only this named job through
`cron.alter_job`, after its owner, command and execution permissions are checked.
Do not grant clients direct write access to `cron.job` or broaden the cleanup RPC.
The setup script deliberately creates an inactive job; do not rerun it on an active
release, since its preparation step sets the job inactive.

Use `supabase/ops/live-coaching-hr-monitor.sql` with administrator access. An inactive
job, no recorded success, success older than three minutes, or recent failures needs
operator investigation. No external paging/alerting service is installed by this work.
The monitoring query is a manual operational check, not automatic alert delivery.

Read access hides samples at their exact 24-hour expiry even if cleanup is delayed.
Physical deletion normally follows the next successful minute run; do not promise
deletion at the exact expiry instant. Latest values hide after ten seconds and are
cleared after sixty seconds. Revocation deletes retained history independently of cron.

If cleanup fails, keep live HR disabled, inspect job run status and the reviewed
pruner's grants/definition, correct only the demonstrated cause, then rerun the pruner
and observe scheduled success. Do not extend retention, insert fake measurements,
delete unrelated data, or disable Garmin's scheduler as a recovery action.

## Physical acceptance checklist

1. Use a consenting athlete, a standard BLE HR broadcaster, and supported Chrome or
   Edge on a device with Bluetooth. HTTPS or trustworthy localhost is required.
   An ordinary smartwatch connection or Garmin cloud sync is insufficient.
2. First validate the candidate software in the existing isolated local/disposable
   test workflow with HR enabled only there. Keep production flags off during this
   acceptance step. Do not send synthetic readings to production.
3. Coach creates training, invites the athlete, opens joining, and starts training
   after the athlete joins. Athlete uses their own Live Training view and explicitly
   grants live HR sharing. Timeline retention is a separate optional consent.
4. Coach selects that joined athlete and clicks **Connect Heart Rate** directly.
   Choose the intended physical sensor in the browser's native chooser. Cancel and
   retry once as a separate acceptance case; never auto-select a nearby person's device.
5. Confirm physical notifications and credible changing BPM reach the assigned athlete
   only. Record actual device/browser versions and sample admission results. Do not
   infer one-second sensor output from synthetic fixtures or interpolate missing points.
6. Disconnect/reconnect, background and return, revoke consent during an upload,
   re-consent, and complete training. Old generations must not resume sharing. A stalled
   post-selection connection times out after 30 seconds and remains retryable.
7. With separate retention consent, inspect the HR chart, interval navigation and gaps;
   revoke retention and verify erasure. Test expiry in disposable time-controlled
   fixtures, not by modifying production timestamps.
8. Add independent sensors gradually when available. Backend tests cover 1/2/8/12
   synthetic athletes; they do not certify twelve physical GATT connections.
9. After physical acceptance and retention/authorization checks pass, release the
   reviewed candidate and consistently configure both production flags, using one
   small consenting test training first. Verify the READY deployment and actual hosted
   account isolation, notifications, scoring and retained history before wider use.

## Stop and recovery

For the controlled session, **Disconnect Heart Rate**, athlete revocation, or session
completion stops admission through the existing assignment/generation/lifecycle fences.
For global shutdown, set both flags false and deploy the disabled configuration, then
verify the HR endpoint returns 503. Vercel environment edits require a deployment;
do not describe them as an instantaneous runtime switch. Keep cleanup running.
Never roll back to a website incompatible with the installed role-access migration.

## Existing local physical-test workflow (PowerShell)

The following uses the existing ignored preview builder and disposable PostgreSQL
runner on this workstation. It starts no production ingestion. Use desktop Chrome or
Edge at the printed `http://127.0.0.1:3218` URL; a phone's localhost is a different
device. Do not expose the emulated-account preview on a public interface.

```powershell
node .verification/live-coaching-preview/build.mjs
$env:PG_BIN="$env:LOCALAPPDATA\Temp\arctrack-feedback-pg17-tooling\extracted\package\native\bin"
$env:PG_DRIVER_MODULE="$env:LOCALAPPDATA\Temp\arctrack-feedback-pg17-tooling\node_modules\pg"
$env:LIVE_COACHING_DEMO='true'
$env:LIVE_COACHING_MONITOR_DEMO='true'
$env:LIVE_COACHING_DEMO_PHYSICAL='true'
$env:LIVE_COACHING_DEMO_DURATION_MS='600000'
node scripts/test-notes-feedback-pg.mjs
```

The runner first executes its isolated fixtures, then prints the new preview URL.
Open that URL as coach and open a second copy with `role=a` as the athlete. All
identities, memberships and scoring are synthetic. Physical mode seeds no HR and
grants no automatic HR consent; synthetic pulse generation is disabled even if the
other demo pulse flag is set. Explicitly consent in the athlete view before selecting
the physical sensor in the coach view. No credentials or production accounts are used.
The preview exits after ten minutes; Ctrl+C also requests cleanup of the owned cluster.
This proves local hardware behavior only. Hosted account/JWT/Realtime validation is a
separate controlled step after physical acceptance and release authorization conditions.
