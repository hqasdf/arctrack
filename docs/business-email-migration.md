# Official business contact migration

Local source review: 30 October 2026, baseline
`c9db09775e86dd268d3948876fa0bd1e33530fce`.

Official public contact: [arctrack0@gmail.com](mailto:arctrack0@gmail.com).
This covers general support, technical/account help, privacy/access/correction
requests, deletion assistance and connected-service questions. It is not an SMTP
sender, authentication identity, service account or OAuth owner.

## Audit findings

The previous public contact was one personal Gmail mailbox used in two places:
`src/app/privacy/page.tsx` and `src/app/delete-account/page.tsx`. Their rendered
HTML tests also asserted that old mailbox. Those active references were replaced.
The Android app already linked to both canonical web resources; its Profile now
also displays a direct support email action using the shared contract.

The source/text audit covered tracked and nonignored local application, core,
mobile, tests, scripts, public assets, documentation, Supabase fixtures/migrations,
workflow and text configuration files. Generated output, dependency trees, Git
history, encrypted credentials and private environment files were not treated as
public contact source. No secret values were printed or changed. Environment
example/configuration key review found no repository SMTP credentials to migrate.
This was not image OCR or an audit of hosted provider settings.

Other address matches are synthetic Auth/validation/SQL fixture identities under
`example.com`, `example.test`, `example.invalid` and `synthetic.invalid`, plus URL
userinfo rejection fixtures (such as credentials before `@` in a URL). They are
not business mailboxes and remain unchanged. Dynamic `user.email`/profile email
fields identify the signed-in user and must not be replaced with the business
address. Provider/operational hostnames are also unchanged.

No separate Arc Track Terms, Help, contact-form or outbound customer-notification
template system was found. No email address was found in runtime SEO/structured
data/PWA metadata requiring a replacement. No contact clipboard action existed.
Coach/training invitation records are not a configurable SMTP sender identity.

## Implementation

`packages/core/src/contact.ts`, exported as `@arc-track/core/contact`, supplies
`BUSINESS_CONTACT_EMAIL` and `BUSINESS_CONTACT_MAILTO`. Website privacy/deletion
pages and Android Profile use those values; they do not build contact URLs from
user input or attach user IDs, credentials or private data to email bodies.

Android opens the mailto through the existing Linking API. If no email app opens,
the existing error UI shows the address for manual use and warns not to send
passwords or verification codes. No message is sent automatically.

README and the maintained Auth setup template example now include the same
contact. The historical mobile policy review has a current-contact note without
silently rewriting its older observations. Tests independently pin the intended
address, render web mailto links and exercise native support/deletion actions.

## Privacy and deletion review

Only the policy contact import/link changed; `Last updated: 27 October 2026` is
unchanged. A contact-only source change does not automatically establish a new
legal effective date. The operator should decide publication/revision treatment
when releasing it. No retention period, compliance claim, delivery deadline or
data-processing promise was added.

The existing signed-out deletion page remains public and explains how to recover
access or request assistance. Ownership must be verified; users are told not to
send passwords/codes. The self-service flow is unchanged: verified Auth identity,
password and exact DELETE confirmation, isolated reauthentication with matching
user ID, Garmin cleanup/fences and server-only Admin deletion. Email does not
replace that flow. Tests cover signed-out/unavailable/signed-in page rendering and
the native public deletion URL. No real account was deleted.

Separate policy follow-up, intentionally not changed in this contact task:

* The policy still uses optional biometric-unlock wording, while the current
  native controls concern passkey/biometric sign-in and legacy app locking was
  removed. Review the terminology against the enabled/released feature.
* The new offline scoring journal, its retained pending/review history and its
  app-private, unencrypted storage need explicit disclosure before that feature
  is released. Generic cache language is not a detailed description of it.
* The broad wearable-sample-array exclusion should be reconciled with the separate
  Session HR disclosure describing retained timestamped HR datasets.
* The deletion page retains a bracketed operational-log/backup retention item and
  unfinished-publication wording. Resolve it using confirmed operator settings;
  do not manufacture retention guarantees from this source audit.
* Current hosting-plan/retention statements were not reverified against live
  provider accounts in this task.

## Hosted email and publication checklist

All items below are **unverified and unchanged externally**. Obtain separate
authorization before changing hosted settings. Repository edits do not perform
these actions or verify ownership/deliverability of the mailbox.

