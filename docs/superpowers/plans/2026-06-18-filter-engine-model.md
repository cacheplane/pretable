# Filter Engine Operator Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the substring-only filter model (`Record<columnId, string>`) with a typed, operator-based model (text/number/enum/date), AND-combined across columns, headless in `@pretable/core` + `grid-core`.

**Architecture:** A pure `evaluateFilter` function does per-operator matching, keyed on each column's `filterType`. `deriveVisibleRows` uses it. The engine state, methods, and snapshot are retyped to `Record<columnId, ColumnFilter>`; `setFilter(id, string)` becomes `setColumnFilter(id, ColumnFilter | null)`; a new `distinctColumnValues` helper powers enum auto-derive. Public surface (`core`, `react` types) and the website's `buildFilters` are migrated. No backcompat aliases.

**Tech Stack:** TypeScript, Vitest, api-extractor (required "report freshness" CI gate). `packages/*` is vanilla (no UI here at all). Commands: `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test`, `pnpm format` (check; `format:write` fixes), `pnpm api` (regen api reports), `pnpm --filter @pretable/grid-core test`.

**Key facts (verified against code):**

- Filter state: `create-grid-core.ts:90` `let filters: Record<string,string> = {}`; methods at `:121` (`setFilter`), `:144` (`clearFilters`), `:152` (`replaceFilters`); `filtersEqual` at `:990`; snapshot build `:868-907` (`filters: { ...filters }`, `cachedDerivedFilters`).
- Evaluation: `derived-rows.ts` — `deriveVisibleRows` (filters param `Record<string,string>`), `resolveFilters`, `matchesFilters`, `readCellValue` (uses `column.value` then `row[id]`).
- Types: `grid-core/src/types.ts` — `PretableColumn` (:66, has `filterable?`, `value?`), `PretableGridSnapshot.filters` (:210), `PretableEngine` (:220, has `setFilter/clearFilters/replaceFilters`).
- Public: `core/src/pretable-grid.ts:39-41` (interface methods), `core/src/create-grid.ts:34-37` (forwarding), `core/src/public_api.ts` + `react/src/public_api.ts` (exports), `react/src/use-pretable.ts` (`PretableSurfaceState.filters` :76, controlled apply `grid.replaceFilters(state.filters)` ~:230).
- Website: `apps/website/app/components/heroGrid/filters.ts` (`buildFilters` returns `Record<string,string>`), consumed in `HeroGrid.tsx` (`filterMap` → `state={{ filters: filterMap }}`).

---

## File Structure

- `packages/grid-core/src/types.ts` — new filter types; column fields; snapshot + engine retype.
- `packages/grid-core/src/evaluate-filter.ts` — **new**: `evaluateFilter` (pure) + helpers.
- `packages/grid-core/src/derived-rows.ts` — `resolveFilters`/`matchesFilters` use `evaluateFilter`; `deriveVisibleRows` filters param retyped.
- `packages/grid-core/src/create-grid-core.ts` — state/methods/snapshot retype; `setColumnFilter`; `distinctColumnValues`; structural `filtersEqual`.
- `packages/core/src/pretable-grid.ts`, `create-grid.ts`, `public_api.ts` — public interface + forwarding + exports.
- `packages/react/src/use-pretable.ts`, `public_api.ts` — `PretableSurfaceState.filters` retype + controlled apply; re-export types.
- `apps/website/app/components/heroGrid/filters.ts` (+ its test) — `buildFilters` emits `ColumnFilter`s.
- `*.api.md` — regenerated via `pnpm api`.
- Tests: `packages/grid-core/src/__tests__/evaluate-filter.test.ts` (new), extend `grid-core.test.ts`.

---

## Task 1: Filter types + `evaluateFilter` (pure, fully tested)

**Files:**

- Modify: `packages/grid-core/src/types.ts`
- Create: `packages/grid-core/src/evaluate-filter.ts`
- Test: `packages/grid-core/src/__tests__/evaluate-filter.test.ts`

This task is additive (no existing code changes behavior yet), so the repo still compiles.

- [ ] **Step 1: Add types to `packages/grid-core/src/types.ts`**

Add near the top-level exports (e.g. just above `PretableColumn`):

