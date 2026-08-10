# Server-Controlled Data Exploration — Architecture Design

Date: 2026-08-09
Status: DRAFT — awaiting human approval; no implementation may begin until approved
Requirements source: `docs/superpowers/specs/2026-08-09-server-controlled-data-exploration-requirements.md` (in the dawn repo)
Repositories audited: pretable @ `origin/main` (v0.0.9, commit 58796c6); dawn @ `origin/main` + one test-only commit (branch `fix/close-guard-rot-gaps`, @dawn-ai/* 0.8.21, consumes @pretable/* 0.0.8)

This document is the architecture deliverable requested by the requirements
handoff. It contains no implementation. Every normative requirement ID from the
handoff is resolved in the traceability table (§16); every EXT requirement is
either given a designed seam or explicitly deferred.

Companion: `2026-08-09-server-controlled-exploration-competitive-analysis.md`
tests every decision below against AG Grid v35 (source-audited), MUI X
DataGrid 9.10.1, TanStack Table 8.21.3, and seven other grids. It overturns
no decision here; it attaches incumbent evidence to the deferred EXT seams
and records four non-blocking observations.

---

## 1. Verified current-state audit

All claims below were verified against source at the commits named above.
Citations are repo-relative `path:line`.

### 1.1 Pretable — what exists

**Package boundary.** `@pretable/core` is a thin public facade
(packages/core/src/public_api.ts:9-47) over the private
`@pretable-internal/grid-core`; `@pretable/react` renders it;
`@pretable-internal/{layout-core,renderer-dom,text-core}` stay private. The
public surface is pinned by CI-gated api-extractor reports
(packages/core/core.api.md, packages/react/react.api.md).

**The engine always processes locally — no server mode exists.** `getSnapshot()`
unconditionally derives the row model through
`deriveVisibleRows` = filter → group → aggregate → sort → flatten
(packages/grid-core/src/derived-rows.ts:38-63,
packages/grid-core/src/create-grid-core.ts:1493-1553). A grep for any
server/manual/external-processing flag across all packages returns nothing.
The React controlled-state prop (`PretableSurfaceProps.state`, the repo's only
`@experimental` symbol — packages/react/src/pretable-surface.tsx:453-466) is
applied by re-asserting `grid.replaceSort` / `grid.replaceFilters` in a layout
effect (packages/react/src/use-pretable.ts:310-321), i.e. controlled state is
always _locally applied_, never display-only. **A consumer that filters rows
server-side and also passes `state.filters` gets the filter applied twice.**

**Filter model.** One `ColumnFilter { operator, value? }` per column, all
AND-combined (packages/grid-core/src/derived-rows.ts:91-105). Operators are
selected per `column.type ?? "text"`: text
contains/notContains/equals/notEquals/startsWith/endsWith (lowercased compare),
number equals…between, date on/before/after/dateBetween (UTC day buckets), enum
and boolean isAnyOf/isNoneOf (an empty selection is _inactive_ and the filter
entry is deleted — packages/grid-core/src/evaluate-filter.ts:14-21,
packages/grid-core/src/create-grid-core.ts:290-313), isEmpty/isNotEmpty on all
types. The filter UI is the built-in per-column funnel menu, keyed off
`column.type` (packages/react/src/filter-menu/filter-operators.ts:20-51).

**Sort model.** Ordered multi-sort `PretableSortEntry[]`; comparator chosen by
_runtime value inspection_ (all-number → numeric, else stringified
`Intl.Collator`), not by `column.type`
(packages/grid-core/src/row-utils.ts:31-34, 46-88); final tie-break is source
index. `setSort`/`replaceSort` sanitize unknown and `sortable: false` columns.

**Row updates preserve interaction state.** `grid.setRows(rows)` replaces the
row set in place, preserving selection ranges and focus (both row-ID-keyed;
focus reconciled to a surviving ID, else a clamped index position —
packages/grid-core/src/create-grid-core.ts:1137-1202, 1352-1421) and any
in-flight edit; measured row heights live in React state keyed by row ID and
survive (packages/react/src/pretable-surface.tsx:787, 2144-2209). The grid
instance is recreated only when the `autosize` prop identity changes
(packages/react/src/use-pretable.ts:253-257). `applyTransaction {add, update,
remove}` is the incremental path; `@pretable/stream-adapter` is a push-only
ingestion pipe over it. These guarantees are pinned by tests
(packages/grid-core/src/**tests**/set-rows.test.ts,
packages/react/src/**tests**/use-pretable-streaming.test.tsx,
packages/react/src/**tests**/pretable-surface.test.tsx:3535). **No scroll
anchoring exists anywhere** — content shifts under a static `scrollTop`.

**Counts, ARIA, selection scope — all derived from supplied rows.**
`snapshot.totalRowCount` = `sourceRows.length` (output only; no total input
exists anywhere — packages/grid-core/src/create-grid-core.ts:1540).
`aria-rowcount` = `visibleRows.length + 1`, `aria-rowindex` = model index + 2,
group rows included (packages/react/src/pretable-surface.tsx:2216, 3266).
Header select-all targets all post-filter _model_ data rows — children of
collapsed groups excluded — via `setSelectAllVisible`
(packages/react/src/pretable-surface.tsx:2554-2617,
packages/grid-core/src/create-grid-core.ts:513-557). React-level telemetry
exposes `{rowModelRowCount, renderedRowCount, visibleRowRange, totalRowCount,
…}` via `onTelemetryChange` (packages/react/src/use-pretable.ts:112-124); there
is no scroll callback.

**No lifecycle UI.** No loading, empty, error, skeleton, or overlay rendering
exists anywhere in the packages; `OverlayPortal` is internal. The single polite
live region announces select-all, copy/paste, and group expand/collapse only —
no sort, filter, count, or busy announcements; no grid-level `aria-busy`
(packages/react/src/pretable-surface.tsx:3751-3769; §3 of the a11y audit).
Localizable strings flow through the public `messages` prop.

**Grouping.** Local engine feature: groups are synthesized post-filter,
`childCount` counts post-filter descendants, aggregates fold leaf rows
(packages/grid-core/src/group-rows.ts:53-58, 79-117). The derived group column
appears in `getColumns()` (drawn order), never in `options.columns`.

**0.0.8 → 0.0.9 delta.** Entirely grouping work (group panel, grouping
correctness); `core.api.md` unchanged; nothing Dawn exercises changes on
upgrade. `PretableSurfaceState.rowGroups` already existed in 0.0.8.

**A11y gaps noted in passing** (not D1 obligations, recorded for accuracy):
column resize and reorder are pointer-only; `FilterMenu` does not restore focus
on Escape (the column ⋮ menu does).

### 1.2 Dawn — what exists

**Browse query.** `BrowseQuery { namespacePrefix?, status?, kind?, sourceType?,
limit?, offset?, since?, until?, now? }` → `BrowsePage { records, total }`
(packages/memory/src/types.ts:54-71); `status`/`kind` are single-valued;
`namespacePrefix` is a byte-exact, case-sensitive prefix (deliberately not
LIKE — packages/memory/src/sqlite-store.ts:434-436). Ordering is hardcoded:
`ORDER BY updated_at DESC, id ASC` (Postgres pins the tie-break with
`COLLATE "C"` — packages/memory-pgvector/src/pgvector-store.ts:486-489). There
is no sort parameter, no content/confidence/tags filter, no multi-value
anything. `limit` has **no upper bound** (store clamps to ≥ 0 only —
sqlite-store.ts:464-467). Records + total are two non-transactional statements;
the Postgres implementation documents the skew as accepted
(pgvector-store.ts:483-486).

**Public-contract shape.** `BrowseQuery`/`BrowsePage` are exported from the
`@dawn-ai/memory` barrel; `@dawn-ai/core` carries a _structural mirror_ with the
query shape inlined anonymously on `MemoryStoreLike.browse`
(packages/core/src/capabilities/types.ts:76-93) that must move in lockstep; the
pgvector store is a third implementor. A shared ~40-test conformance suite
(`runMemoryStoreConformance`, packages/testing/src/memory-conformance.ts) runs
against SQLite always and Postgres behind `DAWN_TEST_PGVECTOR=1`. Dawn uses
changesets (single fixed version group, 0.8.21) and has **no api-extractor**.

**Storage semantics.** Timestamps are ISO-8601 TEXT compared lexicographically
(full-ISO-Z normalization happens at the Inspector route boundary —
packages/inspector/app/api/memory/list/route.ts:25-37). SQLite BINARY
collation; Postgres relies on `COLLATE "C"` only where added. Indexes:
`(namespace, status, updated_at DESC)`, `(namespace, kind, effective_at DESC)`,
token-table indexes. **No index serves the global `updated_at DESC` browse
order** when namespace+status equality is absent.

**Validation.** The store validates nothing beyond limit/offset clamping —
invalid enum values silently match zero rows; since/until/now are compared as
raw strings. The Inspector HTTP route validates enums (400) and normalizes
instants (400 on unparseable); unknown params are silently ignored.

**Inspector consumption of Pretable.** One component instantiates
`PretableSurface` (packages/inspector/src/components/memory/memory-grid.tsx:125-161)
with six columns — status, content, namespace, kind, confidence, updated —
**none of which declare `type`, `options`, `sortable`, or `filterable`**, so
every column runs Pretable's untyped/text default for both filtering and
sorting. Sort and filter are uncontrolled and fully local over a fixed
`limit=200` fetch; no offset is ever sent, there is no pagination UI, and the
response's `total` is never displayed (the facet rail's counts come from a
separate, always-global stats endpoint). Selection is the uncontrolled checkbox
column mirrored out via `onRowSelectionChange`; _clearing_ selection requires
remounting the grid (`key={gridEpoch}` —
packages/inspector/src/components/memory/list-page.tsx:149-155, 299). Bulk
actions POST one ID at a time, deliberately sequential (concurrent approves
race into 409s), `window.confirm` for destructive verbs, partial failures keep
the selection and list per-ID errors.

**Freshness.** Client-side polling only: `usePolling` at 2 s, whole-response
replacement, documented last-write-wins, no AbortController, no request
identity anywhere (packages/inspector/src/components/use-polling.ts:16-19).
List polling pauses during search; stats keep polling; mutations bump a
`refreshKey`.

**The three consumer-correctness defects the handoff names, confirmed:**

1. _Namespace narrowing_: the server filters by prefix, the client then narrows
   to exact equality (list-page.tsx:167-172) — displayed rows and any
   prefix-based total can disagree.
2. _Timeline re-sort_: the timeline receives an `updated_at DESC` browse page
   and re-sorts it client-side by event time
   (packages/inspector/src/components/memory/timeline-view.tsx:22-27) — a
   result selected under one order presented as another population.
3. _Inert controls during search_: the status/kind selects stay rendered and
   interactive while a search is active, but the search route hardcodes
   `status: "active"` and takes no kind — they are silently ignored
   (packages/inspector/app/api/memory/search/route.ts:43-49).

**Search/stats/timeline surfaces.** Search fans out per-namespace
`store.search` calls (limit 8 each, no totals, no continuation) and returns
namespace-grouped sections rendered as separate grids without selection.
Stats is five GROUP BY counts, query-unaware beyond an optional
`namespacePrefix` the UI never sends. There is no server timeline endpoint.
The namespace-grouping prototype lives unmerged on
`blove/inspector-namespace-grouping` (controlled `state.rowGroups`, client-side
over the same ≤200-row page).

**Serving.** The Inspector is its own published standalone Next app, spawned by
`dawn inspect`, localhost-guarded, no auth. SSE infrastructure exists only in
the CLI dev runtime server, internal, in a different process.

---

## 1.3 Baseline correction (2026-08-09, post-approval)

Two Dawn PRs landed between the §1 audit and design approval. **No decision in
this document changes**; the starting point does. Corrections to §1.2:

- **`BrowseQuery.status`/`kind` are no longer single-valued.** #432
  (`fc0ec4f1`) widened both to `T | readonly T[]`, implemented `IN (…)` /
  `= ANY($n::text[])` in both stores, added five conformance tests (including
  the contract that an **empty set matches nothing**), and encodes over HTTP
  as a repeated param with whole-request 400 on any bad value. §5.1's
  multi-value requirement is therefore **already satisfied** for these two
  fields, and `normalizeSetFilter` (packages/memory/src/browse-filter.ts) is
  the extension seam for the rest.
- **Two Inspector columns now declare filter metadata.** #434 (`ff73de5a`)
  gives `status` and `kind` `type: "enum"` + `options` + `filterable: true`,
  and sets `filterable: false` on the other four _because the server cannot
  express them yet_ — the four controls were deleted rather than left
  dishonest. Filter state is now controlled and lifted to `ListPage`.
- **The double-application hazard is live but currently neutralized by
  accident, not by design.** Dawn re-encodes every funnel selection as
  `isAnyOf` over the same resolved set already sent to the server, so
  Pretable's local pass is an idempotent no-op
  (packages/inspector/src/components/memory/column-filters.ts:47-53). This
  works only while every pushed-down filter is set-shaped and equality-based;
  it breaks for `contains`, ranges, and dates, and it already leaks in one
  place — between a filter tick and its response, the new predicate is
  applied locally to the _old_ page. This is direct field evidence for
  `D1-GRID-01`.
- **Sort is now the largest honesty gap in the Inspector.** #434 fixed the
  lie for filters and left it standing for sort: no column sets
  `sortable: false` and no sort state is controlled, so all six columns sort
  the loaded 200 rows while presenting as a sort of the dataset.
- **Partial-window counts already cost a shipped feature.** The unmerged
  grouping branch now gates grouping on `page.records.length >= page.total`
  ("group only when the page is the whole answer") — the only place in Dawn
  that reads `total`, used to _withhold_ a feature because there was no
  honest way to show partial counts. §9.4's loaded-scope labeling is what
  replaces that gate.
- Two items to absorb: `packages/core/src/capabilities/types.ts:78-79` still
  mirrors the **scalar** `status`/`kind` and is silently out of sync (no
  parity test exists — §5.7 must add one); and Dawn pins `@pretable/*` at
  `0.0.8` while `0.0.10` is published (the delta is an SSR density-hydration
  fix that matters for a server-rendered grid).

Slice scoping consequences: slice 2 shrinks (multi-value done), slice 4
shrinks (two columns typed), and both grow one task each (core-mirror parity,
Pretable version bump). §13's order is unchanged.

---

## 2. Design summary (read this first)

**Recommendation: a B-core hybrid.** Pretable gains a minimal, transport-neutral
set of primitives — per-operation _processing authority_, a _result metadata_
input (matching total + dataset identity), and a consumer-asserted _data
lifecycle_ presentation — and refuses to own anything else. Dawn owns the entire
request loop: desired/fulfilled query revisions, stale-response suppression,
keyset continuation, head-anchored poll refresh, and the domain query. The full
remote-datasource abstraction (Approach C) is deferred with named seams; the
zero-Pretable-change approach (A) is rejected because its costs are permanent
and user-visible while B's are smaller and mostly internal.

