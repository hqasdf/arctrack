# Arc Track privacy policy publication review

> Historical publication-review notes, not a current compliance checklist. The
> 19 October 2026 mobile Phase 1 removes optional biometric app locking and its
> `biometrics.ts` adapter; secure session storage remains. Passkey sign-in is not
> enabled. Earlier release observations below are retained as history.

The canonical policy is now the public web page at src/app/privacy/page.tsx.
This file records implementation evidence and publication checks; it is not a second policy.

Intended URL: https://archery-website.vercel.app/privacy
Last reviewed: 17 October 2026.

Current contact note (30 October 2026): the official public support and privacy
email is [arctrack0@gmail.com](mailto:arctrack0@gmail.com). Website and Android code
share `@arc-track/core/contact`. The checklist below is historical; changing local
source does not publish the policy or update provider dashboards. See
`docs/business-email-migration.md` at the repository root for current follow-up.

## Confirm before publication

- Replace the explicit operator-name and monitored privacy-contact placeholders on the page.
- Confirm backup, Auth log, Vercel log and abuse-prevention retention periods and legal exceptions.
- Confirm configured processing regions, subprocessors/email delivery arrangements, intended audience/age distribution and actual provider dashboard monitoring settings.
- Reconcile the Google Play Data safety answers with the signed Android build, especially foreground approximate location, account information, user content, organisation sharing and provider processing. A public Privacy Policy does not replace any separately required in-app prominent disclosure/permission consent.
- Do not submit the placeholder page as a finished Play policy. Google requires an actual privacy contact, retention/deletion disclosure and a publicly accessible, non-geofenced HTML URL.

## Verified application flows

- Email/password and verification/recovery go through Supabase Auth. Optional profile fields are display name, club/team, division, shooting hand and experience.
- Saved Sessions, Round formats, End/Arrow scores, X state, raw normalized coordinates and triple-face indices support scoring and derived Analytics/Insights.
- Active Head Coaches can read active Archer members' saved history, including Sessions predating membership. Normal Archers do not receive peer access. Leaving removes access based on that membership.
- Plans persist titles/notes, dates, assignments and dated targets/coach notes. Shared plans can survive account deletion with creator/assigner references cleared.
- Weather requests one foreground location fix in eligible active scoring. Coordinates are rounded to two decimals before the trusted Arc Track API; the API sends coarse coordinates to Open-Meteo. The weather save RPC stores conditions and timestamps, not coordinates. Provider logs can still process request information.
- Mobile Auth uses SecureStore-backed session storage; signup/recovery context and Counter state use AsyncStorage. Optional biometric unlock uses the OS result, not biometric templates.
- Grouping exports are local downloads/cache files and user-directed sharing. No immediate cache cleanup is implemented; do not promise that exported files disappear after sharing or account deletion.
- No advertising/tracking or third-party product-analytics/crash SDK was found in current app dependencies/source. Hosting/Auth/provider operational logging is separate and must not be described as nonexistent.
- Profile > Delete Account opens the existing web resource. The server checks current Auth identity, password and exact DELETE confirmation before deleting that identity through the server-only Admin API. Owned scoring/weather/profile records cascade; shared organisations/plans remain. No production deletion was executed for this policy task.

## Relevant code

- src/proxy.ts and src/app/(platform)/layout.tsx: public privacy route stays outside protected-route matching/layout.
- src/features/profile/account-deletion-actions.ts and supabase migrations: account deletion and cascade behaviour.
- src/features/weather/location.client.ts, apps/mobile/src/weather-location.ts, src/features/weather/provider.server.ts and service.server.ts: weather flow.
- apps/mobile/src/secure-auth-storage.ts, auth-flow.ts, counter-model.ts and biometrics.ts: local data.
- apps/mobile/src/privacy-policy-link.tsx: one canonical external Privacy Policy URL, linked from Sign in, Sign up and Profile.

## Deployment verification (not executed by this implementation)

Deploy the reviewed web application to the existing Vercel project using the normal approved release process. No database migration, new environment variable or EAS configuration change is needed for these links.

After deployment, request /privacy without cookies or an Authorization header from outside the developer machine. Confirm HTTPS, status 200, HTML content, no authentication or Vercel Deployment Protection challenge and no country/network restriction. Check mobile and desktop, all in-app links, and the existing account-deletion flow. Test another network/region if worldwide accessibility is required; localhost cannot prove that property.

Build/release the updated Expo application through the existing process so store testers receive the new links. The public web page must be deployed before the new app link can work in production.

Enter https://archery-website.vercel.app/privacy in the Google Play Privacy Policy field only after the content and external accessibility checks pass. The account-deletion URL is a separate Play field.

## Primary references

- https://support.google.com/googleplay/android-developer/answer/10144311?hl=en
- https://support.google.com/googleplay/android-developer/answer/13327111?hl=en
- https://open-meteo.com/en/terms