```ts
/** @public */
export type FilterType = "text" | "number" | "date" | "enum";

/** @public */
export type FilterOperator =
  | "contains"
  | "notContains"
  | "equals"
  | "notEquals"
  | "startsWith"
  | "endsWith"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "isAnyOf"
  | "isNoneOf"
  | "on"
  | "before"
  | "after"
  | "dateBetween"
  | "isEmpty"
  | "isNotEmpty";

/** @public */
export type FilterValue =
  | string
  | number
  | readonly [number, number]
  | readonly [string, string]
  | readonly string[]
  | null;

/** @public — one column's active filter. `value` is omitted for isEmpty/isNotEmpty. */
export interface ColumnFilter {
  operator: FilterOperator;
  value?: FilterValue;
}

/** @public */
export interface FilterOption {
  value: string;
  label?: string;
}
```

Add to `PretableColumn` (after the existing `filterable?: boolean;` line):

```ts
  filterType?: FilterType;
  filterOptions?: FilterOption[];
```

(Leave `snapshot.filters` and `PretableEngine` unchanged in this task — Task 2 retypes them.)

- [ ] **Step 2: Write the failing test** `packages/grid-core/src/__tests__/evaluate-filter.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { evaluateFilter, isFilterActive } from "../evaluate-filter";
import type { ColumnFilter } from "../types";

const ev = (
  cell: unknown,
  filterType: "text" | "number" | "date" | "enum",
  f: ColumnFilter,
) => evaluateFilter(cell, filterType, f.operator, f.value);

describe("evaluateFilter — text", () => {
  it("contains / notContains are case-insensitive", () => {
    expect(ev("Hello", "text", { operator: "contains", value: "ell" })).toBe(
      true,
    );
    expect(ev("Hello", "text", { operator: "contains", value: "ELL" })).toBe(
      true,
    );
    expect(ev("Hello", "text", { operator: "notContains", value: "xyz" })).toBe(
      true,
    );
    expect(ev("Hello", "text", { operator: "notContains", value: "ell" })).toBe(
      false,
    );
  });
  it("equals / notEquals / startsWith / endsWith", () => {
    expect(ev("abc", "text", { operator: "equals", value: "ABC" })).toBe(true);
    expect(ev("abc", "text", { operator: "notEquals", value: "abd" })).toBe(
      true,
    );
    expect(ev("abcdef", "text", { operator: "startsWith", value: "ABC" })).toBe(
      true,
    );
    expect(ev("abcdef", "text", { operator: "endsWith", value: "DEF" })).toBe(
      true,
    );
  });
});

describe("evaluateFilter — number", () => {
  it("comparisons", () => {
    expect(ev(5, "number", { operator: "gt", value: 4 })).toBe(true);
    expect(ev(5, "number", { operator: "gte", value: 5 })).toBe(true);
    expect(ev(5, "number", { operator: "lt", value: 4 })).toBe(false);
    expect(ev(5, "number", { operator: "lte", value: 5 })).toBe(true);
    expect(ev(5, "number", { operator: "equals", value: 5 })).toBe(true);
    expect(ev(5, "number", { operator: "notEquals", value: 6 })).toBe(true);
  });
  it("between is inclusive and tolerates reversed bounds", () => {
    expect(ev(5, "number", { operator: "between", value: [1, 10] })).toBe(true);
    expect(ev(5, "number", { operator: "between", value: [10, 1] })).toBe(true);
    expect(ev(11, "number", { operator: "between", value: [1, 10] })).toBe(
      false,
    );
  });
  it("non-numeric cell fails comparisons (but not isEmpty)", () => {
    expect(ev("oops", "number", { operator: "gt", value: 1 })).toBe(false);
    expect(ev(null, "number", { operator: "isEmpty" })).toBe(true);
  });
});

describe("evaluateFilter — enum", () => {
  it("isAnyOf / isNoneOf; empty selection = no constraint", () => {
    expect(ev("a", "enum", { operator: "isAnyOf", value: ["a", "b"] })).toBe(
      true,
    );
    expect(ev("c", "enum", { operator: "isAnyOf", value: ["a", "b"] })).toBe(
      false,
    );
    expect(ev("c", "enum", { operator: "isNoneOf", value: ["a", "b"] })).toBe(
      true,
    );
    expect(ev("a", "enum", { operator: "isAnyOf", value: [] })).toBe(true);
  });
});

describe("evaluateFilter — date", () => {
  it("on / before / after / dateBetween (inclusive)", () => {
    expect(
      ev("2026-06-18", "date", { operator: "on", value: "2026-06-18" }),
    ).toBe(true);
    expect(
      ev("2026-06-18", "date", { operator: "before", value: "2026-06-19" }),
    ).toBe(true);
    expect(
      ev("2026-06-18", "date", { operator: "after", value: "2026-06-17" }),
    ).toBe(true);
    expect(
      ev("2026-06-18", "date", {
        operator: "dateBetween",
        value: ["2026-06-01", "2026-06-30"],
      }),
    ).toBe(true);
    expect(
      ev("2026-07-01", "date", {
        operator: "dateBetween",
        value: ["2026-06-01", "2026-06-30"],
      }),
    ).toBe(false);
  });
  it("unparseable cell fails (but not isEmpty)", () => {
    expect(
      ev("not-a-date", "date", { operator: "before", value: "2026-06-19" }),
    ).toBe(false);
    expect(ev("", "date", { operator: "isEmpty" })).toBe(true);
  });
});

describe("evaluateFilter — shared empty semantics", () => {
  it("isEmpty / isNotEmpty across types", () => {
    expect(ev(null, "text", { operator: "isEmpty" })).toBe(true);
    expect(ev("", "text", { operator: "isEmpty" })).toBe(true);
    expect(ev("  ", "text", { operator: "isEmpty" })).toBe(true);
    expect(ev("x", "text", { operator: "isNotEmpty" })).toBe(true);
    expect(ev(undefined, "number", { operator: "isEmpty" })).toBe(true);
    expect(ev(Number.NaN, "number", { operator: "isEmpty" })).toBe(true);
  });
});

describe("isFilterActive", () => {
  it("blank values are inactive (no constraint)", () => {
    expect(isFilterActive({ operator: "contains", value: "" })).toBe(false);
    expect(isFilterActive({ operator: "isAnyOf", value: [] })).toBe(false);
    expect(isFilterActive({ operator: "gt", value: undefined })).toBe(false);
    expect(isFilterActive({ operator: "between", value: [1, 2] })).toBe(true);
    expect(isFilterActive({ operator: "isEmpty" })).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @pretable/grid-core test -- evaluate-filter`