| Surface / location | Required owner action |
| --- | --- |
| Play Console → Arc Track → Grow users → Store presence → Store settings → Store listing contact details | Set the public support email to `arctrack0@gmail.com`; review the listing's App support display after publication. [Official instructions](https://support.google.com/googleplay/android-developer/answer/113477?hl=en). |
| Play Console → developer account details / contact information | Review any public developer contact separately. Do not replace login, legal-verification or private account contacts merely to match support. The account-specific field layout was not inspected. |
| Play Console → Arc Track → Policy and programs → App content → Data safety → account/data deletion disclosures | Verify links still point to the existing public `/delete-account` resource and `/privacy`; review any manually entered support text. Keep current declarations unless actual behavior warrants an authorized change. |
| Supabase → project `pdwxphgyqbbflnrruobp` → Authentication → Emails / Email Templates | Review signup, recovery, invitation, email-change and enabled security-notification bodies for support links. Update contact text only, preserving OTP/link variables and current flow. The repo's `docs/auth-setup.md` example is not deployed automatically. [Template documentation](https://supabase.com/docs/guides/auth/auth-email-templates). |
| Supabase → Authentication → Emails / SMTP settings, and the existing email provider | Inspect configured reply-to/support fields if available. Change a public reply-to only through the appropriate approved provider control. Leave sender address, credentials, domain verification and sending authentication unchanged. Do not assume an arbitrary Reply-To template header is supported. [SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp). |
| Google Auth Platform → existing app → Branding, if Google OAuth is used | Review User support email and select the official mailbox only if the account/provider permits it. Ownership/selection prerequisites may apply. Leave OAuth clients, account identities and secrets unchanged. [Branding documentation](https://support.google.com/cloud/answer/15549049?hl=en). |
| Garmin Developer Portal → existing Arc Track application record | Review public application/developer support contact fields where available. Field layout/current values were not inspected. Do not modify Garmin API Tools notification endpoints, callback URLs, permissions, credentials or account ownership. |
| Website / store resources | After a separately approved release, verify rendered `/privacy`, `/delete-account`, native Profile and any published store URLs show the new contact. Do not change the existing deletion URL. |
| Domain registrar / other connected-service profiles, if applicable | Review any public support/contact listing. Keep registrar identity, billing/login emails, Vercel/Cloudflare accounts and service credentials separate. No such dashboard values were read or updated. |
| Business mailbox | Confirm the mailbox is accessible and monitored, and test replies through an authorized manual procedure. No test email or support request was sent by this task. |

## Changed-file manifest

* `packages/core/src/contact.ts` and `packages/core/package.json`: shared public
  contact contract and package export; no dependency versions changed.
* `src/app/privacy/page.tsx` and `src/app/delete-account/page.tsx`: official contact
  display and mailto, without changing policy dates/deletion behavior.
* `apps/mobile/app/(tabs)/profile.tsx`: direct support link and safe failure text.
* `README.md`, `docs/auth-setup.md`, `apps/mobile/docs/privacy-policy-draft.md`:
  consistent support information and explicit hosted-configuration limits.
* `packages/core/tests/contact.test.mjs`, `tests/business-contact.test.mjs`,
  `tests/privacy-policy.test.mjs`, `tests/account-deletion-page.test.mjs`,
  `apps/mobile/tests/account-deletion-entry.test.mjs`: contact drift/rendering,
  safe native link errors and preserved deletion regression checks.
* `docs/business-email-migration.md`: this audit and manual publication checklist.

## Local verification

* Website tests: 690 passed; mobile tests: 561 passed; shared-core tests: 124 passed.
* Focused contact/privacy/deletion tests: 14 passed, overlapping those suites.
* Website/mobile/core TypeScript, website/root ESLint and changed Profile mobile
  ESLint passed. This does not claim a full mobile lint cleanup.
* Next.js 16.4.1 production build passed. No website or Android artifact published.
* Architecture checks passed across 343 source files. All 37 canonical migration
  files and seven historical aliases passed local consistency checks.
* `git diff --check` passed. Dependency versions, lockfile, native SecureStore
  patch, scoring/offline/Garmin code, Auth/deletion actions and SQL are unchanged.
* The final inventory scanned 724 text files and found 74 distinct email-shaped
  values: one official business mailbox and 73 synthetic/validation fixture
  values. No unclassified mailbox or old active public contact remained. The
  generated local inventory is in ignored `.verification/business-email/`.

Mailto targets and public HTML were exercised through automated tests; native
mail-client launch and mailbox delivery were not tested on a device. No email was
sent, no account deleted and no external settings were updated.
