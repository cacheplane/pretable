# Next perf cycle — brainstorm and lever triage (post-#490 arc) — 2026-08-29

Scheduled nightly cycle. Two objectives were set: (1) a controls-in-band
confirmation round for the #490 arc's estimate-met bar, and (2) a
brainstorm/spec for the next cycle. **Objective 1 was not run** — the
regime preconditions failed and were still failing at the end of the
window. Objective 2 was done as a load-independent static analysis, and
its central finding is that the lever list inherited from the arc is
**stale attribution** that must be re-traced before anything is built.

Worktree: `blove/perf-cycle-2026-08-29` off `origin/main` @ `bac186da`
(#529). No engine code changed in this document's commit.

## Objective 1 — ABORTED, with the regime evidence

Preconditions from the cycle definition: `lsof -i :4173` empty and 1-min
load < 5. Both failed at fire time and never recovered:

| Check        | At fire (22:00)                                       | At end of window (22:02) |
| ------------ | ----------------------------------------------------- | ------------------------ |
| 1-min load   | **6.37** (5/15-min: 9.55 / 8.46)                      | **6.25** (8.70 / 8.25)   |
| Swap         | **8775M used of 9216M**, 440M free                    | unchanged                |
| Port 4173    | held by another `Claude` PID 24077 (3 CLOSED sockets) | —                        |
| Top consumer | `Virtualization.VirtualMachine.xpc` at **258% CPU**   | still running            |

A VM pinning ~2.6 cores, a parallel Codex session, a running eslint, and
exhausted swap on a 10-core Mac. Per the standing rule the port holder was
**not** killed. No bench was run, no trace was captured, and **no bar is
claimed**.

**The #490 arc's verdict is therefore unchanged and still estimate-met:**
50k filter-metadata ~124.1 loaded → **~116 fit-estimate against the ≤120
primary bar**, keystroke warm p50 51.2 loaded against the ≤130 bar. The
confirmation round is still owed. No addendum was written to
`2026-08-29-dense-flat-cooperative-candidate-results.md`, because writing
one without the measurement is exactly the thing the cycle forbids.

**Carry-forward:** the confirmation round is the first item of the next
cycle that fires on a quiet machine. It is cheap (~15 min) and it is the
only thing standing between "estimate-met" and "met".

## Objective 2 — lever triage

### The headline finding: the inherited lever list is pre-M2 attribution

The three levers on record — snapshot HAMT reads ~10%, sort-key carry fill
~8%, residual runner overhead ~15% — come from the **post-M1 trace of a
127 ms settle window**. Since that trace, two things landed that changed
the profile's shape:

- **#518** amortized the shared slice clock to a 32-unit stride (main's own
  50k filter went ~141.6 → ~133 in the same regime), and
- **M2** (`17385023`/`28fa68f5`/`04fe0a2a`) re-denominated the identity
  lane's build unit from one row to one slot-vector chunk — cutting the
  50k sweep from ~196 scheduler hops to ~50.

Both edits attack the _runner overhead_ term specifically. The window is
now ~124 ms, and the shares inside it have not been re-measured. **Any
percentage quoted from the arc doc is a percentage of a different
window.** Re-tracing is a gate, not a formality.

### Static confirmation that one inherited share is mis-attributed

Reading the flat snapshot's read path (`visible-index.ts`), every
`root.rows.get(...)` on a flat root is **viewport-sized, not row-count
sized**:

- `visible-index.ts:220` (`publicRowAt`) — one get per requested row.
- `visible-index.ts:236` (`range`) — one get per row in `[start, end)`.
- `visible-index.ts:267` (`ɵslotOfRowId`) — one get per call.

A 50k filter settle asks for a viewport (tens of rows) per commit, not
50 000. Sweeping every `.rows.get(` site in `packages/` (24 hits, none in
tests) finds no per-row HAMT read on the identity lane's build path at
all: `sweepChunk` → `carryRecord` touches `filterVerdict`,
`fillSortKeysFromPrevious`, a transient tree insert and a membership bit —
no store get. The two candidate-lane gets
(`flat-cooperative-candidate.ts:350`, `:438`) are on the **replay** and
**evaluate-lane** paths, neither of which the warm identity lane runs.

So "snapshot `rows.get` ~10%" is unlikely to survive re-tracing as a
snapshot-read cost. The re-trace's first job is to find out what that
10% actually is now. **Do not build a dense read path against it.**

For the record, if a dense read path _is_ ever wanted, the substrate is
already there and already invariant-pinned: `root.recordsBySlot` is a
per-revision `SlotVector<RowRecord>` on every `RevisionRoot`, and
`__tests__/records-by-slot.test.ts` pins
`slotVectorGet(recordsBySlot, record.slot) === record` (identity) for
every record in `rows`. Turning a `rows.get(rowId)` into a
`slotVectorGet(recordsBySlot, slot)` is two array indexes against a trie
descent. It is a _cheap_ change whenever a site is shown to be hot. No
site has been shown to be hot.

### Lever A (the one concrete, real candidate): the double WeakMap get per survivor

This one is load-independent and readable straight off the source.

On the warm keystroke path the candidate takes the identity lane
(`operation === "set-query"`, captured plan flat) and adoption fires,
because a keystroke is a filter-only change:
`flat-cooperative-candidate.ts:95` →
`adoptEvaluationCache(next, captured)` makes both plans share **one**
evaluation-cache WeakMap.

