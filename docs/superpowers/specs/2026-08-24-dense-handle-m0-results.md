# M0 pricing probe — results

Date: 2026-08-24. Probe: `m0-probe.mjs` (session scratchpad, throwaway).

Machine load at run: `load averages: 37.32 23.69 22.12` (run 1) and `22.49 21.92 21.57` (run 2) on a 10-core Mac — well above the ≥8 caution threshold both times; parallel sessions were saturating the machine. Fitness: **NOT all spreads ≤ 20%** in either run. Run 1 (reported below) had four sections over: A3 195%, A5 25%, B 79%, C2 539%. The mandated rerun (run 2, second column) was noisier still (A1 78%, A3 102%, A5 88%, B 91%, C 27%, C2 484%), so the noise is reported rather than hidden. All oracles printed `oracles: PASS` before any timing in both runs.

Why the verdict survives the noise: the two runs' medians agree to within ~1.4x on every section, the *worst observed maximum* of every relevant section is still 3–10x inside its go-threshold, and the noisy sections are the sub-millisecond ones where scheduler jitter dominates a tiny denominator. The noise widens the error bars; it cannot move any number across a decision boundary.

## Isolation numbers (median of 5, 2 warmups)

| section | run 1 median (spread) | run 2 median (spread) |
|---|---|---|
| A1 numeric columnar scan → bitset | 0.263ms (4%) | 0.266ms (78%) |
| A2 string columnar scan `.includes` → bitset | 0.693ms (1%) | 0.701ms (1%) |
| A3 xor + enumerate flips | 0.131ms (195%) | 0.129ms (102%) |
| A4 50k records-by-slot vecGet | 0.100ms (12%) | 0.105ms (5%) |
| A5 50k string-keyed Map.get (baseline) | 1.218ms (25%) | 1.615ms (88%) |
| B composed filter-commit equivalent | 3.764ms (79%) | 5.227ms (91%) |
| C streaming: per-commit chunk-COW (100 writes) | 33.1µs (10%) | 42.1µs (27%) |
| C2 1000 whole-bitset clones | 1.005ms (539%) | 1.207ms (484%) |

Notes on individual sections:

- A4 vs A5: slot-indexed vecGet (0.10ms) is ~12x cheaper than string-keyed
  `Map.get` (1.2–1.6ms) for the same 50k reads — and the Map baseline is itself
  far cheaper than the HAMT the trace prices at 42.5ms. Stringiness alone does
  not explain the HAMT cost; the dense-slot representation removes both the
  string hashing and the persistent-tree pointer chasing.
- A3's absolute times are 0.08–0.34ms; the huge spread percentages are jitter
  on a tiny denominator, not instability of the primitive.
- C2: cloning a 6.25KB bitset 1000 times costs ~1ms total (~1µs each) — a
  whole-membership clone per commit is effectively free.

## Read-across

- Replaced work (trace attribution, `filter-final-results.md`):
  persistent-map 42.5 + verdict pass 18.3 + double-lookup 11.9 = **72.7ms**.
- New-structure equivalent, deliberately **overcounted**: A1 + A3 + B =
  **4.2ms** (run 1) / **5.6ms** (run 2). The overcount: section B re-sorts the
  ~12.5k survivors from scratch (2 × `Array.prototype.sort` dominates its
  3.8–5.2ms), whereas the real path takes survivor order proven from the old
  tree walk and only sorts the flip-ins. B alone is therefore an upper bound
  on the model-side commit work, and it also already contains its own scan and
  xor, so A1+A3+B double-counts those too. Even so: ≥13x under the replaced
  72.7ms.
- Streaming regression check: per-commit chunk-COW cost for 100 random writes
  is **33–42µs** against the ≲500µs comfort bound — 12–15x headroom. Adding a
  per-commit whole-bitset clone (~1µs) doesn't change that. The HAMT's
  structural sharing is not being given up for anything close to its cost.
- Caveat: these are Node numbers, not browser numbers. The precedent probe
  (`index-representation-probe.md`) landed within 2ms of the browser result;
  browser certification remains M7's job, not M0's.

## Go/no-go

**GO.**

- New-primitive total (A1 + A3 + B, overcounted): 4.2–5.6ms ≲ 15ms required. ✓
  Even the single worst maximum ever observed for B (8.47ms, under a load of
  22) plus the worst A1/A3 maxima stays under 9.3ms.
- Per-commit streaming COW: 33–42µs ≲ 500µs required. ✓ Worst rep implies
  ~44µs.
- Against the 72.7ms of replaced work, the new primitives price at roughly
  6–8% of the cost they displace, leaving the spec's ~55–75ms filter-commit
  window dominated by the parts M0 did not model (tree build / render), which
  is exactly where the budget was expected to live.

No primitive priced out. Proceed to M1.
