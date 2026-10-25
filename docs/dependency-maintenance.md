# Phase C dependency findings — 25 October 2026

## Minimal local corrections

Next.js and eslint-config-next stay exactly 16.4.1. React, React DOM, Expo, React Native, native modules and mobile signing/build settings are unchanged.

The root now explicitly declares the already-installed `eslint-plugin-react-hooks@7.1.1` and `typescript-eslint@8.70.0` used by `eslint.mobile.config.mjs`, rather than relying on incidental hoisting from Next's ESLint preset. `yaml@2.9.1`, already present in the lockfile, is directly declared for workflow validation.

A version-scoped npm override patches the development lint consumer's Zod 4.6.5 to 4.6.6 for [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). React Hooks ESLint and its error helper support that major and consume `zod/v4`. A focused test verifies oversized constrained invalid arrays produce bounded errors and ordinary input/error formatting still works. This is a fix for that copy, **not complete remediation of every Zod installation**.

## Advisories retained

The fresh post-change lockfile audit reports 11 affected package entries: 5 high, 6 moderate, 0 critical. These entries include inherited parent-package advisories; they are not 11 independent exploits. Root Zod 4 is no longer listed as affected; Expo CLI's separate Zod 3.25.76 remains listed. No clean audit is claimed.

| Underlying advisory | Remaining dependency path | Why not automatically changed |
| --- | --- | --- |
| [Zod memory exhaustion](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | Expo CLI → Zod 3.25.76 | CLI declares Zod 3; forcing Zod 4 crosses its API boundary. |
| [node-forge signature verification](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | Expo CLI → code-signing certificates → node-forge 1.4.0 | No compatible patched package is established by this audit. npm suggests an unacceptable Expo downgrade. |
| [URI decoding denial of service](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) | Expo Router → query-string 7 → decode-uri-component 0.2.2 | npm proposes Expo Router 58. Changing the decoder across its declared pre-1.0 range without router validation is not a safe maintenance shortcut. |
| [UUID buffer bounds](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | Expo config plugins → xcode → uuid 7 | npm's proposed UUID major change is not automatically compatible with the native tooling consumer. |

Root lint tooling is development-only. Expo CLI/config-plugin findings are tooling-related, while the router decoder is potentially a mobile runtime path. This categorization does not prove non-exploitability; no finding is dismissed merely because it is transitive. Do not run blanket `npm audit fix --force` or downgrade Expo 57 to 54 as npm's automated suggestion proposes.

## React/Expo compatibility remains a separate decision

Installed React/React DOM are 19.3.0. React Native 0.86.3 declares a peer range of `^19.2.3`, which semver-accepts 19.3.0, but its Fabric renderer reports 19.2.3 and the Expo 57 dependency matrix expects React 19.2.3. Therefore peer resolution alone does not establish native compatibility. Native runtime behavior was not verified here; a crash is not asserted from metadata alone.

An automatic shared React downgrade would affect the working website, while resolving separate React versions through Metro/workspace configuration overlaps excluded Phase C.5. Neither is implemented in this pass. Review React/renderer alignment and current SDK-57 patch recommendations together before the next Android binary. Do not upgrade Expo SecureStore casually: the existing native durability patch intentionally requires its reviewed exact version and checksum.

The maintenance workflow retains the existing workspace-wide installation. Its validation jobs do not split web/mobile builds, alter runtime resolution, publish a mobile binary, or demonstrate Android device compatibility.
