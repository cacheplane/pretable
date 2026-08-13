# Windowed data

Status: proposed · 2026-08-13

Lets pretable hold a **contiguous window** onto a dataset larger than memory,
positioned inside a population it never sees, with the scroll geometry and ARIA
positions staying honest.

This is the addressing layer. It ships **no eviction** — that is the next slice,
and it is what this one exists to make possible.

## Why this is the wedge

AG Grid's docs state that when using dynamic row height with the Server-Side Row
Model, `maxBlocksInCache` must not be set: "purging the cache and dynamic row
heights do not work together." They did not solve that coupling; they banned it.
MUI documents no eviction at all and requires a static `rowCount`.

Variable row heights are pretable's differentiator — wrapped text is the hero
demo's headline correctness claim. So the opportunity is not windowing, which
everyone has. It is being the only grid where **bounded memory and variable row
heights coexist**.

Three of the four primitives that requires already exist, none built for this:

| Primitive | Status |
| --- | --- |
| Retain measured heights for rows no longer present | **built** — tombstones, bounded at 100_000 |
| Geometry for unmaterialized regions | **spike-proven** — 16 lines in `planViewport` |
| Hold the view still while geometry shifts underneath | **built and live** — `captureAnchor`/`restoreAnchor`, used around every cooperative rebuild |
| Selection surviving a row's disappearance | **not built** — the engine prunes vanished ids |

## Scope

**In:** window addressing, spacer geometry, ARIA under a non-zero offset, the
near-edge telemetry signal, and the re-fetch contract.

**Out:** eviction, the selection retainer, remote grouping, and jumping to an
arbitrary unvisited offset. Random access stays reachable later — `window.start`
is exactly the seam it would use.

## Design

### 1. `window` joins `PretableResultMeta`

`packages/grid-core/src/types.ts`:

```ts
export interface PretableResultMeta {
  total?: PretableMatchingTotal;
  datasetKey?: string;
  /** Where the loaded rows sit inside the population, when they are a window
   *  rather than a prefix. */
  window?: {
    /** Dataset index of `rows[0]`. Absent or 0 is the prefix case. */
    readonly start: number;
    /** Whether anything follows this window. NOT how much. */
    readonly hasMore: boolean;
  };
}
```

Both `start` and `hasMore` are facts the consumer already holds from the response
it just received. Neither asks it to compute a derived number — an earlier draft
used a `reachableRowCount` high-water mark, and a field needing a paragraph of
explanation is a field that gets passed wrong.

`hasMore` rather than a count because a keyset cursor walks forward: on first
load you can reach one page, not ten million. The scroll extent must promise
only what is fetchable, or dragging lands somewhere the cursor cannot serve.

**Placement follows for free.** `<Pretable>` already forwards `resultMeta`, so it
gains window addressing with no change to its prop list.

### 2. `windowGap` joins telemetry

`packages/react/src/surface-types.ts`, beside `visibleRowRange`:

```ts
/** The viewport is over rows that were not supplied. The GRID computes this,
 *  because the grid owns the geometry. */
windowGap?: { readonly direction: "before" | "after"; readonly rowCount: number };
```

A consumer must never derive "am I near an edge" from a row range and an invented
threshold. An earlier draft's example needed `visibleRowRange.end > loadedCount - 20`
plus a coordinate pun where a negative `start` meant "before the window" — both
signs the consumer was reconstructing geometry the engine already had.

This stays a **published fact, not an invocation**. The engine still never calls
the consumer; transport independence holds.

**Placement follows for free here too, in the other direction.** `<Pretable>` has
no `onTelemetryChange` and does not gain one. That exclusion is not invented for
windowing: the drop-in hardcodes `viewportStyle` and `viewportHeight`, so it owns
its viewport, and telemetry reports viewport-derived facts. Handing a consumer
telemetry about a viewport they cannot configure would be incoherent.

### 3. Two coherent halves, not one crippled one

| | `<Pretable>` | `PretableSurface` |
| --- | --- | --- |
| `resultMeta.window` | **yes** (inherited) | yes |
| `windowGap` telemetry | no | yes |
| Result | honest positioning for a window **you** move — a pager, a "load more" | the same, plus fetch-on-scroll |

The drop-in gets correctness with explicit control; the surface gets the
automated version. That matches what the two components already are.

### 4. Geometry: spacers, never rows

`planViewport` gains optional `leadingHeight` / `trailingHeight`, derived by the
surface from `window.start`, `hasMore` and the row-height estimate. Regions
outside the window become **pure geometry** — no row elements, so they occupy no
`aria-rowindex` and need no focus/selection/copy exemptions. This is what makes
the feature legal under the design's no-placeholder-rows rule, and it is why the
change is small rather than a new row model.

Proven against a 100,000-row dataset with rows 40,000–40,099 loaded: extent
4,000,000px, correct local-index resolution at the window top and mid-window, row
tops offset past the spacer, and the dataset index recovered as `start + local`.
With no spacers supplied the planner is byte-for-byte unchanged.

**The two halves of the extent have different error characteristics**, and only
one is exact:

- **Behind you** — measured, then released. Heights are retained, so scrolling
  back is pixel-exact.