The shape in one paragraph: the Inspector declares its six columns with real
types (`status`/`kind` enum, `confidence` number, `updated` date) and
constructs the grid with `processing: { filter: "external", sort: "external" }`.
Pretable's existing funnel menus and header sort affordances keep working as
_intent editors_ — they mutate display state and fire the existing
`onFiltersChange`/`onSortChange` callbacks — but the engine's derivation
pipeline no longer applies them to the loaded rows. Dawn's new `useMemoryBrowse`
hook maps that intent to an extended `BrowseQuery` (normalized filters, ordered
sort whitelist, opaque keyset cursor), tags every request with a desired-query
revision, discards responses for dead revisions, and hands Pretable three
things: the accumulated rows, `resultMeta` (`{ total, datasetKey }`), and
`dataState` (loading / stale / refreshing / loading-more / error / idle).
Pretable renders honest counts (`aria-rowcount` from the exact remote total),
honest select-all labeling ("all loaded"), honest lifecycle blocks, and
preserves selection/focus/heights across refresh and append through the
already-shipped `setRows` reconciliation. A `datasetKey` change — a genuinely
different query — clears selection and focus and resets scroll, replacing the
Inspector's `key={gridEpoch}` remount hack with a first-class primitive.

Headline decisions (each argued later; §15 maps all twelve open decisions):

| Decision                | Ruling                                                                                                                                          | Where      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Boundary                | B-core hybrid; C deferred, A rejected                                                                                                           | §3         |
| Authority granularity   | Per-operation `{filter, sort}` flags, with an ARIA-honesty downgrade rule for mixed modes                                                       | §4.2, §4.5 |
| D1 navigation           | Load-more (accumulate); keyset continuation, opaque server cursor                                                                               | §6.2       |
| Consistency             | Per-response snapshot (explicit transaction, both backends); eventual across responses, repaired ≤ one poll period _while polling is active_    | §5.6, §6.3 |
| Rows+total              | Two statements inside one transaction; `COUNT(*) OVER ()` rejected on measurement                                                               | §5.6       |
| Desired/fulfilled state | Dawn-owned (`useMemoryBrowse`); Pretable displays, never orchestrates                                                                           | §6.1       |
| Lifecycle rendering     | Pretable renders body states + announcements when `dataState` is supplied; Dawn owns failure banners and retry                                  | §4.4, §9   |
| Selection               | Engine-reconciled across same-dataset refresh/append; cleared on dataset change; bulk retry re-attempts failures only                           | §9.3       |
| ARIA counts             | `aria-rowcount = total + 1` only under full external authority, ungrouped, exact total; loaded-count under grouping/engine-sort; `-1` otherwise | §4.5       |
| Dawn query              | Additive `BrowseQuery` extension: normalized `filters[]`, whitelisted `orderBy[]`, opaque `cursor`; named `BrowseQueryLike` mirror in core      | §5         |
| Budgets                 | Proposed numerically from measured baselines                                                                                                    | §11        |
| aria-busy               | Not used on the grid in any state (AT support reality); status region + announcements instead                                                   | §4.5, §9.1 |

**What ships in D1** (per the delivery boundary): the ordinary browse grid,
server-authoritative for every visible column's filter and for ordered sort,
with exact totals, load-more, honest lifecycle, safe loaded-scope selection,
SQLite/Postgres parity, and zero behavior change for local-mode Pretable
consumers. Search and timeline remain separately scoped with their controls
honestly disabled where inert (§8.2). Everything EXT gets a designed seam or an
explicit deferral (§15).

---

## 3. Approaches compared

Three approaches were developed independently (each by a dedicated design
agent), then adversarially cross-examined against both codebases. Verified
findings only; the full champion briefs and the skeptic's review are session
artifacts.

### 3.1 Approach A — Dawn-only orchestration, zero Pretable changes

**Mechanism.** Filters become grid-blind: every column `filterable: false`
(suppresses the funnel; the derivation pipeline additionally ignores filters on
such columns), and Dawn renders its own query bar above the grid. Sort keeps
the native header affordance as an _optimistic preview_: the grid locally
re-sorts the loaded window while Dawn fetches the server-sorted result, with
comparator compatibility engineered per column. Dataset changes are handled by
remounting the surface keyed on a fulfilled-query hash.

**Genuine strengths** (verified): every prop it relies on exists in 0.0.8, so
D1 ships with an empty Pretable diff; it produces a dogfood-verified gap list
before locking any Pretable API; its Dawn-side orchestrator (desired/fulfilled
revisions, keyset discipline) is exactly what the recommended design adopts.

**Why it is rejected — four verified defects:**

1. **The sort-remount is user-hostile.** Hashing sort into the remount key
   means every header click destroys the DOM node the keyboard user just
   pressed (focus falls to `<body>`), clears selection — diverging from
   Pretable's own local-mode semantics, where sorting preserves row-ID-keyed
   selection because sort changes _order_, not _membership_ — and drops
   measured heights. The remount is a scroll-reset workaround dressed up as
   identity semantics.
2. **Its `aria-busy`-during-refresh plan makes the grid intermittently
   invisible to AT** under 2 s polling (assistive tech treats `aria-busy`
   subtrees as suppressed). See §4.5 for the ruling this design adopts instead.
3. **The optimistic sort preview shows the wrong _sample_, not just the wrong
   order**: between click and fulfillment (indefinitely, on failure), a
   recency-selected window re-sorted by confidence presents "top confidence of
   a recency-biased sample" under a truthful-looking `aria-sort` — the
   dishonesty class the requirements ban (`D1-GRID-01`).
4. **A permanent second filter ecosystem.** A Dawn query bar duplicates
   Pretable's typed filter editors, operator vocabulary, and announcements
   forever, and every future Pretable filter feature (the planned advanced
   panel) widens the gap. `aria-rowcount` also stays loaded-count — Pretable
   hardcodes `visibleRows.length + 1` — so honest population counts are
   unreachable without Pretable changes anyway.

### 3.2 Approach C — full remote datasource / row-model in Pretable

**Mechanism.** A new `@pretable/data` package defines
`PretableDataSource.getRows(request) → {rows, total, hasMore, continuation}`
plus an orchestrating reconciler driving desired/fulfilled revisions _inside_
the grid; the engine gains `rowModel: "local" | "external"` and a commit port.
Consumers implement one interface; races become unrepresentable by
construction.

**Genuine strengths**: stale suppression and lifecycle become engine-tested
machinery every consumer inherits; the EXT roadmap (auto near-end loading,
bounded windows/eviction, remote grouping, push) extends one contract instead
of five ad-hoc surfaces; eviction in particular requires coordinating
engine-owned caches (measured heights, selection ranges, focus) that a
props-driven consumer cannot reach — a real retrofit asymmetry.

**Why it is deferred, not chosen now:**

1. **Its precondition is unmet.** By its own champion's adoption test, C pays
   off with ≥ 2 committed remote-data consumers and EXT items on a committed
   roadmap. Today there is exactly one consumer and every EXT item is
   explicitly deferred.
2. **Cost is the largest single API addition in the project's history**
   (~150–200 api-report lines plus a new published package plus a public
   commit port), locked in before any dogfooding evidence.
3. **Bimodality tax**: every future engine feature must answer "what does this
   do in external mode?" — and the review found two concrete unpriced
   regressions in C's own brief (client grouping killed while Dawn has a
   working prototype branch; clipboard _paste_ into a server-owned window left
   with no defined semantics), plus a spec bug in its refresh transition that
   would shrink a 600-row resident window to 200 on every poll tick.
4. **Its D1 default was offset-append over a mutating dataset** — the
   boundary-skew bug the paging analysis (§6.2) exists to prevent.

**The deferral is designed, not silent**: §15 names the seams (the
`PretableResultMeta` shape is C's response format in embryo; telemetry's
`visibleRowRange` is the near-end trigger; the continuation stays an opaque
consumer token). The flip condition — a second remote-data consumer with a
committed timeline plus any of eviction/auto-near-end/push moving from EXT to
the committed roadmap — is restated in §14.

### 3.3 Approach B — minimal transport-neutral primitives (chosen, corrected)

Approach B as originally championed had four defects found by adversarial
review, all incorporated into §4:

1. An **empty-state contradiction**: built-in "no results" blocks gated on a
   _defaulted_ `idle` phase would change behavior for existing local consumers
   (`rows={[]}` renders nothing today) — violating `D1-GRID-04` — and would
   flash "No results" for remote consumers before their first fetch. Fix:
   `dataState` has **no default**; lifecycle presentation is entirely off
   unless the prop is supplied (§4.4).
2. **The mixed mode `{filter: "external", sort: "engine"}` breaks the ARIA
   honesty claim**: engine sort over a partial window destroys the
   contiguous-prefix mapping that makes `aria-rowindex` globally true. Fix:
   the ARIA downgrade rule in §4.5, enforced, with a dev warning.
3. **Scope labeling missed three surfaces**: the header checkbox's hardcoded
   pre-activation `aria-label="Select all rows"`, the copy announcement, and
   group aggregates. Fix: §4.5, §9.3.
4. **Its reference requester recipe had the duplicate-row bug it existed to
   prevent** (naive `offset = loadedCount` concat under polling). Fix: the
   normative requester design in §6 is the keyset + head-anchored refresh +
   ID-dedup model, specified precisely.

**Why B wins**: its primitives are the smallest set that fixes the three
verified Inspector defects _inside_ Pretable's tested surface — the
double-application hazard (authority flags), the `gridEpoch` remount
(`datasetKey`), and dishonest counts (`resultMeta` + ARIA/labeling rules) —
while the orchestration that genuinely varies per consumer (transport,
continuation strategy, polling cadence, cache) stays consumer-owned. Every new
symbol survives a reusability test against non-Dawn consumers (§4.6): the
exact/estimate/unknown total split is forced by Elasticsearch and GraphQL
backends, not Dawn (Dawn only ever uses `exact`); the authority flags are two
enum values; `datasetKey` is a policy-free identity string. Nothing in the new
surface names records, namespaces, statuses, instants, or HTTP
(`D1-GRID-05`).

**Scope boundary recorded honestly**: B's D1 shape is _accumulate-only_
(head-anchored load-more). A page-based table with jump-to-page — the most
common server-grid pattern elsewhere — would additionally need a window-offset
input (`rowIndexOffset`), selection-across-window semantics, and scroll-reset
decoupled from the clear bundle. These are EXT seams (§15), deliberately not
D1, and the limitation is documented rather than discovered.

---

## 4. The Pretable surface (provisional API and semantics)

All names provisional until implementation review; pre-1.0, no aliases. New
symbols ship with `@experimental` TSDoc tags (house precedent: the `state`
prop) and are promoted to stable after Inspector dogfooding — this is the
answer to the "locking shapes before evidence" objection from Approach A.

### 4.1 Engine additions (`@pretable/core`)

```ts
/** Who applies an operation to the loaded records: the engine's derivation
 *  pipeline, or an external processor upstream of setRows (a server, a
 *  worker, a wasm index — the engine does not know or care). */
export type PretableProcessingAuthority = "engine" | "external";

export interface PretableProcessingOptions {
  /** "external": filter state is displayed (funnel indicators, menu contents,
   *  snapshot.filters) but never applied to loaded records. Default "engine". */
  filter?: PretableProcessingAuthority;
  /** "external": sort state is displayed (header arrows, priority badges,
   *  snapshot.sort) but the model order is the supplied record order.
   *  Default "engine". */
  sort?: PretableProcessingAuthority;
}

/** How many records match the fulfilled query — loaded or not. */
export type PretableMatchingTotal =
  | { kind: "exact"; count: number }
  | { kind: "estimate"; count: number }
  | { kind: "unknown"; atLeast?: number }; // e.g. Elasticsearch "gte 10000"

export interface PretableResultMeta {
  /** Matching total for the result set the loaded records came from. */
  total?: PretableMatchingTotal;
  /** Dataset identity. When this key CHANGES between setRows calls, the loaded
   *  records answer a different question: the engine clears selection, focus,
   *  group-expansion overrides, and any in-flight edit, and the surface resets
   *  scroll to the top. A stable (or omitted) key preserves all of them — the
   *  existing streaming guarantees. Local mode never changes it. */
  datasetKey?: string;
}

// Additions to existing types:
interface PretableGridOptions<TRow> {
  /** Construction-time. Flipping authority is a dataset pivot: new grid. */
  processing?: PretableProcessingOptions;
}
interface PretableGrid<TRow> {
  /** Same in-place, id-keyed preserving replace; meta lands in the same
   *  single emit (rows and total can never render torn). */
  setRows(rows: TRow[], meta?: PretableResultMeta): void;
  /** Meta-only update (e.g. a late-arriving exact count) without row churn. */
  setResultMeta(meta: PretableResultMeta): void;
}
interface PretableGridSnapshot<TRow> {
  /** RENAMED from totalRowCount: count of loaded source records. */
  loadedRowCount: number;
  /** Engine filter authority: computed locally, always exact (post-filter,
   *  pre-grouping). External authority: last supplied meta.total, else
   *  { kind: "unknown" }. */
  matchingTotal: PretableMatchingTotal;
  /** Last supplied dataset identity; null before any. */
  datasetKey: string | null;
}
interface PretableColumn<TRow> {
  /** Restrict the filter menu to operators the processor can honor.
   *  Omitted = the full per-type set (today's behavior). */
  filterOperators?: FilterOperator[];
}
```

Placement reasons: these change what the row model _is_, so they are engine
concerns — the documented headless path (`createGrid` +
`useSyncExternalStore`) gets them without React. `processing` is
construction-time; flipping it is honestly a new grid. In the React memo it
participates as its two _scalar_ fields (`processing?.filter`,
`processing?.sort`), never as object identity — an inline
`processing={{...}}` literal must not recreate the grid every render. `meta`
rides on `setRows` so rows and total commit in one emit; `setResultMeta`
exists so a late-refined total does not force a fake rows-identity change.

### 4.2 Engine semantics under external authority

The single change site is the derivation call in `getSnapshot`
(create-grid-core.ts:1508-1521): external filter authority substitutes empty
filters; external sort authority substitutes an empty sort list (the empty-sort
path already falls through to `sourceIndex`, i.e. supplied order).

| authority (filter, sort) | model =                                                 |
| ------------------------ | ------------------------------------------------------- |
| engine, engine           | today, byte-for-byte                                    |
| external, external       | loaded records in supplied order (+grouping if grouped) |
| external, engine         | loaded records, unfiltered, engine-sorted               |
| engine, external         | locally filtered, supplied order                        |

