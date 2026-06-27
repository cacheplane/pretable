# Filter Header Menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A built-in per-column header filter menu in `@pretable/react` (funnel → popover with operator select + typed value control), styled in `@pretable/ui`, driving the merged engine filter API. On-by-default for `filterable` columns; live-apply; uncontrolled or controlled via `state.filters`; fires `onFiltersChange`.

**Architecture:** A pure `filter-operators.ts` module (operators-per-type, value-shape, completeness gating, draft↔`ColumnFilter` conversion) underpins three React components (`FunnelButton`, `FilterMenu`, plus a `useFilterPopover` open/position hook). The surface renders one funnel **overlay** per header (absolutely-positioned sibling of the resize handle — the header is itself a `<button>`, so the funnel must NOT nest inside it) and a single `FilterMenu` dialog at the surface root (fixed-position, mirroring the reorder ghost, to escape header clipping). CSS lives in `@pretable/ui/grid.css` via `:where()` + `data-pretable-filter-*`.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library, vanilla CSS (no Tailwind in packages, no runtime deps). api-extractor (required gate). Commands: `pnpm -r typecheck`/`lint`/`test`, `pnpm --filter @pretable/react test`, `pnpm format`(check)/`format:write`, `pnpm api`.

**Key facts (verified against code):**
- Engine API (merged #180): `grid.setColumnFilter(id, ColumnFilter | null)`, `grid.replaceFilters(Record<string,ColumnFilter>)`, `grid.distinctColumnValues(id): string[]`, `snapshot.filters: Record<string,ColumnFilter>`. Types `ColumnFilter`/`FilterOperator`/`FilterType`/`FilterOption`/`FilterValue` are exported from `@pretable/core` and re-exported from `@pretable/react` (`react/src/public_api.ts:61-64`). Columns carry `filterType`/`filterOptions`/`filterable`.
- Header render: `pretable-surface.tsx` returns per-column an array `[<button role="columnheader" …>, resizeHandle?]` (header button ~`:1281`, resize handle ~`:1479`). `effWidth`, `plannedCol.left`, `plannedCol.pinned`, `pinnedOffset` are in scope. The resize handle is `position:absolute; top:0; height:100%; width:4; left: plannedCol.left + effWidth - 4; zIndex:4` with a `handlePinnedStyle` (sticky) for pinned columns. **Mirror this for the funnel overlay**, offset further left.
- Props: `PretableSurfaceProps` (~`:188-287`) has `onSortChange`, `onColumnWidthsChange`, etc.; destructured ~`:428-451`. Controlled `state.filters` already applies via `usePretable` (`use-pretable.ts`, `grid.replaceFilters(state.filters)`).
- Snapshot is available in the surface as `snapshot` (from `usePretable`), so `snapshot.filters[id]` gives a column's active filter and the funnel's active state.
- CSS: `grid.css` uses `@layer pretable` + `:where([data-pretable-*])`; existing `[data-pretable-popover]` rule (~`:222`) uses `--pretable-bg-tooltip`/`--pretable-rule`/`--pretable-radius`. Token contract test: `packages/ui/src/__tests__/contract.test.ts` (TOKENS list, 42 tokens) — only touch if adding a token.
- Tests: `packages/react/src/__tests__/pretable-surface.test.tsx` (sort-click test ~`:240` to mirror). RTL via `@testing-library/react`.

---

## File Structure

New under `packages/react/src/filter-menu/`:
- `filter-operators.ts` — pure helpers (no React).
- `FunnelButton.tsx` — header funnel overlay button.
- `useFilterPopover.ts` — open-state + fixed-position-from-rect + outside-click/Escape.
- `FilterMenu.tsx` — the popover dialog.
- `index.ts` — barrel for the above (internal).

Modified:
- `packages/react/src/pretable-surface.tsx` — funnel overlay per header, single `FilterMenu` at root, `onFiltersChange` prop.
- `packages/ui/src/grid.css` — `data-pretable-filter-*` styling.
- Tests: `packages/react/src/__tests__/filter-operators.test.ts`, `packages/react/src/__tests__/filter-menu.test.tsx`.
- `packages/react/react.api.md` — regenerated.

---

## Task 1: `filter-operators.ts` (pure helpers, fully tested)

**Files:**
- Create: `packages/react/src/filter-menu/filter-operators.ts`
- Test: `packages/react/src/__tests__/filter-operators.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/react/src/__tests__/filter-operators.test.ts
import { describe, expect, it } from "vitest";
import {
  operatorsForType,
  operatorValueShape,
  isComplete,
  toColumnFilter,
  fromColumnFilter,
  OPERATOR_LABELS,
  type FilterDraft,
} from "../filter-menu/filter-operators";

describe("operatorsForType", () => {
  it("lists the operators for each type incl. shared empties", () => {
    expect(operatorsForType("text")).toEqual([
      "contains", "notContains", "equals", "notEquals",
      "startsWith", "endsWith", "isEmpty", "isNotEmpty",
    ]);
    expect(operatorsForType("number")).toEqual([
      "equals", "notEquals", "gt", "gte", "lt", "lte",
      "between", "isEmpty", "isNotEmpty",
    ]);
    expect(operatorsForType("date")).toEqual([
      "on", "before", "after", "dateBetween", "isEmpty", "isNotEmpty",
    ]);
    expect(operatorsForType("enum")).toEqual([
      "isAnyOf", "isNoneOf", "isEmpty", "isNotEmpty",
    ]);
  });
  it("every operator has a label", () => {
    for (const t of ["text", "number", "date", "enum"] as const)
      for (const op of operatorsForType(t))
        expect(OPERATOR_LABELS[op]).toBeTruthy();
  });
});

describe("operatorValueShape", () => {
  it("classifies operators", () => {
    expect(operatorValueShape("contains")).toBe("single");
    expect(operatorValueShape("between")).toBe("range");
    expect(operatorValueShape("dateBetween")).toBe("range");
    expect(operatorValueShape("isAnyOf")).toBe("set");
    expect(operatorValueShape("isEmpty")).toBe("none");
    expect(operatorValueShape("isNotEmpty")).toBe("none");
  });
});

describe("isComplete + toColumnFilter (gating)", () => {
  it("text single value", () => {
    const d: FilterDraft = { operator: "contains", text: "ab" };
    expect(isComplete("text", d)).toBe(true);
    expect(toColumnFilter("text", d)).toEqual({ operator: "contains", value: "ab" });
    expect(isComplete("text", { operator: "contains", text: "" })).toBe(false);
    expect(toColumnFilter("text", { operator: "contains", text: "" })).toBeNull();
  });
  it("number single + parses", () => {
    expect(toColumnFilter("number", { operator: "gt", text: "5" }))
      .toEqual({ operator: "gt", value: 5 });
    expect(toColumnFilter("number", { operator: "gt", text: "x" })).toBeNull();
  });
  it("between needs both bounds", () => {
    expect(isComplete("number", { operator: "between", min: "1", max: "" })).toBe(false);
    expect(toColumnFilter("number", { operator: "between", min: "1", max: "" })).toBeNull();
    expect(toColumnFilter("number", { operator: "between", min: "1", max: "10" }))
      .toEqual({ operator: "between", value: [1, 10] });
  });
  it("dateBetween needs both ISO bounds", () => {
    expect(toColumnFilter("date", { operator: "dateBetween", min: "2026-01-01", max: "" })).toBeNull();
    expect(toColumnFilter("date", { operator: "dateBetween", min: "2026-01-01", max: "2026-02-01" }))
      .toEqual({ operator: "dateBetween", value: ["2026-01-01", "2026-02-01"] });
  });
  it("date single", () => {
    expect(toColumnFilter("date", { operator: "before", text: "2026-06-18" }))
      .toEqual({ operator: "before", value: "2026-06-18" });
  });
  it("enum set; empty selection is incomplete", () => {
    expect(isComplete("enum", { operator: "isAnyOf", selected: [] })).toBe(false);
    expect(toColumnFilter("enum", { operator: "isAnyOf", selected: [] })).toBeNull();
    expect(toColumnFilter("enum", { operator: "isAnyOf", selected: ["a", "b"] }))
      .toEqual({ operator: "isAnyOf", value: ["a", "b"] });
  });
  it("none-shape ops are always complete with no value", () => {
    expect(isComplete("text", { operator: "isEmpty" })).toBe(true);
    expect(toColumnFilter("text", { operator: "isEmpty" })).toEqual({ operator: "isEmpty" });
  });
});

describe("fromColumnFilter (hydrate)", () => {
  it("round-trips each shape", () => {
    expect(fromColumnFilter("text", { operator: "contains", value: "ab" }))
      .toEqual({ operator: "contains", text: "ab" });
    expect(fromColumnFilter("number", { operator: "between", value: [1, 10] }))
      .toEqual({ operator: "between", min: "1", max: "10" });
    expect(fromColumnFilter("enum", { operator: "isAnyOf", value: ["a"] }))
      .toEqual({ operator: "isAnyOf", selected: ["a"] });
    expect(fromColumnFilter("text", { operator: "isEmpty" }))
      .toEqual({ operator: "isEmpty" });
  });
  it("returns a default draft for null", () => {
    expect(fromColumnFilter("text", null)).toEqual({ operator: "contains", text: "" });
    expect(fromColumnFilter("enum", null)).toEqual({ operator: "isAnyOf", selected: [] });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter @pretable/react test -- filter-operators`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `filter-operators.ts`**

```ts
// packages/react/src/filter-menu/filter-operators.ts
import type { ColumnFilter, FilterOperator, FilterType } from "@pretable/core";

/** Local editing shape for the popover. One field set per value-shape. */
export interface FilterDraft {
  operator: FilterOperator;
  text?: string;            // single (text/number/date)
  min?: string;             // range lower
  max?: string;             // range upper
  selected?: string[];      // set (enum)
}

export type ValueShape = "none" | "single" | "range" | "set";

const TEXT_OPS: FilterOperator[] = [
  "contains", "notContains", "equals", "notEquals", "startsWith", "endsWith",
];
const NUMBER_OPS: FilterOperator[] = [
  "equals", "notEquals", "gt", "gte", "lt", "lte", "between",
];
const DATE_OPS: FilterOperator[] = ["on", "before", "after", "dateBetween"];
const ENUM_OPS: FilterOperator[] = ["isAnyOf", "isNoneOf"];
const SHARED_OPS: FilterOperator[] = ["isEmpty", "isNotEmpty"];

export function operatorsForType(type: FilterType): FilterOperator[] {
  const base =
    type === "number" ? NUMBER_OPS
    : type === "date" ? DATE_OPS
    : type === "enum" ? ENUM_OPS
    : TEXT_OPS;
  return [...base, ...SHARED_OPS];
}

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains: "contains",
  notContains: "does not contain",
  equals: "equals",
  notEquals: "does not equal",
  startsWith: "starts with",
  endsWith: "ends with",
  gt: "greater than",
  gte: "greater than or equal",
  lt: "less than",
  lte: "less than or equal",
  between: "is between",
  isAnyOf: "is any of",
  isNoneOf: "is none of",
  on: "on",
  before: "before",
  after: "after",
  dateBetween: "is between",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
};

const RANGE_OPS = new Set<FilterOperator>(["between", "dateBetween"]);
const SET_OPS = new Set<FilterOperator>(["isAnyOf", "isNoneOf"]);
const NONE_OPS = new Set<FilterOperator>(["isEmpty", "isNotEmpty"]);

export function operatorValueShape(op: FilterOperator): ValueShape {
  if (NONE_OPS.has(op)) return "none";
  if (RANGE_OPS.has(op)) return "range";
  if (SET_OPS.has(op)) return "set";
  return "single";
}

export function defaultDraft(type: FilterType): FilterDraft {
  const operator = operatorsForType(type)[0]!;
  if (operatorValueShape(operator) === "set") return { operator, selected: [] };
  if (operatorValueShape(operator) === "range") return { operator, min: "", max: "" };
  return { operator, text: "" };
}

const isNum = (s: string | undefined): s is string =>
  s !== undefined && s.trim() !== "" && !Number.isNaN(Number(s));

export function isComplete(type: FilterType, d: FilterDraft): boolean {
  const shape = operatorValueShape(d.operator);
  if (shape === "none") return true;
  if (shape === "set") return (d.selected?.length ?? 0) > 0;
  if (shape === "range") {
    if (type === "number") return isNum(d.min) && isNum(d.max);
    return !!d.min && !!d.max; // date ISO strings
  }
  // single
  if (type === "number") return isNum(d.text);
  return !!d.text && d.text.trim() !== "";
}

export function toColumnFilter(type: FilterType, d: FilterDraft): ColumnFilter | null {
  const shape = operatorValueShape(d.operator);
  if (shape === "none") return { operator: d.operator };
  if (!isComplete(type, d)) return null;
  if (shape === "set") return { operator: d.operator, value: [...d.selected!] };
  if (shape === "range") {
    if (type === "number") return { operator: d.operator, value: [Number(d.min), Number(d.max)] };
    return { operator: d.operator, value: [d.min!, d.max!] };
  }
  // single
  if (type === "number") return { operator: d.operator, value: Number(d.text) };
  return { operator: d.operator, value: d.text! };
}

export function fromColumnFilter(type: FilterType, filter: ColumnFilter | null): FilterDraft {
  if (!filter) return defaultDraft(type);
  const { operator, value } = filter;
  const shape = operatorValueShape(operator);
  if (shape === "none") return { operator };
  if (shape === "set") return { operator, selected: Array.isArray(value) ? value.map(String) : [] };
  if (shape === "range") {
    const arr = Array.isArray(value) ? value : ["", ""];
    return { operator, min: String(arr[0] ?? ""), max: String(arr[1] ?? "") };
  }
  return { operator, text: value === null || value === undefined ? "" : String(value) };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @pretable/react test -- filter-operators`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/filter-menu/filter-operators.ts packages/react/src/__tests__/filter-operators.test.ts
git commit -m "feat(react): pure filter-operators helpers for the header menu"
```

---

## Task 2: `FunnelButton`, `useFilterPopover`, `FilterMenu` components (+ direct RTL tests)

**Files:**
- Create: `packages/react/src/filter-menu/FunnelButton.tsx`, `useFilterPopover.ts`, `FilterMenu.tsx`, `index.ts`
- Test: `packages/react/src/__tests__/filter-menu.test.tsx` (component-level, rendering `FilterMenu` directly)

- [ ] **Step 1: Write `FunnelButton.tsx`**

A presentational button (the surface positions it). Inline-SVG funnel; no icon font.

```tsx
// packages/react/src/filter-menu/FunnelButton.tsx
import type { CSSProperties } from "react";

export function FunnelButton({
  columnId,
  label,
  active,
  open,
  style,
  onToggle,
}: {
  columnId: string;
  label: string;
  active: boolean;
  open: boolean;
  style?: CSSProperties;
  onToggle: (columnId: string) => void;
}) {
  return (
    <button
      type="button"
      data-pretable-filter-funnel=""
      data-pretable-column-id={columnId}
      data-pretable-filter-active={active ? "true" : "false"}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`Filter ${label}`}
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(columnId);
      }}
    >
      <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">
        <path d="M1.5 2.5h13l-5 6v4l-3 1.5v-5.5l-5-6z" fill="currentColor" />
      </svg>
    </button>
  );
}
```

(The `stopPropagation` on pointer-down/click is belt-and-suspenders even though the funnel is a sibling of — not a child of — the header sort button.)

- [ ] **Step 2: Write `useFilterPopover.ts`** — open-state + position-from-rect + dismiss.

```tsx
// packages/react/src/filter-menu/useFilterPopover.ts
import { useCallback, useEffect, useState } from "react";