Then, per surviving row, `carryRecord` does:

1. `filterVerdict(plan, record)` — which internally does
   `#evaluationCache.get(input.row)`, finds the entry, fails the
   `cached.verdictPlan === compiled` guard (the entry was written by the
   _previous_ plan, so this plan must run its own filters — correct and
   deliberate), **discards the entry**, and evaluates the predicate.
2. `fillSortKeysFromPrevious(nextPlan, prevPlan, record)` — two
   `instanceof CompiledQueryPlan` re-validations, then
   `next.#evaluationCache.get(input.row)` **on the same key, into the same
   map**, hits `existing !== undefined` and returns `existing.sortKeys`
   immediately. Under adoption this function carries nothing and evaluates
   nothing; it is a lookup wrapped in revalidation.

That is **two WeakMap gets on the same key plus two `instanceof` checks
plus two call frames, per survivor, per commit** — at 50k survivors and 5
warm commits, 500 000 redundant lookups.

**Proposed shape:** a single fused reader used only when adoption has
fired — the candidate already knows this at line 95 and can hoist it to a
boolean. One `#evaluationCache.get(row)` yields both the entry to check
the verdict guard against _and_ `entry.sortKeys`, with no second lookup
and no re-validation. Semantics are unchanged: the verdict is still
recomputed under the new plan (the `verdictPlan` guard still fails), and
the keys still come from the same entry `fillSortKeysFromPrevious` would
have read.

**Pre-registered prediction (must be falsifiable before it is built):** if
the sort-key carry term is still ~8% of a ~124 ms window (~10 ms) and this
removes roughly one of the two lookups plus the revalidation, the
expected win is **~3–5 ms on 50k filter-metadata and proportionally more
on keystroke warm p50** (which is dominated by survivor count). If a
paired A/B measures flat, the harness is lying or the term has already
moved — per the bench-A/B rule, a flat response across the variable is a
harness signal, not a result.

**Gate:** the re-trace must first show the carry-fill term is still a
material share of the _current_ window. If M2 already absorbed it, this
lever is dead and should be dropped without ceremony.

### Lever B (columnar verdict cache): REJECT — and now on a ceiling argument, not a regime excuse

The cycle asked whether the columnar verdict cache preserved at
`73f1ae24` (`blove/filter-fast-path`) has a case now that warm keystroke
commits run the cooperative identity lane, and required a warm-path budget
analysis to prove the saving _before_ any rebuild. The budget analysis
proves the opposite, and it does not need a fit regime to do it:

- The columnar verdict cache exists to make **filter predicate
  evaluation** cheaper. That is the only term it can touch.
- The post-arc trace puts compiled-query `filterVerdict` at **~1% of the
  settle window**. The pre-arc `evaluate` term it replaced was ~13%; the
  compiled predicate already collapsed it.
- A cache cannot save more than the term it caches. The upper bound on
  this lever is therefore **~1% ≈ 1 ms of a 124 ms window**, before
  paying for a mutable columnar store with commit-side clears — a real
  ongoing maintenance cost on every commit, which is precisely the cost
  the two previous reverts were unwilling to carry.
- This is consistent with, and now explains, the two prior measurements:
  the Amendment J A/B measured **flat** (50k filter-metadata 108.6 vs
  107.3 pooled; filter-text 104.3 vs 108.4 — both inside the ~8.3 ms
  frame-quantization bin, with TanStack controls at **49.7–58.0, in
  band**, so that round was _fit_ and the flat reading is trustworthy).
  It was reverted as "cold-store-invisible" twice; the sharper statement
  is that its target term is now ~1% and there is no version of the warm
  path where it pays for itself.

**Decision: closed, not deferred.** Recommend deleting the preserved
branch's claim on the roadmap rather than carrying it forward a third
time. Reopening requires a trace showing filter-predicate evaluation back
above ~10% of a settle window — which would itself mean something else
regressed.

### Lever C (runner overhead ~15%): re-measure before touching

M2 and #518 both targeted this directly and neither has been traced
since. It is the term most likely to have already moved. No proposal
until the re-trace.

## What the next cycle should do, in order

1. **Confirmation round** (objective 1, unchanged): controls-in-band
   check, then the honest met/missed verdict against ≤120 / ≤130, as an
   addendum to the arc results doc. Cheap, and it closes an open bar.
2. **Re-trace** one `PLAYWRIGHT_PERF_TRACE=1` 50k filter-metadata run,
   `analyze-cdp.mjs --window=settle`, **shares only**. Publish the
   post-M2 share table beside the post-M1 one so the drift is visible.
3. **Then** decide on Lever A against the _current_ shares, with the
   pre-registered prediction above as the falsifier.
4. Lever B needs no further work — it is closed.

Nothing in steps 2–4 should be started before step 1, because a share
table measured on a loaded machine and a bar measured on a quiet one are
the same 15-minute setup cost.

## Honesty ledger for this run

- No bench executed. No trace captured. No absolute or relative
  performance number in this document was measured tonight; every figure
  is cited from a prior run with its own regime disclosed.
- The static findings (call-site sweep, adoption/lookup analysis, the
  `filterVerdict` ceiling argument) are load-independent and stand on the
  source at `bac186da`.
- The one substantive claim that would change the roadmap — that the
  inherited "~10% snapshot HAMT reads" lever is mis-attributed — is
  offered as a _prediction the re-trace can refute_, not as a finding.
