# Filtering Docs + Hero Adoption + E2E — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The hero filters exclusively through the built-in header funnels (bespoke sidebar filter UI deleted), a `/docs/grid/filtering` page documents the feature, and the Playwright smoke drives the funnels — including filter-survives-streaming.

**Architecture:** Website-only (`apps/website`); zero `packages/*` changes. Hero filters become **uncontrolled** (drop the `filters:` slice from the surface `state`; sort stays controlled). The docs nav is **hardcoded** in `app/docs/_nav.ts` — the new page must be registered there.

**Tech Stack:** Next 16 / React 19, `@pretable/react`, MDX docs, Vitest + RTL, Playwright. Commands (from `apps/website`): `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`; repo root: `pnpm format` / `format:write`. Playwright locally: build, `next start` on a port, run with `BASE_URL=http://localhost:<port>` (config has no webServer; script name is `smoke`).

**Key facts (verified against code):**

- Hero filter code to remove: `HeroGrid.tsx` — `filter`/`setFilter` state (~~:64), 150ms debounce `appliedSearch` effect (~~:71-79), `filterMap` memo, `filters: filterMap` in the `state` prop (~~:264-268), `onSearch`/`onSector` props passed to `PortfolioSummary` (~~:275+). `PortfolioSummary.tsx` — `filter`/`onSearch`/`onSector` props + `<FilterSection>` render (:12-14, :64-66, :75-78) + `FilterState` import (:7). `sidebar/FilterSection.tsx` (whole file). `filters.ts` (`SECTORS`/`FilterState`/`buildFilters`) + `heroGrid/__tests__/filters.test.ts`.
- KEEP the ⌘C input-focus guard in HeroGrid's copy handler — it now protects typing in the filter menu's inputs.
- `positionColumns.tsx` already sets `filterType:"text"` (symbol :33) and `filterType:"enum"` (sector :46); sector options auto-derive.
- Funnel selectors (from #185): button `role=button` name `Filter {header}`, `[data-pretable-filter-funnel]`, active `[data-pretable-filter-active="true"]`; dialog `role=dialog` name `Filter {header}`; inputs `[data-pretable-filter-operator]` (select), `[data-pretable-filter-value]`, `[data-pretable-filter-min]`/`-max`, `[data-pretable-filter-set]` (checkbox group), `[data-pretable-filter-clear]`. Live-apply text debounce ~200ms.
- Docs: grid section files in `apps/website/content/docs/grid/` with frontmatter `nav: Grid` + `order:` (editing=7; collisions already exist). Nav hardcoded at `apps/website/app/docs/_nav.ts` (Grid items list; "Editing" at :34, "Column layout" at :35). `search-index.json` lives in `app/docs/` — check whether it's generated at build (if committed + stale after adding the page, regenerate however the repo does; look for a script or build step touching it).
- Smoke: `apps/website/e2e/smoke.spec.ts` — the `"cockpit: filter, edit (guardrail + success), and select+copy under streaming"` test's filter phase uses `getByPlaceholder(/filter symbol/i)` + sector chips (to be replaced); edit/copy phases stay. Existing deterministic assertions: NVDA→1 row, Energy→2 rows (XOM, CVX), clear→>5.
- Website RTL setup mocks IntersectionObserver no-op + rAF no-op; HeroGrid tests mock matchMedia.

---

## File Structure

Deleted:

- `apps/website/app/components/heroGrid/sidebar/FilterSection.tsx`
- `apps/website/app/components/heroGrid/filters.ts`
- `apps/website/app/components/heroGrid/__tests__/filters.test.ts`

Modified:

- `apps/website/app/components/HeroGrid.tsx`, `heroGrid/PortfolioSummary.tsx`,
  `heroGrid/sidebar/sidebar.module.css` (remove `.search`/`.chips`/`.chip` if unused elsewhere),
  `heroGrid/heroGrid.module.css`? (no—legend text only), HeroGrid/PortfolioSummary tests.
- `apps/website/app/docs/_nav.ts`, `apps/website/e2e/smoke.spec.ts`.

New:

- `apps/website/content/docs/grid/filtering.mdx`.

---

## Task 1: Hero adoption (delete sidebar filter, go uncontrolled)

**Files:** as listed above (deletes + HeroGrid/PortfolioSummary + their tests + sidebar.module.css).

- [ ] **Step 1: Update tests first (RTL).** In `heroGrid`/website tests:
  - Delete `heroGrid/__tests__/filters.test.ts`.
  - In the HeroGrid test (`app/components/__tests__/HeroGrid.test.tsx`) and any PortfolioSummary test: remove assertions that reference the search input (`Filter symbol or name…` placeholder) or sector chips; add:
    ```tsx
    it("renders built-in filter funnels on filterable columns", () => {
      renderHeroGrid();
      expect(
        screen.getByRole("button", { name: "Filter Sector" }),
      ).toBeInTheDocument();
    });
    ```
    (Header label is `Sector`; funnel aria-label is `Filter Sector`.)
    Run `cd apps/website && pnpm test` — expect the suite to FAIL (components still render the old UI / props mismatch pending).

- [ ] **Step 2: Trim `PortfolioSummary.tsx`.** Remove the `FilterState` import, `filter`/`onSearch`/`onSector` from `PortfolioSummaryProps` and the destructure, and the `<FilterSection …/>` element (and its import). Sidebar keeps `SelectionSection` + rollup.

- [ ] **Step 3: Trim `HeroGrid.tsx`.**
  - Remove imports: `buildFilters, type FilterState` (from `./heroGrid/filters`).
  - Remove state/effects: `const [filter, setFilter] = useState<FilterState>(…)`, the `appliedSearch` state + debounce effect, the `filterMap` memo.
  - Surface `state` prop becomes `state={{ ...(userSort ? { sort: userSort } : {}) }}` (drop the `filters:` line). Filters are now uncontrolled.
  - Drop `filter=`/`onSearch=`/`onSector=` from `<PortfolioSummary …/>`.
  - KEEP the ⌘C `inInput` guard (it protects the filter menu's inputs now); update its comment to say so.
  - Legend: `double-click to edit · drag to select · ⌘C copy · funnel to filter`.

- [ ] **Step 4: Delete files + prune CSS.** Delete `FilterSection.tsx` and `filters.ts`. In `sidebar/sidebar.module.css`, remove `.search`, `.chips`, `.chip` rules IF no remaining usage (grep first; `.section`/`.label` stay for SelectionSection).

- [ ] **Step 5: Verify.** `cd apps/website && pnpm test && pnpm typecheck && pnpm lint` — all green. Grep for leftovers: `grep -rn "FilterSection\|buildFilters\|FilterState\|SECTORS" apps/website/app` → no hits.

- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "feat(website): hero adopts built-in filter funnels; drop sidebar filter UI"
```

---

## Task 2: `/docs/grid/filtering` page + nav

**Files:** Create `apps/website/content/docs/grid/filtering.mdx`; modify `apps/website/app/docs/_nav.ts`.

- [ ] **Step 1: Write the page.** Frontmatter:

```yaml
---
title: Filtering
description: "Operator-based column filters: the built-in header menu, per-column config, and the controlled filters API."
nav: Grid
order: 8
---
```

Sections (follow the voice/structure of `editing.mdx` — prose-first, tables for enumerable facts, small focused code blocks):

1. Intro: columns are filterable by default; funnel on hover / always when active; `filterable: false` opts out.
2. **Column config** table: `filterType` (default `"text"`), `filterOptions`, `filterable` + a `PretableColumn` snippet showing a text, number, enum (with explicit options), and date column.
3. **Operators** table per family (text: contains/notContains/equals/notEquals/startsWith/endsWith · number: equals/notEquals/gt/gte/lt/lte/between · date: on/before/after/dateBetween · enum: isAnyOf/isNoneOf · shared: isEmpty/isNotEmpty). Note: evaluation keys on `filterType`; columns AND-combine; `isAnyOf` is OR within a column.
4. **The built-in menu**: live-apply (text ~200ms debounce), `between`/`dateBetween` apply only when both bounds are set, per-column Clear, Escape/outside-click closes.
5. **Reacting to changes / controlling filters**: `onFiltersChange` example (uncontrolled) and `state.filters` example (controlled) using `ColumnFilter` from `@pretable/react`.
6. **Headless**: one paragraph pointing at `setColumnFilter` / `replaceFilters` / `clearFilters` / `distinctColumnValues` with a link to `/docs/headless/api-reference`.

- [ ] **Step 2: Register in nav.** In `app/docs/_nav.ts`, insert between Editing and Column layout:

```ts
      { title: "Filtering", href: "/docs/grid/filtering" },
```

- [ ] **Step 3: search-index.** Check how `app/docs/search-index.json` is produced (look for a generate script / build hook). If generated: run it and commit the result. If it updates during `pnpm build`, just build. Do not hand-edit unless that is the established mechanism.

- [ ] **Step 4: Verify.** `cd apps/website && pnpm build` (page compiles, no MDX errors) and `pnpm test` (search-index/docs tests if any). Optionally `pnpm dev` + manual check skipped — e2e covers resolution.

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "docs(website): add /docs/grid/filtering page"
```

---

## Task 3: Smoke rewrite + full validation

**Files:** `apps/website/e2e/smoke.spec.ts`.

- [ ] **Step 1: Rewrite the cockpit test's filter phase.** Replace the search-input + sector-chip block with funnel-driven steps:

```ts
// --- Filter via the built-in header funnels ---
// Symbol funnel → contains NVDA → 1 row.
await page.getByRole("button", { name: "Filter Symbol" }).click();
const symbolDialog = page.getByRole("dialog", { name: "Filter Symbol" });
await symbolDialog.locator("[data-pretable-filter-value]").fill("NVDA");
await expect(page.locator("[data-pretable-row]")).toHaveCount(1); // auto-waits past the ~200ms live-apply debounce
// Clear restores the book.
await symbolDialog.locator("[data-pretable-filter-clear]").click();
await expect
  .poll(() => page.locator("[data-pretable-row]").count())
  .toBeGreaterThan(5);
await page.keyboard.press("Escape");

// Sector funnel → enum checklist (auto-derived) → Energy → 2 rows.
await page.getByRole("button", { name: "Filter Sector" }).click();
const sectorDialog = page.getByRole("dialog", { name: "Filter Sector" });
await sectorDialog
  .locator("[data-pretable-filter-set]")
  .getByRole("checkbox", { name: "Energy" })
  .check();
await expect(page.locator("[data-pretable-row]")).toHaveCount(2); // XOM, CVX
const shown = await page
  .locator('[data-pretable-row] [data-pretable-column-id="sector"]')
  .allInnerTexts();
expect(new Set(shown.map((s) => s.trim()))).toEqual(new Set(["Energy"]));
// Active-funnel indicator.
await expect(
  page.locator(
    '[data-pretable-filter-funnel][data-pretable-column-id="sector"]',
  ),
).toHaveAttribute("data-pretable-filter-active", "true");

// Filter survives streaming: wait several ticks, still 2 rows.
await page.waitForTimeout(2000);
await expect(page.locator("[data-pretable-row]")).toHaveCount(2);

// Clear + close so the edit/copy phases see the full book.
await sectorDialog.locator("[data-pretable-filter-clear]").click();
await expect
  .poll(() => page.locator("[data-pretable-row]").count())
  .toBeGreaterThan(5);
await page.keyboard.press("Escape");
```

Notes: if the enum checkbox has no accessible name binding, fall back to `getByLabel("Energy")` within the set container or a label-text locator — verify against the rendered DOM. If the funnel's opacity-0 hover-reveal blocks clicking, `hover()` the header row first (Playwright forces actionability on opacity but not on `visibility`; opacity-0 elements are still actionable — verify).
Keep the edit (NVDA guardrail / JPM success) and select+copy phases exactly as they are. Delete the old placeholder/chip locators.

- [ ] **Step 2: Docs resolution check.** In the first landing test (where `/docs` is asserted), add:

```ts
const filteringDocs = await page.goto("/docs/grid/filtering", {
  waitUntil: "domcontentloaded",
});
expect(filteringDocs?.status()).toBe(200);
```

- [ ] **Step 3: Run the smoke locally.** Build + serve + run (mirror the established local pattern):

```bash
cd apps/website && pnpm build
cd apps/website && npx next start -p 3123 &
cd apps/website && BASE_URL=http://localhost:3123 pnpm smoke
```

(Adjust to the repo's actual smoke invocation; kill the server after.) All tests pass on chromium + webkit; if a pre-existing unrelated test flakes under parallel contention, retry it in isolation to confirm it's not this change.

- [ ] **Step 4: Full validation.**

```bash
cd apps/website && pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm format
pnpm api   # expect a clean no-op (no packages/* change)
```

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "test(website): smoke drives built-in filter funnels; docs page check"
```

---

## Self-Review notes (for the executor)

- **Spec coverage:** hero funnels-only + deletions (Task 1) ✓; keep ⌘C guard ✓; legend ✓; docs page + hardcoded nav + search-index (Task 2) ✓; funnel e2e incl. streaming persistence + docs 200 (Task 3) ✓; website-only, `pnpm api` no-op check ✓.
- **Do NOT touch `packages/*`.** If e2e exposes a library bug, report it — don't patch the library in this PR.
- **Selector source of truth** is the #185 implementation (`packages/react/src/filter-menu/`); verify any doubted selector against those files/tests before changing the smoke.
- **Grep-clean:** after Task 1, `FilterSection|buildFilters|FilterState|SECTORS` must have zero hits under `apps/website/app`.
