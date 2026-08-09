# Row grouping + aggregation: docs, hero, and benchmark — design (P2 sub-project 4 of 4)

**Date:** 2026-08-08
**Base:** `c50e15e` (`feat(grouping): drag-to-group panel, chip keyboard model, and column menu`)
**Status:** approved in-session

## Context

Row grouping shipped in three deliberately separate sub-projects:

1. the headless grouping and aggregation engine;
2. group-row rendering, expansion, aggregates, and treegrid semantics; and
3. the drag-to-group panel, keyboard-complete chips, and column menu.

This final sub-project makes the feature usable and visible outside its fixtures. It
threads the four grouping options that already exist in `PretableGridOptions` through
the React API, documents the complete public workflow, gives visitors an interactive
grouping path in the streaming portfolio hero, and measures the full-recompute design
under the existing S5 streaming load before the hero adopts it.

The engine deliberately recomputes grouping and aggregates after every row change.
That was an explicit SP1 decision: measure the simplest correct implementation before
adding changed-path machinery. SP4 is the measurement gate.

## Approved product decisions

1. **The homepage hero demonstrates grouping.** The live portfolio is the flagship
   surface and is a better proof than a disconnected showcase card.
2. **The hero starts ungrouped.** The group panel is visible and empty on first paint,
   inviting interaction without replacing the familiar portfolio table with a hierarchy.
3. **Grouping gets a dedicated Grid guide.** The guide is added to navigation, while the
   component and API-reference pages receive concise prop entries and cross-links.
4. **The benchmark is permanent.** A grouped S5 updates variant remains in the harness
   as a regression surface; SP4 does not rely on an unrepeatable one-off measurement.

## Scope

### In

- React plumbing for `aggregateFilteredRows`, `groupsDefaultExpanded`, `groupColumn`,
  and `hideGroupedColumns` on both `usePretable` and `PretableSurface`.
- A dedicated `/docs/grid/grouping` guide plus navigation and reference-page updates.
- An ungrouped-on-first-paint grouping panel in the portfolio hero.
- Sum aggregates for the hero's quantity, market value, and day P&L columns.
- A permanent `updates-grouped` S5 benchmark and a measured grouped-versus-flat run.
- Unit, browser, docs, API-report, and benchmark-contract coverage for the above.

### Out

Tree data, pivoting, total/footer rows, group filtering by aggregate value, sticky group
headers, single-child-group collapsing, per-chip aggregate pickers, locked group levels,
and new aggregation functions. Incremental or changed-path recomputation is also out of
scope unless the benchmark gate fails; a failure stops SP4 before hero adoption and
triggers a separately designed optimization project.

## React API plumbing

The four existing engine options become optional fields on `UsePretableOptions` and
`PretableSurfaceProps`, with the same names, types, and defaults as
`PretableGridOptions`:

```ts
aggregateFilteredRows?: boolean; // default false
groupsDefaultExpanded?: boolean; // default true
groupColumn?: PretableGroupColumnOptions;
hideGroupedColumns?: boolean; // default true
```

`PretableSurface` passes them to `usePretable`; `usePretable` passes them into
`createGrid`. There is one object-identity trap to avoid: a consumer will naturally
write `groupColumn={{ header: "Group" }}` inline. An equal new object on every render
must not recreate the grid, because doing so would discard sort, filters, selection,
focus, grouping, column layout, and in-flight edits under streaming updates.

Grid creation therefore keys the group-column option by its primitive public fields
(`header`, `widthPx`, and `pinned`), not by object identity. An equal inline object keeps
the grid instance stable. A real option change may recreate the grid, matching the
existing construction-option behavior of `autosize`; documentation must not imply that
these four fields are controlled state. Runtime grouping itself remains controlled via
`state.rowGroups` and observed with `onRowGroupsChange`.

No fifth option is added. `groupExpansionOverrideLimit` remains a headless construction
option in this sub-project: it is an advanced memory bound, not required by either the
React hero or the documented React workflow.

## Documentation design

`/docs/grid/grouping` is the canonical guide and sits after Filtering in the Grid nav.
It covers:

1. **Quick start:** `rowGroup: true` for a declarative initial grouping and
   `groupPanel={{ enabled: true }}` for interactive grouping.
2. **Panel and column menu:** drag a header into the panel, use “Group by this column,”
   reorder chips, remove a level, and use the keyboard model (arrows, Shift+arrow,
   Delete).
3. **Controlled grouping:** `state={{ rowGroups }}` plus `onRowGroupsChange`; `[]`
   explicitly ungroups, while omitting the slice returns ownership to the engine.
4. **Aggregation:** built-ins, custom `PretableAggregator`, `formatAggregate`, and the
   fact that aggregation is column configuration rather than a per-chip choice.
5. **Expansion:** `groupsDefaultExpanded`, imperative expand/collapse methods, stable
   path-derived ids, and the fact that changing or reordering grouping levels resets
   expansion overrides because every path changes.
6. **Filtering:** visible-row totals by default and `aggregateFilteredRows` for totals
   over filtered-out leaves; `childCount` remains post-filter in both modes.
7. **Group column layout:** `groupColumn` header/width/pin configuration and
   `hideGroupedColumns={false}`.
8. **Accessibility:** `treegrid`, group-row levels/expanded state, the listbox chip
   model, and the menu as the keyboard path for adding a grouping.

The `PretableSurface` page gains the four construction props, `groupPanel`,
`onRowGroupsChange`, and `state.rowGroups` in its prop/state documentation, plus a link
to the guide. The API-reference page is updated where it enumerates React surface
options. Existing Sorting and Filtering pages add only small “See also” links where the
pipeline order matters; grouping details remain centralized.

