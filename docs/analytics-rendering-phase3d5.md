# Phase 3D-5: Analytics and Coach rendering performance

## Scope and confirmed costs

Audit covered Personal Analytics, Coach Dashboard, Athlete Insights, shared Coach charts, target grouping and Android Analytics. Queries, full-history readers and statistical algorithms are unchanged. This work measures browser rendering separately from Phase 3D-3 calculation timings; it does not measure database or network improvements.

Chart focus/hover updated local detail state but rebuilt the entire SVG/bar tree and repeated axis/path transformations. At 5,000 synthetic Sessions, Coach line focus rendering took 9.6 ms and Personal trend focus rendering 6.8 ms. Unchanged target grouping props still rerendered thousands of circles on parent updates.

The history passed to grouping and training/competition calculations is required for complete outputs. No records are removed, no summary reader substitutes for complete data, and no grouping algorithm or chart density is changed. Initial mount still grows with complete history.

## Changes

- analytics-workspace.tsx: memoized TrendChart and VolumeChart boundaries; cache SVG/volume-list elements and axis/path transformations by actual data and interval. Local focus/hover still updates the same accessible detail element.
- analytics-target-grouping.tsx: memo boundary around existing complete target plot. A layout change or new groups array still renders normally.
- coach-charts.tsx: memoized chart boundaries and data-dependent plot trees. Coach reveal effects, full series, keyboard targets, links, axes and secondary labels are preserved.
- tests/analytics-render-performance.test.mjs and tests/helpers/analytics-render-runtime.mjs: deterministic hook-lifecycle/element-identity tests, axis call counts, invalidation, empty transitions and full coordinate mapping. These are not a substitute for actual browser tests.
- scripts/benchmark-analytics-render-build.mjs: existing Next bundled webpack and TypeScript build a local production React profiling harness; no new dependencies.
- scripts/benchmark-analytics-render.mjs: repeatable Chrome profiling.
- scripts/verify-analytics-render-browser.mjs: actual DOM and interaction acceptance.

All caches are instance-local and depend on immutable current props. No global data cache, permission cache, subscriptions, requests, timers or effects were added. Existing callers create new derived arrays when inputs change. React memo does not avoid parent work when callers pass new array identities; no dashboard-wide speedup is claimed.

## Method

Chrome/156.0.8078.74, headless, 1280 x 900. Production React profiling renderer, actual chart components and existing module CSS, deterministic synthetic histories from the Phase 3D-3 fixture generator. Fixture preparation is outside measured rendering. One warmup then three measured mounts per case; six keyboard-focus updates per mount. Median React durations come from Profiler; wall-clock mount/focus measurements settle through two animation frames and include scheduling/layout. Before and after use the same dataset and procedure. Parent updates reuse identical props. Timing zero means below timer resolution, not zero work.

This is a local component harness, not authenticated production, React Native, or physical-device testing. Next Link is represented by an anchor. Profiling runs omit the application shell/font/theme setup; separate responsive acceptance uses the source globals/theme styles and authenticated-theme marker. Before/after runs are sequential rather than interleaved, so cold-mount differences include normal runtime/GC variability. No timing threshold is used in CI.

## Results

