# Arc Track mobile

This Expo Router app supports Supabase email/password sign-in and six-digit email confirmation/recovery codes, Session and Round creation, native target-first Arrow scoring, Analytics, a local Arrow Counter, the join-code Organisation model, Profile editing, and sign-out. Arrow scoring uses the shared `@arc-track/core` model and saves to the existing `session_ends` and `arrows` tables.

From the repository root, run `npm ci`, then copy `apps/mobile/.env.example` to `apps/mobile/.env.local`. Set the public Supabase URL and publishable key for the intended development environment. Never put a service-role or secret key here. The `.env.local` file is ignored by Git. See the [developer guide](../../docs/development.md) for focused checks and release boundaries.

Start Metro with `npm run start -w @arc-track/mobile`. Use the existing compatible native development/testing binary for the full app: Expo Go cannot validate the native passkey module and patched SecureStore. Authentication uses the existing SecureStore/session-authority architecture; the Counter uses AsyncStorage and the shared version-3 Counter model. Failed Arrow saves remain visible for retry; full offline synchronization and process-kill recovery of unacknowledged Arrow writes are not promised.

`eas.json` contains existing development, internal preview and production profiles. Preserve the configured package identifiers, icons, signing workflow and R8 settings. Remote builds, environment changes, updates and store releases require separate explicit approval. Public environment values are bundled into the app; never add server secrets. Current OTA configuration is not sufficient to publish an EAS Update safely. Review [dependency compatibility findings](../../docs/dependency-maintenance.md) before the next native release. Documentation is not a live database-migration status check.

Round configuration from the scoring screen stays read-only until the reviewed owner Round-update RPC is applied. The Configure form appears only before the first saved/optimistic Arrow; its Save action also requires `EXPO_PUBLIC_ROUND_UPDATE_ENABLED=true`. Keep this flag unset or `false` until the RPC exists and has been runtime-tested.

Checks: `npm run test -w @arc-track/mobile`, `npm run typecheck -w @arc-track/mobile`, and, from `apps/mobile`, `npx expo export --platform android` or `npx expo export --platform ios`.