## Hero adoption

The portfolio hero retains its current row replay, external sort, selection, editing,
paste, reduced-motion fallback, and sidebar calculations. Grouping is intentionally
uncontrolled so a visitor's panel/menu action mutates the grid without adding another
React state loop to the streaming surface.

The surface adds:

```tsx
groupPanel={{
  enabled: true,
  emptyMessage: "Drag a column here to group",
}}
groupColumn={{ header: "Group" }}
```

It does **not** provide `state.rowGroups` and no column starts with `rowGroup: true`, so
the first paint is ungrouped. “Group” is deliberately neutral: although Sector is the
expected demonstration, the column menu permits other columns and a fixed “Sector”
derived header would become false.

The hero columns add `aggregate: "sum"` to:

- `qty`, using its existing integer formatter;
- `mktValue`, using the existing compact-USD formatter; and
- `dayPnl`, with an aggregate formatter that preserves signed-USD presentation without
  rendering the leaf-row percentage subline.

The sidebar continues to summarize the leaf `rows` array, not the grid's visible row
model. Grouping therefore changes only the table presentation. Streaming ticks continue
to update aggregates because the grid receives the same stable columns and changing
rows it receives today.

The legend gains grouping alongside edit, select, copy, paste, and filter affordances.
The group panel consumes the existing `viewportHeight` contract, so enabling it must not
change the bezel's external height or move the portfolio sidebar.

## Benchmark design

### Why a new script, not a new scenario

The existing S5 scenario already supplies the required load shape: fixed 50 ms batches,
configurable updates per second, 30 columns, and scales from smoke through 20,000 target
rows. A new scenario would make grouped and flat runs differ in more than grouping.

`updates-grouped` therefore uses the same S5 dataset, patch generator, duration,
viewport policy, and metrics as `updates`. It is supported for the Pretable adapter on
S5 and rejected by the existing support-validation path for unsupported
adapter/scenario combinations.

For this script only, the Pretable adapter:

- groups by `col_1`, whose generated owner values form a small stable set;
- adds `aggregate: "sum"` to numeric `col_3`;
- keeps groups expanded, matching the default and the hero's interaction result; and
- does not render the group panel, so the measurement isolates grouped row derivation
  and rendering rather than panel chrome.

Every update invalidates the current full derived-row cache, even when the randomly
patched column is neither the group key nor aggregate input. That is intentional: the
test measures the present full-recompute contract rather than an imagined optimized
path.

### Measurement gate

Run `updates` and `updates-grouped` with identical S5 target-scale settings and the
default 1,000 updates/second. Record both artifacts and compare them. The grouped run
must satisfy:

- `scroll_frame_p95_ms <= 16`;
- `long_tasks_count === 0`;
- `scroll_position_drift_px === 0`; and
- `visible_row_count_drift === 0`.

The flat run is the diagnostic baseline and its relative delta is reported, but the
absolute grouped thresholds are the gate. If the grouped run misses either frame or
long-task threshold, stop before editing the hero. Do not hide the result by lowering
the update rate, collapsing groups, reducing scale, or optimizing inside this spec.

## Error and edge behavior

- Unknown, duplicate, derived, or otherwise invalid grouping column ids continue to be
  sanitized by the engine. React does not create a second validation path.
- `rowGroups: []` remains the explicit ungrouped controlled state.
- If a grouped column is hidden (the default), it is removed through the panel chip;
  with `hideGroupedColumns={false}`, the column menu may also show Ungroup.
- Reordering group levels resets expansion overrides and returns groups to
  `groupsDefaultExpanded`; the guide states this explicitly.
- Changing the four construction options may replace the grid instance. Equal inline
  `groupColumn` values do not.
- A benchmark support mismatch produces the harness's existing `unsupported` result,
  not a failed or fabricated measurement.

## Verification strategy

### React unit tests

- Each of the four options reaches the engine and changes an observable outcome.
- An equal inline `groupColumn` object across rerenders preserves the grid and its
  internal grouping state.
- Changing a primitive `groupColumn` field updates the derived column after the allowed
  reconstruction.
- Existing controlled `state.rowGroups` and `onRowGroupsChange` behavior remains intact.

### Hero tests

- The group panel is visible and empty on first paint; no group row exists initially.
- Grouping Sector through a supported interaction creates sector groups and aggregate
  cells with the expected format.
- Streaming/row updates change group aggregates without resetting the user's grouping.
- The sidebar remains a leaf-row summary.
- The reduced-motion seeded snapshot still renders with an empty panel.

### Docs and API tests

- Grid navigation includes Grouping at the approved location.
- Links and code examples pass the existing website build/typecheck pipeline.
- The React API report includes the four new props and has no unintended diff.

### Benchmark tests and run

- Query parsing accepts `updates-grouped`.
- Bench-runner support validation accepts only the intended Pretable/S5 combination.
- The adapter applies grouping and one numeric aggregate only for the grouped script.
- The Playwright artifact contract recognizes the grouped updates metrics.
- Flat and grouped target runs are executed with identical update-rate parameters; the
  grouped artifact is checked against the measurement gate before hero adoption.

### Repository validation

Run the affected package suites first, then the repository's full typecheck, lint,
tests, API check, website build, grouping browser tests, and benchmark artifact run.
Every new behavioral test must have a negative control that demonstrates it fails when
the behavior it protects is removed or inverted.

## Delivery order

1. Thread and test the four React construction options.
2. Add and validate `updates-grouped`.
3. Run the flat/grouped target measurement gate.
4. Only after the gate passes, adopt grouping in the hero.
5. Add the dedicated guide, navigation, cross-links, and API report.
6. Run browser, benchmark, and full-repository validation.

