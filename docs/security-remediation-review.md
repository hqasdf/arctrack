# Security patch review

Local patches: Next.js/eslint-config-next 16.3.6 → 16.3.8; transitive sharp 0.35.4 → 0.35.5; transitive shell-quote 1.10.0 → 1.12.0. No direct sharp/shell-quote dependency, override, Expo upgrade, React Native upgrade or new runtime dependency was added. Lockfile version changes are limited to those packages and their Next/sharp platform companions.

Fresh npm audit: 36 affected packages (1 critical, 24 high, 11 moderate) before; 33 (0 critical, 22 high, 11 moderate) after. Next.js, sharp and shell-quote advisories no longer appear. Counts include propagated parent packages, not distinct vulnerabilities.

## Expo Router remains open

Installed chain remains Expo Router 57.0.23 → query-string 7.1.3 → decode-uri-component 0.2.2. Decoder advisory GHSA-vcc3-ghjq-m6fr is fixed in 0.5.0. SDK 57 Router 57.0.25 still declares query-string ^7.1.3; SDK 58 remains beta per current official changelog/registry tags. Do not force a decoder major-version override or upgrade SDK 58 during this patch.

Source trace: Router `getLinkingConfig` supplies `link/linking.getStateFromPath`, which imports the Expo fork. That fork uses `getStateFromPath-forks.parseQueryParams`, which uses `utils/url.parseUrlUsingCustomBase(...).searchParams` (URLSearchParams), not query-string.parse. Query-string is used for outgoing stringify. The separate bundled React Navigation core `getStateFromPath` still uses query-string.parse; it is the default fallback in native useLinking if no parser is supplied.

The permanent mobile regression tests execute the installed Expo query parser with valid/repeated query parameters and malformed percent input. They demonstrate that parser path, not every native deep-link/fallback path or device engine. No application guard was added: a screen-level guard cannot establish protection before the Router parses input. The dependency advisory remains unresolved and must receive a separate supported remediation or release-risk decision. Do not call it patched or fully mitigated.

Other remaining findings: braces (lint glob tooling), node-forge (Expo CLI certificate/signature tooling), and uuid (Xcode/config tooling). No ordinary Arc Track app-runtime use was established. Their dangerous inputs and compatible upstream remediation still require tracking; do not follow npm's unrelated downgrade suggestions or use audit fix --force.

No production SQL/configuration, existing URL, auth flow, scoring logic or SecureStore behavior was changed. Account-deletion approval requirements are documented separately in account-deletion-review.md.
