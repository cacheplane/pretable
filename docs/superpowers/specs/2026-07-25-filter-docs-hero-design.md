# Filtering docs + hero adoption + e2e — design (sub-project 3 of 3)

**Date:** 2026-07-25
**Branch:** `claude/filter-docs-hero` (off `main` after #185)
**Status:** approved (design confirmed in-session)

## Context

Sub-projects 1 (#180, engine operator model) and 2 (#185, built-in header filter menu)
are merged. Since #185, the hero cockpit shows the built-in funnels **and** its bespoke
sidebar Filter section (search input + sector chips driving controlled `state.filters`)
— two UIs writing the same filters. This final sub-project closes the feature: the hero
adopts the built-in menu, filtering gets a docs page, and the deferred Playwright e2e
lands.

**Decision (user):** adopt funnels, drop the sidebar Filter section. No new API
(`columnFilters` master prop explicitly rejected).

## Goal

Website-only. Three deliverables:

1. **Hero adoption** — filtering on the hero happens exclusively through the built-in
   header funnels; the bespoke sidebar filter UI and its supporting code are deleted.
2. **Docs page** — `/docs/grid/filtering` documenting column config, operators, the
   built-in menu, and controlled/uncontrolled usage.
3. **E2E** — the smoke suite drives the funnels on the live hero, including
   filter-survives-streaming.

## Non-goals

- Any `packages/*` change (no new props, no CSS changes). If a real library bug
  surfaces during e2e, surface it — don't silently patch around it.
- The advanced sidebar filter/pivot panel (future brainstorm).
- Theming, OR-logic, chip bar.

## 1 — Hero adoption

Delete (in `apps/website/app/components/heroGrid/`):
- `sidebar/FilterSection.tsx` and its sidebar.module.css rules that only it uses
  (`.search`, `.chips`, `.chip` — verify no other consumer).
- `filters.ts` (`SECTORS`, `FilterState`, `buildFilters`) and
  `__tests__/filters.test.ts`.

Modify:
- `HeroGrid.tsx`: remove `filter`/`setFilter` state, the 150ms search-debounce
  state/effect (`appliedSearch`), `filterMap`, and the `filters:` slice from the
  surface `state` prop (sort stays controlled; filters become **uncontrolled** — the
  funnels drive the engine directly). Remove the input-focus guard in the ⌘C handler
  ONLY if no other input remains in the hero (the guard protects typing in inputs; the
  funnel popover has inputs, so KEEP the guard — it now protects the filter menu's
  text inputs instead of the search box).
- `PortfolioSummary.tsx`: drop `filter`/`onSearch`/`onSector` props and the
  `<FilterSection>` render; sidebar keeps Selection + Rollup. Update its test if any.
- `positionColumns.tsx`: no change needed (symbol `filterType:"text"`, sector
  `filterType:"enum"` already set; sector options auto-derive from streamed rows via
  `distinctColumnValues`). Optionally set `filterable: false` on columns where a filter
  makes no sense on the demo (e.g. `analyst` commentary) — decide in implementation by
  what reads well; default is leave all filterable.
- Legend copy: append filtering, e.g.
  `double-click to edit · drag to select · ⌘C copy · funnel to filter`.
- HeroGrid RTL test: replace any FilterSection assertions with a funnel presence
  assertion.

Behavior note: with filters uncontrolled, edited-qty overrides and streaming continue to
work unchanged — engine filters live outside row reconciliation (`setRows`), so an
active filter persists across ticks. The e2e proves this.

## 2 — Docs page

New `apps/website/content/docs/grid/filtering.mdx`:
- Frontmatter: `title: Filtering`, `description`, `nav: Grid`, `order: 8`.
- **Register in the hardcoded nav** `apps/website/app/docs/_nav.ts`: insert
  `{ title: "Filtering", href: "/docs/grid/filtering" }` between "Editing" and
  "Column layout". (The nav is NOT frontmatter-derived; prev/next flows from _nav.ts.)
- Content sections:
  - Quick start: columns are filterable by default; funnel appears on hover/active;
    `filterable: false` opts out.
  - Column config: `filterType` (`"text"` default | `"number"` | `"date"` | `"enum"`),
    `filterOptions` (enum; auto-derived from data when omitted).
  - Operator table per family (+ shared `isEmpty`/`isNotEmpty`); note evaluation keys
    on `filterType`, AND across columns, `isAnyOf` = OR within a column.
  - The built-in menu: live-apply (text debounced), multi-part gating
    (`between`/`dateBetween` apply only when complete), per-column Clear.
  - Uncontrolled vs controlled: `onFiltersChange(filters)` + `state.filters`
    (`Record<columnId, ColumnFilter>`), with a small code example of each.
  - Headless pointer: `setColumnFilter`/`replaceFilters`/`clearFilters`/
    `distinctColumnValues` link to `/docs/headless/api-reference`.
- A `search-index.json` regen if the docs build requires it (check how other pages
  update it — if it's generated at build time, nothing to do).

## 3 — E2E (Playwright, `apps/website/e2e/smoke.spec.ts`)

Rewrite the filter phase of the existing `"cockpit: …"` test to drive funnels:
- Open the Symbol funnel (`role=button`, name `Filter Symbol`) → dialog appears →
  type `NVDA` in the value input → after the ~200ms live-apply debounce, 1 row.
- Clear → rows restored (>5).
- Open the Sector funnel → enum checklist (auto-derived) → check `Energy` → 2 rows
  (XOM, CVX); assert an active-funnel indicator
  (`[data-pretable-filter-active="true"]`).
- **Streaming persistence:** with the Energy filter active, wait ~2s of ticks →
  still 2 rows and the filter/dialog state intact.
- Close the dialog (Escape) before the edit/copy phases; those phases stay unchanged
  (they don't depend on the sidebar).
- Remove the now-dead `getByPlaceholder(/filter symbol/i)` + sector-chip steps.
- Add a docs assertion: `/docs/grid/filtering` resolves (status 200) — mirror the
  existing `/docs` check.

## Testing / validation

- Website unit (vitest): updated HeroGrid/PortfolioSummary tests; deleted
  filters.test.ts; suite green.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` in `apps/website`; repo-wide
  `pnpm format`. No `pnpm api` needed (no packages/* change) — but run it once to
  confirm a no-op.
- Playwright smoke locally against a built server (BASE_URL pattern used previously).

## Risks

- **Debounce timing in e2e:** live-apply text debounce (~200ms) + streaming re-renders;
  use Playwright's auto-waiting `expect.poll`/`toHaveCount` rather than fixed sleeps.
- **Funnel hover-reveal:** funnels are opacity-0 until header-row hover — Playwright
  clicks force actionability; hover the header row first if needed.
- **Enum auto-derive under streaming:** distinct sector values come from live rows —
  stable because the roster's sectors are fixed from the first tick.
