# Dense flat cooperative candidate — results (issue #490) — 2026-08-29

Implementation at `ef20370b` (Tasks 1–3 + reviews). Design:
`2026-08-29-dense-flat-cooperative-candidate-design.md`.

## Regime disclosure, up front

Every browser round today ran on a loaded machine (1-min load 8–32 on 10
cores; parallel sessions, not killable). TanStack same-run controls sat
~1.5–1.8× above their historical 48–58 ms band in every absolute round, so
**no absolute number below is a fit-regime measurement**. The
load-tolerant instruments — the interleaved paired A/B and the traced
shares — carry the verdicts; the absolute tables are corroboration.

## The money table: interleaved paired A/B at 50k (same load window, alternating sides, medians of 3)

Baseline = throwaway worktree at `origin/main` (1e3b9305), fresh install +
bench build; sides alternated main→branch per pair; port checked; zero
long tasks on both sides in every run.

| Metric (pretable, S2 target)           | main                      | branch                        | Δ        |
| -------------------------------------- | ------------------------- | ----------------------------- | -------- |
| filter-metadata total (latency+settle) | 225.0 (225.0/225.0/250.0) | **142.6** (139.9/142.6/143.5) | **−37%** |
| keystroke cold total                   | 265.1                     | 157.4                         | −41%     |
| keystroke warm p50                     | 167.7                     | **76.4** (73.4/76.4/76.5)     | **−54%** |

Both sides identically load-inflated; the paired delta is the trustworthy
number. Branch-side spreads are tight (±2 ms) despite the load.

## Traced shares (settle window, sourcemap-resolved; shares only — traced absolutes skew)

| Term                                            | pre-arc (194 ms window) | post (127 ms window)                                                |
| ----------------------------------------------- | ----------------------- | ------------------------------------------------------------------- |
| persistent-map (HAMT) writes — candidate        | ~22%                    | **gone** (write path absent from the profile)                       |
| candidate machinery (per-row get/alloc/AVL)     | ~18%                    | **gone**; slice-runner scheduling loop now ~15%                     |
| compiled-query `evaluate`                       | ~13%                    | **gone**; replaced by `filterVerdict` ~1% + sort-key carry fill ~8% |
| remaining HAMT (snapshot `rows.get` reads etc.) | (within above)          | ~10%                                                                |
| GC + program                                    | ~8%                     | ~6%                                                                 |

The three shares the design targeted are eliminated; what remains in the
engine is the slice-runner loop (~15%), snapshot-read HAMT gets (~10%),
and the per-survivor sort-key carry fill (`compiled-query.js:844`, ~8%) —
the M2/future lever list.

## Absolute rounds (loaded; corroboration only)

- 50k, two rounds ~1 h apart, remarkably consistent: filter-metadata
  totals 133–158 (round 1) and 140.4–142.8 (round 2); filter-text the
  same band; keystroke cold 157–176, warm p50 82–83; **zero long tasks
  and zero blank frames in every pretable summary**; sort 50–58
  (unregressed); TanStack filter controls 83–92 (band 48–58 — the regime
  marker).
- 3k: all pretable scripts within load-noise of their sync-path history
  (filter ~49–67 vs ~33 fit-history, with tanstack controls equally
  inflated 58–83 vs ~25) — the sync paths are untouched by this diff and
  the inflation tracks the controls. Keystroke 3k blank-gap read 2 (sum
  across 5 commits) in one loaded round and 0 historically; sync path
  untouched — treated as starvation noise, to re-check in the fit round.
- Grouped controls (group / group-expand at 3k): completed, in line with
  their history — the untouched-lane check.
- `replace` at target: fails a spec assertion (`rows newly rendered: 5`,
  expected 0) — **reproduced on clean main**, deterministic, never
  CI-exercised at target scale. Pre-existing; filed as #516 and excluded
  from this certification. Dev-scale replace (the CI lane) is green.

## Bar verdicts

- **Zero long tasks at 50k: MET** (every pretable summary, both scales,
  all scripts, both rounds + all paired runs).
- **Keystroke warm p50 ≤ 130 ms: MET with room** — 76.4 paired / 82.5
  absolute, both under load; the fit number is lower.
- **No regression** (3k / cooperative sort / grouped / replace-append):
  MET within the regime's resolution — sort and grouped in-band, 3k
  tracks the controls, replace's failure is pre-existing on main (#516).
- **Primary ≤ 120 ms on 50k filter: UNDECIDED — fallback (≤ 150) MET.**
  Loaded measurement is 142.6 paired / 141.6 absolute (±1). Two
  incompatible load-scalings bracket the fit value (~83 by control ratio,
  ~130 by main-side history ratio), so the honest statement is 120–145
  likely, ≤ 150 certain. Per the agreed bars this SHIPS with the miss
  documented.
- **M2 decision: DEFERRED to one fit-regime round** (1-min load < 5,
  controls in the 48–58 band): if 50k filter-metadata reads ≤ 120,
  M2 is skipped and the arc closes; if > 120, M2 (chunked sweep +
  terminal bulk build) gets its pre-scoped amendment. The remaining
  engine levers the trace names for M2: slice-runner loop ~15%, sort-key
  carry fill ~8%, snapshot HAMT gets ~10%.

## Work-counter certification (load-independent)

- Flat set-query transition (10k): `hamtNodesCopied === 0`,
  `rowsEvaluated === 0`, `transitionRows === 10 000` — mutation-proven
  (reverting the carry reads 27 946–55 742 copies).
- Flat set-derivations: `hamtNodesCopied < 100` (was 55 742).
- 682 row-model tests green including the equivalence-oracle matrix,
  identity pins, upgrade/replay pins, membership word-boundary pin; react
  1548 green; root build/api/lint clean, zero public report drift.

## Fitness statement

Paired interleaved design + zero-long-task invariance + load-independent
work counters carry the conclusion; absolute bars that need a fit regime
are explicitly deferred, not claimed. No lever measured flat; nothing to
revert.
