# Incremental row-model hard gate

Date: 2026-08-11

Evidence tree base commit: `226fbaa54768b8a636ab86e1f0ca498880080e76`

Optimization commits: `eb321b8c`, `1396cc3c`, `bbaa09f5`, `226fbaa5`

Harness readiness correction: `0f04ad4f`

Result: **PASS**

## Environment and method

- Machine: Apple M1 Max, 32 GiB, arm64, Darwin 25.5.0.
- Browser: headless Chromium 151.0.7922.34, 1440×900, device scale factor 1.
- Scenario: S5, seed 505, default profile, 1,000 patches/second in 50-patch ticks.
- Commands:
  - `pnpm --filter @pretable/app-bench build`
  - `pnpm bench:row-model:gate -- --project=chromium` (two consecutive unchanged passes)
  - `pnpm --filter @pretable-internal/row-model exec vitest run src/__tests__/retention.test.ts && node --test scripts/__tests__/bench-row-model-memory.test.mjs`
  - `node --expose-gc scripts/bench-row-model-memory.mjs`

The four-run gate retained the original row counts, grouping, update schedule,
aggregation, expansion, catch-up behavior, and thresholds. The grouped rebuild
uses unpublished transient maps/trees, cooperatively seals built-in aggregate
measures once per node, and falls back to the original persistent path for any
custom aggregator. Production updates retain the persistent delta path.

Both production scripts reserve an isolated localhost port, pass it to Vite's
strict preview launch, and verify that the spawned preview remains alive after
HTTP readiness. A regression proves that a responsive foreign endpoint cannot
mask an immediately exiting preview child.

The focused 10,000-row grouped candidate counter gate recorded 10,000 row
evaluations/transition rows, 234 HAMT node copies, zero ordered-index node
copies, 2,446 group node copies, and 40,000 aggregate merges. The pre-bulk
100,000-row local-max replay recorded 2,488,201 HAMT copies, 5,099,112 order
copies, 1,545,392 group copies, and 6,798,816 aggregate merges.

## Final repeated Chromium artifact set

| Scale     | Script          |    Rows | Commit p95 | Frame p95 | Slice max | Long tasks | Drift |     Rebuild | Catch-up commits / probes |
| --------- | --------------- | ------: | ---------: | --------: | --------: | ---------: | ----: | ----------: | ------------------------: |
| target    | updates         |  20,000 |    2.70 ms |   9.80 ms |      0 ms |          0 |     0 |           — |                         — |
| target    | updates-grouped |  20,000 |    4.00 ms |  10.00 ms |   3.20 ms |          0 |     0 | 1,898.00 ms |                  38 / 226 |
| local-max | updates         | 100,000 |    3.10 ms |   9.80 ms |      0 ms |          0 |     0 |           — |                         — |
| local-max | updates-grouped | 100,000 |    2.30 ms |   9.80 ms |   7.20 ms |          0 |     0 | 8,318.50 ms |                  50 / 998 |

Every run accepted all 3,000 patches and matched its deterministic final
checksum. Both grouped runs completed atomically, preserved 20,000/100,000
source rows, and produced the expected 105 groups. The immediately preceding
unchanged four-run invocation also passed; its local-max grouped slice maximum
was 7.00 ms, its rebuild completed in 7,786.50 ms across 933 probes, and it had
zero long tasks and zero drift. The extra callbacks are the measured throughput
cost of reserving host/GC margin with the final 0.25 ms internal quantum.

Final summary artifacts:

- `status/chromium-pretable-default-s5-target-updates-2026-08-11t20-44-21-820z.summary.json`
- `status/chromium-pretable-default-s5-target-updates-grouped-2026-08-11t20-44-27-805z.summary.json`
- `status/chromium-pretable-default-s5-local-max-updates-2026-08-11t20-44-34-435z.summary.json`
- `status/chromium-pretable-default-s5-local-max-updates-grouped-2026-08-11t20-44-45-690z.summary.json`

Immediately preceding pass artifacts ended in `20-42-52-679z`,
`20-42-58-712z`, `20-43-05-471z`, and `20-43-16-927z`, respectively.

The ignored Playwright trace ZIPs remain local evidence and are not committed.

## Retention and production CDP heap proof

The production grouped local-max page warmed through 2,000 revisions. Chromium
then forced garbage collection and recorded a baseline plus five further
2,000-revision windows. Each window started and cancelled a real query
candidate, started and cancelled a real distinct-value build, replaced the
same logical row through real transactions, and churned distinct dictionaries
past their configured cache bound.

Heap samples (bytes) at revisions 0, 2k, 4k, 6k, 8k, and 10k were:
`488835588`, `507859112`, `489402488`, `489648148`, `489681056`, and
`489941004`. Final growth was 1,105,416 bytes (limit 16 MiB). Least-squares
slope was -696.59 bytes/revision (upper limit 256 bytes/revision).

Final ownership counters were one live revision root, zero explicit snapshots,
zero transition candidate/delta roots, a 32-entry consumer journal, four cached
dictionary roots, zero distinct projections, and zero scheduled callbacks.
The machine-readable local report is `status/runsets/row-model-memory.json`;
the committed milestone below contains its release evidence without raw heap or
trace dumps.

## Diagnosis history

The initial grouped local-max rebuild produced a 324.9 ms slice and major-GC
long task. Deterministic replay attributed the allocation pressure to millions
of persistent HAMT/order/group copies and 6.8 million aggregate merges. Skipping
display-only grouped contributions fixed steady commits. Candidate-only
transients removed persistent per-row path copying, and deferred built-in
measure sealing reduced aggregate combines from O(N log N) to O(N). Repeated
1 ms and 0.5 ms runs still exceeded the unchanged 8 ms slice ceiling (10.4 ms
and 8.9/8.6 ms observed). A focused 0.25 ms internal quantum produced two
consecutive passes while retaining bounded completion and catch-up throughput.
Custom aggregates deliberately retain their original path and exact failure
timing.
