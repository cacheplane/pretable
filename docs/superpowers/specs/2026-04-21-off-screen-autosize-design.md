# Off-Screen Autosize (S4) Design Spec

## Summary

Add automatic column width computation to pretable. Columns without explicit `widthPx` get their width estimated from content using character-count heuristics — no DOM rendering required. The feature runs eagerly on dataset load, integrates with column virtualization, and caps widths to prevent layout blowout.

## Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Optimization target | Content-fit with cap | Pairs with wrapped-text support; capped widths keep total scrollable area reasonable |
| 2 | Estimation method | Estimate-only (pure math, no DOM) | text-core heuristic is proven adequate for row heights; column widths are less sensitive; no layout shifts |
| 3 | Timing | Eager on dataset load | `planColumns()` needs all widths upfront for binary search; one-time cost is predictable |
| 4 | Package location | layout-core (pure function) + grid-core (store integration) | layout-core owns column geometry; grid-core stays focused on state; two layers serve different consumers |
| 5 | Explicit widthPx interaction | Skip columns with explicit `widthPx` | Zero new API surface; `widthPx` presence/absence is the opt-out signal |
| 6 | Width cap | Fixed default 400px, configurable | No viewport-width timing dependency; simple to reason about |
| 7 | Header text | Included in width calculation | Truncated headers look broken; trivial cost (one multiply per column) |
| 8 | Minimum width | 60px default, configurable | Prevents collapse on empty/single-char data; matches industry norms |

## API Surface — Three Layers

### Layer 1: Pure function in layout-core

The testable, framework-agnostic primitive. Takes explicit data, returns computed widths.

```typescript
export interface AutosizeColumnsInput<TRow extends Record<string, unknown>> {
  columns: AutosizeColumnDef<TRow>[];
  rows: TRow[];
  options?: AutosizeOptions;
}

export interface AutosizeColumnDef<TRow extends Record<string, unknown>> {
  id: string;
  header?: string;
  widthPx?: number;
  wrap?: boolean;
  getValue?: (row: TRow) => unknown;
}

export interface AutosizeOptions {
  maxWidthPx?: number;       // default 400
  minWidthPx?: number;       // default 60
  averageCharWidth?: number; // default 7
  cellPaddingPx?: number;    // default 16
}

export interface AutosizeResult {
  widths: Map<string, number>;
}

export function autosizeColumns<TRow extends Record<string, unknown>>(
  input: AutosizeColumnsInput<TRow>,
): AutosizeResult;
```

Columns with `widthPx` already set are skipped. The function does not import text-core — it uses the same `averageCharWidth` heuristic (default 7) inlined or passed via options.

### Layer 2: Imperative method on GridCoreStore

```typescript
export interface GridCoreStore<TRow extends GridCoreRow> {
  // ...existing methods...
  autosizeColumns(options?: AutosizeOptions): void;
}
```

Calls the layout-core function with the store's current columns and rows, applies resulting widths by creating new column objects with `widthPx` set (does not mutate the original column definitions), bumps internal version, and notifies subscribers.

### Layer 3: Declarative option on GridCoreOptions

```typescript
export interface GridCoreOptions<TRow extends GridCoreRow> {
  // ...existing fields...
  autosize?: boolean | AutosizeOptions;
}
```

- `autosize: true` — autosize on store creation with defaults
- `autosize: { maxWidthPx: 300 }` — autosize on store creation with custom config
- `autosize` omitted or `false` — no autosize (current behavior)

When enabled, the store calls `autosizeColumns()` internally after initialization, before the first snapshot is computed.

## Algorithm

Per column (skipping those with explicit `widthPx`):

1. **Header width** — If `header` is defined: `Array.from(header).length * averageCharWidth + cellPaddingPx`.

2. **Content scan** — For each row:
   - Extract value: `getValue(row)` if defined, otherwise `row[column.id]`
   - Coerce to string: `String(value)` (nullish becomes `""`)
   - Compute width: `Array.from(text).length * averageCharWidth + cellPaddingPx`
   - Track maximum content width

3. **Combine** — Raw width = `max(headerWidth, maxContentWidth)`.

4. **Clamp** — `clamp(rawWidth, minWidthPx, maxWidthPx)`.

### Why not reuse `prepareText()`?

Autosize only needs `graphemeCount * averageCharWidth` — a single multiply per cell. `prepareText()` additionally tokenizes (word/space/newline splitting), computes breakpoints, and allocates a `PreparedText` object. For S4's 5M cells, that overhead is unnecessary. The `averageCharWidth` constant comes from the same heuristic source.