**State mutators are untouched.** `setSort`/`replaceSort`/`setColumnFilter`/
`replaceFilters`/`clearFilters` mutate display state, sanitize exactly as today
(`sortable: false` still prunes — that is how a consumer declares
server-unsortable columns), and emit. The controlled-state layout effect and
the `onSortChange`/`onFiltersChange` mirrors work unmodified: the funnel menu
edits filter state, `onFiltersChange` fires, the consumer fetches, `setRows`
lands. Displaying-without-applying is a derivation substitution, not a second
state model. This is what makes `D1-GRID-02` (controls show controlled desired
state and emit complete next intent) fall out of existing machinery.

Derived features under external authority:

- **`distinctColumnValues`**: unchanged, documented **loaded-scope**. Under
  external filter authority the surface dev-warns when an enum/boolean column
  reaches the distinct-values fallback (a loaded-window value list silently
  offers an incomplete `isAnyOf` universe); declared `column.options` are the
  D1 answer, query-aware facets are EXT.
- **Grouping**: stays engine-owned and loaded-scope (`childCount`, aggregates
  fold loaded records). Activating grouping in external mode triggers the ARIA
  downgrade (§4.5) and marks counts loaded-only (§9.4). Remote grouping is EXT;
  its seam is a `processing.group` key that deliberately does not exist yet.
- **Select-all**: mechanics unchanged — all post-filter _model_ data rows,
  excluding children of collapsed groups (existing behavior); under full
  external authority ungrouped, that set _is_ the loaded window. The scope
  difference is a labeling obligation (§4.5), not an engine one. Query-wide
  select-all is OUT.
- **Counts**: `loadedRowCount = sourceRows.length`. `matchingTotal` under
  engine filter authority is computed locally (exact, post-filter,
  pre-grouping — this also closes the long-standing "post-filter row count"
  residual); a supplied `meta.total` under engine filter authority is ignored
  with a dev warning (it cannot be reconciled with local filtering).
- **Dataset identity**: on `datasetKey` change — clear selection, focus,
  group-expansion overrides, in-flight edit, and aggregate-identity cache,
  then proceed with the normal replace; one emit. Same/absent key: today's
  preservation semantics exactly. The clamped-index focus fallback is
  suppressed across identity changes (a row position in the old query's result
  has no relationship to the same position in a different query's window).
  **DK-change focus rule (deterministic, never `<body>`)**: if DOM focus was
  inside the grid at the change, the surface moves engine focus (and,
  through the existing focus-follow effect, DOM focus) to the first data cell
  of the new result — or to the grid viewport element when the new result is
  empty; if focus was outside the grid, nothing is grabbed.
  `focusedRowRemovedAnnouncement` does **not** fire on a DK change — the
  results announcement covers that transition.

**Append is `setRows(prev.concat(page))` — no `appendRows` method.**
Preservation is row-ID-keyed and heights are ID-keyed React state, so a tail
append preserves everything and moves nothing; an `appendRows` would make the
engine a second bookkeeper of the loaded window (it would have to define what
"the window" is), and the consumer already owns that. Cost accepted: each
append re-reconciles O(loaded) rows — measured budget in §11; the EXT
bounded-window seam revisits this.

### 4.3 React surface additions (`@pretable/react`)

```ts
/** Presentation lifecycle of the loaded records. Consumer-owned and
 *  consumer-asserted; the surface renders it, never infers it.
 *  NO DEFAULT: when this prop is absent the entire lifecycle presentation is
 *  off (no body blocks, no phase announcements, no data-phase attribute) —
 *  local consumers see zero change. Remote consumers must supply it from
 *  their first render, starting at { phase: "loading" }. */
export type PretableDataState =
  | { phase: "idle" } // loaded records answer the desired query
  | { phase: "loading" } // nothing usable loaded for the desired query
  | { phase: "stale" } // records answer a PREVIOUS query; desired in flight
  | { phase: "refreshing" } // same query, newer fulfillment in flight (polling)
  | { phase: "loading-more" } // tail extension in flight
  | { phase: "error"; message?: string };

interface PretableSurfaceProps<TRow> {
  processing?: PretableProcessingOptions; // forwarded to createGrid
  resultMeta?: PretableResultMeta; // applied via setRows/setResultMeta
  dataState?: PretableDataState; // no default — see above
  /** Override the built-in body-state blocks (loading / empty / error-without-
   *  rows). Built-ins are minimal vanilla-CSS blocks; strings from messages. */
  renderBodyState?: (input: {
    phase: PretableDataState["phase"];
    errorMessage?: string;
    loadedRowCount: number;
    matchingTotal: PretableMatchingTotal;
  }) => ReactNode;
  /** Pass-through to the grid element, e.g. for a stale-notice association. */
  ariaDescribedBy?: string;
}

interface PretableSurfaceMessages {
  // existing entries unchanged, plus:
  /** NEW — header checkbox aria-label was hardcoded "Select all rows";
   *  external-mode default "Select all loaded rows". */
  selectAllLabel?: (args: { scope: "all" | "loaded" }) => string;
  /** existing entry — args gain scope + counts (additive). */
  selectAllAnnouncement?: (args: {
    rowCount: number;
    columnCount: number;
    isAll: boolean;
    scope: "all" | "loaded";
    loadedCount: number;
    total?: number;
  }) => string;
  /** existing entry — args gain scope (additive): a copy of 200-of-10,432
   *  must not announce as an unscoped copy. */
  copyAnnouncement?: (args: {
    /* existing */ scope: "all" | "loaded";
  }) => string;
  /** Announced when loading/stale/loading-more resolves to idle — the honest
   *  count moment, and the missing filter-result announcement: "Showing 200
   *  of 4,120"; with `added`, "Loaded 200 more. 400 of 5,432 loaded." */
  resultsAnnouncement?: (args: {
    loaded: number;
    total: PretableMatchingTotal;
    added?: number;
  }) => string;
  /** NEW — group-header child count label (today hardcoded "({childCount})").
   *  scope "loaded" marks partial-window grouping: default "12 loaded" — a
   *  loaded-children count that makes no claim about the population. */
  groupChildCountLabel?: (args: {
    childCount: number;
    scope: "all" | "loaded";
  }) => string;
  dataErrorAnnouncement?: (args: { message?: string }) => string;
  /** Fired only when focus reconciliation's id-lookup misses during a rows
   *  replacement: "Focused row is no longer in the results; moved to a
   *  nearby row." */
  focusedRowRemovedAnnouncement?: () => string;
  /** Announced on entering `stale` — the AT channel for the desired/fulfilled
   *  mismatch (the data-phase attribute and any dimming are visual only, so
   *  without this a screen-reader user has no signal that the visible rows
   *  answer the previous query). Default "Updating results…". */
  staleAnnouncement?: () => string;
  /** Announced when navigation is refused at the last loaded row while more
   *  matching rows exist: "End of loaded rows. 5,032 more available." */
  moreRowsBoundaryAnnouncement?: (args: {
    loadedCount: number;
    total?: number;
  }) => string;
  emptyStateMessage?: () => string; // filtered vs unfiltered handled by consumer copy
  loadingStateMessage?: () => string;
}

interface PretableTelemetry {
  loadedRowCount: number; // RENAMED from totalRowCount
  matchingTotal: PretableMatchingTotal; // NEW
  // rowModelRowCount, renderedRowCount, visibleRowRange unchanged
}
```

`UsePretableOptions` gains `processing` and `resultMeta`; the rows layout
effect keys on `[rows, resultMeta]` and routes a meta-only change through
`setResultMeta`. Headless consumers drive `setRows(rows, meta)` directly and
own their own status a11y, as they already own everything else a11y.

One core-type widening rides along: `PretableAggregateFormatInput` (the
`formatAggregate` argument) gains `scope: "all" | "loaded"` so an aggregate
over a partial window is never presentable as a population figure (§9.4).
Local mode always passes `"all"` — additive, no behavior change.

### 4.4 Lifecycle rendering rules

Body-state blocks render only when `dataState` is supplied:

| phase + loaded                                     | rendering                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loading`, 0 loaded                                | built-in loading block (austere vanilla CSS, no spinner opinion)                                                                                                                                                                                                                                                                                          |
| `idle`, 0 loaded                                   | built-in empty block (`emptyStateMessage`)                                                                                                                                                                                                                                                                                                                |
| `error`, 0 loaded                                  | built-in error block (message + slot for consumer retry)                                                                                                                                                                                                                                                                                                  |
| `error`, >0 loaded                                 | rows stay visible and interactive; a strip at the viewport top carrying **no live-region role of its own** (see the note below); never discard fulfilled records. (This is the query-change-failure presentation: the visible rows belong to an older fulfilled revision — §6.4; the strip carries the consumer's retry affordance via `renderBodyState`) |
| `stale` / `refreshing` / `loading-more`, >0 loaded | rows stay fully visible; `data-pretable-data-phase` attribute on the root is the consumer styling hook (Dawn dims stale rows)                                                                                                                                                                                                                             |
| `stale`, 0 loaded                                  | loading block (an old-empty result with a _new query_ in flight shows loading, not "no results")                                                                                                                                                                                                                                                          |
| `refreshing`, 0 loaded                             | empty block stays; attribute-only change (a 2 s poll over an empty result must not flicker empty → loading → empty)                                                                                                                                                                                                                                       |

**Amended during implementation — the error strip carries no `role="status"`.**
This table originally gave the >0-loaded error strip its own `role="status"`.
It ships without one, and so does every other body-state block. Two reasons,
both found while building it: the surface already owns one permanent polite
region (§4.5), so a second region carrying the same sentence is spoken twice —
the failure already reaches assistive technology through
`dataErrorAnnouncement` on the shared region, which is what the single-channel
rule in §4.5 requires; and a live region that is _inserted together with its
text_ is announced unreliably across AT pairs, because the region has to be
present and observed before the text lands. The strip is therefore visual
presentation plus a `data-pretable-body-state="error-strip"` styling hook. Pinned
by `packages/react/src/__tests__/data-state-surface.test.tsx` ("gives the strip
no live-region role of its own").

No skeleton rows and no synthetic loading/footer rows in the row model: a
synthetic row would occupy an `aria-rowindex` that belongs to a real server row
and would need focus/selection/copy exemptions. The `PretableVisibleRow` union
stays open for future footer rows (existing comment in types.ts) — that is the
EXT seam, not a D1 feature. Load-more and retry controls are consumer chrome
outside the grid element (§9.2).

### 4.5 ARIA and labeling rules (normative)

Grounded in the ARIA 1.2 definitions: `aria-rowcount` is the total row count
of the _full_ table including rows not in the DOM, `-1` when unknown;
`aria-rowindex` is the 1-based position within the full table, counting all
rows including headers (which is why Pretable's header is index 1 and data
rows start at 2 — the existing `+1`/`+2` arithmetic is spec arithmetic).

**Row counts.** With filter and sort authority both external, no grouping
active, and `matchingTotal.kind === "exact"`: `aria-rowcount = count + 1` and
`aria-rowindex = model index + 2` — correct _global_ positions, because a
head-anchored contiguous window makes loaded model index i equal dataset
position i. This contiguous-from-head contract is documented on
`PretableResultMeta` and asserted in dev mode where violations are detectable.
Downgrades:

- **Grouping active, or sort authority engine over a partial window**
  (`total.count > loadedRowCount`): local reordering/synthesis destroys the
  global mapping → `aria-rowcount` reverts to the loaded-model count
  (`visibleRows.length + 1`), positions are loaded-model positions, and the
  population honesty moves to the results announcement and status chrome
  ("200 of 5,432 loaded"). The engine-sort-over-partial-window combination
  additionally dev-warns: it is expressible (a complete-window consumer
  legitimately uses it) but dishonest when partial.
- **`estimate` / `unknown` total** → `aria-rowcount = -1` (the spec's
  unknown value). Estimates go in human-readable text ("about 5,000"), never
  through an API whose contract is an exact integer.
- **Noncontiguous windows** (D1-A11Y-02's remaining case): unrepresentable by
  the D1 contract, and a _detected_ violation of the contiguous-from-head
  contract does not merely dev-assert — production behavior downgrades to
  loaded-model counts, the same rule as grouping. Windowed/noncontiguous
  arithmetic (`rowIndexOffset`) is the reserved EXT seam.

**`aria-busy`: not used on the grid, rowgroup, or rows in any D1 state.** The
AT pairs that honor it drop the whole subtree from the accessibility tree
while `true`; under a 2 s poll cadence the table would intermittently vanish
for exactly the users the attribute claims to help, and the pairs that ignore
it get nothing. Loading is conveyed by the visible body blocks and the
announcements below. (Per-cell-editor `aria-busy` on controls that genuinely
lock stays as-is.)

**Announcements** (all through the existing 500 ms trailing-edge, last-wins
scheduler; one channel per event, never double-spoken):

| Event                                 | Channel                                                  | Rule                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loading`/`stale` → `idle`            | Pretable live region, `resultsAnnouncement`              | the honest-count moment; also serves as the filter-result announcement                                                                                                                                                                                                                                                                                            |
| `loading-more` → `idle`               | Pretable live region, `resultsAnnouncement` with `added` | "Loaded 200 more. 400 of 5,432 loaded." — the cumulative count is what the user navigates by                                                                                                                                                                                                                                                                      |
| `refreshing` → `idle`                 | silent                                                   | a 2 s poll must not produce a metronome; a _changed_ row set or total still announces via `resultsAnnouncement`                                                                                                                                                                                                                                                   |
| → `error`                             | whoever renders the failure UI                           | the channel rule is structural: Pretable's `dataErrorAnnouncement` fires only when Pretable renders the failure (error block or status strip, i.e. `phase === "error"`); a consumer that shows its own `role="alert"` banner keeps the phase out of `error` (Dawn's pattern for refresh/load-more failures, §6.4) — so double-speak is impossible by construction |
| → `stale`                             | Pretable live region, `staleAnnouncement`                | at most once per settling burst: announced on entering `stale`, deduped (message equality through the last-wins scheduler) until the burst settles. This is the _only_ AT-facing stale signal — the data-phase attribute and consumer dimming are visual                                                                                                          |
| focus repaired after row removal      | Pretable, `focusedRowRemovedAnnouncement`                | only for data-driven replacements, not user actions                                                                                                                                                                                                                                                                                                               |
| navigation refused at loaded boundary | Pretable, `moreRowsBoundaryAnnouncement`                 | once per boundary arrival                                                                                                                                                                                                                                                                                                                                         |
| select-all / copy                     | existing announcements                                   | gain `scope` so "All rows selected" can never be said about a partial window                                                                                                                                                                                                                                                                                      |

