# Production-build and public-page performance validation

The scoped `web` job in `.github/workflows/validate.yml` now runs a **required** `npm run build` after its existing type, lint and regression checks. Build failures remain blocking. Mobile, shared-core, architecture, migration consistency and essential/full-suite selection retain their existing scopes. Root configuration, package manifests, scripts and workflow changes already select every relevant job; tests cover the new performance paths.

The same web job reuses that build for `npm run report:build` and `npm run test:performance`; no second CI build or monitoring service is introduced. Only Lighthouse execution is initially `continue-on-error`. Public reports are uploaded even after failure, under a commit-specific artifact name, for 14 days. Checkout, Node setup and artifact upload actions use reviewed immutable commit SHAs; workflow permissions remain `contents: read`, without credentials or deployment commands.

## Tool and measurement contract

Lighthouse CLI **13.6.0** is an exact development dependency. Its Node requirement raises the root minimum from 22.18 to **22.19**; CI continues using Node 24. Existing package versions, Next.js, Expo, React and SecureStore protections are unchanged. Only the Lighthouse dependency tree is added; package placement/metadata can change during npm lockfile reconciliation.

The runner starts a production Next server on `127.0.0.1:4173`, refuses a pre-existing server, and measures only `/`, `/sign-in` and `/privacy`. It uses three independent runs per route, default Lighthouse mobile emulation and simulated throttling, fresh headless Chrome profiles, then shuts down the server. No login, cookies, private athlete records or provider requests are needed. It rejects local `.env` files and populated Supabase/Garmin environment variables. CI uses a clean checkout and no secrets.

Reports contain JSON and HTML per run, median/min/max LCP, CLS and TBT, transferred JavaScript bytes, total page bytes, and server output. **TBT is a laboratory responsiveness metric, not field INP.** Loopback excludes real CDN/network geography and does not measure authentication, database latency, mobile-device thermals, scrolling or long-session rendering. Browser version, CPU load, GPU/WebGL support and runner changes affect results. Raw Lighthouse reports record Chrome/environment/throttling settings.

The baseline in `performance-baseline.json` is provisional: local Windows, headless Chrome and an isolated **Webpack** build. The repository's normal Turbopack build is validated separately. Route regressions are compared only when platform, builder and Lighthouse version match. Linux/Turbopack CI initially gathers evidence; record a fresh matching baseline after several stable hosted runs before gating anything. Cross-environment scores must not be presented as equivalent.

Warning budgets use the larger of median × 1.25 and median plus a noise allowance: LCP 500 ms, CLS 0.02, TBT 150 ms, JavaScript 32 KiB, page weight 64 KiB. Reports warn without failing CI. Static JavaScript disk size has a separate 15% growth warning against the recorded normal Turbopack build. Disk size is not transferred or route-specific size. Inspect the ten largest chunks before attributing growth to a dependency. Do not update the baseline automatically to conceal regressions.

## Running locally without real configuration

From the repository, run `node scripts/prepare-performance.mjs`. It prints the path of a new temporary source export containing current tracked/unignored working files while excluding dotenv files, Git metadata, dependencies and verification archives. Dependencies are linked read-only by convention to the installed root tree; no package installs run in the export. Review the source before measuring it.

Change directory to that path. On Windows the external dependency junction is rejected by Turbopack's filesystem-root boundary, so build this temporary export using `node node_modules/next/dist/bin/next build --webpack`. Set `CHROME_PATH` to an installed Chrome executable, and `PERFORMANCE_BUILD_ENGINE=webpack`, then run `node scripts/test-performance.mjs`. In a normal clean Linux CI checkout use the default `npm run build` and `npm run test:performance` instead. Keep any inherited application credentials unset. Outputs stay under the export's `.verification/performance/`.

`PERFORMANCE_RUNS=1` is available for smoke testing only; do not substitute a single run for a measured baseline. The runner accepts at most five runs. It refuses unexpected route redirects and incomplete/failed Lighthouse results rather than reporting zero metrics. Measurement failures are visible in CI even though initially non-blocking.

## Homepage and operational boundaries

No homepage source changes are needed. Preserve dynamic `archery-scene` import, SVG fallback, reduced-motion handling, adaptive pixel ratio, visibility suspension and geometry/material/texture/renderer disposal. Headless WebGL availability varies; fallback rendering must remain a supported path, not a CI failure based on a global score. This task does not prove visual or WebGL equivalence on physical hardware.

No new serverless telemetry or production monitoring is installed. Existing provider logs/monitoring remain operational tools; public Lighthouse cannot establish API tail latency, queue health or field Core Web Vitals. Add those only with a separate privacy and operational decision. Existing npm caching and build reuse keep CI bounded; the web timeout is 30 minutes. Hosted run duration/cache-hit behavior remains unverified until this workflow is approved, pushed and actually runs.

Tool reference: [official Lighthouse CLI](https://github.com/GoogleChrome/lighthouse#using-the-node-cli).
