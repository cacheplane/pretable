# Windowing and eviction — docs

Status: approved · 2026-08-15

Finishes the `/docs/server-data` section. The original scoping
(`2026-08-14-server-side-data-docs-design.md`) cut windowing and eviction
because a windowed grid at a nonzero offset rendered blank. That defect was
fixed in #422 and is now pinned by a real `locator.click()` in
`apps/bench/tests/eviction.spec.ts`. Eviction shipped in #412.

## The surface, in full

Small, and smaller than the story:

| Thing | Shape | Where |
| --- | --- | --- |
| `resultMeta.window` | `{ readonly start: number; readonly hasMore: boolean }` | `PretableResultMeta` |
| `telemetry.windowGap` | `{ readonly direction: "before" \| "after"; readonly rowCount: number }` | `PretableTelemetry` |
| `resultMeta.datasetKey` | `string` | already documented on `lifecycle.mdx` |
| `DataHonestyInput.windowStart` | `number \| undefined` | already public |

**Eviction has no API of its own.** That is the single most important thing
both pages must convey. Eviction is what happens when a consumer drops rows it
is not showing while keeping `window.start` honest; the grid's job is to make
that unobservable. Any page implying there is an eviction prop to reach for is
wrong.

## Scope

**In:** window addressing, the `windowGap` near-edge signal, the re-fetch
contract, the eviction guarantees, and the `datasetKey` requirement that makes
them possible.

**Out:** deciding memory pressure for the consumer, remote grouping, jumping to
an arbitrary unvisited offset, and selection surviving a *query* change (a new
`datasetKey` resets everything, by design).

## Design

### 1. Two pages

`/docs/server-data/windowing` and `/docs/server-data/eviction`, appended to the
existing nav section after **Totals and honesty**.

Two rather than one because the reader intents are different — "how do I page
through a result too big to hold?" versus "how do I bound memory?" — and
because eviction's page is mostly guarantees, not mechanism.

Nav entries land **with** their page, never ahead of it: `app/llms.txt/build.ts`
throws on an href resolving to no page and fails the build.

### 2. `windowing.mdx`

Required headings, in order (the docs guard keys tables and fences by heading):

1. Intro, then `<Example id="server-windowing" />`.
2. `## The window` — `start` is the dataset index of `rows[0]`; `hasMore` is
   whether anything follows, **not how much**. Absent or `0` is the ordinary
   prefix case. Both are facts the consumer already holds from its own
   response.
3. `## What the grid does with it` — spacer geometry for the unmaterialized
   regions, so the scroll extent reflects the population rather than the
   loaded rows; and `aria-rowindex` carrying dataset positions.

   State the invariant plainly: **a row reports a dataset position only when
   the grid is also reporting the dataset count.** One rule so the two can
   never contradict. Verify the conditions against `resolveAriaRowCount` before
   writing them — both processing slices external, not grouped, exact total,
   window in range.
4. `## Knowing when to fetch` — a table whose first header is `Field`,
   documenting `windowGap`'s two members, bound to `PretableTelemetry` in the
   guard. `direction` says which edge the viewport reached; `rowCount` is how
   far past the loaded window it is.
5. `## A gap you may not be told about` — the known false-negative, documented
   because we shipped a page once claiming a warning that could not fire.

   The row layout controller does not replan on a `resultMeta`-only change, and
   `windowGap` reads `windowSpacers`. A *growing* total self-corrects (the
   stale boundary only becomes more permissive). A *shrinking* total does not:
   `windowGap` can read `undefined` for a viewport a fresh replan would call
   past the window, until any replan-triggering event (a scroll, a row change)
   corrects it. Pinned by the test named in
   `2026-08-13-windowed-data-design.md` §7. Say that a fix means changing when
   the controller replans, which is deliberately ignorant of `resultMeta`, so
   it is its own decision.
6. `## Re-opening a window you have seen` — the re-fetch contract. It is
   documentation, not code: **keep the cursor that opened each block and
   re-send it**; a keyset continuation is a position, not a session. Two
   constraints, both found by spiking rather than reasoning:
   - a cursor's fingerprint includes `now`, so re-stamping rejects every stored
     cursor at once and the stack must be rebuilt from the head;
   - a `datasetKey` change discards everything — new identity means offsets are
     meaningless.

### 3. `eviction.mdx`

1. Intro, then `<Example id="server-windowing" />` — **no**. An example belongs
   to exactly one page; this page links to windowing's instead and describes
   what to watch for in it. If the implementer finds a second example earns its
   cost, that is a deviation to justify, not assume.
2. `## What eviction is` — dropping rows you are not showing. No prop, no flag,
   no method. The grid's contribution is that it does not notice.
3. `## What survives` — across a release-and-return cycle: a returning row is
   restored at **the height it had**, not re-estimated; the scroll position
   does not jump; selection and focus survive. Verify each against the
   implementation and its tests before asserting it — `#412`'s tests are the
   source, not the spec's prose.
4. `## What it costs you` — `datasetKey` is required. Without it nothing can
   tell an evicted row from a deleted one, and the engine refuses to restore
   what it recorded. Cross-link the `datasetKey` section on `lifecycle.mdx`
   rather than restating it.
5. `## What it does not do` — it will not decide memory pressure for you, and
   it will not fetch evicted rows back; that is the re-fetch contract on
   `windowing.mdx`.

### 4. The example

`server-windowing`: a 100-row window over the endpoint's 480 fixture orders.

- `resultMeta.window: { start, hasMore }` from the response's offset.
- `resultMeta.total: { kind: "exact", count: 480 }` so the population count and
  dataset positions are publishable.
- `processing: { filter: "external", sort: "external" }`.
- A stable `datasetKey`, since the population never changes.
- `onTelemetryChange` (stable via `useCallback`) watching `windowGap`: when the
  viewport runs past the loaded window, fetch the next block and **drop the
  previous one** — that is the eviction half, and it must be visible.
- A readout showing `window.start`, the loaded row count, and the number of
  rows fetched so far, so a reader can see memory staying bounded while the
  dataset position climbs.

The endpoint already supports `offset` and `limit`; no endpoint change should
be needed. If one is, that is a finding to report.

Expected consequences, to be verified in a browser rather than assumed:
`aria-rowcount` 481 throughout; `aria-rowindex` on a row equal to its dataset
position, not its index in the loaded array; `resolveDataScope` answering
`"loaded"` because 480 exact exceeds the ~100 loaded.

### 5. Guard registration

Every type the pages print gets registered, and every registration
mutation-tested — edit the report, observe the specific failure, revert. A
registration whose mutation does not fail is not coverage.

`PretableTelemetry` is already bound as a member table on
`grid/pretable-surface.mdx#Telemetry`. The `windowGap` note there currently
reads "used by windowed datasets" and should now link to `windowing.mdx`.

## Verification

- Every example runs in a real browser on an isolated port, and the assertions
  above are observed, not inferred. A successful build proves compilation, not
  behaviour.
- e2e per page, each proven able to fail by deleting the behaviour it names.
- `docs-links`, `nav`, `docs-api-surface`, and `examples-registry-guard` green.
- `prettier --check .` is repo-wide: editing a markdown table's longest cell
  realigns the whole table, and a per-file check will not see it.
- `pnpm build` before `pnpm api:check`.

## What must be true afterwards

1. Neither page claims an eviction API exists.
2. The `windowGap` false-negative is documented, not hidden.
3. Every claim about what survives eviction is traceable to a test, not to a
   spec's prose.
4. The section's overview no longer says windowing and eviction are "not
   covered yet".