**Scope labeling** (closing the three surfaces the review found): the header
checkbox `aria-label` becomes the localizable `selectAllLabel` (external-mode
default "Select all loaded rows"); `copyAnnouncement` gains scope; group
aggregate display in external mode is marked loaded-scope (§9.4).

### 4.6 Reusability justification (why this belongs in Pretable)

Every new symbol tested against three non-Dawn consumers — a REST+SQL admin
table, a GraphQL (Relay-connection) dashboard, an Elasticsearch browser:

| API                                          | Non-Dawn forcing function                                                                                                                     | Dawn shape?          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `processing {filter, sort}`                  | ES browser: both external; small REST table: external filter + engine sort over a _complete_ filtered set                                     | two enum values      |
| `PretableMatchingTotal`                      | ES `hits.total {value, relation: "gte"}` forces `unknown+atLeast`; GraphQL `totalCount` absent forces `unknown` — Dawn only ever uses `exact` | none                 |
| `setRows(rows, meta)` / `setResultMeta`      | any page/cursor accumulation                                                                                                                  | an array and a count |
| `datasetKey`                                 | new WHERE ⇒ selection cleared — every listed consumer needs exactly this bundle                                                               | policy-free string   |
| `dataState`                                  | mirrors the transport-free status vocabulary every fetch layer already has                                                                    | none                 |
| `column.filterOperators`                     | expose only indexed operators; useful to purely local consumers who want smaller menus                                                        | none                 |
| messages/`renderBodyState`/`ariaDescribedBy` | localization + branding                                                                                                                       | none                 |

Kept out of Pretable on purpose (generic _problems_, not generic _shapes_):
revision bookkeeping, abort discipline, continuation strategy, polling
cadence, caches, retries, facet counts. The moment Pretable ships a fetcher it
picks a transport — explicitly OUT.

---

## 5. The Dawn query model

### 5.1 Extended `BrowseQuery` (provisional shape)

Additive extension of the existing type — existing callers unaffected;
custom-store implementors are obligated to the new semantics via the
conformance suite (§5.7).

```ts
// packages/memory/src/types.ts (public via the @dawn-ai/memory barrel)
export type BrowseSortField =
  "updatedAt" | "createdAt" | "confidence" | "namespace" | "kind" | "status";

export interface BrowseSortEntry {
  readonly field: BrowseSortField;
  readonly dir: "asc" | "desc";
}

export type BrowseFilter =
  // Split per field, NOT `field: "status" | "kind"` with `values: string[]` —
  // a shared arm would make `{field:"status", values:["actve"]}` compile, a
  // check the existing `BrowseQuery.status` shorthand already gives us.
  | {
      readonly field: "status";
      readonly op: "in" | "notIn";
      readonly values: readonly MemoryStatus[];
    }
  | {
      readonly field: "kind";
      readonly op: "in" | "notIn";
      readonly values: readonly MemoryKind[];
    }
  | {
      readonly field: "content";
      readonly op:
        | "contains"
        | "notContains"
        | "equals"
        | "notEquals"
        | "startsWith"
        | "endsWith";
      readonly value: string;
    }
  | {
      readonly field: "namespace";
      readonly op: "equals" | "startsWith";
      readonly value: string;
    }
  | {
      readonly field: "confidence";
      readonly op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
      readonly value: number;
    }
  | {
      readonly field: "confidence";
      readonly op: "between";
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly field: "updatedAt";
      readonly op: "onDay" | "beforeDay" | "afterDay";
      readonly day: string;
    } // "YYYY-MM-DD", UTC day
  | {
      readonly field: "updatedAt";
      readonly op: "betweenDays";
      readonly fromDay: string;
      readonly untilDay: string;
    }; // inclusive days

export interface BrowseQuery {
  // — existing nine fields retained, semantics unchanged —
  readonly namespacePrefix?: string;
  readonly status?: MemoryStatus; // sugar for filters:[{field:"status",op:"in",values:[s]}]
  readonly kind?: MemoryKind; // sugar likewise
  readonly sourceType?: MemorySource["type"];
  readonly limit?: number; // NOW CLAMPED: 1..1000, default 50 (was unbounded)
  readonly offset?: number; // retained for existing callers; Inspector stops using it
  readonly since?: string;
  readonly until?: string;
  readonly now?: string;
  // — new —
  readonly namespace?: string; // EXACT namespace; distinct from namespacePrefix
  readonly filters?: readonly BrowseFilter[]; // AND-combined, one per field max
  readonly orderBy?: readonly BrowseSortEntry[]; // whitelist above; [] or absent = default order
  readonly cursor?: string; // opaque continuation from a prior BrowsePage
}

export interface BrowsePage {
  readonly records: readonly MemoryRecord[];
  readonly total: number; // exact, same snapshot as records (§5.6)
  readonly continuation: string | null; // NEW — opaque; null = no more rows
}
```

Mapping from Pretable intent is a pure Inspector-side function
(`toBrowseQuery(filters, sort)`): `isAnyOf → in`, `isNoneOf → notIn`, text ops
1:1, `between → between` (inclusive), `on/before/after/dateBetween →
onDay/beforeDay/afterDay/betweenDays`, `PretableSortEntry[] → orderBy` via a
column→field table. Nothing Pretable-shaped crosses the store boundary.

**Every Inspector column declares `filterOperators` matching the
`BrowseFilter` grammar exactly** — this is load-bearing, not cosmetic:
Pretable's funnel menus append `isEmpty`/`isNotEmpty` to every type by
default, and no `BrowseFilter` arm can express them (correctly — every D1
field is NOT NULL, so they are meaningless here). Unpruned menus would show
operators the server ignores: the dishonest-control class this design exists
to kill.

| column     | `type` | `options`       | `filterOperators`                                                          | `sortable`  |
| ---------- | ------ | --------------- | -------------------------------------------------------------------------- | ----------- |
| status     | enum   | domain statuses | `isAnyOf`, `isNoneOf`                                                      | yes         |
| kind       | enum   | domain kinds    | `isAnyOf`, `isNoneOf`                                                      | yes         |
| namespace  | text   | —               | `startsWith`, `equals`                                                     | yes         |
| content    | text   | —               | `contains`, `notContains`, `equals`, `notEquals`, `startsWith`, `endsWith` | no (§14 Q2) |
| confidence | number | —               | `equals`, `notEquals`, `gt`, `gte`, `lt`, `lte`, `between`                 | yes         |
| updated    | date   | —               | `on`, `before`, `after`, `dateBetween`                                     | yes         |

`toBrowseQuery` **throws** on an operator it cannot map (a programming error
by construction once menus are pruned — never a silent drop, which would
recreate the active-looking-but-ignored control).

**Two "defaults", deliberately distinct**: `limit` absent → 50 is the _API_
default (unchanged for existing callers); 200 is the _Inspector's requested
page size_ (§11).

**One filter per field** mirrors Pretable's one-`ColumnFilter`-per-column
model (D1-QUERY-03): cross-field composition is AND; within-field multi-value
exists only through `in`/`notIn` value lists. An empty `values` array is a
validation error (400) — Pretable deletes inactive filters client-side, so an
empty list can only be a bug. Server ordering always terminates with the
`id` tie-break regardless of `orderBy` (§5.4).

### 5.2 Per-field semantics (D1-QUERY-04..08)

**Text — `content`.** Substring/equality ops implemented with literal
substring primitives, not LIKE — `instr(lower(content), lower(?)) > 0`
(SQLite) / `position(lower($1) in lower($2)) > 0` (Postgres) — so LIKE
metacharacters need no escaping ever. Case-insensitive via `lower()` on both
backends. **Documented divergence**: non-ASCII case folding is backend-native
(SQLite `lower()` is ASCII-only without ICU; Postgres follows the database
ctype); the conformance suite pins ASCII behavior, the API docs state the
divergence, and full Unicode folding (generated lowercase column or ICU) is an
EXT option. Whitespace is significant and untrimmed; empty-string values are
rejected at validation (inactive filters are never sent). Ranked search stays
a separate path — `contains` is substring, never tokenized relevance.

**Text — `namespace`.** Machine identifiers: **byte-exact and
case-sensitive**, matching the existing prefix semantics and the facet rail's
exact selection. `equals` = exact match; `startsWith` = the existing
byte-exact prefix, now implemented sargably as a range —
`namespace >= $p AND namespace < succ($p)` — preserving the deliberate
metachar-literal semantics while using the existing namespace-leading index.
`succ` is defined over _code points_ (order-equivalent to byte order for
valid UTF-8, and implementable in JS without producing invalid parameter
strings): strip trailing maximal code points, then increment the last
remaining one; an all-maximal prefix drops the upper bound. The existing
`substr`/`left` forms are character-based, so this is semantics-preserving
for valid-UTF-8 namespaces — stated per D1-QUERY-04's Unicode requirement. Postgres comparisons use `COLLATE "C"` for byte
semantics. The Inspector's namespace column declares
`filterOperators: ["startsWith", "equals"]` so the menu only offers what the
server honors; the facet rail sends `namespace` (exact) — **the client-side
equality narrowing and its rows/total disagreement are deleted**
(D1-QUERY-08).

**Number — `confidence`** (`REAL NOT NULL`, both backends). Finite JSON
numbers required (400 otherwise); `between` inclusive on both ends (matching
Pretable's local `between`); no null semantics needed (column is NOT NULL).
Postgres casts cursor/filter parameters `::real` so float4 comparisons are
exact (§6.2).

**Date — `updatedAt`.** Day-granularity ops over **UTC day buckets**,
matching Pretable's date-filter semantics (UTC `toDayMs`) and the ISO-Z TEXT
storage: `onDay(d)` ⇒ `updated_at >= d T00:00:00.000Z AND < d+1 T00…`;
`beforeDay(d)` ⇒ `< d T00…`; `afterDay(d)` ⇒ `>= d+1 T00…`; `betweenDays`
inclusive of both days. Day strings validated `YYYY-MM-DD` (400 otherwise).
Distinct by construction from timeline effective-event time (`since`/`until`
continue to bound `COALESCE(effective_at, created_at)` — a different field
with different semantics, D1-QUERY-06).

**Enum — `status`, `kind`.** `in`/`notIn` over values validated against the
domain literal unions (400 on unknown values — replacing today's
silently-match-zero behavior). `sourceType` keeps its existing single-value
domain filter (not a D1 grid column).

### 5.3 Validation (D1-QUERY-02, D1-QUERY-11)

A shared validator (`validateBrowseQuery`, exported from `@dawn-ai/memory`)
runs at the Inspector HTTP boundary (400 with `{error}` naming the offending
field/op/value) and defensively inside both stores (throw). Explicit failures
for: unknown fields, unknown ops, unknown sort fields or directions, malformed
values (non-finite numbers, bad day strings, non-ISO instants), empty value
lists, oversized inputs, and malformed/mismatched cursors. Bounds: ≤ 1 filter
per field, ≤ 8 filters total; ≤ 3 `orderBy` entries; string values ≤ 1 kB;
cursor ≤ 4 kB.

**The `limit` ceiling (1..1000, default 50) is enforced at the HTTP route
only — not in the stores.** Correction to an earlier draft of this section,
found during planning: `gatherRecords` in `packages/cli/src/lib/memory/distill.ts:379`
legitimately browses with `limit: MAX_SCAN_RECORDS` (10 000) and then does
offset arithmetic against `page.total` to seek the oldest rows for
consolidation. A store-side clamp would silently truncate that scan and
corrupt distillation with no error. `validateBrowseQuery(q, { maxLimit })`
therefore enforces a ceiling only where one is supplied; the stores keep
their existing ≥ 0 integer clamp. Conformance pins both halves: the route
rejects `limit=5000`, and an in-process caller may exceed 1000. Field and order mappings are
whitelisted tables — user input never becomes SQL identifiers or fragments
(all values are bound parameters; all column names come from the whitelist).

### 5.4 Deterministic ordering (D1-QUERY-09, D1-QUERY-10)

Default order (absent/empty `orderBy`) remains `updated_at DESC, id ASC` —
the documented reset state. Any `orderBy` list is applied in order and
**always terminated by the `id` tie-break** (`id ASC` appended server-side,
`COLLATE "C"` on Postgres) so every order is total and windows are
deterministic. Cross-backend agreement:

- All sortable text fields hold uniform ASCII (`status`/`kind` enums,
  full-ISO-Z timestamps) or machine identifiers (`namespace`) — Postgres
  comparisons on `namespace` and `id` pin `COLLATE "C"` to match SQLite
  BINARY; timestamps are safe under any sane collation because uniform-format
  ASCII digits differ digit-vs-digit (the format-uniformity invariant is
  written down: full-ISO-Z only, already enforced at the route boundary).
- No sortable field is nullable (verified: all six are NOT NULL) — no
  `NULLS FIRST/LAST` policy is needed in D1, and the EXT event-time order is
  NOT NULL by construction (`COALESCE(effective_at, created_at)`).
- `confidence` numeric order is IEEE on both backends.

Conformance adds tied-value fixtures (equal `updated_at`, equal `confidence`,
mixed-case ids) asserting identical ordered ID sequences on both backends
(D1-QUERY-13).

### 5.5 Indexes and query plans (D1-PERF-03)

Measured against Dawn's exact DDL (SQLite 3.47.2 via `node:sqlite`, 100k and
1M synthetic rows; Postgres figures are planner-semantics estimates). The
benchmark scripts are committed into the dawn repo with slice 2 (as the
store-bench harness §11 requires) so these baselines remain reproducible:

| Query shape                                | Plan                                                      | 100k / 1M             |
| ------------------------------------------ | --------------------------------------------------------- | --------------------- |
| Default order + keyset guard, LIMIT 200    | index SEARCH on new `(updated_at DESC, id ASC)`           | 0.54 / 0.50 ms (flat) |
| status/kind equality or IN + default order | filter-scan of the same index, early terminate            | ~0.2 ms (flat)        |
| Filtered `COUNT(*)`                        | index/filtered count                                      | 5.1 / 53 ms           |
| Non-default sort (e.g. confidence)         | scan + top-k temp b-tree (no per-sort index in D1)        | 12.6 / 101 ms         |
| Content contains, rare term                | full scan (no substring index without FTS5/pg_trgm — EXT) | 46 / 355 ms           |
| Namespace exact (+status)                  | existing `(namespace, status, updated_at DESC)`           | sub-ms                |
| Namespace prefix as byte-range             | SEARCH on existing namespace-leading index                | 0.63 / 7.1 ms         |
| Namespace prefix, today's `substr()` form  | not sargable — full scan                                  | 8.0 / 71.5 ms         |

New DDL (the minimal set — the default order is the hot path hit by every
poll tick; user sorts are interactive one-offs, accepted as top-k scans at D1
scale):

