# Hero Cockpit Enrichment (Sub-project A) — Design

**Date:** 2026-06-11
**Status:** Approved (brainstorm), pending implementation plan
**Scope:** Homepage hero demo only (`apps/website`). No `packages/*` changes expected.
**Parent goal:** Make the homepage demo the canonical pretable demo. This is
sub-project A (in-hero features). Sub-project B (below-the-fold showcase
sections: theming/density, resize/reorder, headless, column-virtualization
scale) is a separate later spec.

## Problem

The PMS hero proves streaming + wrapped-text rendering but exercises roughly a
third of the shipped library surface. The three most damaging absences for a
canonical demo are the flagship interaction features:

1. **Cell editing** — the async edit lifecycle shipped in PR #174 has zero demo
   presence.
2. **Cell-range selection + keyboard navigation + clipboard copy** — the
   spreadsheet-grade interactions that distinguish a real grid are invisible.
3. **Filtering** — the engine's filter state has no UI anywhere on the site.

These also combine into the demo's strongest implicit claim: **rich
interactions coexist with streaming** (selection and row-height fixes earlier
in this branch made that true at the engine level; this spec makes it visible).

## Decision

Add three features to the live hero grid, all via the **real public API** — no
bespoke demo shortcuts — and surface them with explicit affordances:

- **A1 — Inline Qty editing with a simulated async order lifecycle.**
- **A2 — Cell-range selection + keyboard nav + ⌘C copy, with a live selection
  summary.**
- **A3 — Filter: symbol/name search box + sector chips.**