| Sessions | Component | React focus ms before -> after | Parent React ms before -> after | Mount wall ms before -> after | DOM elements unchanged |
| --- | --- | --- | --- | --- | --- |
| 100 | line | 0.5 -> <0.1 | 0.5 -> <0.1 | 13.7 -> 13.8 | 475 |
| 100 | bar | 0.4 -> <0.1 | 0.3 -> <0.1 | 13.7 -> 13.5 | 463 |
| 100 | trend | 0.3 -> <0.1 | 0.4 -> <0.1 | 13.7 -> 13.9 | 244 |
| 100 | volume | 0.8 -> <0.1 | 0.8 -> <0.1 | 13.7 -> 14.1 | 815 |
| 100 | grouping | n/a -> n/a | 0.2 -> <0.1 | 13.7 -> 13.8 | 414 |
| 500 | line | 1.5 -> <0.1 | 1.4 -> <0.1 | 17.2 -> 16.8 | 2295 |
| 500 | bar | 1.2 -> <0.1 | 0.9 -> <0.1 | 33.7 -> 24.1 | 2283 |
| 500 | trend | 1.0 -> <0.1 | 1.5 -> <0.1 | 13.9 -> 13.6 | 1154 |
| 500 | volume | 2.7 -> <0.1 | 2.0 -> <0.1 | 28.2 -> 29.7 | 3615 |
| 500 | grouping | n/a -> n/a | 0.4 -> <0.1 | 14.7 -> 13.7 | 1914 |
| 2000 | line | 3.6 -> <0.1 | 5.1 -> <0.1 | 62.4 -> 61.9 | 9115 |
| 2000 | bar | 2.8 -> <0.1 | 2.8 -> <0.1 | 101.3 -> 113.4 | 9103 |
| 2000 | trend | 2.8 -> <0.1 | 2.0 -> <0.1 | 19.0 -> 19.6 | 4564 |
| 2000 | volume | 2.4 -> <0.1 | 2.3 -> <0.1 | 28.0 -> 37.1 | 3618 |
| 2000 | grouping | n/a -> n/a | 2.4 -> <0.1 | 62.0 -> 62.8 | 7596 |
| 5000 | line | 9.6 -> <0.1 | 11.0 -> <0.1 | 131.5 -> 134.2 | 22762 |
| 5000 | bar | 7.2 -> <0.1 | 8.7 -> <0.1 | 228.2 -> 265.7 | 22747 |
| 5000 | trend | 6.8 -> <0.1 | 6.5 -> <0.1 | 56.2 -> 49.7 | 11389 |
| 5000 | volume | 2.5 -> <0.1 | 1.9 -> <0.1 | 26.4 -> 30.6 | 3618 |
| 5000 | grouping | n/a -> n/a | 5.6 -> <0.1 | 159.9 -> 107.5 | 18978 |

The 5,000-Session fixture contains 6,000 Rounds and 192,635 scored Arrow records. Charts use every applicable point: no downsampling, capping, pagination or coordinate approximation. Node counts and initial DOM are exactly identical in all 20 paired cases. At 5,000 Sessions, initial Coach line mounting remains about 134 ms and Coach bars about 266 ms; this task principally improves repeated interactions, not first-load scalability.

Browser heap was sampled using Runtime.getHeapUsage after each workload, without forced GC or peak-allocation capture. For example, the final grouping workload sampled 52.7 MiB before and 77.6 MiB after. These include surrounding harness/previous workload objects and GC effects. No memory reduction, leak absence or peak-memory bound is established. Memoization retains render elements for the mounted instance.

## Correctness and browser acceptance

All 20 initial DOM snapshots matched byte-for-byte, preserving every coordinate, chart path, label, keyboard target, data list and count. 64 browser assertions passed: keyboard detail and blur, stable chart DOM, immutable data refresh, empty-data transitions, grouping layouts, All Time complete Round list and interval interaction. Responsive checks at 320, 390, 768 and 1280 px in both real light/dark palettes showed no document horizontal overflow. Source CSS and visual design are unchanged. The 390 px dark screenshot was visually inspected. No browser runtime errors were observed.

The complete statistical models are unmodified and covered by the full core suite including prior exact-parity/date-policy tests. Raw paired JSON, synthetic HTML snapshots and screenshots live under ignored .verification/phase3d5.

## Validation

Website 809/809; mobile 613/613; core 263/263; maintenance 32/32. Focused new rendering regressions 16/16 (included in website total). TypeScript web/mobile/core passed. Root lint passed. Full-mobile lint retains eight existing errors, separately compared with the Phase 3D-4 output. Architecture and migration consistency are checked without contacting a database. Next.js production build passed.

## Remaining dependencies

No migration, deployment or production action belongs to Phase 3D-5. Prior uncommitted phases and staged Garmin work remain separate. Review/release approval, any pending Phase 3D-1 database prerequisite and production/mobile acceptance remain separate work. Complete-history cold mount and memory growth are documented future concerns; this task does not introduce history limits or start deferred pagination phases.

### Additional browser evidence

At 5,000 Sessions, the Coach and Personal line charts each retained all 5,684
keyboard-inspectable points. Volume retained all 450 calendar buckets in this
fixture; grouping retained 18,966 circles including target rings. These counts
are identical before/after. The fixture spans 450 repeating calendar dates;
volume bucket counts are a consequence of genuine date aggregation, not a cap.

Coach-line focus-to-two-animation-frame completion at 100, 500, 2,000 and 5,000
Sessions was 13.9 -> 13.9, 13.9 -> 13.9, 13.9 -> 13.9 and 27.8 -> 13.8 ms.
The frame floor masks smaller CPU improvements and these measurements are not
input-latency guarantees for real devices.

A final regression also verifies all-null Coach series do not compute an axis,
while a genuine zero-valued point remains visible. Final browser acceptance
exercised this branch and passed 64 assertions.
