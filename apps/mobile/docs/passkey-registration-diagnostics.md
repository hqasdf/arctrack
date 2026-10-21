# Play-installed Android passkey registration diagnostics

Local investigation, 21 October 2026. No build, deployment or live configuration
change is implied by this document. Preserve password access and existing data.

## Existing installed build: inspect without rebuilding

Use Windows **CMD**, with the tester's permission and their phone connected via
USB debugging. Do not uninstall, clear app/provider data, or delete passkeys.

```cmd
set "PATH=%LOCALAPPDATA%\Android\Sdk\platform-tools;%PATH%"
adb devices -l
adb shell pm list packages -i com.arctrack.archery
adb shell dumpsys package com.arctrack.archery | findstr /I "versionName versionCode"
adb shell pidof com.arctrack.archery
```

Check the installer (normally `com.android.vending` for Play), but do not treat
that alone as proof of the signing certificate. Open Arc Track first if no PID
is returned. Replace `12345` below with its actual PID:

```cmd
adb logcat --pid=12345 -v time -T 1 "System.err:W" "*:S"
```

Keep this stream local. The existing library prints some credential-creation
exceptions. Reproduce once, then Ctrl+C. Share only the exception class, DOM
subtype/safe code and reproduction time after reviewing/redacting locally. Do
not share arbitrary exception messages or the complete stream. If there is no
native exception, this does not prove native success: JS validation, parsing or
foreground-return failure may need the diagnostic source below.

For actual certificate verification, inspect the installed base APK read-only:

```cmd
adb shell pm path com.arctrack.archery
```

Copy the returned `base.apk` path, omit its `package:` prefix, and substitute it
for `DEVICE_BASE_APK_PATH` (split APKs do not need to be pulled):

```cmd
adb pull "DEVICE_BASE_APK_PATH" "%TEMP%\arc-track-installed-base.apk"
"%LOCALAPPDATA%\Android\Sdk\build-tools\36.0.0\apksigner.bat" verify --print-certs "%TEMP%\arc-track-installed-base.apk" | findstr /I /C:"certificate SHA-256 digest:"
```

Compare with **Play App Signing**, not the upload/debug key. If Play uses key
rotation, check the certificate actually delivered to this Android version.
No signing credentials or private key are required for this check. Delete only
this temporary copied APK after inspection; do not alter the installed app.

## Prepared source diagnostics: future approved build only

`[ARC_PASSKEY]` records contain only fixed stage names, allowlisted error codes
and bounded HTTP status numbers. There are no payloads, challenges, credential
IDs, account IDs, tokens, email addresses, RP values or arbitrary messages.
They are local console records, not a remote telemetry service. Diagnostic sink
failure must never change registration outcomes.

These records are **not present in an older installed binary**. If existing
native logs are insufficient, a separately approved build containing this source
must be delivered through an appropriate Play-signed test track. An ordinary
debug/upload-key-signed APK is not equivalent to the Play-signed app.

For that future build, capture only the safe registration records:

```cmd
adb logcat --pid=12345 -v time -T 1 "ReactNativeJS:I" "*:S" | findstr /L /C:"[ARC_PASSKEY]"
```

Interpretation:

| Last relevant records | Boundary |
| --- | --- |
| `registration_options_error` | Options API rejected/returned no usable challenge |
| `registration_rp_error` | Options RP differs from the fixed app RP |
| `native_options_error` | Local input validation rejected options |
| `native_create_error` | Library `Passkey.create()` rejected; inspect allowlisted code/native exception |
| `native_create_success` then `native_prompt_error` | Library resolved; foreground-return scope failed |
| `native_prompt_returned` then `native_response_error` | Local returned-response validation failed |
| `verification_error` | Verification returned a Supabase error/no result |
| `verification_started` then `registration_error` | Possible thrown transport error or abandoned operation; correlate backend logs |
| `verification_success` then error | Server verified; inspect refresh/storage stages |
| `enrollment_success` | Final server reconciliation and local registration metadata completed |

`native_create_success` means the library promise resolved. It does **not** mean
Supabase accepted or stored a credential. `verification_success` does not by
itself mean local enrollment metadata was persisted.

## Association checks

Compare the live website statement with the exact installed certificate/package.
Current Google guidance includes **both** `common.get_login_creds` and
`common.handle_all_urls`. The current repository/live statement has only the
former; no association file was changed in this diagnostic task.

Read Play Console → Deep links → App configuration → Credential sharing for
`archery-website.vercel.app`. Google documents Play-managed app-side association
as an alternative to manual `asset_statements`, without a new app version.
Local absence of manifest metadata alone cannot establish Play's configuration.
Do not enable/change it or deploy a statement without approval.

Official references:

- https://codelabs.developers.google.com/seamless-credential-sharing
- https://developers.google.com/identity/credential-sharing/set-up
- https://developer.android.com/identity/credential-manager/prerequisites
- https://developer.android.com/identity/sign-in/credential-manager-troubleshooting-guide
- https://supabase.com/docs/guides/auth/passkeys