```sql
-- SQLite: migration v4
CREATE INDEX IF NOT EXISTS idx_mem_updated_id ON memories (updated_at DESC, id ASC);
-- Postgres: initSchema addition
CREATE INDEX IF NOT EXISTS {prefix}_updated_id
  ON {t} (updated_at DESC, id COLLATE "C" ASC);
-- Postgres, optional: C-collated namespace index if byte-range prefix must be
-- index-served there (SQLite already serves it via BINARY collation):
CREATE INDEX IF NOT EXISTS {prefix}_ns_c ON {t} (namespace COLLATE "C");
```

Mixed sort directions must be declared in the DDL (a plain-ASC composite
scanned backward yields the wrong tie-break direction on both backends).
Existing composites stay (they serve search/candidates). The EXT triggers are
recorded with numbers (§11): per-sort indexes or poll backoff beyond ~1M rows
under user sorts; FTS5/pg_trgm for content; estimated totals when counting
itself breaks budget.

### 5.6 Rows + total consistency (D1-DATA-04, D1-COUNT-01/03)

**Ruling: per-response snapshot via explicit transaction, both backends;
eventual consistency _across_ responses, repaired by the poll refresh.**

- SQLite: `BEGIN DEFERRED … COMMIT` around the two statements on the existing
  `DatabaseSync` connection — one WAL read snapshot, cost ≈ 0.
- Postgres: one pool client, `BEGIN ISOLATION LEVEL REPEATABLE READ; rows;
count; COMMIT` (READ COMMITTED has per-statement snapshots — same skew as
  today).
- `COUNT(*) OVER ()` (single statement) was measured and **rejected**: the
  window aggregate forces materialization of the entire filtered set —
  46 ms at 100k / 439 ms at 1M vs 5.3 ms for two statements — and destroys
  the lazy top-k path for the rows themselves.

Every fulfilled response's `records`, `total`, and `continuation` are
therefore mutually exact _at that fulfilled result revision_. The loaded
client model remains a composite of windows fulfilled at different instants:
rows deleted after loading linger ≤ one poll period, hoisted/inserted rows are
invisible ≤ one poll period, and the UI presents "N loaded of M matching"
precisely because the two numbers may legitimately be ≤ 2 s apart. The head
refresh re-derives the whole resident span (the resident cap never exceeds the
maximum request limit — §11) and the total from one snapshot each tick, so the
model converges every poll period — **a guarantee scoped to active polling**
(live toggle on, tab visible; §6.3 defines the paused presentation and resume
behavior). Conformance gains concurrent-write tests asserting the snapshot
property per response and convergence after refresh (D1-COUNT-03).

### 5.7 Public-contract impact (D1-QUERY-12)

1. `@dawn-ai/memory`: `BrowseQuery`/`BrowsePage` extended (additive);
   `BrowseFilter`, `BrowseSortEntry`, `BrowseSortField`,
   `validateBrowseQuery` newly exported. `MemoryStore.browse` obligations
   grow; both bundled stores updated.
2. `@dawn-ai/core`: the structural mirror gains **named**
   `BrowseQueryLike`/`BrowsePageLike` types (replacing the anonymous inline
   shape on `MemoryStoreLike.browse` — the lockstep comment stays, but named
   types make the mirror diffable). Custom-store authors see the new
   obligations in one place.
3. `@dawn-ai/memory-pgvector`: third implementor updated; schema addition via
   idempotent `initSchema` (no versioned migration system exists there —
   unchanged posture).
4. Conformance suite (`runMemoryStoreConformance`): every new
   filter/op/value shape, tied-order determinism, cursor round-trip
   (including float4 round-trip on Postgres), snapshot totals under
   concurrent writes, validation rejections, limit clamping. Custom stores
   inherit the obligations by running the suite.
5. Changesets: one minor changeset for the fixed version group, with an
   explicit "breaking for `MemoryStore` implementors" note (0.x semver).
6. The Inspector HTTP contract (`/api/memory/list` params) grows
   `filters`/`orderBy`/`cursor`/`namespace` as JSON-encoded query params,
   validated by the shared validator; `includeExpired` unchanged.

---

## 6. Orchestration (Dawn-owned): revisions, paging, refresh

All of §6 lives in `packages/inspector` (a `useMemoryBrowse` hook plus small
pure modules). None of it is Pretable API; it is also the documented reference
requester pattern for future consumers.

### 6.1 Desired vs fulfilled revisions; stale suppression (D1-DATA-01/02)

```ts
interface UseMemoryBrowseResult {
  rows: MemoryRecordRow[]; // accumulated, deduped, reconciled
  resultMeta: PretableResultMeta; // { total: {kind:"exact",...}, datasetKey }
  dataState: PretableDataState;
  loadMore(): void; // no-op unless idle and continuation !== null
  refresh(): void; // manual tick (mutation recovery)
  retry(): void; // re-attempt the failed request kind
}
```

- **Desired query revision**: a monotonically increasing integer, bumped by
  any change to the canonical query. The identity fields are enumerated once
  and used identically by the revision counter, `datasetKey`, and the cursor
  fingerprint (§6.2): filters, ordered sort, exact `namespace`,
  `namespacePrefix`, `sourceType`, `since`/`until`, and the view. The
  canonical query is normalized (sorted keys, canonical value forms) and
  hashed → `datasetKey`; the fingerprint is these fields plus the pinned
  `now` generation.
- Every fetch closes over `{ revision, kind: "initial" | "refresh" |
"load-more" }` and an `AbortController`. On resolve: **the response is
  discarded whole unless its revision is still the desired revision** — that
  one comparison is the entirety of stale-response suppression; aborting is an
  optimization layered on top, and correctness never depends on it
  (D1-DATA-02). This replaces `usePolling`'s documented last-write-wins hole
  for the list fetch.
- **Fulfilled result revision**: the revision of the last response that was
  applied. `records`, `total`, `continuation`, and `datasetKey` are stored
  together, tagged with it (D1-DATA-01: totals and continuation always belong
  to their fulfilled revision).
- **Single flight per dataset identity, with specified arbitration** (user
  intent wins): at most one browse request in flight; a new desired revision
  aborts and supersedes anything. Refresh vs load-more contention: a
  `loadMore()` requested while a poll tick is in flight is **queued** and runs
  when the tick settles (never silently dropped); a poll tick that comes due
  during `loading-more` is **skipped** (the next tick covers it); `loadMore()`
  during `loading-more` is a no-op. This removes interleaving cases outright
  rather than handling them, without losing user intent.
- Phase derivation is mechanical: fulfilled = desired → `idle` (or
  `refreshing`/`loading-more` by in-flight kind); fulfilled < desired with
  rows → `stale`; without rows → `loading`; **`error` exactly when the last
  attempt for the desired revision failed and nothing is fulfilled _for that
  revision_** — initial and query-change failures, with or without an older
  revision's rows still visible. The failure-channel partition follows:
  `error`-phase failures are rendered and announced by Pretable (error block,
  or the status strip over still-visible older rows; retry affordance supplied
  by the consumer through the body-state slot); refresh/load-more failures
  keep the phase at the settled `idle` and surface only through the
  consumer's per-kind banner slots (§6.4). One failure, one channel, by
  construction (§4.5).

### 6.2 Continuation: keyset, opaque, server-validated (D1-DATA-07/08)

**Model comparison (summary of the full analysis, measured against Dawn's
real write workload):** the Inspector's primary interaction — approve — sets
`updatedAt = now`, hoisting a row from anywhere to position 0 of the default
order; forget/reject delete; a status filter turns approve into a
filter-departure (a delete, for that dataset). Under **offset** paging this
workload produces routine _silent omissions_ (a hoist above the seam skips an
unseen row — undetectable client-side; a duplicate at least arrives with a
known ID) plus linearly growing scan cost (measured 7.6 ms at offset 500k vs
0.5 ms flat for keyset). Under **keyset** with the default order, the
monotone-hoist property (updated_at only increases) means writes only move
rows into territory the walk has already passed — never a duplicate; new/
hoisted rows are invisible to the forward walk _by design_ and are exactly
what the head refresh repairs within ≤ 2 s. Under user sorts, the only keyset
duplicate case is a sort-key edit crossing the cursor downward — absorbed by
ID-dedup; upward crossings are omissions-until-refresh. Hybrid
offset+overlap converts duplicates to silence but cannot repair omissions —
rejected. **Ruling: keyset continuation + head-anchored refresh + client
ID-dedup.** Explicit prev/next pages and random jumps are OUT for D1;
`offset` stays in the API for existing callers.

**Cursor encoding** — opaque to the client, transparent to the server:
base64url of `{ v, fp, key: [raw sort key values…], id }` where

- `fp` is a fingerprint of the canonical query (filters, ordered sort,
  namespace, sourceType, window bounds, pinned `now`). The server recomputes
  `fp` from the request's own parameters and rejects a mismatch with 400
  `continuation-invalid` — a cursor can never smuggle its own query;
- `key` holds **raw stored values** (ISO text verbatim; confidence as a
  full-precision number, cast `::real` in Postgres comparisons so float4
  equality is exact);
- **pinned `now`**: the first window of a generation pins the expiry cutoff;
  continuations of that generation reuse it (it participates in `fp`); each
  head refresh starts a new generation with a fresh `now`. Rows expiring
  mid-generation are ordinary concurrent deletes, repaired by refresh.

**WHERE construction**: row-value comparisons cannot express mixed asc/desc,
so the server builds the expanded OR-chain with a **redundant leading range
guard** — e.g. for the default order:

```sql
AND updated_at <= $u
AND (updated_at < $u OR (updated_at = $u AND id > $i))   -- pg: id COLLATE "C"
ORDER BY updated_at DESC, id ASC LIMIT $k
```

The guard is not optional: measured 0.54 ms (SEARCH) with it vs 2.51 ms at
100k / 22.8 ms at 1M (full index scan) without. General n-key form: guard on
the first key (`<=` DESC / `>=` ASC), nested OR-chain with per-key direction
operators, `id` always last.

**What invalidates a continuation**: any dataset-identity change (any filter,
sort, namespace, window-bound change). The continuation, loaded records, and
displayed total are dropped together — they belong to the dead identity
(D1-DATA-03). Not invalidating: poll refreshes (same identity, new
generation), selection/focus/column-layout changes. Every fulfilled response
computes its continuation from its own last row; the client always continues
from the _newest_ fulfilled response's token, never a remembered one.

### 6.3 Head-anchored refresh and reconciliation (D1-DATA-05, D1-GRID-08)

Every poll tick (2 s, visible-tab, live-toggle — cadence unchanged) for the
current dataset identity: fetch the offset-0 window with `limit = resident
count`. This is always expressible in one request because **the resident cap
equals the maximum request limit (1 000, §11)** — the refresh can re-derive
the entire resident span in a single snapshot, which is what makes the
convergence guarantee arithmetic, not aspiration. Fresh generation, fresh
`now`. **Pause/resume**: while polling is paused (live off, tab hidden, or
`error` with nothing loaded — §6.4) the convergence guarantee is suspended
and the status chrome shows an as-of indicator ("updated 14:32:07") instead
of claiming freshness; resuming (live on, tab visible again, successful
retry) fires an immediate refresh tick. Reconcile against loaded records,
where B = last row of the response:

1. Index response rows by ID. Any resident row whose ID appears takes the
   response's payload **and position** (handles hoists into the head span and
   payload staleness in one rule). Pretable's ID-keyed `setRows` preserves
   selection/focus/heights across this — the reason replace-in-place is cheap.
2. Resident rows inside the refreshed span (sort tuple ≤ tuple(B)) but absent
   from the response: deleted or moved out → **drop**. (A row whose sort-key
   edit moved it beyond the span reappears via load-more.)
3. Resident rows beyond the refreshed span (tuple > tuple(B) — head inserts
   pushed coverage up): **retain as possibly-stale tail**; never evict rows
   from under the user because inserts arrived; the next tick's larger
   `limit` re-covers them.

Rules 2–3 compare sort tuples client-side; the comparator is pinned:
UTF-16 code-unit string comparison plus numeric compare for `confidence` —
safe because every sortable field is ASCII-uniform under the format-uniformity
invariant (§5.4), so code-unit order equals the server's byte order.