- **Ahead of you** — never seen. Estimated, so the extent corrects as you arrive.
  #367 reduced that estimator's mean error to 3.083px; over a 1,000-row lookahead
  that is ~3,000px of eventual correction.

### 5. ARIA generalizes "contiguous prefix" to "contiguous window"

The engine's current contract is that loaded rows are a contiguous **prefix** —
visible verbatim in a warning: *"the loaded records cannot be a contiguous prefix
of the result set."*

| | Today | With a window |
| --- | --- | --- |
| `aria-rowindex` | `local + 2` | `start + local + 2` |
| `aria-rowcount` | `total.count + 1` | unchanged |
| Downgrade guard | `total < loaded` | `start + loaded > total` |

Every existing downgrade survives untouched: non-external authority, grouping
active, and non-exact totals each still fall back to the loaded model and warn
once. The honesty machinery already **detects** the non-prefix case and refuses
it; this slice teaches it to represent an offset instead.

### 5b. The offset is gated on the count being honest

**Found during implementation; the plan specified this wrong.** Applying
`window.start` to `aria-rowindex` unconditionally is a regression, because the
row-rendering branch covers both flat rows and data rows nested inside expanded
groups. Under grouping that would publish positions around 40,000 while
`aria-rowcount` stays downgraded to the small loaded-model count — the two
attributes disagreeing is precisely the dishonesty this feature exists to avoid.

The offset is therefore derived from whether `resolveAriaRowCount` actually
published the population (`ariaRowCount === matchingTotal.count + 1`), degrading
to `0` for grouping, non-external authority, a non-exact total, or an
out-of-range window.

**Invariant: a row may only report a dataset position when the grid is also
reporting the dataset count.** One rule, so the two can never contradict.

### 6. The re-fetch contract (documentation, not code)

Re-opening a window the user has already seen needs no new mechanism and no
backward cursor: **keep the cursor that opened each block and re-send it.** A
keyset continuation is a position, not a session. Verified against Dawn's store —
replaying the cursor for block 2 and block 4 returned those blocks byte-identical
after walking past them.

Two constraints the spec must state, both found by spiking rather than reasoning:

1. **The cursor's fingerprint includes `now`.** Re-stamping it rejects *every*
   stored cursor at once (`continuation-invalid`), and the stack must be rebuilt
   from the head. A windowed session pins one `now`, and accepts that expiry is
   evaluated as of that instant.
2. **A `datasetKey` change discards everything.** New identity means offsets are
   meaningless; the grid resets to the top and the cursor stack is garbage.

### 7. A known false-negative in `windowGap`

**Found during implementation, and pinned rather than fixed.** The row layout
controller does not replan on a `resultMeta`-only change — no `rows` or viewport
change means no new plan. `windowGap`'s checks read `windowSpacers`, which IS
derived fresh every render, so a *growing* total self-corrects immediately: the
stale boundary only ever becomes more permissive.

A *shrinking* total does not. `windowGap` can report `undefined` for a viewport
that a fresh replan would still call past the window, until any
replan-triggering event (a scroll, a row change) corrects it.

Pinned by `"windowGap telemetry does not refresh from a resultMeta-only update
without a rows/viewport change"`. A real fix means changing when the controller
replans, which its own documentation deliberately keeps ignorant of
`resultMeta` — so that is its own decision, not a detail of this slice.

## Testing

- **Geometry**, in `apps/layout-core`: extent, index resolution at the window top
  and mid-window, row tops offset past the spacer, and a regression guard that
  the planner is unchanged with no spacers. (The spike's tests, promoted.)
- **ARIA**, in `packages/react`: `aria-rowindex` under a non-zero `start`; every
  downgrade condition, each mutation-proved.
- **Telemetry**: `windowGap` appears with the right direction and count when the
  viewport passes an edge, and is absent when it does not.
- **Browser**, in `apps/bench/tests/`: a window at a real offset scrolls, resolves
  the right rows, and reports the right positions. jsdom has no layout engine, so
  anything about rendered geometry is vacuous there by construction.

**Every guard must be shown able to fail by deleting the feature it names**, not
by tweaking an expected value. A test asserting "positions are offset" must fail
when `window` is removed from `resultMeta`.

## Open question, to settle by spike rather than argument

Is `<Pretable>` + `window` without telemetry genuinely usable, or a trap? The
claim is that changing `window.start` and swapping `rows` yields correct
positioning without a telemetry round-trip. If it does not — if the grid needs a
signal the drop-in cannot receive — then `window` should be surface-only after
all, and §3's table is wrong.

This is the first thing to build, before the rest of the slice depends on it.

## Risks

1. **Delegated honesty grows.** `window.start` is one more field pretable renders
   and cannot validate. The design's own risk register says that pattern is
   "structurally solved only by Approach C, deferred" — this slice adds to the
   debt it names.
2. **The estimator sets the drift.** Extent correction ahead of the window is
   `rows × estimator error`. Acceptable today at ~3px/row; a regression there
   becomes a visible scrolling defect rather than a cosmetic one.
3. **Eviction is not in this slice, and the value is.** Addressing alone changes
   little for a user — it is the enabling half. If eviction does not follow, this
   ships surface area for a capability nobody reaches.
