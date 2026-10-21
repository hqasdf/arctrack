# Mobile appearance

Arc Track Expo supports **Light**, **Dark** and **System** under Profile → Appearance. System is the first-launch default. This is a device-local setting and is also applied to authentication screens; the website's signed-out Light-only policy remains unchanged.

## Implementation

- `src/organization-appearance.ts` contains the existing website-derived general/Coach palette source.
- `src/theme.ts` adds general semantic aliases and exact input, soft, error and chart tokens.
- `src/coach-palette.ts` exposes stable Coach palettes from that same source.
- `src/appearance-store.ts` keeps preference separate from resolved appearance, serialises preference writes and protects against late restoration overwriting a new selection.
- `src/appearance.tsx` connects one appearance listener and one foreground listener, provides stable palette/style objects, and sets the native root background.
- `src/appearance-settings.tsx` provides the accessible three-choice Profile control.
- The root provider sits outside authentication. Theme changes do not key/remount the route tree, alter auth guards, or refetch data. The existing account-identity key remains intact.

Preference storage is AsyncStorage key `arc-track:mobile-appearance:v1`, separate from all authentication/session-authority storage. Invalid or missing values resolve to System. A failed read does not write defaults over saved values. A failed write retains the selected appearance, reports the persistence error in Profile, and allows another selection to retry. The app waits for initial restoration before mounting screens; an OS/native launch surface can still appear before JavaScript restores a saved explicit preference.

The installed React Native implementation uses `Appearance.setColorScheme('unspecified')` to restore OS following. Explicit Light/Dark overrides OS changes. Foreground events recheck appearance and listeners are removed on unmount.

## Website references

- `src/styles/globals.css`: general Light tokens.
- `src/styles/theme.css`: general Dark tokens and System rules.
- `src/components/theme/theme-preference.ts`: preference/default/persistence conventions.
- `src/components/theme/theme-control.tsx`: website selector.
- `src/features/organizations/components/coach.module.css`: Coach Light/Dark tokens.

Token parity tests read the actual CSS. No browser CSS/DOM code is imported into the native app. Target face colours, scoring swatches, Arrow markers, geometry and static PNG report colours stay fixed intentionally.

## Native configuration

`app.json` uses `userInterfaceStyle: automatic`. Expo SDK-compatible `expo-system-ui ~57.0.4` is required for Android and provides the native root background API. Expo configuration introspection verifies Android `expo_system_ui_user_interface_style=automatic` and iOS `UIUserInterfaceStyle=Automatic` without writing native projects. Status bar text and Expo Router navigation surfaces follow the resolved palette.

A future native development/release build is required to include this native module/configuration. No EAS or native release build is part of this change. Native Google Password Manager/passkey dialogs remain platform-owned.

## Physical-device QA still required

1. In Profile select Light, Dark and System. In System, change the device's OS appearance while active and while backgrounded, then return.
2. Restart in each preference. Sign out/in and verify the preference is retained without automatic biometric prompts.
3. Inspect sign-in, sign-up, recovery, loading/errors, Sessions, create/edit forms, Counter, Analytics, all Coach routes and Training Plan forms in both appearances.
4. Verify chart labels, input placeholders, keyboard, native dialogs, bottom tabs, headers, status/navigation bars, safe areas and scoring configuration/export modals.
5. During an unfinished scoring Round, switch appearance and verify current slot, edits, gestures and saved data persist. Target colours and PNG output must stay unchanged.
6. Keep an unsaved Profile/Training Plan form open while changing OS appearance in System; verify values survive. Check large text and short/landscape windows.

Automated tests exercise preference lifecycle, storage failure/retry, parity/contrast, routing harnesses and state preservation in auth, Counter, Coach navigation and active scoring. They do not replace Android/iOS screenshot and interaction testing.

## Files touched by this appearance task

Existing files (including appearance additions to ongoing Coach work):

