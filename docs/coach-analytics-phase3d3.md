# Phase 3D-3: calculation optimization

Only the shared Coach calculation module changes at runtime. UI, readers,
authorization, migrations, scoring helpers and grouping helpers are unchanged.

## Confirmed work removed

Athlete sessionTrend previously filtered the entire Round record list for every
Session. It now builds a Session-ID map once, accumulating Arrows in their
original encounter order. Team calculations now accumulate per-athlete,
Session-type, chart-bucket, distance and score-distribution totals while walking
the filtered Rounds/Arrows once. Per-input-entry totals serve recent and review
cards without rescanning their scoring arrays. One stable date sort serves both
lists. Latest Session selection preserves the first input on equal dates.

There is no global cache. Maps live only for one calculation. Public output
fields and original Session/Round references are retained. Legacy duplicate IDs,
duplicate references and duplicate roster entries retain their prior model
semantics; the Phase 3D-1 reader still rejects duplicated persisted histories.
Recorded Session Arrow volume remains separate from scored Arrow counts.

All sums retain point-wise Arrow order. Percentages, means, null handling,
completed-End variance, RMS spread and maximum group diameter are unchanged.
The date policy, review eligibility and mixed-format rules are not modified.

## Exact parity

The original module is frozen under tests/fixtures and guarded by its canonical
source SHA-256 FC45A2E9C38DE7010F1E541DC54D3A890F606BF01A193142005A634109691C7E.
The parity suite compares whole outputs with deepStrictEqual, without floating
point tolerances. It covers 80 seeded filter cases, six large-history cases,
empty histories, custom/partial Rounds, X/misses, plots and Triple-face indices,
future/former-owner exclusions, equal dates, duplicates and input immutability.
A deterministic ID-access test guards against reintroducing per-Session scans.

## Synthetic benchmark

Run `node --expose-gc --experimental-strip-types scripts/benchmark-coach-analytics.mjs`.
The pre-edit current module was also measured before changing runtime code.
The final paired run uses the frozen original and optimized module in the same
Node 24.19.0 process: two warmups, seven timed calls each, alternating execution
order. Explicit GC occurs outside timing. Fixtures use one athlete or 32
athletes, mixed dates and Round formats, one/two Rounds, partial/unscored
Rounds and about one-third plotted Arrows. They contain no real account data.

| View | Sessions | Arrows | Before ms | After ms | Speedup |
|---|---:|---:|---:|---:|---:|
| Athlete | 500 | 19,251 | 20.625 | 9.639 | 2.14x |
| Team (32) | 500 | 19,251 | 9.922 | 1.908 | 5.20x |
| Athlete | 2,000 | 77,040 | 120.628 | 34.829 | 3.46x |
| Team (32) | 2,000 | 77,040 | 39.174 | 6.353 | 6.17x |
| Athlete | 5,000 | 192,635 | 625.258 | 57.944 | 10.79x |
| Team (32) | 5,000 | 192,635 | 153.702 | 23.656 | 6.50x |

Serialized fixture DTOs are about 2.30/9.27/23.25 MB. Those are uncompressed
synthetic model inputs, not measured HTTP payloads. Exact raw samples, byte
counts and memory deltas are in .verification/phase3d3-before.json and
.verification/phase3d3-after.json (ignored local verification artifacts).

At 5,000 Sessions, additional heap retained by the result after forced GC was
1,338.4 -> 1,322.7 KiB for Athlete and 735.8 -> 722.8 KiB for Team. Already-loaded
fixture memory is excluded. Immediate post-call heap growth was mixed; the
2,000-Session Athlete case grew 11,589.8 -> 33,904.1 KiB before GC. These deltas
depend on collection timing and do not establish peak memory or an across-the-
board memory reduction. No device, browser, database or network speedup is
claimed. Benchmarks are evidence, not timing-based CI assertions.

## Preservation

Phase 3A, 3W, 3D-1 and 3D-2 remain in place. No migration or production action
belongs to this change. The staged Garmin release is not rebuilt or modified.