A new thin **grid toolbar** row inside the bezel (between `TopControlBar` and
the grid surface) hosts: search box, sector chips, live selection summary, and
a one-line interaction legend ("double-click to edit · drag to select · ⌘C
copy"). The existing `TopControlBar` (ticks/s · p95 · fps · pause · tiers) is
unchanged.

**The stream keeps running through everything.** Edit drafts, selection, and
filters persist across ticks. No pausing, no row freezing.

## A1 — Inline Qty editing (async order lifecycle)

**Column config (`positionColumns.tsx`):** the `qty` column becomes editable
using the public column API:

- `editable: true`
- `parseEditValue`: string → integer (strip commas/whitespace).
- `validate`: sync rules — integer, `> 0`, `≤ 10×` current qty (sanity bound).
  Returns an error string on failure (engine shows `editing` + error state).
- `renderEditor`: numeric input showing lifecycle states from
  `PretableEditorInput`: `status === "validating"` → "compliance check…",
  `"saving"` → "submitting order…", `"error"`/validation message inline.
  Commit on Enter (focus moves down), cancel on Esc — engine defaults.
- Hover affordance: a pencil glyph on the qty cell (CSS `:hover` on the cell
  via `getBodyCellClassName` or the cell render; implementation may choose).

**Commit handler (`HeroGrid` `onCellEdit`):** returns a promise that drives the
full lifecycle:

1. ~400 ms simulated **compliance check** (`validating`).
2. **Guardrail rejection:** if the new position's weight
   (`newQty · last / NAV`) would exceed **7%** of the book, reject with
   `"Rejected: breaches 7% single-name guardrail"`. This reuses the demo's
   existing narrative (the AI analyst already flags the 7% guardrail).
3. ~700 ms simulated **order submission** (`saving`).
4. **Seeded pseudo-random desk rejection** (~1 in 7, deterministic per
   row+value so tests are stable): reject with `"Rejected by trading desk"`.
5. Otherwise resolve: apply the new `qty` to row state and recompute that
   row's `mktValue = qty · last` and all rows' `weight` (= `mktValue / NAV`),
   so NAV and the sidebar allocation update live.

**Streaming coexistence rule:** the replay reducer's tick patches only touch
price-derived fields (`last`, `mktValue`, `dayPnl`, `dayPnlPct`, `weight`) —
`qty` is never streamed, so a user edit cannot be overwritten by a tick.
Because ticks patch `mktValue`/`weight` from the recording (which assumes
original quantities), after a successful edit the reducer must recompute
`mktValue`/`weight` for the edited row from `qty · last` on each tick instead
of trusting the recorded patch values for that row. Keep a
`editedQtyById: Map<string, number>` in the reducer for this.

**Reduced-motion snapshot:** editing works identically on the settled snapshot
(no stream running; recompute logic identical).

## A2 — Cell-range selection + keyboard + copy

All engine/surface capabilities already exist; this wires and surfaces them:

- Cell-range selection: click, shift+click extend, marquee drag, ⌘/Ctrl+A —
  default surface behavior, already enabled. Row-checkbox selection stays.
- Keyboard navigation: arrows, shift+arrows, page up/down, tab wrap — default.
- Copy: ⌘/Ctrl+C with `copyWithHeaders: true` (TSV + HTML payload, default
  `serializeRangesAsTsv` path; no `onCopy` override).
- **Wire `onSelectionChange`** in `HeroGrid` to local state powering a live
  **selection summary** in the toolbar: e.g. `3 × 2 selected · ⌘C to copy`
  (rows × columns of the bounding ranges; hidden when nothing is selected).
  Show `Copied ✓` transiently after a copy (hook the surface's copy
  announcement via `messages.copyAnnouncement` returning the same string it
  uses for aria — implementation detail; the visible summary update is the
  requirement).
- The interaction legend in the toolbar lists: "double-click to edit · drag to
  select · ⌘C copy".
- Everything must survive streaming ticks (already true at engine level;
  asserted end-to-end in tests).

## A3 — Filter (search + sector chips)

- **Search box** (toolbar, left): filters by symbol or name substring,
  case-insensitive. Debounce ~150 ms.
- **Sector chips** (toolbar, next to search): `All · Technology · Consumer ·
  Health Care · Financials · Energy`. Single-select; `All` clears.
- Both compose into a `filters` object applied via the surface's controlled
  `state.filters` (engine `replaceFilters` semantics):
  - search → a filter on a searchable field; sector chip → `sector` equals.
  - The engine's filter is substring matching per column. The grid's columns
    don't include `sector` or a combined symbol+name field as visible columns —
    add hidden filterable handling as needed: implementation may add
    `filterable: true` metadata or filter on the `symbol` column for search and
    add a hidden `sector` column config if required by the engine's per-column
    model. The spec requirement is the BEHAVIOR (search matches symbol or
    name; chip matches sector exactly); the wiring may use whatever the public
    API supports cleanly.
- Filtered view updates live while the stream ticks (visible rows keep
  flashing/growing). Clearing filters restores the full book.
- **Sidebar rollups stay whole-book** (NAV, Day P&L, allocation, AI alerts are
  computed from all rows, not the filtered subset) — avoids implying the fund
  NAV changed because the view narrowed.
- Empty state: if no rows match, the grid shows its natural empty body; the
  toolbar keeps the active filter visible so the user can clear it.

## Toolbar (new component)

`apps/website/app/components/heroGrid/GridToolbar.tsx` — one row inside the
bezel above the grid surface:

- Left: search input + sector chips.
- Right: selection summary (or legend when nothing selected). At narrow
  widths the legend hides; search collapses to an icon (mobile sidebar is
  already hidden at ≤768px; match that breakpoint).
- Styling: CSS module consistent with the existing hero skin (Tailwind is
  allowed in `apps/*` but the heroGrid components use CSS modules — stay
  consistent with CSS modules here).

## State & data flow (HeroGrid)

New local state alongside existing `rows`/`userSort`:

- `filters: { search: string; sector: string | null }` → translated to the
  surface's `state.filters` object.
- `selectionSummary: { rows: number; cols: number } | null` ← from
  `onSelectionChange`.
- `editedQtyById: Map<string, number>` ← successful edits; consulted by the
  streaming reducer (see A1).

`PretableSurface` gains props: `onCellEdit`, `onSelectionChange`,
`copyWithHeaders`, and `state` extended with `filters` (sort stays as-is).

## Testing

- **Unit:** qty `parseEditValue`/`validate` rules; guardrail-rejection math;
  weight/NAV recompute after edit; filter translation (search+chip →
  filters object); deterministic desk-rejection seed.
- **Component (RTL):** edit lifecycle states render (validating → saving →
  success and both rejection paths); selection summary updates on
  `onSelectionChange`; toolbar chips/search drive `state.filters`.
- **Smoke (Playwright), against the streaming hero:**
  - Edit qty → success path: new qty visible, weight changes, stream still
    ticking.
  - Edit qty → guardrail rejection: error visible in editor, value unchanged.
  - Drag-select a 2×2 range while streaming → summary shows "2 × 2"; press
    ⌘C → "Copied ✓"; selection still present after ticks.
  - Type in search → visible rows reduce; click a sector chip → further
    reduce; clear → full book returns. Stream ticking throughout.
- Existing tests (drift, row-select, reduced-motion snapshot) keep passing.

## Out of scope

- Sub-project B (showcase sections below the fold).
- Multi-sort, right-pin, paste (library roadmap gaps — not demoable yet).
- Any `packages/*` changes. If implementation discovers a genuine library bug
  blocking the above (as happened with selection/row-height), fix it as its
  own commit with its own tests, but no new public API is anticipated.
- Recording/generator changes (the stream content is untouched).

## Success criteria

- A visitor can: double-click a Qty and watch a real async order lifecycle
  (including a themed rejection), drag-select cells and ⌘C a TSV/HTML block,
  search/filter the book — all while prices tick and analyst text streams.
- All interactions use only public pretable APIs.
- The interactions are discoverable at a glance (pencil affordance, selection
  summary, legend).
- Full validation green: website unit/RTL, smoke, typecheck, lint, build.
