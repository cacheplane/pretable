# Server-Controlled Data Exploration — Competitive Alignment

Date: 2026-08-09
Companion to: `2026-08-09-server-controlled-exploration-design.md` (the design
under test). This document changes no design decision by itself; §6 lists the
items it adds to the record.

## 1. Method and sources

Deep source audits (all claims `path:line`-cited in the underlying research;
doc-derived claims labeled):

- **AG Grid v35.2.1-beta** — full monorepo source at `~/repos/ag-grid`
  (community + enterprise: server-side row model "SSRM", infinite row model,
  viewport row model, a11y layer, selection strategies, docs).
- **MUI X DataGrid 9.10.1** — shipped ESM from this repo's node_modules
  (bench comparator pin), plus mui.com docs.
- **TanStack Table 8.21.3** (`table-core` + `react-table`) — shipped source
  from node_modules.
- **Landscape sweep** — Handsontable 17.1+/18, Tabulator 6.x, Glide Data
  Grid, react-data-grid, Ant Design Table (rc-table), React Aria/Stately
  `useAsyncList`, Infinite Table for React. Provenance differs from the three
  audits above and is weaker: Tabulator and Glide claims come from upstream
  source **downloaded from GitHub during research** (not a pinned local
  checkout, so line numbers are snapshot-relative); Handsontable, Ant Design,
  React Aria, and Infinite Table claims are **doc-derived only**. Race
  handling and a11y for Infinite Table are *unknown* (not covered in fetched
  docs), not absent.

The three primary audits (AG Grid, MUI, TanStack) are local, version-pinned,
and independently re-verified by a fact-checking pass; the landscape sweep is
corroborating context, not load-bearing evidence.

## 2. The landscape maps exactly onto the design's A/B/C axis

Every approach the design compared is shipped by someone. The market
bifurcates along precisely the boundary the design debated:

| Camp | Who ships it | Notes |
|---|---|---|
| **A — consumer-owned everything, grid displays only** | react-data-grid (sort emitted, "does not reorder rows for you"; no filtering at all); Ant Design Table (`sorter: true` + `onChange` callback) | Existence proof that display+emit-only can be a successful grid's *only* mode |
| **B — per-operation authority flags + consumer request loop** | **TanStack Table** (`manualSorting`/`manualFiltering`/… — row-model pass-through, state still displayed and emitted — the design's flags semantics *verbatim*); **Tabulator** (`sortMode`/`filterMode: "local"\|"remote"` — shipped years ago); **MUI legacy mode** (`sortingMode`/`filterMode`/`paginationMode: "client"\|"server"` with genuine no-reapply short-circuits); React Aria `useAsyncList` (consumer loop, cursor-only, built-in stale discard) | The chosen approach has three independent, battle-tested precedents |
| **C — engine-owned datasource** | **AG Grid** SSRM/infinite (offset blocks, stubs, engine-owned cache/races); **MUI `dataSource`** (GA in community 9.10.1: engine-owned fetch, cache, `lastRequestId` stale discard); **Handsontable `dataProvider`** (new in 17.1, 2026 — AbortSignal + serialized CRUD); Infinite Table | The deferred approach is also real and converging — see §5 |

Two market facts bear directly on the design's staging decision:

1. **MUI's own trajectory is the design's plan.** They shipped the granular
   flags first and layered `dataSource` on top later — and the moment
   `dataSource` is supplied, MUI forces all three flags to `"server"`. The
   B-primitives remain the substrate under the C-layer; C does not replace
   them. That is the design's B-now/C-seamed bet, validated by the closest
   competitor's actual history.
2. **AG Grid demonstrates the cost of *not* having per-operation flags**:
   authority is a global `rowModelType` switch, enforced by per-model option
   validations and API allowlists, with features silently degrading across
   models (infinite mode wipes selection on sort change; range selection
   returns empty across unloaded gaps). Their only granular authority toggle,
   `serverSideEnableClientSideSort`, *silently flips sort authority based on
   whether a group happens to be fully loaded* — exactly the
   load-state-dependent ambiguity the design's static flags exist to prevent.

## 3. Decision-by-decision alignment

| Design decision | AG Grid | MUI X | TanStack | Verdict |
|---|---|---|---|---|
| Per-op authority flags | Absent (global row-model switch; one silent completeness-driven sort flip) | **Same model** (3 flags, no-reapply verified in source) | **Same model** (manual* pass-through) | Validated; our flags are *declared contracts* where TanStack's are plugin-omission side effects |
| Controls display + emit, never re-apply | SSRM: filterModel passed verbatim, never locally evaluated (verified absence) | "The prop should always win" — internal writes discarded | State accessors never consult manual flags | Unanimous across all server modes |
| No placeholder rows in the row model | Opposite: stub rows everywhere, with a visible tax (§4.1) | Community: same as us (overlay-layer skeleton). Pro: stubs in model, with leaks | Same as us (absence) | Validated at the community tier; AG documents the cost of the alternative |
| Keyset continuation | **Offset only**; code self-heals offset drift by id and never documents the duplicate/omission hazard | Offset only; cursor *typed* but unconsumed in community | n/a (consumer-owned) | **We are ahead of every shipped grid**; only React Aria `useAsyncList` (cursor-only) is prior art |
| Totals: exact\|estimate\|unknown | exact or unknown(-1); unknown encoded as a phantom +1 row | Three-state (`rowCount:-1` + `estimatedRowCount` + `hasNextPage` latch) but estimate reaches the *footer label only* | exact or `-1` | Validated; ours is the only single-type version, and the only one whose estimate tier has defined ARIA semantics |
| `aria-rowcount = -1` for unknown | **Identical shipped behavior** | Never uses -1; aria is loaded-scope everywhere ("row 3 of 27" per page) | Zero aria anywhere (grep-confirmed) | Incumbent-proven |
| Global `aria-rowindex` over partial window | Same arithmetic (virtual-model positions, header-inclusive) | Absent | Absent | Validated by AG locally; **Glide Data Grid appears to ship our exact pattern** (hidden windowed a11y tree, total+1, global rowindex) — GitHub-snapshot evidence, §1 provenance caveat |
| No `aria-busy` on the grid | **Zero occurrences across five packages** | Zero occurrences | Zero occurrences | Unanimous market confirmation |
| Data-lifecycle announcements | **None** — data loads/refreshes/filter results announce nothing (verified absence; only overlays and pagination summary) | None | None (headless) | **We fill a gap nobody ships**; AG's docs instead tell SR users to disable virtualization and paginate |
| Consumer-owned request loop w/ revisions | Grid-owned, coarse (cache-generation liveness; **no per-request revision — a non-purge refresh accepts pre-refresh responses**; grand-total race punted to example code) | Engine-owned `lastRequestId` inside `dataSource`; **nothing at all** in legacy server mode | Delegated to TanStack Query (`placeholderData: keepPreviousData` = our stale phase) | Validated; our revision protocol fills the exact hole MUI's legacy mode has and generalizes what AG keeps internal |
| Explicit `datasetKey` | Implicit (cache destroyed on sort/filter change); purge loses heights + focus identity | Implicit (cache key = stringified models) | **Documented footgun** (data reference identity; cannot distinguish refresh from new query) | **Genuinely novel** — no competitor has an explicit dataset-identity primitive; our DK-change semantics are strictly stronger than AG's purge |
| Focus preserved by row id | Positional (index) restore; self-documents the failure ("focus moved up"); but **never drops to `<body>`** (header fallback + forced re-grab) | n/a | n/a | Ours is stronger; AG sets the never-body bar our DK focus rule must match (design already does) |
| Selection loaded-scope by default | Opposite: `{selectAll, toggledNodes}` ranges over never-loaded rows | Loaded-scope by default; off-window via opt-in `keepNonExistentRowsSelected` | Loaded-scope | Validated; see §4.2 for what AG/MUI's dataset-scope selection costs |
| Eviction deferred | **Eviction is off by default** (`maxBlocksInCache: -1`) and force-disabled under variable row heights (warns 203/204) | Community: none (TTL cache of responses, not rows) | n/a | Our deferral matches the incumbent default; §5.1 attaches their coupling evidence to our EXT seam |

## 4. The two most instructive incumbent case studies

### 4.1 AG Grid's placeholder rows — the tax, itemized from source

The design rejected synthetic loading rows; AG Grid is the fully-built
alternative. What stubs-in-the-model costs them, verified in source:

- **Export/copy silently skips stub rows** (`gridSerializer.ts`) — the exact
  silent-omission bug class the design's paging analysis exists to prevent,
  shipped in the incumbent's clipboard path.
- Shift-click range selection is **refused entirely** when any row in the
  range is a stub.
- `ensureIndexVisible` needs a ≤10-attempt retry loop that waits for stubs to
  load and cancels if the user scrolls.
- Stubs must be garbage-collected when they leave the viewport; page
  navigation splits scroll-target from focus-target "ie. scrollRow could be
  stub"; `firstDataRendered` must special-case them; selection sync excludes
  them at every call site.
- MUI Pro's version leaks: skeleton rows are *not* excluded by
  `isRowSelectable` — they escape selection only because the skeleton cell
  renders no checkbox.

What stubs buy them, honestly: random-access scrollbar geometry under
unknown totals (the phantom "+1 loading row" *is* their infinite-scroll
trigger) and a per-position SR affordance ("Row data is loading" label at the
position the user reached). The design traded both away for accumulate-only
load-more — a documented scope boundary, and §6.1 records the one mitigation
worth keeping.

### 4.2 AG/MUI dataset-scope select-all — our OUT-SELECT-01, shipped, with the bill

AG Grid SSRM select-all is exactly the query+exclusions model the design
declared OUT: `{selectAll: boolean, toggledNodes: Set<id>}`. Its observed
costs, from source: the header checkbox renders fully-checked over an
unverified extent (zero rows loaded, unknown total); `getSelectedNodes()`
permanently warns once select-all has ever been used ("cannot be used with
select all functionality"); export-selected silently degrades to loaded rows;
selected-count returns `-1` rendered as `?` in the status bar; and the
"all except X"→ids translation is pushed entirely to the application. MUI's
`include|exclude` model adds five bail-out conditions and a footer count that
reports a page-scope number for a dataset-scope intent. Both incumbents thus
*validate the deferral*: dataset-scope selection is real and wanted, and it
drags exactly the mutation-safety and honesty problems the requirements said
it would (OUT-SELECT-01's "query-plus-exclusions model and separate mutation
safety review").

## 5. Incumbent evidence now attached to our deferred seams

- **EXT-DATA-01 / EXT-GRID-03 (bounded windows/eviction).** AG Grid: eviction
  off by default; *banned* in combination with dynamic row heights (rather
  than solved); focused/expanded/editing nodes exempted per-node, so blocks
  evict with holes; the infinite model refuses to purge focused blocks. A
  decade of incumbent evidence that eviction couples to heights, focus, and
  selection — which is why the design routed it to an engine-coordinated
  future rather than a consumer loop.
- **EXT-COUNT-04 / EXT-GRID-02 (remote grouping).** AG's contract is the
  reference shape: `groupKeys` route addressing, consumer-supplied
  `getChildCount`, id-keyed expansion with `parentKeys`-synthesized ids,
  server-supplied aggregates never recomputed, expand-all as base+inversions.
  Their honesty caveats to avoid: stale parent rows over empty children under
  scoped filter refresh (documented), and root-store-only `isLastRowKnown`
  feeding aria while child stores are still unknown. TanStack's
  `manualGrouping` shows the failure mode of grafting server grouping onto a
  client grouper: `getIsGrouped()` is dead for server-built rows — group
  metadata must be part of the row contract.
- **EXT-GRID-01 (auto near-end loading).** AG's trigger is row
  materialization by the viewport (plus the phantom row), not a scroll
  threshold — supporting the design's telemetry-based seam
  (`visibleRowRange` walking toward `loadedRowCount`).
- **EXT-DATA-02 (push).** AG's viewport row model is the push seam as a whole
  separate row model (server pushes sparse `{index: row}` updates; no
  sort/filter in the contract at all). The design's version — push schedules
  the same `refresh()` under the same identity — is smaller and composes with
  the rest.
- **OUT page-jump.** AG supports offset page-jump everywhere and inherits the
  silent-omission hazard wholesale; MUI guards one corner of it (page-size
  change under unknown count resets to page 0). Nothing here argues for
  reopening the OUT decision.

## 6. What this research adds or changes (the full list)

Nothing in the incumbent evidence overturns a design decision. Four items are
worth recording:

1. **Per-position loading affordance gap (accepted, mitigated).** AG's
   labeled stubs give an SR user who outruns loading a "Row data is loading"
   row at the position reached; we have no equivalent position. Mitigation
   already in the design (§9.2 boundary announcement + load-more label +
   load-completion announcement) — and AG itself never *announces* stub
   resolution, so the net SR experience still favors the design. No change.
2. **AG's focus re-grab is the implementation bar** for the DK-change focus
   rule: when the browser drops focus to `<body>` mid-teardown, AG forcibly
   re-grabs with `preventScrollOnBrowserFocus`. Slice 1 should meet exactly
   that bar (the design's rule already requires it; this is a pointer to
   proven mechanics).
3. **Handsontable's partial-data filter honesty** (removing "Filter by
   value" from the column menu because value lists would be incomplete) is
   precedent for going *further* than the design's dev-warn on the
   enum-distinct-values fallback. Option recorded for implementation review:
   suppress rather than warn. Non-blocking.
4. **React Aria `useAsyncList`'s typed loading phases** distinguish
   `sorting`/`filtering`/`loadingMore` where our `dataState` folds the first
   two into `stale`. Our announcements already carry the intent context;
   finer phases remain a possible additive refinement if consumers ask.
   No change.

## 7. Positioning summary

Where the design lands relative to the field, in one paragraph: the
**authority-flags core is market-proven three times over** (TanStack,
Tabulator, MUI legacy); the **a11y stance is either identical to the best
shipped behavior** (aria-rowcount -1, global row indexes, universal
no-aria-busy) **or ahead of everyone** (lifecycle announcements, honest exact
totals over partial windows without a "disable virtualization" accessibility
mode — a capability AG Grid's own docs explicitly disclaim); the
**keyset-with-head-refresh continuation and the explicit `datasetKey`
primitive have no shipped counterpart** in any surveyed grid (React Aria's
cursor-only `useAsyncList` is the nearest prior art, and it is a list data
layer, not a grid); and everything
the incumbents have that we don't — page-jump, dataset-scope select-all,
remote grouping, eviction, engine-owned datasource — is a consciously
sequenced EXT/OUT item, now with the incumbents' source-verified costs
attached to each seam. The staged B→C plan is not a compromise between
competitor camps; it is the trajectory the closest competitor (MUI) actually
followed, with the C-layer's known spec bugs (AG's refresh race hole, MUI's
legacy-mode void) designed out in advance.