Expected: FAIL — `Cannot find module '../evaluate-filter'`.

- [ ] **Step 4: Write `packages/grid-core/src/evaluate-filter.ts`**

```ts
import type {
  ColumnFilter,
  FilterOperator,
  FilterType,
  FilterValue,
} from "./types";

const NO_OPERAND: ReadonlySet<FilterOperator> = new Set([
  "isEmpty",
  "isNotEmpty",
]);

/** Is this filter active (has a usable operand)? Blank/empty operands are inactive. */
export function isFilterActive(filter: ColumnFilter): boolean {
  const { operator, value } = filter;
  if (NO_OPERAND.has(operator)) return true;
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true; // number
}

function isEmptyCell(cell: unknown): boolean {
  if (cell === null || cell === undefined) return true;
  if (typeof cell === "number") return Number.isNaN(cell);
  return String(cell).trim() === "";
}

function toDayMs(input: unknown): number {
  // Day-resolution: parse and zero the time so "on"/range compare by calendar day.
  const ms = typeof input === "number" ? input : Date.parse(String(input));
  if (Number.isNaN(ms)) return Number.NaN;
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Pure per-operator filter match. Evaluation is keyed on `filterType` (not the
 * operator name), so `equals` means string-equality for text and numeric-equality
 * for number. An operator outside the column's family returns false (no match).
 */
export function evaluateFilter(
  cell: unknown,
  filterType: FilterType,
  operator: FilterOperator,
  value: FilterValue | undefined,
): boolean {
  if (operator === "isEmpty") return isEmptyCell(cell);
  if (operator === "isNotEmpty") return !isEmptyCell(cell);

  switch (filterType) {
    case "number": {
      const n = typeof cell === "number" ? cell : Number(cell);
      if (Number.isNaN(n)) return false;
      switch (operator) {
        case "equals":
          return n === Number(value);
        case "notEquals":
          return n !== Number(value);
        case "gt":
          return n > Number(value);
        case "gte":
          return n >= Number(value);
        case "lt":
          return n < Number(value);
        case "lte":
          return n <= Number(value);
        case "between": {
          if (!Array.isArray(value)) return false;
          const a = Number(value[0]);
          const b = Number(value[1]);
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          return n >= lo && n <= hi;
        }
        default:
          return false;
      }
    }
    case "date": {
      const c = toDayMs(cell);
      if (Number.isNaN(c)) return false;
      switch (operator) {
        case "on":
          return c === toDayMs(value);
        case "before":
          return c < toDayMs(value);
        case "after":
          return c > toDayMs(value);
        case "dateBetween": {
          if (!Array.isArray(value)) return false;
          const a = toDayMs(value[0]);
          const b = toDayMs(value[1]);
          if (Number.isNaN(a) || Number.isNaN(b)) return false;
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          return c >= lo && c <= hi;
        }
        default:
          return false;
      }
    }
    case "enum": {
      const c = String(cell);
      const set = Array.isArray(value) ? value.map(String) : [];
      if (set.length === 0) return true; // empty selection = no constraint
      switch (operator) {
        case "isAnyOf":
          return set.includes(c);
        case "isNoneOf":
          return !set.includes(c);
        default:
          return false;
      }
    }
    case "text":
    default: {
      const hay = String(cell ?? "").toLowerCase();
      const needle = String(value ?? "").toLowerCase();
      switch (operator) {
        case "contains":
          return hay.includes(needle);
        case "notContains":
          return !hay.includes(needle);
        case "equals":
          return hay === needle;
        case "notEquals":
          return hay !== needle;
        case "startsWith":
          return hay.startsWith(needle);
        case "endsWith":
          return hay.endsWith(needle);
        default:
          return false;
      }
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @pretable/grid-core test -- evaluate-filter`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add packages/grid-core/src/types.ts packages/grid-core/src/evaluate-filter.ts packages/grid-core/src/__tests__/evaluate-filter.test.ts
git commit -m "feat(grid-core): typed filter operators + pure evaluateFilter"
```

---

## Task 2: Wire operators into the engine (grid-core)

**Files:**

- Modify: `packages/grid-core/src/derived-rows.ts`
- Modify: `packages/grid-core/src/create-grid-core.ts`
- Modify: `packages/grid-core/src/types.ts` (retype snapshot + engine)
- Test: `packages/grid-core/src/__tests__/grid-core.test.ts` (extend)

- [ ] **Step 1: Retype snapshot + engine in `types.ts`**

- `PretableGridSnapshot.filters`: `Record<string, string>` → `Record<string, ColumnFilter>`.
- In `PretableEngine`, replace:

  ```ts
  setFilter(columnId: string, value: string): void;
  clearFilters(): void;
  replaceFilters(nextFilters: Record<string, string>): void;
  ```

  with:

  ```ts
  setColumnFilter(columnId: string, filter: ColumnFilter | null): void;
  clearFilters(): void;
  replaceFilters(nextFilters: Record<string, ColumnFilter>): void;
  distinctColumnValues(columnId: string): string[];
  ```

- [ ] **Step 2: Rewrite filter logic in `derived-rows.ts`**

Replace the `import` to add `ColumnFilter`, and replace `ResolvedFilter`, `resolveFilters`, `matchesFilters`, and the `deriveVisibleRows` filters type:

```ts
import type {
  ColumnFilter,
  PretableColumn,
  PretableGridOptions,
  PretableRow,
  PretableVisibleRow,
  PretableSortState,
} from "./types";
import { evaluateFilter, isFilterActive } from "./evaluate-filter";
```

```ts
export function deriveVisibleRows<TRow extends PretableRow>(input: {
  columns: PretableColumn<TRow>[];
  filters: Record<string, ColumnFilter>;
  rows: SourceRow<TRow>[];
  sort: PretableSortState;
}): PretableVisibleRow<TRow>[] {
  const resolvedFilters = resolveFilters(input.columns, input.filters);
  const filtered = input.rows.filter((entry) =>
    matchesFilters(entry.row, resolvedFilters),
  );
  const sorted = sortRows(filtered, input.columns, input.sort);
  return sorted.map(({ id, row, sourceIndex }) => ({ id, row, sourceIndex }));
}

