# Mobile D7 release preparation — local checklist, not a submission

## Current identity and build config

`app.json` has display name `Arc Track`, slug `arc-track`, app version `0.1.0`, portrait orientation, light UI, and custom scheme `arctrack`. It has **no** final `ios.bundleIdentifier`, `ios.buildNumber`, `android.package`, `android.versionCode`, icon, splash or Android adaptive icon. No `extra.eas.projectId` is committed. The owner must confirm permanent IDs before adding them; a possible format is `com.<confirmed-owner>.arctrack`, not an assigned ID. After confirming there is no earlier release history, use `1.0.0`, iOS build `1`, and Android versionCode `1` for a first release. Increase build numbers for each store upload.

`eas.json` has `development` and `preview` as internal distribution builds and `production` as a store build. The development profile currently makes an internal build, **not** an Expo development client; enabling a development client later would require `expo-dev-client`. The current preview/production distinction is appropriate. Do not run a remote build until the Expo project is linked, identity and assets are final, EAS public variables are set, and Apple/Expo credentials are available. An iOS internal preview requires Apple signing and device registration for ad hoc installation. Windows can request EAS cloud iOS builds.

Only these EAS variables are read in mobile source: `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Set both in **preview** and **production**, using the intended Arc Track project's public URL and publishable key. Both become visible in the app bundle. Never enter service-role/secret keys, database passwords or admin tokens. After owner-controlled `eas login` and project linking, set the four public values in the EAS dashboard under the project's Environment variables page; use `eas env:list --environment preview` and `eas env:list --environment production` to verify the names. The documented CLI alternative is `eas env:set --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value <public-url> --visibility plaintext` (repeat for the key and production), but the dashboard avoids copying values into shell history. Do not copy values into reports.

## Assets and permissions

Supply approved artwork before a signed release. Suggested local paths: `apps/mobile/assets/icon.png` (1024×1024 PNG, opaque iOS-safe artwork), `apps/mobile/assets/splash.png` (approved PNG; keep the focal artwork within a 1024×1024 source canvas), and `apps/mobile/assets/adaptive-icon.png` (1024×1024 PNG foreground with padding and approved background color). Wire these into Expo config only after artwork is approved. A notification icon is not needed because the current app has no push-notification feature. No camera, location, photos or microphone permission is requested by Arc Track source. Check the final native permission manifest in the signed artifact because dependencies/platform defaults can differ.

## Round settings and account deletion gates

`supabase/migrations/20260926120000_prepare_owner_round_update.sql` and `supabase/tests/owner-round-update.sql` are local review-only files. The mobile edit UI is intentionally not exposed until the RPC is approved, applied and runtime-tested. Integration then calls `public.update_owned_round_settings` with `p_round_id`, trimmed `p_name`, `p_division`, `p_distance_metres`, `p_face_diameter_cm`, and `p_planned_ends`; after success, reload the Round/Ends. The form permits increasing planned Ends, while layout and Arrows per End remain read-only. On failure leave existing data visible and show a safe retry error. Existing Arrow scores/plots must remain untouched.

The unsafe, unapplied account-deletion RPC migration has been retired. Web and Expo Profile use the same `/delete-account` web resource. Its server action verifies current identity, password and typed `DELETE`, then uses server-only Auth Admin hard-deletion. No deletion RPC or new SQL is required. Before release, runtime-test the local database/Auth behavior and separately approve configuring `SUPABASE_SECRET_KEY` on Vercel and deploying the resource. Never put that credential in Expo/EAS or public variables. The rollback SQL fixture checks FK preservation; the local API integration runner checks actual Auth/Admin behavior. Browser cleanup does not remotely erase Expo Counter storage. Test former Head Coach access and preserved organisations without a Head Coach. See `docs/account-deletion-review.md` in the repository root.

## Email change

The web flow calls `auth.updateUser({ email }, { emailRedirectTo: web /auth/callback })` and Secure Email Change requires confirmation of both old and new addresses. Mobile has a scheme but no native Auth return-link handler. Do not add a link-only mobile request until a deep-link callback, session refresh, Supabase allowlisted redirect and both-email real-device test are ready. A possible native approach uses a scheme URL and PKCE code exchange in a dedicated callback route, with the current web flow unchanged. The exact email template/token form and redirect behavior must be verified against the project's Auth configuration. Native email change remains deferred pending this work; confirm whether it is required before v1.0 submission.

## App Store Connect privacy mapping to verify

| Actual use | Likely App Store data category | Linked to account? | Purpose / processing |
| --- | --- | --- | --- |
| Account email | Contact Info → Email Address | Yes | Account management and authentication; Supabase processes it |
| Profile display name | Contact Info → Name, if a real name is entered | Yes | Profile and coach roster |
| Club/team, division, shooting hand, experience | Other User Content or Other Data; confirm category in current questionnaire | Yes | Profile and relevant app display |
| Session/Round/End/Arrow records and target plots | User Content / Other Data; confirm current Apple category | Yes | App functionality and performance analysis; Supabase stores it |
| Membership and role | Other Data; confirm category | Yes | Organisation access control and coach views |
| Auth/session identifiers | Identifiers, if applicable to Apple's current definitions | Yes | Login/session management; Supabase handles them |
| Local Arrow Counter | Stored only on device; assess against Apple's definition of “collected” | Not sent by counter feature | Local clicker functionality |

This is a mapping draft, not a completed App Store declaration. Verify Supabase Auth logs, hosting telemetry, IP/device metadata, Apple/Google platform processing, actual third-party SDK behavior, tracking status, and the final policy URL before answering. No advertising/tracking SDK is evident in the mobile dependency list, but confirm the built app. The operator must provide a public privacy-policy URL and contact method.

## Signed build and TestFlight sequence (owner-controlled)

1. Finish backend approvals/runtime tests, native deletion UX, final identifiers/assets, privacy/contact decisions, and local validation. Link the Expo app with the intended Expo account/project. Check current `eas` CLI syntax with `eas --help` when credentials are available.
2. From `apps/mobile`: `eas login`, `eas whoami`, `eas init` (if unlinked). Register the intended test iPhone with `eas device:create`, then `eas build --platform ios --profile preview`. This creates an internal ad hoc build, **not** a TestFlight build. Install and complete real-device QA.
3. Build a store-signed binary with `eas build --platform ios --profile production`. Prepare the matching App Store Connect app record/ID, privacy policy URL, metadata, screenshots, and Apple signing access.
4. Upload the production build with `eas submit --platform ios --latest` after explicit approval. In App Store Connect, enable internal TestFlight testers, review crash/QA feedback, fix issues and upload incremented builds as needed. External testing can require additional Apple review. Only separately submit the final app for App Store review after all requirements are met.
5. Android later: confirm package ID, versionCode, adaptive icon, Play Console access, then `eas build --platform android --profile production`; Play submission is a separate approved step.

No remote build, submission or credential step was executed during D7.

## Final real-iPhone QA

- **Auth:** signup/code/sign-in, kill/relaunch persistence, recovery/password update, sign-out, invalid/expired code, email change if enabled.
- **Sessions:** create Training and Competition, edit Arrow count, reopen, delete a disposable Session.
- **Rounds:** quick Start, preset/custom configuration, multiple Rounds, deletion, and settings update only after backend approval.
- **Scoring:** full/six-ring/triple face, X and miss, plot/advance, select/move, correct score, clear marker, Delete previous, retry failed network save, zoom/pan/reset, reload persistence.
- **Insights and Analytics:** totals, End analysis, grouping/flyers, filters, best completed Round, recent/fresh reads and empty states.
- **Counter:** change increment, add, multiple Undo, reset confirmation and app-restart persistence.
- **Organisation:** join/leave, Head Coach code/regeneration, active roster, read-only athlete details, and denial of athlete scoring writes.
- **Profile/deletion:** profile edit/password change; account deletion only after approved backend and UI are enabled.
- **Device:** narrow iPhone, dynamic text/VoiceOver basics, notch/home indicator, keyboard, weak/offline network, background/foreground and kill/relaunch mid-flow.
