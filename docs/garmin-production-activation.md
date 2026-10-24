# Permanent Garmin production activation — 25 October 2026

The owner has approved general-availability activation after publishing the updated
Privacy Policy. Garmin API Tools shows Daily Health Stats and Activity as Approved
and enabled. All seven saved callback values were compared privately with the
existing DPAPI-recovered credential; no callback URL or secret belongs in this file.

Supported notifications: Activities, Manually Updated Activities, Deregistrations,
User Permissions Change, Dailies, Sleeps, and Stress Details. Do not enable unrelated
categories that the normalizer does not accept. Saved URLs alone do not enable
their individual delivery checkboxes.

The production Wrangler configuration now explicitly sets INGRESS_ENABLED=true
for permanent operation. Keep all logging/tracing safeguards, secret bindings,
fixed forwarding destination and SQLite Durable Object limits unchanged. No tester
UUID is needed. Runtime activation is verified separately from this source setting.

Release order: publish privacy; set the three existing Vercel Health flags true;
deploy and verify READY; deploy the existing Cloudflare production module; verify
authenticated fixed-receiver transport using invalid/empty payloads only; enable
the existing cron job; verify real HTTP processing responses; then enable only the
seven reviewed Garmin notification checkboxes. Never inject artificial measurements
into production to demonstrate a successful sync.

Runtime evidence, deployment IDs and redacted status results are retained in ignored
`.verification/garmin-production-activation/`. Code/configuration activation is not
proof of a genuine Garmin notification, watch upload, or dashboard measurement.

Emergency stop: disable the seven Garmin deliveries when accessible; immediately
deploy this Worker with `--var INGRESS_ENABLED:false`; set GARMIN_HEALTH_ENABLED=false
and redeploy Vercel; deactivate the existing cron job using cron.alter_job. If the
issue is suspected credential exposure, keep all collection off while following
the existing reviewed rotation procedure. Never rotate the OAuth encryption key
as an ingress troubleshooting step. Do not drop tables or delete user connections.

Retain known-good Vercel/Cloudflare version IDs for rollback. Rolling back website
code must preserve compatible Garmin account-deletion cleanup. Continue monitoring
queue age, failed/missing pg_net responses, refresh backlog, consent reconciliation
and ambiguous summary corrections. Never export raw Health payloads, request headers,
tokens, private callback paths or decrypted Vault entries into monitoring reports.