### Performance expectation

S4: 25,000 rows x 200 columns = 5M cells. Each cell: one string coercion, one `Array.from().length`, one multiply, one comparison. No object allocation beyond the temporary string. Expected well under 100ms on modern hardware.

## Integration Points

### grid-core store

1. On creation, if `options.autosize` is truthy, run `autosizeColumns()` from layout-core against initial columns and rows. Apply resulting widths by creating new column objects with `widthPx` set (no mutation of original definitions) before the first snapshot.

2. Imperative `store.autosizeColumns(options?)` does the same on demand: calls layout-core function, patches column widths, bumps version, notifies subscribers.

3. Autosized columns are indistinguishable from explicitly-set widths downstream. `planColumns()`, `getColumnWidth()`, and the React renderer all see `widthPx` as a normal number. No special casing anywhere else.

### React layer

Minimal changes:

1. `usePretableModel` passes `options.autosize` through to `createGridCoreStore()` — passthrough of `GridCoreOptions`.
2. Playground app enables `autosize: true` for S4 scenarios.

### Renderer-dom

No changes. `createDomRenderSnapshot` already reads column widths via `getColumnWidth(col)`, which returns `col.widthPx ?? defaultWidth`. Autosized columns have `widthPx` set, taking the first branch.

### Scenario-data

`buildColumns()` currently hardcodes `widthPx` on every column. For S4 (which has `autosize_all_columns: true`), `buildColumns()` omits `widthPx` so autosize can compute widths. Other scenarios keep explicit widths — unaffected.

### Dependency graph

```
layout-core (autosizeColumns function, no new deps)
    ^
grid-core (imports autosizeColumns, calls on init/imperative)
    ^
react (passes autosize option through)
    ^
playground / bench (enables autosize: true for S4)
```

layout-core does NOT gain a dependency on text-core. The `averageCharWidth` constant is inlined (default 7) or passed via options.

## Benchmark Proof Surface

### S4 scenario (already registered)

- 25,000 rows, 200 columns, 1 pinned left, 2 wrapped columns
- `autosize_all_columns: true`
- mixed row heights

### What S4 proves

1. **Correctness** — Autosized columns have widths reflecting their content. Narrow-data columns are narrower than wide-data columns. No column below 60px or above 400px.

2. **Scroll quality** — Column virtualization works with varying autosize widths. `planColumns()` receives non-uniform widths and binary search + overscan still produce zero blank-gap frames.

3. **Computation cost** — Autosize pass for 25,000 x 200 completes in reasonable time. Benchmark telemetry captures autosize duration.

### Benchmark scripts

- `scroll` — proves scroll quality with variable-width columns (mirrors S3 scroll proof)
- No new interaction scripts needed — sort/filter/select don't interact with column widths

### Hypotheses

- **H13: Autosize computation** — `autosizeColumns()` completes in under 100ms for S4 dataset
- **H14: Scroll quality with autosize** — S4 scroll maintains zero blank-gap frames and zero long tasks, same standard as S3

### No-regression requirement

S1, S2, S3, S7 benchmarks must remain green. Autosize changes are additive — they only affect columns without explicit `widthPx`.

## Public API Documentation Contract

### Exported from `@pretable/core`

**Types:**
- `AutosizeOptions` — configuration for autosize behavior (`maxWidthPx`, `minWidthPx`, `averageCharWidth`, `cellPaddingPx`)

**Options:**
- `GridCoreOptions.autosize` — `boolean | AutosizeOptions` — enables automatic column width computation on grid creation

**Store method:**
- `GridCoreStore.autosizeColumns(options?)` — imperatively re-computes column widths from current data

### Exported from `@pretable-internal/layout-core` (internal for now)

- `autosizeColumns(input)` — pure function, framework-agnostic column width computation
- `AutosizeColumnsInput`, `AutosizeColumnDef`, `AutosizeResult` — supporting types

### Usage examples

Declarative:

```typescript
const store = createGridCoreStore({
  columns,
  rows,
  autosize: true,
});
```

With custom limits:

```typescript
const store = createGridCoreStore({
  columns,
  rows,
  autosize: { maxWidthPx: 300, minWidthPx: 80 },
});
```

Imperative re-computation:

```typescript
store.autosizeColumns();
```

### Key documentation points

- `widthPx` presence is the opt-out signal — no separate flag needed per column
- Header text is included in width calculation
- Works with column virtualization — all widths computed upfront
- Pure estimation, no DOM dependency — works in SSR and headless environments
- Deterministic — same data always produces same widths
