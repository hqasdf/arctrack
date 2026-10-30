# Connect Arc Track sign-in

This increment adds email/password registration, sign-in, password reset, sign-out, and authenticated page checks. The code is ready to connect; successful real account and email flows must still be tested against your Supabase project.

## 1. Create your Supabase project

Open https://supabase.com/dashboard and sign in or create an account yourself. Choose New project, select/create your organisation, and name the project Arc Track. Choose the region nearest your archers. Keep the generated database password privately. This sign-in integration does not need that password.

Wait for the project dashboard to become ready. No tables or SQL scripts are needed in this increment.

## 2. Fill the local connection file

Open `web/.env.local`. If it does not exist, copy `.env.example` to `.env.local`.

In the Supabase project's Connect dialog, find Project URL and Publishable key. The key must begin with `sb_publishable_`. Copy those two values into the local file:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_VALUE
APP_URL=http://127.0.0.1:3000
```

Use the publishable key, not the database password, secret key, or service-role key. Do not paste passwords into the task. `.env.local` is ignored by Git. The URL/key identify the project; user authentication and future database policies determine access.

## 3. Configure email sign-in

In Supabase Authentication settings:

1. Enable email/password sign-in and keep email confirmation enabled.
2. Set the minimum password length to 12 to match the app.
3. Under URL Configuration, set Site URL to `http://127.0.0.1:3000`.
4. Add these exact allowed redirect URLs:
   - `http://127.0.0.1:3000/auth/callback`
   - `http://127.0.0.1:3000/auth/callback?next=/update-password`
5. Set Email OTP length to **6 digits** and Email OTP Expiration to **300 seconds**. Supabase enforces expiry from issuance, not from opening the email or refreshing the form.
6. Replace both **Confirm signup** and **Reset password** email bodies with a code-only template:

```html
<h2>Your Arc Track verification code</h2>
<p>{{ .Token }}</p>
<p>This code expires in 5 minutes. Enter it on the website.</p>
<p>If you did not request this email, ignore it.</p>
<p>For account support, contact <a href="mailto:arctrack0@gmail.com">arctrack0@gmail.com</a>. Never send passwords or verification codes.</p>
```

This is repository template guidance, not a change to hosted Supabase templates.
Keep the existing OTP variables, SMTP sender identity and provider credentials.
The public support mailbox is separate from the technical sending account.

Do not include a confirmation link. Keep Confirm Email enabled. Supabase generates and verifies all codes. The app never generates its own OTP.

Use `127.0.0.1` consistently. It is a different cookie host from `localhost`. Read email on any device, then enter the code on the website. The registration and recovery flows lead to their code-entry pages; normal sign-in has no separate verification link or code step. Code entry does not require the requesting browser cookies. The local loopback website itself is reachable only on the development computer. For another port, update APP_URL and both Supabase redirects to match.

Supabase's default email service sends only to project-team addresses and has a low rate limit (documented as two emails per hour when checked). Begin with your own project-account email. Before inviting normal users, configure custom SMTP. Do not turn off email confirmation to work around delivery restrictions.

## 4. Start the app

Open a terminal in `web`. If a development server is running, stop it with Ctrl+C, then run:

```powershell
npm.cmd run dev
```

Open http://127.0.0.1:3000/sign-in. If the form is still disabled, check all three environment settings, save the file, and restart the server.

## 5. Test together

- Signed out: direct visits to `/dashboard`, `/sessions`, and `/update-password` must return to sign-in.
- Register: use your own email and a unique password of 12–128 characters. The app should ask you to check email.
- Confirm: enter your email and the six-digit code on the registration verification page; expect Dashboard and normal session cookies. Repeat in a fresh browser context without the originating cookies.
- Sign out: expect the sign-in page and a signed-out message. Revisiting a protected page or using Back must not grant access.
- Sign in: correct credentials open Dashboard; incorrect credentials show a generic error without exposing account information.
- Reload a protected page: expect the session to persist while valid.
- Reset: request recovery, enter the six-digit code on the next page, choose a new password, then sign out and sign in with it. Test that signup codes do not satisfy recovery verification.
- Verify an unused code works after two minutes and before five minutes, but fails after five minutes. Check incorrect/reused codes, resend limits, and that refresh cannot extend expiry.
- Invalid/expired/reused legacy callback: expect an explanatory sign-in message, never an authenticated page.
- Network failure: expect an error and no authenticated access. Retry when connectivity returns.
- Before profile data is added: test two separate accounts/browser contexts and ensure their identities never cross. Once tables exist, separately test row-level policies; page protection alone is not database isolation.

## How the code connects

`AuthForm` -> server action -> input validation -> Supabase Auth -> HttpOnly session cookies -> server identity check -> protected page.

- `src/features/auth/actions.ts`: registration, login, code verification/resend, recovery, password update, logout.
- `src/lib/supabase/server.ts`: creates a fresh cookie-aware SDK client per request.
- `src/proxy.ts`: refreshes tokens and prevents shared caching of auth responses.
- `src/lib/auth/session.server.ts`: asks Supabase to verify the user. Both the layout and each current protected page call it; future data operations must do so too.
- `src/app/auth/callback/route.ts`: retained legacy PKCE callback. New email templates send codes verified through Server Actions instead. Only fixed internal destinations are accepted.
- `src/lib/auth/config.ts`: rejects incomplete configuration and accidental secret keys.

No browser Supabase client is used yet, so session cookies are HttpOnly. Adding browser-side Supabase later requires deliberately revisiting that design. Sign-out applies to the current browser, not all devices. Password update requires a verified signed-in identity; a recovery email is one route to obtaining it.

No custom tables/migrations or row-level security policies have been created in this step. Supabase manages its own authentication identities. Next increment: agree ArcherProfile fields and its one-to-one relationship with identity before implementing profile persistence.

## References

- https://supabase.com/docs/guides/auth/server-side/creating-a-client
- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/guides/auth/redirect-urls
- https://supabase.com/docs/guides/auth/auth-smtp

## Current status

Supabase connection verified; signup enabled and confirmation required. No development bypass remains. Hosted six-digit/300-second settings and code templates await user confirmation. Real account, email delivery, code expiry, signed-in persistence, recovery, and two-account tests remain pending.

## Signup email carry-forward

Signup remembers the submitted email in an HttpOnly, SameSite=Lax UI-context cookie for up to one hour, cleared after successful email-code verification. This is not a session or OTP and grants no access; Supabase still verifies the email/code and enforces the separate 300-second code expiry. The verification page shows only a code input and the recipient email. It has no Already confirmed link. Without signup context, it returns to registration. Read the email on any device, then enter the code in the signup browser; this convenience step does not require the old PKCE verifier. Hosted code-only email templates and expiry still need confirmation and live testing.