- `apps/mobile/app.json`
- `apps/mobile/app/(auth)/sign-in.tsx`
- `apps/mobile/app/(auth)/sign-up.tsx`
- `apps/mobile/app/(tabs)/_layout.tsx`
- `apps/mobile/app/(tabs)/analytics.tsx`
- `apps/mobile/app/(tabs)/counter.tsx`
- `apps/mobile/app/(tabs)/organization/[organizationId].tsx`
- `apps/mobile/app/(tabs)/organization/[organizationId]/analytics.tsx`
- `apps/mobile/app/(tabs)/organization/[organizationId]/athletes/[userId].tsx`
- `apps/mobile/app/(tabs)/organization/[organizationId]/athletes/[userId]/sessions/[sessionId].tsx`
- `apps/mobile/app/(tabs)/organization/[organizationId]/athletes/[userId]/sessions/[sessionId]/rounds/[roundId].tsx`
- `apps/mobile/app/(tabs)/organization/[organizationId]/athletes/index.tsx`
- `apps/mobile/app/(tabs)/organization/[organizationId]/reviews.tsx`
- `apps/mobile/app/(tabs)/organization/[organizationId]/settings.tsx`
- `apps/mobile/app/(tabs)/organization/[organizationId]/training-plans/[planId]/index.tsx`
- `apps/mobile/app/(tabs)/organization/[organizationId]/training-plans/index.tsx`
- `apps/mobile/app/(tabs)/organization/_layout.tsx`
- `apps/mobile/app/(tabs)/organization/index.tsx`
- `apps/mobile/app/(tabs)/organization/member/[organizationId].tsx`
- `apps/mobile/app/(tabs)/profile.tsx`
- `apps/mobile/app/(tabs)/sessions.tsx`
- `apps/mobile/app/_layout.tsx`
- `apps/mobile/app/recover.tsx`
- `apps/mobile/app/rounds/[roundId]/score.tsx`
- `apps/mobile/app/sessions/[sessionId].tsx`
- `apps/mobile/app/sessions/[sessionId]/configure-round.tsx`
- `apps/mobile/app/sessions/new.tsx`
- `apps/mobile/app/sessions/training-plans/[planId].tsx`
- `apps/mobile/package.json`
- `apps/mobile/src/auth-ui.tsx`
- `apps/mobile/src/coach-palette.ts`
- `apps/mobile/src/coach-readonly-target.tsx`
- `apps/mobile/src/coach-ui.tsx`
- `apps/mobile/src/grouping-export.tsx`
- `apps/mobile/src/native-target.tsx`
- `apps/mobile/src/passkeys/prepared-ui.tsx`
- `apps/mobile/src/passkeys/screen-controls.tsx`
- `apps/mobile/src/password-field.tsx`
- `apps/mobile/src/privacy-policy-link.tsx`
- `apps/mobile/src/round-insights.tsx`
- `apps/mobile/src/session-category-tabs.tsx`
- `apps/mobile/src/session-weather.tsx`
- `apps/mobile/src/theme.ts`
- `apps/mobile/src/training-plans-ui.tsx`
- `apps/mobile/tests/account-deletion-entry.test.mjs`
- `apps/mobile/tests/auth-ui.test.mjs`
- `apps/mobile/tests/coach-palette.test.mjs`
- `apps/mobile/tests/coach-workspace.test.mjs`
- `apps/mobile/tests/counter-responsive.test.mjs`
- `apps/mobile/tests/helpers/auth-runtime.mjs`
- `apps/mobile/tests/native-target-gestures.test.mjs`
- `apps/mobile/tests/passkey-controls.test.mjs`
- `apps/mobile/tests/passkey-integration.test.mjs`
- `apps/mobile/tests/privacy-policy.test.mjs`
- `apps/mobile/tests/signin-responsive.test.mjs`
- `apps/mobile/tests/weather.test.mjs`
- `package-lock.json`
- `tests/scoring-replot.test.mjs`
- `tests/session-category-tabs.test.mjs`

New files:

- `apps/mobile/src/appearance.tsx`
- `apps/mobile/src/appearance-store.ts`
- `apps/mobile/src/appearance-settings.tsx`
- `apps/mobile/tests/appearance.test.mjs`
- `apps/mobile/docs/appearance.md`

Also updated the comment in the already-present untracked `apps/mobile/src/organization-appearance.ts`; its palette values were preserved. Updated appearance mocks in the already-present untracked `apps/mobile/tests/organization-workspace-ui.test.mjs`. Existing passkey diagnostics/service changes and Digital Asset Links work were left intact.