interface ResolvedFilter<TRow extends PretableRow> {
  column: PretableColumn<TRow>;
  filter: ColumnFilter;
}

function resolveFilters<TRow extends PretableRow>(
  columns: PretableColumn<TRow>[],
  filters: Record<string, ColumnFilter>,
): ResolvedFilter<TRow>[] {
  const columnMap = new Map(columns.map((c) => [c.id, c]));
  const resolved: ResolvedFilter<TRow>[] = [];
  for (const [columnId, filter] of Object.entries(filters)) {
    if (!filter || !isFilterActive(filter)) continue;
    const column = columnMap.get(columnId);
    if (!column || column.filterable === false) continue;
    resolved.push({ column, filter });
  }
  return resolved;
}

function matchesFilters<TRow extends PretableRow>(
  row: TRow,
  resolvedFilters: ResolvedFilter<TRow>[],
): boolean {
  for (const { column, filter } of resolvedFilters) {
    const cell = readCellValue(row, column);
    if (
      !evaluateFilter(
        cell,
        column.filterType ?? "text",
        filter.operator,
        filter.value,
      )
    ) {
      return false;
    }
  }
  return true;
}
```

(Keep `sortRows`, `readCellValue`, `collator` unchanged.)

- [ ] **Step 3: Update `create-grid-core.ts`**

1. State + cache types:

   ```ts
   let cachedDerivedFilters: Record<string, ColumnFilter> | null = null;
   let filters: Record<string, ColumnFilter> = {};
   ```

   (Add `ColumnFilter` to the existing type import from `./types`.)

2. Replace `setFilter` (the whole method, `:121-143`) with:

   ```ts
   setColumnFilter(columnId: string, filter: ColumnFilter | null) {
     const current = filters[columnId];
     if (filter && isFilterActive(filter)) {
       if (current && columnFilterEqual(current, filter)) return;
       filters = { ...filters, [columnId]: filter };
     } else {
       if (current === undefined) return;
       const next = { ...filters };
       delete next[columnId];
       filters = next;
     }
     emit();
   },
   ```

3. Replace `replaceFilters` body to normalize via `isFilterActive` and compare with the new `filtersEqual`:

   ```ts
   replaceFilters(nextFilters: Record<string, ColumnFilter>) {
     const normalized: Record<string, ColumnFilter> = {};
     for (const [columnId, filter] of Object.entries(nextFilters)) {
       if (filter && isFilterActive(filter)) normalized[columnId] = filter;
     }
     if (filtersEqual(filters, normalized)) return;
     filters = normalized;
     emit();
   },
   ```

4. `clearFilters` stays as-is (already type-agnostic).

5. Add `distinctColumnValues` to the `store` object (it has `sourceRows` + `options` in closure scope):

   ```ts
   distinctColumnValues(columnId: string): string[] {
     const column = options.columns.find((c) => c.id === columnId);
     if (!column) return [];
     const seen = new Set<string>();
     for (const entry of sourceRows) {
       const raw = column.value ? column.value(entry.row) : entry.row[columnId];
       if (raw === null || raw === undefined) continue;
       const s = String(raw);
       if (s.trim() === "") continue;
       seen.add(s);
     }
     return [...seen].sort((a, b) => a.localeCompare(b));
   },
   ```

6. Snapshot: `filters: { ...filters },` stays (shallow copy of the record; `ColumnFilter` values are treated as immutable).

7. Replace `filtersEqual` (`:990`) with a structural version + add `columnFilterEqual`:

   ```ts
   function columnFilterEqual(a: ColumnFilter, b: ColumnFilter): boolean {
     if (a.operator !== b.operator) return false;
     const av = a.value;
     const bv = b.value;
     if (Array.isArray(av) && Array.isArray(bv)) {
       return av.length === bv.length && av.every((v, i) => v === bv[i]);
     }
     return av === bv;
   }

   function filtersEqual(
     a: Record<string, ColumnFilter>,
     b: Record<string, ColumnFilter>,
   ): boolean {
     const aKeys = Object.keys(a);
     const bKeys = Object.keys(b);
     if (aKeys.length !== bKeys.length) return false;
     for (const key of aKeys) {
       const av = a[key];
       const bv = b[key];
       if (!av || !bv || !columnFilterEqual(av, bv)) return false;
     }
     return true;
   }
   ```

8. Add `isFilterActive` to the imports from `./evaluate-filter` at the top of the file.

- [ ] **Step 4: Extend `grid-core.test.ts`**

Add tests (use the file's existing grid-construction helpers; mirror its style):

```ts
it("setColumnFilter applies an operator and AND-combines across columns", () => {
  const grid = makeGrid(); // however the file builds a grid with rows
  grid.setColumnFilter("status", { operator: "equals", value: "open" });
  // expect only matching rows in snapshot.visibleRows ...
  grid.setColumnFilter("priority", { operator: "gt", value: 2 });
  // expect rows matching BOTH ...
  grid.setColumnFilter("status", null); // removes
  // ...
});