Load-more appends `dedupeById(prev, page.records)` — the belt-and-suspenders
for the one keyset duplicate case — and updates `total`/`continuation` from
the response. Documented residual (the consistency model's "acceptable skew"):
between polls, loaded rows can be ≤ 2 s stale, hoisted/inserted rows ≤ 2 s
invisible, and under user sorts a moved row can be transiently mispositioned —
all bounded by one poll period + response latency, and all _visible-state_
errors, never silent permanent omissions.

### 6.4 Failure and retry (D1-DATA-06, D1-UX-01/03)

Failures are recorded per request kind against the revision that failed.
Initial and query-change failures (nothing fulfilled for the desired
revision) → `error` phase: Pretable renders and announces the failure (error
block, or the status strip over still-visible older-revision rows); Dawn
supplies only the retry control through the body-state slot, not a second
banner — **and polling suspends until `retry()` succeeds**, so the error
presentation does not flicker on a 2 s cadence. Refresh or load-more failure
with the desired revision fulfilled → rows stay usable; the phase stays
`idle`; the failure surfaces in Dawn's banner. The banner uses **per-kind
slots** — one independent slot per request kind (refresh, load-more,
mutation), the same pattern as the Inspector's existing per-source error
slots — so one kind's success can never clear another kind's failure. A
succeeding poll tick clears the _refresh_ slot; a load-more slot clears only
on retry or a succeeding load-more. `retry()` re-attempts the failed kind
under the _current_ desired revision — if the query moved on, the retry is
simply the new query's initial fetch. Message-equality suppression prevents
banner re-announcement on repeated failing ticks. Columns are never rebuilt
on retry; grid state is untouched.

---

## 7. State-flow analysis (the twelve required flows)

Vocabulary per the handoff. Common legend: **DQR** = desired query revision,
**FRR** = fulfilled result revision, **DK** = `datasetKey`. Source of truth
for query state is always `useMemoryBrowse`; for interaction state (selection,
focus, expansion, layout) always the Pretable engine; for lifecycle always the
`dataState` prop derived from DQR/FRR.

**The lifecycle machine** (state × event → next state / actions). Every flow
below is a path through this table; per-flow prose adds the
focus/selection/announcement specifics.

| State          | Event                                   | Next                                                  | Actions                                                              |
| -------------- | --------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------- |
| any            | query change (DQR++, DK′)               | `stale` (rows loaded) / `loading` (none)              | abort in-flight; drop continuation; fetch(initial, DQR)              |
| `loading`      | response, rev = DQR                     | `idle`                                                | apply rows+meta (one emit); announce results                         |
| `loading`      | response, rev < DQR                     | _(same)_                                              | discard whole (Flow 6)                                               |
| `loading`      | failure, rev = DQR                      | `error`                                               | error block + banner; **suspend polling**                            |
| `error`        | `retry()`                               | `loading`                                             | fetch(initial, DQR); resume polling on success                       |
| `idle`         | poll tick due (live ∧ visible)          | `refreshing`                                          | fetch(refresh, DQR, limit = resident)                                |
| `refreshing`   | response, rev = DQR                     | `idle`                                                | reconcile §6.3; silent unless changed                                |
| `refreshing`   | failure, rev = DQR                      | `idle`                                                | refresh banner slot; rows untouched                                  |
| `refreshing`   | `loadMore()`                            | `refreshing`                                          | **queue** load-more; run on settle                                   |
| `idle`         | `loadMore()` (continuation ∧ under cap) | `loading-more`                                        | fetch(load-more, DQR, cursor)                                        |
| `loading-more` | poll tick due                           | `loading-more`                                        | **skip** tick (next covers it)                                       |
| `loading-more` | response, rev = DQR                     | `idle`                                                | dedupe-append; announce with `added`                                 |
| `loading-more` | failure, rev = DQR                      | `idle`                                                | load-more banner slot; rows untouched                                |
| `stale`        | response, rev = DQR                     | `idle`                                                | apply rows+meta; DK′ clears selection/focus/scroll; announce results |
| `stale`        | failure, rev = DQR                      | `error` (nothing fulfilled for DQR… rows are FRR<DQR) | banner; rows stay visibly stale; retry re-arms                       |
| any            | live off / tab hidden                   | _(same)_                                              | pause ticks; as-of indicator (§6.3)                                  |
| any            | live on / visible / unmount-guard       | _(same)_                                              | immediate tick on resume; post-unmount resolutions ignored           |

**Flow 1 — initial browse load.** Mount: DQR=1, FRR=0, no rows →
`dataState={phase:"loading"}`; grid renders loading block (no aria-busy).
Fetch (kind=initial, rev 1) → txn snapshot response {records, total,
continuation} → still desired → apply: FRR=1, `setRows(rows, {total, DK})` in
one emit; phase `idle`; `resultsAnnouncement("Loaded 200 of 5,432")`.
Focus/selection: none to preserve. Failure path → Flow 7.

**Flow 2 — apply/change/clear a filter.** User opens funnel (native
Pretable UI), edits → engine filter state changes → `onFiltersChange(full
map)` → normalize → new canonical query → DQR=2, DK'≠DK. In-flight requests
aborted; phase `stale` (rows still shown, FRR=1, visibly marked via
`data-pretable-data-phase` + "Updating results…" announcement). Funnel shows
desired state (engine state = display state; no double application — filter
authority external). Response for rev 2 → `setRows(newRows, {total', DK'})` →
engine clears selection/focus/expansion (DK change), surface scrolls to top
and applies the DK-change focus rule (§4.2: first data cell if focus was in
the grid, never `<body>`); phase `idle`; results announcement. Clearing a filter is the same flow (the
cleared map is a new canonical query). A stray rev-1 response resolving late
is discarded (revision gate).

**Flow 3 — change an ordered sort.** Header click/shift-click → engine sort
state changes (display only; model order untouched — sort authority
external) → `onSortChange(entries)` → DQR bump, DK change → same as Flow 2.
Note the honest intermediate state: between click and fulfillment the rows
remain in the _old_ order while the header shows the _desired_ sort — plus
the stale marking. This is deliberate: re-sorting the stale window locally
would present a recency-biased sample as a confidence-sorted result (the
Approach-A defect). Clearing sort restores the documented default order
(§5.4).

**Flow 4 — desired query B while fulfilled query A visible.** Covered by
Flows 2/3: phase `stale`, rows dimmed via the data-phase attribute, status
chrome shows "Updating…", controls show B (desired), rows/total/continuation
all still tagged FRR=A. The UI never presents A's records as answering B
(D1-DATA-01); selection over A's rows remains valid _for A_ and is cleared
exactly when B fulfills (DK change) — never mid-flight.

**Flow 5 — next result window.** `loadMore()` (footer control after the
grid): guard (continuation≠null ∧ resident < cap) → if a poll tick is in
flight, the load-more is queued and runs on settle (arbitration, §6.1);
otherwise phase `loading-more` immediately; a tick coming due mid-load-more
is skipped. Fetch (kind=load-more, same DQR, cursor = newest fulfilled
continuation) → response → still desired → `setRows(dedupeById(prev ++
page), {total', DK})` — DK unchanged → selection/focus/heights preserved,
no scroll movement; phase `idle`; `resultsAnnouncement` with `added`:
"Loaded 200 more. 400 of 5,432 loaded." Boundary announcement fires if the
user hits the last loaded row while more exist.

**Flow 6 — stale request completing after query change.** Rev-N response
resolves while DQR=M>N → revision gate discards it entirely (records, total,
continuation). Abort usually prevents this; the gate makes it harmless when
abort loses the race. No state transitions occur; no announcement.

**Flow 7 — initial failure and retry.** Fetch rejects (non-abort) with
FRR=0 → phase `error` (body block, message; consumer banner + retry button
above the grid). Focus is never stolen (role=alert announces). `retry()` →
phase `loading` → Flow 1. Columns and grid instance persist throughout.

**Flow 8 — refresh/next-window failure and retry.** Failure with fulfilled
rows: rows remain usable and interactive; per-source banner appears; the
failed kind is recorded against its revision; poll ticks continue (a
succeeding tick clears the _refresh_ banner via message-equality rules;
a load-more banner clears only via retry/success). Retry re-attempts the
failed kind at the current DQR. A retry can never re-apply a completed
append: continuation tokens are consumed only on success, and dedupeById
absorbs the overlap if a response was applied but the client failed before
acknowledging.

**Flow 9 — polling that inserts, moves, updates, or removes a row.** Tick →
kind=refresh at current DQR/DK, `limit = resident count`, new generation →
reconciliation rules §6.3: updated rows take new payload+position; vanished
rows drop (engine prunes their selection entries; focus repaired
survivor-else-clamped-index + `focusedRowRemovedAnnouncement`); inserted/
hoisted rows appear at their true positions; beyond-span residents retained
stale. Phase `refreshing` during flight — rows never dim (it is the same
query); silent on no-change; results announcement only when the row set or
total changed. Scroll _offset_ is untouched; when a tick inserts or hoists
rows above the viewport, content shifts under that static offset — the
accepted, documented D1 behavior (no anchoring exists or is added; §8.1,
decision 8). Row heights preserved by ID.

**Flow 10 — switching browse ⇄ search or timeline.** View switch does not
destroy the browse dataset, and the mechanism is named: `useMemoryBrowse`
lives in `ListPage` (above the view branch), so rows/FRR/continuation
survive any view, and the browse `MemoryGrid` stays **mounted but hidden**
across view switches (today the Inspector conditionally unmounts it, which
would destroy the engine-owned selection/focus/heights — that changes).
In-flight responses land in the hook regardless of the active view; hook
unmount (leaving the page entirely) aborts in-flight work and ignores
post-unmount resolutions. Search and timeline never inherit the browse
continuation (different dataset identities; the view is part of the
canonical query). Browse-only controls are disabled-with-reason in those
views (§8.2) — never rendered active-but-ignored. Returning to browse
resumes polling with an immediate `refreshing` tick against the retained
identity.

**Flow 11 — select records, change windows, run a bulk action.** Selection
lives in the engine (ranges keyed by row ID), mirrored out via
`onRowSelectionChange`. Load-more append preserves it (ID-keyed; dedupe
prevents duplicate IDs, so no duplicate selection entries — D1-SELECT-03).
Refresh that removes a selected row prunes exactly that entry (engine
reconciliation — a vanished ID is never silently actionable,
D1-SELECT-02). Bulk action: the bulk bar is disabled during `stale` (acting on rows a new
query is about to replace is the ambiguity D1 bans); confirmation names count
and scope ("Forget 12 selected memories?") and **snapshots the ID list at
confirmation** — the run proceeds against exactly those IDs even if the grid
updates beneath (per-ID mutations are safe by construction; a row deleted
meanwhile 404s into the per-ID error list). **Polling pauses for the duration
of the bulk run** (sequential per-ID POSTs, existing and race-deliberate) and
a single `refresh()` fires on completion. On completion, **succeeded IDs are
removed from the selection** and only failures remain selected with the
per-ID error list — so re-running the bulk action retries failures only and
can never repeat a completed destructive action (D1-SELECT-04). The
completion refresh reconciles the grid (deleted rows leave; approved rows
change status in place). DK is unchanged by bulk recovery, so surviving
selection is preserved deliberately.

**Flow 12 — namespace grouping prototype on a partial dataset.** If enabled
(controlled `state.rowGroups=["namespace"]` per the prototype branch):
engine groups the _loaded_ records; ARIA downgrades to loaded-model counts
(§4.5); group `childCount` renders through the `groupChildCountLabel`
message with `scope: "loaded"` (§4.3) — default "12 loaded", a
loaded-children count that makes no claim about the population; the results
announcement still carries the matching total. The panel/menu grouping affordances remain
functional. Remote/global group counts are EXT (seam: EXT-COUNT-04); the
prototype must adopt the loaded-only labeling or stay unmerged
(D1-COUNT-04).

---

## 8. Ownership matrix and view-scope matrix

### 8.1 Ownership matrix (required constraints satisfied)

| State / responsibility                              | Owner                                                                                                                                                                                                                                                                 | How the constraint is met                                                                                                         |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Column interaction + displayed filter/sort state    | Pretable engine (display state) + built-in react controls                                                                                                                                                                                                             | Mutators and menus work identically through pending/failed requests; authority flags only change _application_, never interaction |
| Domain field/operator semantics                     | Dawn: `@dawn-ai/memory` validator + stores; Inspector column config (`type`, `options`, `filterOperators`)                                                                                                                                                            | Pretable never infers semantics; `toBrowseQuery` is Inspector code                                                                |
| Desired query revision                              | Dawn: `useMemoryBrowse` (single source of truth)                                                                                                                                                                                                                      | Controls mirror through engine display state; the hook owns the canonical query + revision counter                                |
| Fulfilled result revision                           | Dawn: `useMemoryBrowse`                                                                                                                                                                                                                                               | Records/total/continuation/DK stored together, revision-tagged                                                                    |
| Request creation, cancellation, stale suppression   | Dawn: `useMemoryBrowse`                                                                                                                                                                                                                                               | Outside the transport-agnostic grid core, per D1-GRID-05; revision gate is the correctness mechanism, abort the optimization      |
| Loaded record cache + deduplication                 | Dawn: `useMemoryBrowse` (one owner)                                                                                                                                                                                                                                   | Engine renders the array it is handed; dedupeById at append; reconciliation at refresh                                            |
| Continuation token + availability                   | Dawn holds it; the server mints/validates it                                                                                                                                                                                                                          | Pretable never sees it; `loadMore` guard consumes `continuation !== null`                                                         |
| Matching total + freshness                          | Backend result contract (`BrowsePage.total`, snapshot-consistent) → `resultMeta.total`                                                                                                                                                                                | Pretable displays; never computes remote totals                                                                                   |
| Loading and error state                             | Orchestration: Dawn (`dataState` derivation). Rendering: Pretable body blocks + announcements; Dawn banners + retry controls                                                                                                                                          | Both owners named; one channel per event (§4.5)                                                                                   |
| Focus, selection, measured heights, group expansion | Pretable engine/surface (existing guarantees)                                                                                                                                                                                                                         | Preserved across same-DK replace/append; cleared on DK change; heights ID-keyed React state                                       |
| Off-window selection                                | Deferred (EXT-SELECT-01)                                                                                                                                                                                                                                              | Engine prunes vanished IDs; no component infers selection from absent rows; if Dawn ever retains it, Dawn owns and displays it    |
| Scroll anchoring / restoration                      | D1: surface resets to top on DK change; otherwise the scroll _offset_ is untouched and **content may shift when a poll inserts/hoists rows above the viewport** — no anchoring exists or is added in D1; the shift is accepted, documented behavior (decision 8, §15) | Future eviction/anchoring owner: the EXT bounded-window design (engine-coordinated, per the Approach-C analysis)                  |

### 8.2 View-scope matrix (D1 binding; EXT decided or deferred)

| View               | D1 behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Extension question (disposition)                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary browse    | Server-authoritative filters, ordered sort, exact snapshot total, keyset load-more; full-external ungrouped ARIA semantics                                                                                                                                                                                                                                                                                                                                        | Richer totals (`estimate`/`unknown` already typed — EXT); auto near-end load (EXT-GRID-01, telemetry seam)                                                           |
| Ranked search      | Existing relevance behavior unchanged. **Fix shipped dishonesty**: status/kind selects and any browse-only filter controls are disabled while a query is active — the concrete pattern is `aria-disabled="true"` + still focusable + `aria-describedby` → "Not applied to search" text, so keyboard/AT users can _discover why_ (a `disabled` attribute would remove them from the tab order and hide the reason); namespace facet remains active (it does apply) | Which filters compose into search; totals/continuation for search; alternate sort (EXT-QUERY-01 — deferred, seam: search becomes a second dataset identity family)   |
| Timeline           | Remains separately scoped; keeps its own fetch; never inherits browse continuation or DK; its client-side event-time re-sort is _known-dishonest_ and documented as such pending EXT-QUERY-02 (it is not made worse by D1; browse controls that don't apply are disabled as in search)                                                                                                                                                                            | Server event-time order + paging (EXT-QUERY-02 — deferred; the cursor design already handles `COALESCE(effective_at, created_at)` as a NOT-NULL-by-construction key) |
| Facet rail         | Counts stay global and are **labeled global** ("all memories"), satisfying honesty by labeling; selecting a namespace sends the _exact_ `namespace` param (deleting the client-side narrowing)                                                                                                                                                                                                                                                                    | Query-aware/self-excluding counts, cardinality bounds (EXT-COUNT-01..03 — deferred)                                                                                  |
| Namespace grouping | Not baseline. If the prototype ships: loaded-only labeling + ARIA downgrade per Flow 12                                                                                                                                                                                                                                                                                                                                                                           | Remote groups, global counts, partial children (EXT-COUNT-04/EXT-GRID-02 — deferred)                                                                                 |

---

## 9. Consolidated interaction semantics

### 9.1 Lifecycle and honesty (D1-UX-01..03, D1-A11Y-01)

The six distinguishable presentations and their construction: initial loading
(loading block), background refresh (data-phase attribute only, silent),
next-window load (footer control busy + phase), filtered-empty vs
unfiltered-empty (both are `idle`+0 loaded; the _copy_ differs — the consumer
knows whether filters are active and supplies the message; Dawn: "No memories
match the current filters" vs "No memories yet"), failure-with-rows (banner +
intact rows), failure-without-rows (error block). A failed refresh or append
never discards fulfilled records (D1-UX-01). Stale presentation: rows dimmed
via the data-phase hook + "Updating results…" announcement + status chrome
showing desired-vs-fulfilled — old records are never presentable as answering
the new query (D1-UX-02). Retry never rebuilds columns or recreates the grid
(D1-UX-03).

### 9.2 Keyboard topology (D1-A11Y-04)

Tab order: error banner (retry, when present) → header controls (funnels,
column menus, select-all) → grid body (single entry stop, roving tabindex) →
load-more footer control → rest of page. The load-more control lives _outside_
the scroll viewport because the viewport is the `role="grid"` element (a loose
button corrupts the grid's owned children), virtualization can unmount
focused in-viewport nodes, and a windowed control would move on every append.
It stays mounted on completion (relabeled "All 5,432 loaded" / disabled) so
focus never drops to `<body>`. Discovery for keyboard/AT users: the
rowcount gap ("row 201 of 5,433"), the numbers in the control label, the
boundary announcement, and the load-completion announcement. Every D1
operation — filters, sort, load-more, retry, selection, bulk actions,
reaching content after the grid — is operable by keyboard; the pre-existing
pointer-only gaps (column resize/reorder) are out of D1 scope and recorded in
§1.1.

### 9.3 Selection and bulk safety (D1-SELECT-01..04)

Scope: the header checkbox and Cmd/Ctrl+A operate on loaded/model rows only,
and _say so_ (`selectAllLabel`, scoped announcements, scoped copy
announcement). Query changes (DK change) clear selection; same-DK refresh/
append preserve it for surviving IDs; deduplication precedes the engine so
duplicate selections cannot form. Bulk mutations keep the existing
sequential-by-design per-ID protocol and confirmation dialogs naming count +
scope; partial success prunes succeeded IDs from the selection so retry
re-attempts failures only — a retry cannot repeat a completed destructive
action. Stale selected IDs (row deleted server-side between refreshes) 404
individually and surface in the per-ID error list; the next refresh prunes
them from the grid and selection.

### 9.4 Grouping honesty (D1-COUNT-04, EXT-GRID-02 seam)

Engine grouping over a partial window is permitted but _marked_: ARIA
downgrade (§4.5), `childCount` rendered through `groupChildCountLabel` with
`scope: "loaded"` (§4.3), and aggregate cells (`formatAggregate`) receive a
`scope: "loaded" | "all"` input so a sum over 200 loaded rows is never
presentable as a population sum. Local mode (`processing` absent) always
passes `scope: "all"` — no behavior change. One pre-existing subtlety carried
forward unchanged: select-all targets _expanded_ data rows (children of
collapsed groups are excluded, today's local behavior) — the scoped labels
use counts rather than the word "all", so they stay truthful under grouping.

### 9.5 Live refresh semantics (D1-DATA-05, EXT-DATA-02 seam)

Polling reuses the full desired/fulfilled machinery — a poll response is
discarded by the same revision gate as any other (D1-DATA-05); reconciliation
is §6.3. The EXT push path (SSE/stream) plugs in at exactly one point: a
push notification schedules the same `refresh()` the poll timer schedules —
same identity rules, same reconciliation, same announcements. Nothing else
changes; that is the whole seam (EXT-DATA-02).

---

## 10. Compatibility and public-contract migration

### 10.1 Pretable (D1-GRID-04 mechanics)

Every new input is optional and inert by default: `processing` defaults to
engine/engine with identity-same state objects (derivation caches stay warm);
`setRows` meta absent → no DK → no clearing; `dataState` absent → lifecycle
presentation entirely off; `matchingTotal` in local mode equals today's
implicit exact count; announcement-arg widenings are additive (existing
message functions ignore extra keys). The local-mode regression suite (§12.1)
pins this, and the named existing tests (multi-sort surface, filter-menu
surface, streaming preservation, ARIA rowcount) run unmodified.

Breaking renames, deliberate and alias-free (pre-1.0 policy):
`PretableGridSnapshot.totalRowCount → loadedRowCount`,
`PretableTelemetry.totalRowCount → loadedRowCount` — the old name becomes
actively wrong the day two totals exist. Mechanical migration in
apps/website + bench. The `@experimental` tag on `state` stays until the
dogfood completes, then `state` and the new surface promote together.
Estimated api-report delta: ~10 entries in core.api.md (including the
`PretableAggregateFormatInput.scope` widening), ~17 in react.api.md
(including `groupChildCountLabel` and the widened `resultsAnnouncement`),
regenerated under the required `api:check` gate; build before `api`.

### 10.2 Dawn

`@pretable/*` pin advances 0.0.8 → the release carrying this work (0.0.9
delta is grouping-only and inert for the Inspector). Public contract changes
per §5.7 (memory barrel additions, named core mirror types, pgvector update,
conformance extensions, one minor changeset with implementor note). The
Inspector HTTP contract grows validated params; `includeExpired` and the
mutation routes are unchanged. `usePolling` remains for stats; the list
fetch moves to `useMemoryBrowse`.

---

## 11. Performance and resource budgets (proposed for approval — D1-PERF-01/02)

Baselines: server figures measured against Dawn's exact DDL on Apple-Silicon
SQLite (in-memory, 100k/1M rows; scripts preserved and rerunnable); Postgres
figures are estimates pending the conformance-container bench. Client figures
to be measured by the new bench scripts (§12.3) before implementation is
declared complete; the numbers below are the acceptance ceilings proposed for
approval, not aspirations.

| Budget                                                                      | Proposed value                                                                                                                                                                                                                                       | Grounding                                                                              |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Target dataset size (D1 validated)                                          | 100 000 records (design headroom demonstrated to 1M on the default order)                                                                                                                                                                            | measured §5.5                                                                          |
| Default window / page size                                                  | 200 records                                                                                                                                                                                                                                          | current Inspector fetch size                                                           |
| Maximum request `limit`                                                     | 1 000, **route-enforced only** (in-process callers like distillation's 10 000-row scan are exempt — §5.3)                                                                                                                                            | closes the unbounded-limit hole on the network boundary without breaking consolidation |
| Resident-record cap (client)                                                | **1 000 records (5 pages) — deliberately equal to the max request limit**, so a single head refresh always covers the whole resident span and the convergence guarantee stays arithmetic (§6.3); load-more disables at cap with an explanatory label | ≈ 2 MB at ~2 kB/record; EXT-PERF-01 owns growth beyond                                 |
| Client memory                                                               | grid-attributable heap ≤ 32 MB at the resident cap during steady polling (rows + heights cache + React/DOM overhead)                                                                                                                                 | measured via heap snapshot in the bench lane                                           |
| Request concurrency                                                         | 1 browse request in flight per view + 1 stats poll                                                                                                                                                                                                   | single-flight design §6.1                                                              |
| Server: windowed fetch (default order, keyset)                              | p95 < 10 ms @100k SQLite; < 30 ms Postgres-local                                                                                                                                                                                                     | measured 0.54 ms; margin for real payloads                                             |
| Server: filtered `COUNT(*)`                                                 | p95 < 25 ms @100k SQLite; < 100 ms Postgres                                                                                                                                                                                                          | measured 5.1 ms                                                                        |
| Server: head refresh (rows+count, one txn, resident=1000)                   | p95 < 50 ms @100k                                                                                                                                                                                                                                    | measured ~3–8 ms + decode                                                              |
| Server: non-default sort window                                             | p95 < 50 ms @100k (accepted scan)                                                                                                                                                                                                                    | measured 12.6 ms                                                                       |
| Server: content contains                                                    | p95 < 150 ms @100k (accepted scan; FTS is EXT)                                                                                                                                                                                                       | measured 46 ms rare-term worst case                                                    |
| End-to-end interaction (filter/sort click → fulfilled render, local server) | p95 < 300 ms                                                                                                                                                                                                                                         | sum of budgets + fetch overhead; verified in e2e                                       |
| Client: replace (refresh, 200 rows)                                         | < 20 ms grid work, no grid reconstruction                                                                                                                                                                                                            | new bench script; stable-instance assertion                                            |
| Client: append (200 onto 1 800)                                             | < 30 ms grid work; zero scroll movement; heights cache hit for unchanged rows                                                                                                                                                                        | new bench script (replace and append measured separately per D1-PERF-04)               |
| Poll tick, no changes                                                       | < 10 ms client CPU; zero announcements                                                                                                                                                                                                               | silent-refresh rule                                                                    |
| Refresh cadence                                                             | 2 s visible-tab (unchanged); documented EXT trigger: back off to 10 s under non-default sort beyond ~1M rows, where a refresh tick costs ≈ 150 ms (sort-window scan ≈ 101 ms + count ≈ 53 ms)                                                        | measured §5.5                                                                          |

Benchmark method: server budgets via a seeded-store script per backend
(SQLite in-process; Postgres via the existing testcontainers gate); client
budgets via a new `bench-runner` script pair (`replace`, `append`) reusing the
existing `interaction_latency_ms` marks and CDP slicing
(`--window=interaction`); end-to-end via Playwright against the standalone
Inspector server.

---

## 12. Test and browser-verification strategy

### 12.1 Pretable

- **Engine external-mode tests** (grid-core): per-authority derivation table
  (§4.2) including the four flag combinations; mutators emit display state
  without application; `matchingTotal` computation and precedence rules;
  `datasetKey` clear semantics vs same-key preservation; `setResultMeta`;
  `setRows(concat)` preservation under append; dev-warning conditions
  (supplied total under engine filter; enum distinct-values fallback;
  engine-sort-over-partial-window).
- **Local-mode regression suite** (D1-GRID-04): the existing named tests run
  unmodified — grid-core filter operators / multi-sort / set-rows suites,
  react multi-sort-surface, filter-menu-surface, streaming preservation,
  and the ARIA pin "counts only currently visible filtered rows plus the
  header" — plus new tests asserting a default-constructed grid's snapshot
  is byte-identical pre/post change.
- **React surface tests**: `aria-rowcount`/`aria-rowindex` per §4.5 including
  every downgrade; no `aria-busy` anywhere on the grid in any phase;
  body-state matrix (§4.4) including the no-`dataState` inertness; scoped
  select-all label/announcement and scoped copy announcement;
  `focusedRowRemovedAnnouncement` fires only on data-driven replacement;
  boundary announcement; announcement single-channel rules; focus continuity
  per Flow 2/9 (DK reset path, survivor path, clamp path).
- **Callback-loop prevention** (D1-GRID-09): controlled-state round-trip
  tests under external authority (state in → callback out → same state in =
  no emit; poll-driven `setRows` does not re-fire `onFiltersChange`/
  `onSortChange`; telemetry effect fires once per change).
- **Bench**: new `replace` and `append` bench scripts (bench-runner
  vocabulary + Pretable adapter hook), asserted against §11 budgets in CI's
  bench lane.

### 12.2 Dawn

- **Validator tests**: every `BrowseFilter` arm × valid/invalid/oversized;
  unknown field/op/dir; empty value lists; malformed cursors (bad base64,
  bad version, fingerprint mismatch); limit clamping.
- **Conformance suite extensions** (SQLite always, Postgres gated, identical
  assertions): every filter op's semantics (ASCII case rules, byte-exact
  namespace, inclusive bounds, UTC day buckets); deterministic multi-sort
  with tied values and mixed-case IDs; keyset window walks (with-guard plans
  return identical ordered IDs both backends); cursor round-trip including
  float4; snapshot rows+total under concurrent writes (insert/hoist/delete
  between statements — must be impossible inside one response); expiry
  generation pinning; validation rejections.
- **Orchestration unit tests** (`useMemoryBrowse` with injected fetch/clock):
  revision gating (Flow 6), abort-loses-the-race, single-flight plus the
  arbitration policy (queued load-more runs on tick settle; tick due
  mid-load-more is skipped), phase derivation table (§7), reconciliation
  rules 1–3 (§6.3) including beyond-span retention, dedupe on append,
  failure/retry per kind, error-suspends-polling and resume-tick behavior,
  live-toggle/tab-hidden pause with as-of presentation, unmount-mid-flight,
  cap behavior.
- **Component tests**: Flows 1–12 as React tests over a fake server;
  selection pruning on refresh; bulk partial-failure → selection = failures
  only → retry re-sends failures only; search-view control disabling;
  facet-exact-namespace round trip (total matches rows).
- **E2E (Playwright, standalone Inspector server, seeded > 1 window)**: the
  fourteen dogfood acceptance scenarios from the requirements handoff, each
  as a named spec; scroll stability asserted where the design guarantees it —
  zero scroll-offset movement on no-change ticks and on append (a tick that
  inserts rows above the viewport legitimately shifts content; that case
  asserts offset stability only); view-switch state retention (Flow 10);
  keyboard-only walkthrough; console-error gate.
- **Browser walkthrough** (manual, recorded): one real screen-reader pass
  (VoiceOver) covering busy/count/position/stale/error/retry states.

---

## 13. Incremental delivery slices

Each slice is independently reviewable and leaves both repos green; the
handoff's suggested order is adopted with one change — slices 1 and 2 have no
mutual dependency and run in parallel.

1. **Pretable primitives** (pretable repo): `processing`, `resultMeta`/
   `setResultMeta`/`datasetKey`, `dataState` + body states, ARIA/labeling/
   announcement rules, renames, local-mode regression coverage, engine +
   surface tests. Ships behind `@experimental` tags.
2. **Dawn query contract** (dawn repo, parallel with 1): `BrowseQuery`
   extension, validator, both store implementations (txn totals, keyset,
   sargable prefix, new index/migration), named core mirror types,
   conformance extensions, changeset.
3. **Orchestration + lifecycle UI** (dawn): `useMemoryBrowse` (revisions,
   staleness, continuation, reconciliation), lifecycle chrome (banners,
   retry, status bar), unit + component tests. Depends on 1 + 2.
4. **Inspector integration**: typed columns + `filterOperators`, external
   authority wiring, exact-namespace facet, total display, load-more
   control, `gridEpoch` deletion, view-scope fixes (search selects
   disabled), Flows 1–11 component tests. Depends on 3.
5. **Verification hardening**: a11y polish, bulk-retry selection semantics,
   polling-identity tests, bench scripts + budget assertions, e2e scenario
   suite, browser walkthrough. Depends on 4; D1 is complete when this lands.
6. **EXT work** (each separately approved): query-aware facets, server
   timeline, then the remainder per §15.

---

## 14. Risks, rejected alternatives, unresolved questions

**Risks, priced:**

1. _Split-brain authority tax_ — every future derivation-adjacent feature
   must answer "which authority?" forever. Accepted as the cost of granular
   honesty; the options-object shape keeps future keys (e.g.
   `processing.group`) additive.
2. _Delegated honesty_ — Pretable renders `dataState`/`resultMeta` it cannot
   validate; a lying consumer renders lies. Mitigated by dev-warnings on
   detectable contradictions and by the reference requester being specified
   normatively (§6) rather than as a loose recipe; structurally solved only
   by Approach C, deferred.
3. _API lock-in before evidence_ — mitigated by `@experimental` tags through
   the dogfood and the pre-1.0 rename policy.
4. _Keyset complexity in the stores_ — the OR-chain + guard + cursor
   validation is the hardest new store code; contained by the conformance
   suite and the measured plans.
5. _Postgres estimates_ — server budgets for Postgres are estimates until the
   container bench runs in slice 2; budgets may need one revision.

**Rejected alternatives** (with reasons recorded in-line above): Approach A
(§3.1); Approach C now (§3.2 — flip condition: a second remote-data consumer
with a committed timeline _plus_ any of eviction/auto-near-end/push moving
from EXT to the committed roadmap; at that point building C once beats
migrating twice); `COUNT(*) OVER ()` totals (§5.6); offset
paging and offset+overlap hybrids (§6.2); `aria-busy` on the grid (§4.5);
synthetic loading/load-more rows in the row model (§4.4); an `appendRows`
engine method (§4.2); `aria-rowcount` from loaded count under exact totals
(§4.5); a Dawn-side custom filter bar (§3.1); estimated totals through
`aria-rowcount` (§4.5).

**Unresolved questions for the reviewer** (none block the architecture; each
has a default that implementation will follow absent contrary direction):

1. Non-ASCII case folding for `content` filters: accept the documented
   backend divergence (default), or require a normalized lowercase column in
   D1?
2. Should the Inspector's `content` column be sortable? Default: no
   (`sortable: false`) — byte-order text sorting is rarely meaningful and
   every other column is; the whitelist supports it if wanted later.
3. Resident cap 1 000: right number? (Product judgment, with one design
   constraint: the cap must not exceed the maximum request limit, or the
   single-request head refresh — and with it the convergence guarantee —
   breaks. Raising both together is fine.)
4. Timeline in D1 keeps its known event-time dishonesty (documented,
   unchanged) — confirm that deferring EXT-QUERY-02 is acceptable rather
   than hiding the timeline view.

---

## 15. Open-decision resolutions and EXT dispositions

The twelve open architecture decisions from the handoff, resolved: (1)
boundary = B-core hybrid (§3); (2) granular per-operation authority (§4.1);
(3) desired/fulfilled state Dawn-side, result metadata in the engine snapshot
(§6.1/§4.1); (4) navigation = keyset load-more (§6.2); (5) consistency =
per-response snapshot + ≤ 2 s convergence (§5.6); (6) lifecycle rendering
split Pretable-blocks/Dawn-chrome (§4.4, §9.1); (7) selection
clearing/retention + failures-only bulk retry (§9.3); (8) scroll: reset to
top on DK change; otherwise the scroll _offset_ is never moved — and D1
explicitly **accepts content shift** when a poll inserts or hoists rows above
the viewport (no anchoring exists or is added; the audit's finding stands);
anchoring belongs to the EXT bounded-window owner (§8.1); (9) Dawn query shape + additive public strategy (§5);
(10) budgets (§11); (11) ARIA semantics for the chosen window model (§4.5);
(12) EXT seams needing shape now: the non-exact total variants,
`datasetKey`, the continuation fingerprint/generation design, and telemetry's
`visibleRowRange` — all typed/designed in D1; everything else is a documented
constraint.

Every EXT requirement's disposition:

| EXT                                 | Disposition                                                                                                                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EXT-GRID-01 end-of-window signal    | Deferred. Existing telemetry (`visibleRowRange` + `renderedRowCount` + `loadedRowCount`) is sufficient for a future trigger; a dedicated event is not warranted yet.                               |
| EXT-GRID-02 partial grouping        | Seam shipped in D1: loaded-only labeling + ARIA downgrade + `scope` in aggregate formatting. Remote group metadata deferred.                                                                       |
| EXT-GRID-03 bounded windows         | Deferred. Seam reserved: `PretableResultMeta.windowStart` / `rowIndexOffset` (named, not implemented); append-only retention is not assumed forever (resident cap + this seam are the guardrails). |
| EXT-DATA-01 bounded-cache semantics | Deferred behind the resident cap; the eviction owner must be the engine-coordinated design (Approach-C analysis, §3.2) because heights/selection/focus caches are engine-owned.                    |
| EXT-DATA-02 push updates            | Deferred. Seam: push schedules the same `refresh()` under the same identity + reconciliation (§9.5); Dawn's SSE plumbing exists CLI-side but is process-separate today.                            |
| EXT-QUERY-01 search composition     | Deferred. D1 disables inert controls (§8.2); the seam is that search becomes its own dataset-identity family through the same revision machinery.                                                  |
| EXT-QUERY-02 timeline query         | Deferred. Cursor design already accommodates the coalesced event-time key (NOT NULL by construction, §6.2/§5.4).                                                                                   |
| EXT-COUNT-01..03 query-aware facets | Deferred entirely (rail stays global-labeled). Semantic-consistency requirement noted: facet predicates must reuse `validateBrowseQuery`'s normalized filter model when built.                     |
| EXT-COUNT-04 remote grouping        | Deferred; blocked on EXT-GRID-02's remote-metadata half and a `processing.group` authority key.                                                                                                    |
| EXT-SELECT-01 off-window selection  | Deferred. D1 invariant preserved: engine prunes vanished IDs; nothing infers selection from absent rows; a future retainer must own and display it consumer-side.                                  |
| EXT-PERF-01 resident-window bounds  | Deferred; D1's cap prevents accidental full-dataset retention; eviction budgets belong to EXT-DATA-01's design.                                                                                    |

OUT items (query-wide select-all, Pretable HTTP client, universal cache, URL
persistence, memory-record editing, backward cursors/random jumps, remote
group-child loading, push migration) are untouched by this design except
where a first-order decision would have foreclosed them — none does: the
cursor-stack pattern keeps backward paging possible later; the identity
model keeps URL persistence a pure serialization exercise; select-all scope
labeling leaves room for a future query+exclusions model.

---

## 16. Traceability

Every normative ID from the requirements handoff. "Scenario n" = the
handoff's dogfood acceptance scenarios, implemented as named e2e specs
(§12.2); test families per §12.

| ID                                       | Design section(s)                                           | Acceptance test / deferral                                                    |
| ---------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| D1-GRID-01 explicit authority            | §4.1–4.2                                                    | engine external-mode tests; Scenario 1                                        |
| D1-GRID-02 controlled intent             | §4.2                                                        | controlled round-trip tests; no local re-application under external authority |
| D1-GRID-03 independent operations        | §4.1 (granular ruling + reasons), §4.5 (mixed-mode guard)   | derivation table tests, all four combinations                                 |
| D1-GRID-04 local compatibility           | §10.1                                                       | local-mode regression suite; Scenario 14                                      |
| D1-GRID-05 transport independence        | §4.6, §8.1                                                  | api-report review: no domain/transport types in new surface                   |
| D1-GRID-06 result metadata               | §4.1, §4.3 (counts vocabulary)                              | telemetry/count tests; no placeholder records anywhere (§4.4)                 |
| D1-GRID-07 lifecycle inputs              | §4.3–4.4                                                    | body-state matrix tests; Scenario 8                                           |
| D1-GRID-08 interaction preservation      | §4.2 (DK semantics), §6.3                                   | engine append/replace preservation tests; bench stability; Scenario 10        |
| D1-GRID-09 no callback loops             | §12.1 callback-loop tests                                   | deterministic-firing tests                                                    |
| EXT-GRID-01 end-of-window signal         | §15                                                         | deferred; telemetry deemed sufficient                                         |
| EXT-GRID-02 partial grouping             | §9.4, §15                                                   | loaded-only labeling shipped; remote metadata deferred                        |
| EXT-GRID-03 bounded windows              | §15                                                         | deferred; `windowStart`/`rowIndexOffset` seam reserved                        |
| D1-DATA-01 desired vs fulfilled          | §6.1, Flow 4                                                | component tests; Scenario 6                                                   |
| D1-DATA-02 stale suppression             | §6.1, Flow 6                                                | orchestration unit tests; Scenario 7                                          |
| D1-DATA-03 window compatibility          | §6.2 (invalidation + dedupe ownership)                      | dedupe/identity tests                                                         |
| D1-DATA-04 consistency model             | §5.6                                                        | conformance concurrent-write tests; Scenario 9                                |
| D1-DATA-05 polling safety                | §6.3, §9.5, Flow 9                                          | polling-identity tests                                                        |
| D1-DATA-06 loading behavior              | §6.4, §9.1                                                  | failure-path component tests; Scenario 8                                      |
| D1-DATA-07 beyond-first-window           | §6.2, Flow 5                                                | e2e; Scenario 5                                                               |
| D1-DATA-08 paging under writes           | §6.2 (measured comparison + ruling)                         | keyset conformance walks under writes                                         |
| EXT-DATA-01 bounded cache                | §15                                                         | deferred; engine-coordinated eviction named as owner                          |
| EXT-DATA-02 push updates                 | §9.5, §15                                                   | deferred; refresh-path seam specified                                         |
| D1-QUERY-01 all visible fields           | §5.1 (column declaration table), §5.2, Flow 2               | Scenario 1; validator + conformance                                           |
| D1-QUERY-02 operator validation          | §5.3                                                        | validator tests                                                               |
| D1-QUERY-03 boolean composition          | §5.1 (AND across fields; in/notIn within; empty list = 400) | validator + conformance                                                       |
| D1-QUERY-04 text semantics               | §5.2 content/namespace                                      | conformance ASCII pins; documented divergence; Scenario 3                     |
| D1-QUERY-05 numeric semantics            | §5.2 confidence                                             | conformance                                                                   |
| D1-QUERY-06 date semantics               | §5.2 updatedAt (UTC days; distinct from event time)         | conformance                                                                   |
| D1-QUERY-07 enum semantics               | §5.2 status/kind; sourceType retained                       | conformance; 400 on unknown values                                            |
| D1-QUERY-08 namespace semantics          | §5.2 (exact vs prefix distinct; client narrowing deleted)   | Scenario 4                                                                    |
| D1-QUERY-09 ordered sorting              | §5.1 orderBy, §5.4 default restore                          | Scenario 2                                                                    |
| D1-QUERY-10 deterministic order          | §5.4                                                        | tied-value conformance both backends; Scenario 2                              |
| D1-QUERY-11 bounded requests             | §5.3                                                        | validator bounds tests; whitelist review                                      |
| D1-QUERY-12 public contract impact       | §5.7                                                        | changeset + mirror + conformance diffs reviewed in slice 2                    |
| D1-QUERY-13 cross-backend parity         | §5.2, §5.4, §12.2                                           | shared conformance assertions; Scenario 3                                     |
| EXT-QUERY-01 search composition          | §8.2, §15                                                   | deferred; controls disabled meanwhile (Scenario 12)                           |
| EXT-QUERY-02 timeline query              | §8.2, §15                                                   | deferred; cursor accommodates event-time key                                  |
| D1-COUNT-01 honest matching total        | §5.6, §4.1                                                  | Scenario 5; snapshot-total conformance                                        |
| D1-COUNT-02 population identity          | §8.2 facet rail (global-labeled), §4.5 announcements        | component tests; Scenario 12                                                  |
| D1-COUNT-03 concurrent consistency       | §5.6                                                        | conformance concurrent-write tests; Scenario 9                                |
| D1-COUNT-04 prospective local grouping   | Flow 12, §9.4                                               | grouping-honesty tests; Scenario 11                                           |
| EXT-COUNT-01 query-aware facets          | §15                                                         | deferred; validator-model consistency noted                                   |
| EXT-COUNT-02 snapshot/freshness          | §15                                                         | deferred with EXT-COUNT-01                                                    |
| EXT-COUNT-03 cardinality bounds          | §15                                                         | deferred with EXT-COUNT-01                                                    |
| EXT-COUNT-04 remote grouping             | §15                                                         | deferred; blocked on EXT-GRID-02 + `processing.group`                         |
| D1-SELECT-01 explicit scope              | §9.3, §4.5 labeling                                         | scoped-label tests; Scenario 10                                               |
| D1-SELECT-02 query changes               | §4.2 DK clear; Flow 11 pruning                              | engine + component tests                                                      |
| D1-SELECT-03 window changes              | §6.3, Flow 11                                               | append/dedupe selection tests; Scenario 10                                    |
| D1-SELECT-04 safe bulk outcomes          | §9.3, Flow 11                                               | bulk partial/retry tests; Scenario 10                                         |
| EXT-SELECT-01 off-window selection       | §15                                                         | deferred; no-inference invariant preserved                                    |
| OUT-SELECT-01 query-wide selection       | §15 (OUT)                                                   | out of scope; labeling leaves the door open                                   |
| D1-UX-01 distinct lifecycle presentation | §9.1, §4.4                                                  | body-state matrix tests; Scenario 8                                           |
| D1-UX-02 stale presentation              | Flow 4, §9.1                                                | Scenario 6                                                                    |
| D1-UX-03 retry                           | §6.4                                                        | retry tests; Scenario 8                                                       |
| D1-A11Y-01 busy/status semantics         | §4.5 (no aria-busy ruling; announcement matrix)             | react a11y tests; Scenario 13                                                 |
| D1-A11Y-02 row counts and positions      | §4.5                                                        | ARIA tests incl. downgrades; Scenario 13                                      |
| D1-A11Y-03 focus continuity              | §4.2 (DK-change focus rule), §4.5, Flow 2/9, §9.2           | focus tests (DK reset, survivor, clamp, banner rules); Scenario 13            |
| D1-A11Y-04 keyboard completion           | §9.2                                                        | keyboard e2e walkthrough; Scenario 13                                         |
| D1-PERF-01 bounded windows               | §11 (default 200 / max 1 000)                               | route clamp tests                                                             |
| D1-PERF-02 numeric budgets               | §11 (proposed for approval; method defined)                 | bench + e2e assertions in slice 5                                             |
| D1-PERF-03 query plans                   | §5.5                                                        | plan assertions in store benches; index DDL review                            |
| D1-PERF-04 stable grid work              | §4.2, §11                                                   | new replace/append bench scripts, measured separately                         |
| EXT-PERF-01 resident-window bounds       | §15                                                         | deferred; D1 cap prevents accidental retention                                |

---

_End of design document. Implementation is gated on human approval of this
design, per the requirements handoff and the brainstorming-skill hard gate._
