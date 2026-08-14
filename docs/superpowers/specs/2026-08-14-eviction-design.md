# Eviction

Status: proposed · 2026-08-14

Releases loaded rows to bound memory **without disturbing anything the user can
perceive** — heights, scroll position, selection and focus all survive a
release-and-return cycle.

This is the wedge. It **depends on windowed data** (`2026-08-13-windowed-data-design.md`),
which supplies the spacer geometry an evicted region occupies. That dependency is
hard: a spike run against `main` failed outright because `leadingHeight` does not
exist there, and the extent collapsed from 8197px to 4104px.

## Why it is the wedge

AG Grid's docs state that when using dynamic row height with the Server-Side Row
Model, `maxBlocksInCache` must not be set — *"purging the cache and dynamic row
heights do not work together."* They did not solve that coupling; they banned it.
MUI documents no eviction at all and requires a static `rowCount`.

Variable row heights are pretable's differentiator. **Bounded memory with
variable row heights is a capability no surveyed competitor has.**

Three of the four primitives it needs already exist, none built for this:

| Primitive | Status |
| --- | --- |
| Retain measured heights through a row's absence | **built** — tombstones, bounded at 100_000 |
| Geometry for an unmaterialized region | **built** — windowed data's spacers |
| Hold the view still when geometry shifts | **built and live** — `captureAnchor`/`restoreAnchor` |
| Selection surviving a row's disappearance | **not built** — §2 |

## Scope

**In:** the eviction policy, selection as positional spans, the focus rule when
the focused row is released, and block collapse beyond the tombstone bound.

**Out:** deciding memory pressure on the consumer's behalf, remote grouping,
selection surviving a *query* change (a new `datasetKey` resets everything, as
today), and fetching evicted rows back — that is the consumer's job via the
existing re-fetch contract.

## Design

### 1. What eviction guarantees

Eviction is invisible. Across a release-and-return cycle:

- a returning row is restored at **the height it had**, not re-estimated
- the **scroll position does not jump**
- a selected row **returns selected**
- **focus never falls to `<body>`**

The engine chooses what to release. The consumer still owns all fetching;
nothing here calls the consumer.

### 2. Selection as positional spans

Today `reconcileIndexedSelection` drops any range whose endpoints have both
vanished:

```ts
if (startVisible && endVisible)       ranges.push(range);       // keep
else if (startVisible || endVisible)  collapse to the survivor;
else                                  changed = true;           // DROP
```

That is right when a row is **deleted** and wrong when it is **evicted**.

**The discriminator already exists — it is the window.** `setRows` receives an
array and diffs it, so a missing row is indistinguishable on its own. But
`resultMeta.window` tells the engine the loaded span is
`[start, start + rows.length)`, which resolves it without any new API:

| A row is absent and its dataset position is… | Meaning | Selection |
| --- | --- | --- |
| **outside** the window | **evicted** — out of view, not gone | survives |
| **inside** the window's span | **deleted** — genuinely removed | prunes, as today |

No consumer signal, no change to `setRows`, no new state. This falls out of the
windowed-data slice, and it removes what this spec first recorded as its largest
risk — that the distinction might span grid-core and row-model.

Note `change-journal.ts`'s existing `"journal-evicted"` reset reason is unrelated:
that is the change journal discarding old revision entries, not row eviction. A
name collision to avoid propagating.

Under the honesty gate, ranges are stored as **dataset-index spans**:

| Question | Answer |
| --- | --- |
| How many are selected? | arithmetic — `Σ(hi − lo + 1)`, no rows loaded |
| Is this rendered row selected? | containment on its dataset position |
| Deselect one row inside a span? | splits the span; state is already `ranges: []` |
| Cost | **O(ranges)**, independent of how many rows are selected |

Deliberately NOT answered without a fetch: *give me the selected records*. That
requires loading them, and forcing an async selection API on every consumer is a
much larger surface than this slice earns.

**Gated identically to `aria-rowindex` and the scroll extent.** A span is only
meaningful when the grid is also publishing an honest count, so selection
inherits the existing invariant rather than inventing a third rule. Outside the
gate — grouping, engine authority, an inexact total — today's prune-on-vanish
stands, which is correct, because positions there are meaningless.

The honest consequence: **selection-survives-eviction works only in
server-controlled mode.** In local mode nothing evicts, so it is not a gap — but
it is a real conditional and must be documented as one.

### 3. Policy: release the furthest, never the unrestorable

Evict furthest-from-viewport first. Never evict a row that cannot be restored
faithfully.

"Cannot be restored" has one meaning: **its measured height is no longer
retained**. Beyond the 100_000-measurement bound, an evicted block collapses to a
single retained total — one number per block rather than N per row — so the
geometry stays exact while per-row detail is dropped.

This matters because **the tombstone cache is itself the memory eviction exists
to bound.** Retaining every height forever bounds nothing. Block collapse is what
makes the feature real, and it is the least-designed part of this spec.

### 4. Anchoring is for drift, not for eviction

**Corrected by spike; the first draft of this design had it wrong.**

With **exact** retained heights the spacer reproduces the evicted region's height
precisely, global coordinates do not change, and **nothing moves** — no anchoring
is involved. A test asserting "anchoring keeps the row in place" across such an
eviction passes with the anchor restore deleted. It is a tautology.

Anchoring is needed only where the spacer **differs** from the true height:
rows that were never measured, or a collapsed block carrying an approximation.
Measured with a 5% estimate error over 100 evicted rows:

| | Row's on-screen position |
| --- | --- |
| Anchor restored | **120px** — unchanged |
| Anchor removed | **325px** — a 205px jump |

So the cost model is: **evicting measured rows is free; evicting unmeasured rows
costs an anchor correction.** Drift absorbs below the viewport, so nothing the
user is looking at moves.

### 5. Focus

When the focused row is released, focus must not fall to `<body>`. AG Grid
forcibly re-grabs with `preventScrollOnBrowserFocus` in this situation and the
design already holds Slice 1 to that bar; the same rule applies here. The
re-seat target is the nearest surviving row in the direction of travel.

## Testing

- **Geometry**, `layout-core`: extent unchanged across eviction; a control
  proving it collapses without the spacer.
- **Anchoring**, `layout-core`: the drift case above, with the mutation that
  reddens it — a test written against the *exact* case is vacuous and must not
  be written.
- **Selection**, `grid-core`: count over a span with no rows loaded; containment
  for a returning row; span splitting; and that a **deleted** row still prunes
  while an **evicted** one does not.
- **Browser**, `apps/bench/tests/`: select a span, scroll until it evicts, scroll
  back, and assert the rows return ticked. jsdom cannot answer this.

**Every guard must be proven by deleting the feature it names**, not by tweaking
an expected value. §4 is the worked example of why: the obvious test passed
without the feature.

## Risks

1. ~~**Evicted-vs-deleted is unbuilt and load-bearing.**~~ **Withdrawn** — the
   window supplies the discriminator (§2). What remains is ordinary work:
   `reconcileIndexedSelection` must consult the window before pruning.
2. **Block collapse is the least-designed part**, and it is what makes the
   memory bound real rather than notional.
3. **Depends on unmerged work.** Windowed data must land first; a spike proved
   eviction geometry simply does not function without it.
4. **The value is invisible when it works.** A user cannot see eviction; they
   only see its absence as a browser tab consuming a gigabyte. The bench's
   resident-cap measurement is the only evidence it is doing anything.