it("replaceFilters drops inactive filters and is change-guarded", () => {
  const grid = makeGrid();
  grid.replaceFilters({ status: { operator: "contains", value: "" } }); // inactive
  expect(Object.keys(grid.getSnapshot().filters)).toHaveLength(0);
});

it("distinctColumnValues returns sorted de-duped non-empty values", () => {
  const grid = makeGrid();
  expect(grid.distinctColumnValues("status")).toEqual([
    /* sorted distinct */
  ]);
});
```

Adapt assertions to the file's actual fixture data. Verify `snapshot.filters` is typed/usable as `Record<string, ColumnFilter>`.

- [ ] **Step 5: Run grid-core tests + typecheck the package**

Run: `pnpm --filter @pretable/grid-core test`
Run: `pnpm --filter @pretable/grid-core typecheck` (or `pnpm -r typecheck` — note `core`/`react`/website will still fail until Task 3; that's expected at this step).
Expected: grid-core tests PASS; grid-core typechecks.

- [ ] **Step 6: Commit**

```bash
git add packages/grid-core
git commit -m "feat(grid-core): operator-based filter engine (setColumnFilter, distinctColumnValues)"
```

---

## Task 3: Propagate to public API (`core` + `react`)

**Files:**

- Modify: `packages/core/src/pretable-grid.ts`, `create-grid.ts`, `public_api.ts`
- Modify: `packages/react/src/use-pretable.ts`, `public_api.ts`

- [ ] **Step 1: `core/src/pretable-grid.ts`** — in the `PretableGrid` interface, replace the three filter method signatures (`:39-41`) with:

```ts
  setColumnFilter(columnId: string, filter: ColumnFilter | null): void;
  clearFilters(): void;
  replaceFilters(nextFilters: Record<string, ColumnFilter>): void;
  distinctColumnValues(columnId: string): string[];
