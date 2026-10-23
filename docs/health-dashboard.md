# Health dashboard

`/health` is an owner-only page inside the existing authenticated website layout. The Health navigation item is visible only in the authenticated shell. No new tables, queries for health records, ingestion jobs or OAuth flows are introduced.

## Current production behaviour

The server reader reuses `readGarminStatus(user.id)`. With `GARMIN_HEALTH_ENABLED` off (the default), it performs no health-table queries and returns an empty health dataset. A Garmin account connection is not a health sync. Disconnected, unavailable and connection-attention states link to the existing Profile settings; connected accounts see an awaiting-import explanation. Missing values are displayed as unavailable, never fabricated zeroes. OAuth timestamps are not shown as health-sync timestamps.

## Local design preview

Run `npm run dev`, sign in normally, then open **http://localhost:3000/health?preview=demo** (127.0.0.1 also supported). This requires both development mode and a loopback Host header. Production and remote hosts ignore the preview parameter. Authentication remains required. The fixed fictional dataset ends on 23 October 2026, contains 30 days and is labelled **Demo Data**. It performs no Supabase writes and never claims to be synced Garmin data.

Overview, Trends and Activities are internal views. The date input selects an ending day. Overview shows seven calendar days; Trends enables only complete stored calendar spans of 7/30/90 days. Unknown values remain chart gaps. Sleep bars represent total sleep, with known light/deep/REM stages; awake time is disclosed separately in the tooltip and is not added to sleep duration. Unknown stages use a hatched total-duration bar. Activity times use Asia/Singapore. Activity filtering and newest/oldest/duration sorting are local presentation operations.

Health follows the existing authenticated website Light/Dark/System preference. Light retains the approved white/off-white design; Dark reuses Arc Track's global background, surface, text, muted, border and input-border tokens. The same metric hues are softened against the existing dark text token, with restrained tinted surfaces. The CSS module reads the existing root `data-theme` attribute and the system dark media query; there is no additional theme provider, preference, data request or component remount. The authenticated shell's existing pre-paint theme boundary is preserved.

Charts use custom SVG and native controls, with pointer, touch and keyboard exploration, visible data descriptions and reduced-motion support. Their axes, grid lines, points, sleep stages, missing-stage patterns, legends and tooltips follow the same Health tokens. Native date/filter controls use the effective colour scheme. No extra dependency is required.

## Future real-data boundary

`HealthDataset` and `HealthDay` define the view contract. The locally prepared Garmin foundation can populate it from owner-scoped, RLS-protected records when explicitly enabled after migration. It is not deployed/activated: the provider notification verifier remains fail-closed pending documented authentication requirements. See [Garmin health synchronization](garmin-health-sync.md) for source evidence, migration, permission/deletion behaviour, retention decisions and remaining blockers. No scoring Sessions or OAuth timestamps are substituted for health records. There is no coach access or AI processing.

## Manual review

Review signed-out redirect and all three views at 320, 390, 768 and desktop widths in Light and Dark. Explore chart points using Tab/Enter and touch; select dates and 7/30-day trends (90 days is disabled in the fixture); filter/sort activities. Switch appearance while a filter or information popover is selected and confirm it remains selected. Check empty states, System following and refresh restoration. No live connection, deletion or health import is necessary for UI review.

## Initial implementation verification (23 October 2026, before Health theme support)

- Existing website baseline: 338 passing tests. Final website suite: 357 passing, including 19 Health tests; zero failures or skips. TypeScript, repository lint and production build pass.
- A real unauthenticated HTTP request to `/health?preview=demo` returns 307 to `/sign-in` without fixture measurements.
- Local authenticated browser: normal route shows Garmin unavailable and no measurements; explicit preview shows the labelled fixture. Overview/Trends/Activities, 30-day range selection, activity filtering/sorting, native keyboard date selection and keyboard sleep tooltips were exercised.
- DOM geometry at 320, 390, 768 and desktop CSS pixels shows no horizontal overflow. Mobile uses one column; tablet uses two; desktop uses five metric columns and three chart columns. White content colours remain unchanged when the existing shell switches between Light and Dark. Original System preference and normal browser size were restored.
- A desktop screenshot is saved under ignored `.verification/health/desktop.jpg`. Narrow-viewport and full-page screenshot capture timed out in the browser connector; those widths have layout/interaction evidence, not screenshot-based visual sign-off. Real touchscreen and screen-reader testing remains manual.
- One development-only Turbopack stylesheet hot-reload error occurred during editing. Reload restored the page; no further runtime errors were observed afterward. Production compilation passes.
- The accessible attachment contains the written white-design brief; exact image-to-image comparison with the mentioned approved reference was not available.

## Health theme verification (24 October 2026)

- Baseline: 384 passing website tests. With five focused Health appearance regression tests: 389 passing, zero failures/skips. Health/theme subset: 38 passing. TypeScript, repository ESLint and production build pass.
- All 523 original non-token CSS declarations retain their resolved Light values, including layout and responsive rules. One additional colour-only rule improves the wellness eyebrow label from 4.36:1 to AA contrast; its typography and position are unchanged.
- Local Opera preview: Overview, Trends and Activities were exercised in Light and Dark, including 30-day Trends, keyboard chart exploration, missing-stage tooltips, information popovers and activity filtering/sorting. Filters, date and an open popover survived theme switching. System followed the current dark OS appearance and was restored after refresh.
- All three views in both themes were measured at 320, 390, 768 and 1537 CSS pixels (24 combinations): no horizontal overflow. Desktop, chart-detail and 320px mobile screenshots are under ignored `.verification/health-theme/`.
- Computed visible text colours passed AA checks in all three views: minimum 4.57:1 in Light and 5.38:1 in Dark. The normal non-demo connection notice and empty states were also checked in Light and System Dark. No browser console errors were captured.
- Loading and retry views share the same themed dashboard styles and pass existing rendering tests. A forced runtime error, live imported health data, a light OS/System transition, real touchscreen and screen-reader behaviour were not tested. Reduced-motion and System Light fallback are covered by stylesheet/regression checks, not a physical-device claim.
- Only Health styling, its directly related tests and this documentation changed for the theme task. No React component, provider, reader, calculation, Garmin/backend, global theme, navigation, Expo or database changes were required.
