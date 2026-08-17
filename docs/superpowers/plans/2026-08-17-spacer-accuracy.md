# Spacer accuracy, and the claims that rest on it

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Make the windowed spacer reflect what rows actually measure, and make every published claim about it true.

**Context:** An audit of the eviction project found the spacer never consults a retained height, a published exactness claim the code cannot honour, and the test that appeared to prove otherwise feeding the planner a number production never computes.

---

## The defect

`packages/renderer-dom/src/row-layout-controller.ts` (~line 716):

```ts
const leadingHeight = Math.max(0, (spacers?.leadingRows ?? 0) * defaultRowHeight);
const trailingHeight = Math.max(0, (spacers?.trailingRows ?? 0) * defaultRowHeight);
```

The comment states it plainly — *"Row counts, not pixel heights."* Three consequences:

1. **The retained-measurement cache is never read for spacer geometry.** It is keyed by row identity (`row-height-index.ts:1146` `retainMeasurement`); `getWindowSpacers` (`renderer-dom/src/types.ts:386`) supplies only `leadingRows`/`trailingRows` counts. The two systems cannot meet.
2. **`estimate()` floors at `defaultRowHeight`**, so every evicted row is understated whenever rows wrap. A 10,000-row grid averaging 96px against a 48px default publishes an extent about **half** the truth, and it moves every time the window moves. This is the wrapped-text case — the feature's entire differentiator.
3. **Spec §4's cost model is inverted.** It claims evicting *measured* rows is free and only unmeasured rows cost an anchor correction. In practice every eviction costs one.

### The published claim is false

`apps/website/content/docs/server-data/eviction.mdx`:

> *"sized from the population rather than from what is loaded. Where the retained heights are exact the spacer reproduces the region's height precisely, so the scroll extent is the same number after the eviction as before it and nothing shifts at all."*

It reproduces the region's height precisely only when every evicted row measured exactly `defaultRowHeight`.

### And the test cannot see it

`packages/layout-core/src/__tests__/eviction-anchor.test.ts:99-105` calls `planViewport({ leadingHeight: sumHeights(0, EVICT_BEFORE) })` — the exact sum of the evicted rows' measured heights. `planViewport` is pure and uses what it is handed. **The controller never computes that number.** The assertion is real; the quantity is not the one the product produces. Same shape as the row-height-error proxy this repo already fixed.

---

### Task 1: A test that drives the real spacer

**Do this before changing any production code.**

The existing anchor test exercises `planViewport` directly, so it can never see this bug. Add coverage in `packages/renderer-dom` that drives `createRowLayoutController` with `getWindowSpacers` returning nonzero `leadingRows`, **varied row heights that are not the default**, and measurements retained for the evicted rows.

Assert the published `totalHeight` against the truth — the sum of what those rows actually measured.

- [ ] **Step 1: Write it and watch it fail.** Expected: the extent is short by `(measured − default) × leadingRows`. Report the actual numbers, not just red/green.
- [ ] **Step 2: If it passes, STOP and report.** The diagnosis is wrong and the rest of this plan is void.

Fixture requirements, because this repo has shipped four vacuous tests in a week:
- Heights must **differ from `defaultRowHeight`**, or the bug is invisible by construction.
- Heights must **vary between rows** (`30 + ((i * 7) % 23)` is the established idiom), or arithmetic errors land on multiples of the row height and look right.
- The spacer must be **nonzero**, or every conversion is an identity.

### Task 2: Decide how the spacer learns heights

**This is the plan's one real design decision. Resolve it before implementing.**

**Option A — calibrated mean (recommended).** Give `RowHeightIndex` a running sum and count of retained measurements, exposed as a mean. The controller multiplies the spacer's row count by that instead of `defaultRowHeight`, falling back to `defaultRowHeight` when nothing has been measured.

- No consumer API change; no new information required from anyone.
- Turns a systematic understatement into an unbiased estimate: a 96px-average grid gets a ~96px-per-row spacer instead of 48.
- Still an **estimate**. Rows are not uniform, so the extent will not be exact — and anchoring is what absorbs the residual, which is precisely what `eviction-anchor.test.ts` was written to prove and would now be proving about a real quantity.
- The index already tracks `measurementCacheCount` (`row-height-index.ts:134`), so the shape exists.

**Option B — exact per-region.** `getWindowSpacers` carries heights, or row keys, rather than counts. Exact when the consumer knows what it evicted — but it is a public API change, it pushes bookkeeping onto every consumer, and a consumer that windows without having ever rendered a row has no heights to give.