```

Add `ColumnFilter` to the type import from `@pretable-internal/grid-core` (match how this file imports other engine types).

- [ ] **Step 2: `core/src/create-grid.ts`** — update forwarding (`:34-37`):

```ts
    setSort: engine.setSort,
    setColumnFilter: engine.setColumnFilter,
    clearFilters: engine.clearFilters,
    replaceFilters: engine.replaceFilters,
    distinctColumnValues: engine.distinctColumnValues,
```

(Remove the old `setFilter` line.) If any JSDoc example in this file uses `setFilter(...)`, update it to `setColumnFilter("age", { operator: "gt", value: 30 })`.

- [ ] **Step 3: `core/src/public_api.ts`** — export the new types. Add to the existing `export type { ... } from "@pretable-internal/grid-core"` block (or wherever types are re-exported):

```ts
  ColumnFilter,
  FilterOperator,
  FilterType,
  FilterValue,
  FilterOption,
```

- [ ] **Step 4: `react/src/use-pretable.ts`** — retype the controlled slice:
- Import `ColumnFilter` from `@pretable/core`.
- `PretableSurfaceState.filters?: Record<string, string>` → `Record<string, ColumnFilter>` (`:76`).
- The controlled-apply call `grid.replaceFilters(state.filters)` (~:230) is unchanged in shape — it now passes the new type. Confirm it compiles.

- [ ] **Step 5: `react/src/public_api.ts`** — re-export the new types (mirror Step 3's list) so consumers can import them from `@pretable/react`.

- [ ] **Step 6: Typecheck the packages**

Run: `pnpm --filter @pretable/core typecheck && pnpm --filter @pretable/react typecheck`
Expected: PASS. (Website still pending Task 4.)

- [ ] **Step 7: Commit**

```bash
git add packages/core packages/react
git commit -m "feat(core,react): expose operator filter API (setColumnFilter, filter types)"
```

---

## Task 4: Migrate website + regenerate API reports + full validation

**Files:**

- Modify: `apps/website/app/components/heroGrid/filters.ts` (+ `__tests__/filters.test.ts`)
- Modify: `*.api.md` (generated)

- [ ] **Step 1: Migrate `buildFilters`** in `apps/website/app/components/heroGrid/filters.ts`

Change the return type to `Record<string, ColumnFilter>` (import from `@pretable/core`) and emit operator filters:

- search term → `{ symbol: { operator: "contains", value: search } }` (only when non-empty)
- sector (when not "All") → `{ sector: { operator: "isAnyOf", value: [sector] } }`

Keep the same "omit when empty / All" behavior. Update `filters.test.ts` expectations to the new shape (e.g. `expect(buildFilters({search:"nv",sector:"All"})).toEqual({ symbol: { operator: "contains", value: "nv" } })`).

`HeroGrid.tsx` passes the result straight into `state={{ filters: filterMap }}`; with `PretableSurfaceState.filters` retyped this compiles unchanged. If the hero declares an explicit type for `filterMap`, update it.

Optionally (nice, not required): set `filterType: "enum"` on the hero's `sector` column and `filterType:"text"` on `symbol` in `positionColumns.tsx` — harmless and exercises the new field. Keep minimal if it risks scope creep.

- [ ] **Step 2: Regenerate API reports**

Run: `pnpm api`
This rewrites `packages/core/.../core.api.md` and `packages/react/.../react.api.md` (and any others). Review the diff: it should show the new `ColumnFilter`/`FilterOperator`/`FilterType`/`FilterValue`/`FilterOption` exports and the changed `setColumnFilter`/`distinctColumnValues`/retyped `filters`. Commit the updated reports.

- [ ] **Step 3: Full validation sweep (repo + website)**

Run:

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm format
pnpm --filter @pretable/app-website build
pnpm api  # second run must be a no-op (clean) — proves reports are committed/fresh
```

