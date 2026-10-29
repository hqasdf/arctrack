# Arc Track developer guide

See [the architecture guide](architecture.md) for module ownership, contracts, lifecycle rules and the feature checklist.

## Setup and architecture

Use Node 24 for parity with CI (the repository minimum remains Node 22.18) and npm. From the repository root, run `npm ci`. The existing postinstall verifies and applies the reviewed Android SecureStore patch; do not bypass it in builds or change its pinned package casually.

- `src/`: Next.js website and server-only integrations.
- `apps/mobile/`: Expo Router app, native UI and local storage adapters.
- `packages/core/`: platform-neutral models and calculations.
- `supabase/`: canonical migrations, disposable fixtures and reviewed operational SQL.
- `infra/garmin-ingress/`: existing ingress implementation; not deployed by CI.

Copy `.env.example` to ignored `.env.local`, enter development configuration locally, and run `npm run dev`. Use the same local origin as `APP_URL`. Never copy server secrets into a public variable or commit a filled environment file. Existing examples keep Garmin authorization/ingestion disabled by default; development setup does not authorize activation.

For mobile, copy `apps/mobile/.env.example` to ignored `apps/mobile/.env.local` and run `npm start --workspace @arc-track/mobile`. Use only the intended Supabase URL and publishable key in public configuration. The full app includes native passkey code and a patched native SecureStore implementation, so Expo Go does not validate the full authentication flow. Use the existing compatible development/testing binary for native testing.

## Fast checks

Run only the checks relevant to the change:

```sh
npm run test:essential
npm run test:essential --workspace @arc-track/mobile
npm test --workspace @arc-track/core
npm run check:architecture
npm run check:maintenance
npm run typecheck
npm run typecheck --workspace @arc-track/mobile
npm run typecheck --workspace @arc-track/core
npm run lint
npm run lint:mobile
```

`lint` retains its existing web/root scope. `lint:mobile` is separate and currently reports eight existing errors in untouched auth/recovery, session-category and weather files. CI gates mobile TypeScript and essential regressions; it does not disguise full mobile lint as passing.

For an optional full regression pass, use `npm test`, `npm test --workspace @arc-track/mobile`, and `npm test --workspace @arc-track/core`. Run `npm run build` when web runtime dependencies or imports change. From `apps/mobile`, `npx expo install --check` reports SDK compatibility; do not automatically follow it with `--fix`. See [dependency maintenance](dependency-maintenance.md) before changing React or native packages.

## Shared Counter

The single pure model is `packages/core/src/counter-model.ts`, exported as `@arc-track/core/counter`. Web and mobile Counter model files are re-export adapters. Browser localStorage and native AsyncStorage remain separate. The key and version-3 schema are unchanged by Phase C. Legacy histories retain unknown timestamps. See [Phase B behavior and rollback limitations](phase-b-data-integrity.md).

## Validation CI versus releases

`.github/workflows/validate.yml` runs on relevant pull requests and pushes to `main`; it uses read-only permissions and immutable official action commits. A path-detection job selects web, mobile, core and maintenance jobs. Shared-core changes validate both consumers; mobile-only changes avoid the web suite, while the mobile job still exercises the cross-platform scoring screen harness. Dependency/configuration changes select all jobs. Source changes also run maintenance architecture checks; infrastructure changes select web and maintenance, including the isolated ingress security suite. Documentation-only changes do not trigger the workflow.

Actions → Validate Arc Track → Run workflow offers a `full_regression` checkbox to run the full web/mobile suites instead of essential subsets. Hosted execution has not been tested locally. The workflow has no production secrets, migration execution, publishing or deployment steps. It installs the existing workspace lockfile as a whole; changing that build/install coupling belongs to excluded Phase C.5.

**Every production commit/push, deployment, database write, EAS build/update and store publication requires explicit user approval.** In particular, pushing `main` can trigger the existing Vercel Git integration independently of this validation workflow. Local CI files are not a deployment gate or authorization to release.

Vercel publishes only the website. Mobile changes require their own compatible Android testing release; current mobile configuration does not declare an EAS Update runtime/URL. Do not publish an OTA update without runtime/native compatibility proof. Do not install a differently signed test APK over a Play installation or uninstall it to test. Play testing and production promotion are separate actions.

## Database work

Run `npm run check:migrations` for local filenames, duplicate IDs and historical-source checksums. This command never connects to a database. It is not SQL execution, RLS verification, or proof of the currently applied production history. Follow [migration conventions](migration-conventions.md) and preserve existing Garmin/security runbooks. Database fixtures remain optional, disposable-only checks; never aim them at production.