**Option C — neither; correct the claim only.** Cheapest, and leaves the differentiator understated by 2× on wrapped grids.

**Recommendation: A, and C regardless** — A does not make the spacer exact, so the exactness claim has to go either way.

- [ ] Decide, and record the reasoning in the commit message.

### Task 3: Implement

- [ ] Implement the chosen option.
- [ ] **Mutate:** revert the calibration and confirm Task 1's test reddens with the specific pixel gap. Report both directions verbatim.
- [ ] Confirm a grid with **no** retained measurements is byte-for-byte unchanged — that is the local-mode and cold-start regression guard.

### Task 4: Make the published claims true

- [ ] `eviction.mdx` — replace the exactness claim with what the code does: the spacer is estimated from what rows have actually measured, and the anchor absorbs the residual. Say the extent is an estimate that improves as more rows are measured.
- [ ] `docs/superpowers/specs/2026-08-14-eviction-design.md` §4 — the cost model is inverted; correct it.
- [ ] Check for other places asserting spacer exactness (`grep -rn "precisely\|exact" apps/website/content/docs/server-data/`).

### Task 5: Verify

Baselines must be **measured on `origin/main` first** — numbers in this document may be stale.

```bash
npx vitest run --root packages/renderer-dom
npx vitest run --root packages/layout-core
npx vitest run --root packages/grid-core
pnpm --filter @pretable/react test
pnpm --filter @pretable/app-bench test
./node_modules/.bin/playwright test
pnpm --filter @pretable/app-website test
```

Then `pnpm build && pnpm api && pnpm api:check`, in that order.

Changeset: **minor** for affected public packages (pre-1.0; breaking ships as minor, never major).

---

## What this does NOT fix

Stated so the next reader does not assume otherwise:

- **Memory is still unmeasured.** See the separate plan item below. The spacer is about *geometry*, not about bytes.
- **No evictor ships.** Spec §3 remains absent; consumers do the releasing.
- The spacer remains an **estimate** under Option A. Exactness needs Option B and consumer cooperation.

---

## Next, after the spacer

Ranked. Each is independent.

1. **Measure memory, or stop claiming it.** `resident-cap-memory.spec.ts` runs an *append* script through an adapter that passes no `resultMeta`, so eviction is structurally unreachable; doubling resident rows moved the heap by −0.28 MB. Either instrument the windowed harness — which does evict — and assert that heap falls when the window shrinks, or withdraw the bounded-memory claim until something proves it. **This is the feature's central premise and nothing tests it.**
2. **`PretableCellRangeFor` is missing `datasetRowSpan`** (`react/src/surface-types.ts`). It is the type the docs tell controlled consumers to use, and the value crosses via an `as unknown as` launder. A consumer following the documented recipe who rebuilds range objects loses the span with no type error, and it presents as "eviction doesn't work". Replace the six structural re-declarations with one shared interface.
3. **The Tab branch still has the `-1` sentinel bug** that #453 removed from the page keys (`pretable-surface.tsx:7473`). Latent — needs `tabBehavior="wrap-rows"` — but it is the identical defect.
4. **`verified` reaches no UI.** A public field with no consumer and no documentation; the live-region announcement states an unverified count as fact. Either wire it into the announcement or stop paying for it.
5. **Delete dead weight.** `getScrollTopForIndexedFocus` has zero callers, is exported, and its signature invites the coordinate-space bug the `ScrollRequest` seam exists to prevent. `sameDatasetRowSpan` duplicates `sameSpan` byte-for-byte.
6. **Bench specs are neither typechecked nor linted** — `apps/bench/tsconfig.json` includes only `["src", "vite.config.ts"]`, and lint is `eslint src`. CI now runs those 9 specs; nothing checks them.

**Not on this list, and deliberately:** #452, #457 and #458 are open perf issues filed against the comparative bench. #457 — *S2 sort at 50k rows never settles* — reads as more serious than anything above. They are a different thread and want their own triage.

## Two decisions owed by a human

Carried from the P0 fixes, unchanged:

1. Whether to add a **consumer-supplied population token**, the only thing that closes the equal-insert-and-delete gap a size comparison cannot see.
2. Whether `indexedRangeContainsCell` becomes **tri-state**, so an unconfirmed span paints distinctly rather than as ordinary selection. UI and aria consequences beyond the engine.