export interface PopoverState {
  columnId: string;
  rect: DOMRect;
}

export function useFilterPopover() {
  const [openState, setOpenState] = useState<PopoverState | null>(null);

  const toggle = useCallback((columnId: string, anchorEl: HTMLElement | null) => {
    setOpenState((prev) => {
      if (prev?.columnId === columnId) return null;
      const rect = anchorEl?.getBoundingClientRect();
      return rect ? { columnId, rect } : null;
    });
  }, []);

  const close = useCallback(() => setOpenState(null), []);

  useEffect(() => {
    if (!openState) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // Close on scroll/resize so the popover never floats away from its anchor.
    const onViewportChange = () => close();
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [openState, close]);

  return { openState, toggle, close };
}

/** Fixed-position style from the anchor rect, flipped near the right/bottom edges. */
export function popoverStyle(rect: DOMRect): React.CSSProperties {
  const WIDTH = 240;
  const MARGIN = 8;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const left = Math.min(rect.left, vw - WIDTH - MARGIN);
  return {
    position: "fixed",
    top: rect.bottom + 4,
    left: Math.max(MARGIN, left),
    width: WIDTH,
    zIndex: 50,
  };
}
```

- [ ] **Step 3: Write `FilterMenu.tsx`** — the dialog. Renders operator `<select>` + value control by shape; live-applies via the `onChange` prop (debounced for `single`/`range` text inputs); a Clear button; hydrates draft from `initialFilter`; closes on outside-click.

Contract:
```tsx
export function FilterMenu({
  columnId, label, filterType, options, initialFilter, style, onChange, onClose,
}: {
  columnId: string;
  label: string;
  filterType: FilterType;
  options: { value: string; label?: string }[]; // enum choices (already resolved)
  initialFilter: ColumnFilter | null;
  style?: React.CSSProperties;
  onChange: (columnId: string, filter: ColumnFilter | null) => void; // null = clear
  onClose: () => void;
}): JSX.Element
```
Implementation notes (write idiomatic React; the exact JSX is yours but must satisfy the tests):
- `const [draft, setDraft] = useState(() => fromColumnFilter(filterType, initialFilter));`
- On operator change: reset value fields to the new shape's empty draft (keep selection only if still a set op), then push.
- A single `push(nextDraft)` helper computes `toColumnFilter(filterType, nextDraft)` and calls `onChange(columnId, result)` (result may be `null` → clears). For `single`/`range` **text** inputs, debounce `push` ~200ms (use a ref'd timer; flush on unmount); for `select`/`checkbox`/`date`/number-step changes call `push` immediately. (Simplest: debounce only the free-text `single` `text` input; number/date inputs can debounce too — acceptable. Keep one debounce path keyed on "is this a typed text field".)
- Value control by `operatorValueShape(draft.operator)`:
  - `none` → render nothing.
  - `single` → one `<input>` (`type="date"` when `filterType==="date"`, else `type="text"`/`inputMode="numeric"` for number) bound to `draft.text`.
  - `range` → two inputs bound to `draft.min`/`draft.max` (date or number).
  - `set` → a checkbox list from `options`; toggling updates `draft.selected`.
- Container: `<div role="dialog" aria-label={`Filter ${label}`} data-pretable-filter-menu="" data-pretable-popover="" style={style}>`. On mount, focus the operator `<select>`.
- Clear button: `data-pretable-filter-clear`, calls `onChange(columnId, null)` and resets draft to `defaultDraft`.
- Outside-click: a `useEffect` adding a `pointerdown` listener on `document`; if the target isn't inside the dialog root (ref), call `onClose()`.

- [ ] **Step 4: `index.ts` barrel**

```ts
export { FunnelButton } from "./FunnelButton";
export { FilterMenu } from "./FilterMenu";
export { useFilterPopover, popoverStyle } from "./useFilterPopover";
```

- [ ] **Step 5: Write `filter-menu.test.tsx` (component-level)** — render `FilterMenu` directly with a spy `onChange` and fake timers. Cover:
  - text column: default operator `contains`; type into the value input → after debounce, `onChange("c", {operator:"contains", value:"…"})`.
  - switch operator to `isEmpty` → value input disappears; `onChange("c", {operator:"isEmpty"})` immediately.
  - number column `between`: fill only min → `onChange` last call is `null` (cleared); fill both → `{operator:"between", value:[min,max]}`.
  - enum column: render options as checkboxes; check two → `{operator:"isAnyOf", value:[...]}`; uncheck all → `null`.
  - Clear button → `onChange("c", null)`.
  - dialog has `role="dialog"` + accessible name; operator select is focused on mount.

  Use `vi.useFakeTimers()` + `await vi.advanceTimersByTimeAsync(250)` around debounced assertions; wrap interactions in `act`.

- [ ] **Step 6: Run tests + typecheck the package**

Run: `pnpm --filter @pretable/react test -- filter-menu` and `pnpm --filter @pretable/react typecheck`.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/filter-menu packages/react/src/__tests__/filter-menu.test.tsx
git commit -m "feat(react): FunnelButton, FilterMenu, useFilterPopover components"
```

---

## Task 3: Wire into the surface + `@pretable/ui` CSS + integration test

**Files:**
- Modify: `packages/react/src/pretable-surface.tsx`
- Modify: `packages/ui/src/grid.css`
- Test: extend `packages/react/src/__tests__/filter-menu.test.tsx` with surface-integration cases (or a new `filter-menu-surface.test.tsx`).

- [ ] **Step 1: Add the `onFiltersChange` prop**

In `PretableSurfaceProps`, after `onTelemetryChange` (~`:235`):
```ts
  onFiltersChange?: (filters: Record<string, ColumnFilter>) => void;
```
Import `ColumnFilter` from `@pretable/core` if not already. Destructure `onFiltersChange` in the component signature (~`:428-451`).

- [ ] **Step 2: Funnel overlay per header**

Bring in the popover hook near the other surface hooks:
```ts
const { openState, toggle, close } = useFilterPopover();
```
In the per-column header render (the array currently `[<button>, resizeHandle]`), append a funnel overlay element when `column.filterable !== false`. Position it like the resize handle but offset left of it (so it doesn't overlap the 4px resize strip):
```tsx
column.filterable !== false ? (
  <div
    key={`${column.id}::filter-funnel`}
    style={{
      position: "absolute",
      top: 0,
      height: "100%",
      display: "flex",
      alignItems: "center",
      left: plannedCol.left + effWidth - 22,
      zIndex: 4,
      ...(plannedCol.pinned === "left" && pinnedOffset !== undefined
        ? { position: "sticky", left: pinnedOffset + effWidth - 22, zIndex: 5 }
        : {}),
    }}
    data-pretable-filter-funnel-slot=""
  >
    <FunnelButton
      columnId={column.id}
      label={label}
      active={Boolean(snapshot.filters[column.id])}
      open={openState?.columnId === column.id}
      onToggle={(id) => {
        const slot = headerScrollRef.current?.querySelector(
          `[data-pretable-filter-funnel-slot] [data-pretable-column-id="${id}"]`,
        ) as HTMLElement | null;
        toggle(id, slot);
      }}
    />
  </div>
) : null,
```
Notes:
- `active` reads `snapshot.filters[column.id]` so the funnel stays lit while a filter is set.
- The anchor element passed to `toggle` is the funnel button itself (look it up by the column-id within the funnel slot, or thread a ref). Simplest robust approach: have `FunnelButton`'s `onToggle` receive the event and pass `e.currentTarget` up — change the `FunnelButton` `onClick` to `onToggle(columnId, e.currentTarget)` and the prop type to `(columnId: string, anchor: HTMLElement) => void`. Update Task 2's `FunnelButton` accordingly and pass `anchor` straight to `toggle`. (Prefer this over DOM querying.)
- Filter out the `null` entries when building the children array.

- [ ] **Step 3: Render one `FilterMenu` at the surface root**

Near where the reorder ghost is rendered (surface root, after the scroll container), add:
```tsx
{openState ? (() => {
  const col = effectiveColumns.find((c) => c.id === openState.columnId);
  if (!col) return null;
  const options =
    col.filterOptions ??
    grid.distinctColumnValues(openState.columnId).map((v) => ({ value: v }));
  return (
    <FilterMenu
      columnId={openState.columnId}
      label={col.header ?? openState.columnId}
      filterType={col.filterType ?? "text"}
      options={options}
      initialFilter={snapshot.filters[openState.columnId] ?? null}
      style={popoverStyle(openState.rect)}
      onChange={(id, filter) => {
        grid.setColumnFilter(id, filter);
        onFiltersChange?.(grid.getSnapshot().filters);
      }}
      onClose={close}
    />
  );
})() : null}
```
(Confirm the in-scope names for the planned columns + grid handle — `effectiveColumns`/`grid`/`snapshot` exist in the surface; adjust to the actual identifiers.)

- [ ] **Step 4: `@pretable/ui/grid.css`** — add filter styling (reuse tokens; no new tokens):

```css
:where([data-pretable-filter-funnel]) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: var(--pretable-radius);
  background: transparent;
  color: var(--pretable-text-dim);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.1s ease;
}
:where([data-pretable-header-cell]:hover ~ [data-pretable-filter-funnel-slot] [data-pretable-filter-funnel]),
:where([data-pretable-filter-funnel]:focus-visible),
:where([data-pretable-filter-funnel][data-pretable-filter-active="true"]) {
  opacity: 1;
}
:where([data-pretable-filter-funnel][data-pretable-filter-active="true"]) {
  color: var(--pretable-accent);
}
:where([data-pretable-filter-funnel]:hover) { background: var(--pretable-bg-hover); }

:where([data-pretable-filter-menu]) {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: var(--pretable-bg-tooltip);
  color: var(--pretable-text-cell);
  border: 1px solid var(--pretable-rule);
  border-radius: var(--pretable-radius);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
  font: inherit;
}
:where([data-pretable-filter-menu]) select,
:where([data-pretable-filter-menu]) input[type="text"],
:where([data-pretable-filter-menu]) input[type="date"],
:where([data-pretable-filter-menu]) input:not([type]) {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 7px;
  border: 1px solid var(--pretable-rule);
  border-radius: var(--pretable-radius);
  background: var(--pretable-bg-grid);
  color: var(--pretable-text-cell);
  font: inherit;
}
:where([data-pretable-filter-menu]) label {
  display: flex;
  gap: 6px;
  align-items: center;
}
:where([data-pretable-filter-clear]) {
  align-self: flex-end;
  background: transparent;
  border: 0;
  color: var(--pretable-accent);
  cursor: pointer;
  padding: 2px 4px;
}
```
Note: the hover selector relies on the funnel slot being a following-sibling of the header button within the header row. If the actual DOM nesting differs (e.g. funnel slot is a child of a wrapper, not a sibling of the header `<button>`), use the structurally-correct selector — the requirement is "funnel visible on header hover OR focus-within OR active". Verify against the rendered DOM and adjust the selector; do not ship a selector that doesn't actually match.

- [ ] **Step 5: Integration tests** (via `PretableSurface`): mirror the sort-click test setup. Cover:
  - A `filterable !== false` column renders a funnel (`[data-pretable-filter-funnel]`); a `filterable: false` column does not.
  - Clicking the funnel opens the dialog (`role="dialog"`); clicking it again / pressing Escape / outside-click closes it.
  - Clicking the funnel does NOT change sort (assert `onSortChange` not called; rows not reordered).
  - End-to-end: open funnel on a text column, type a value → `visibleRows`/`[data-pretable-row]` count drops, `onFiltersChange` fired with the column's `ColumnFilter`.
  - Enum column with no `filterOptions`: options come from `distinctColumnValues` (assert the checkbox labels match the column's distinct values).
  - Controlled `state.filters`: pass a filter in, assert the funnel shows active and the dialog hydrates to that operator/value.

- [ ] **Step 6: Run react tests + typecheck**

Run: `pnpm --filter @pretable/react test` and `pnpm --filter @pretable/react typecheck` and `pnpm --filter @pretable/ui test` (token contract still green — no tokens added).
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/pretable-surface.tsx packages/ui/src/grid.css packages/react/src/__tests__
git commit -m "feat(react,ui): built-in header filter menu wired into the surface"
```

---

## Task 4: API report + full validation

**Files:** `packages/react/react.api.md` (generated); whole repo.

- [ ] **Step 1: Regenerate API reports**

Run: `pnpm api`. Review the diff: `react.api.md` should gain `onFiltersChange` on `PretableSurfaceProps` (and nothing else unexpected — the filter-menu internals are NOT exported from `public_api.ts`, so they must not appear; if api-extractor reports a forgotten export, that means something internal got exported — fix the export, don't add it to the public surface). Commit the updated report.

- [ ] **Step 2: Full validation sweep**

Run from the worktree root:
```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm format
pnpm --filter @pretable/app-website build
pnpm api   # second run must be a clean no-op
```
All green; second `pnpm api` reports no changes. If `pnpm format` fails, run `pnpm format:write` and re-commit. (Website still uses controlled `state.filters` on the hero — confirm it still builds; the hero does NOT adopt the menu here.)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(api): refresh react report for onFiltersChange"
```

---

## Self-Review notes (for the executor)

- **Spec coverage:** pure operators module (Task 1) ✓; FunnelButton/useFilterPopover/FilterMenu (Task 2) ✓; surface wiring + on-by-default funnel + onFiltersChange + single root popover (Task 3) ✓; live-apply with `between`/`dateBetween` gating via `toColumnFilter`→`null` (Tasks 1–2) ✓; enum options from `filterOptions` or `distinctColumnValues` (Task 3) ✓; hover/focus/active visibility CSS (Task 3) ✓; a11y dialog + Escape + outside-click (Tasks 2–3) ✓; controlled `state.filters` hydrate (Tasks 2–3) ✓; api refresh (Task 4) ✓.
- **Invalid-HTML guard:** the funnel is a sibling overlay, NOT nested in the header `<button>`. Do not nest it.
- **No new tokens** unless unavoidable; if added, update both themes + `contract.test.ts` TOKENS (and `pnpm api` is unaffected, but the contract test must pass).
- **Don't export filter-menu internals** from `@pretable/react`'s `public_api.ts` — only `onFiltersChange` (a prop) is new public surface. Keep the components internal.
- **Out of scope:** hero adoption, docs page, e2e (sub-project 3).
- **Type consistency:** `FilterDraft`, `operatorsForType`, `operatorValueShape`, `isComplete`, `toColumnFilter`, `fromColumnFilter`, `defaultDraft`, `OPERATOR_LABELS`, `FunnelButton`, `FilterMenu`, `useFilterPopover`, `popoverStyle` used identically across tasks.