Expected: all green; the second `pnpm api` reports no changes. Fix anything red (run `pnpm format:write` if format check fails).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(website): migrate buildFilters to operator model; refresh API reports"
```

---

## Self-Review notes (for the executor)

- **Spec coverage:** operators text/number/enum/date + shared empty (Task 1) ✓; per-column `filterType`/`filterable`/`filterOptions` (Task 1 types; `filterable`/`filterType` honored in Task 2) ✓; AND-combination + non-existent/`filterable:false` ignored + inactive-passes (Task 2) ✓; `setColumnFilter`/`replaceFilters`/`clearFilters`/`distinctColumnValues`/snapshot retype (Tasks 2–3) ✓; public exports (Task 3) ✓; website migration + api refresh (Task 4) ✓.
- **No backcompat:** `setFilter` is removed, not aliased. Grep the repo for any other `setFilter(` / `.filters` string usages before finishing Task 4 and migrate them.
- **Type consistency:** `ColumnFilter`, `FilterOperator`, `FilterType`, `FilterValue`, `FilterOption`, `evaluateFilter`, `isFilterActive`, `setColumnFilter`, `distinctColumnValues`, `columnFilterEqual`, `filtersEqual` are used identically across tasks.
- **`filterOptions` consumer:** only the engine field + auto-derive helper (`distinctColumnValues`) exist here; the menu that reads them is sub-project 2. That's intended — `filterOptions`/`distinctColumnValues` are dormant-but-tested in this sub-project.
- **api gate:** Task 4 Step 2/3 are load-bearing — the "API Extractor — report freshness" check is required on main.
