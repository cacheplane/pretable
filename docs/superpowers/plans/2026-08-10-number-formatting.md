# Native Number Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship opt-in native number formatting, transparent money/accounting helpers, locale-aware React rendering, and consistent aggregate and clipboard output without moving formatted strings into raw grid operations.

**Architecture:** `@pretable/core` owns the native option field and pure preset constructors. `@pretable/react` compiles one `Intl.NumberFormat` per configured column and locale, then routes data cells, aggregates, wrappers, and clipboard serialization through one precedence resolver while retaining channel-specific unformatted fallbacks. Locale remains React/serializer presentation context; the engine continues to process raw values only.

**Tech Stack:** TypeScript 6, React 19, `Intl.NumberFormat` / ECMA-402, Vitest + Testing Library + jsdom, React server rendering/hydration, API Extractor, Next.js MDX documentation, pnpm, Changesets.

**Design:** [`docs/superpowers/specs/2026-08-10-number-formatting-design.md`](../specs/2026-08-10-number-formatting-design.md)

---

## File map

### Core contract

- Modify `packages/grid-core/src/types.ts` — add the framework-neutral
  `PretableColumn.numberFormat` field.
- Create `packages/core/src/number-formats.ts` — pure `money` and `accounting`
  constructors plus their public input type.
- Modify `packages/core/src/public_api.ts` — export the constructors and type.
- Create `packages/core/src/__tests__/number-formats.test.ts` — runtime and
  type-level preset coverage.

### React formatting seam

- Create `packages/react/src/value-formatting.ts` — compile native formatters,
  add column context to construction errors, and resolve data/aggregate strings.
- Create `packages/react/src/__tests__/value-formatting.test.ts` — pure resolver,
  precedence, value-domain, error, and construction-count tests.
- Modify `packages/react/src/rendering.ts` — retain geometry/sort/value access;
  remove formatting helpers after every caller migrates.
- Modify `packages/react/src/pretable-surface.tsx` — add locale, memoize the
  registry, use it for data cells/groups/default copy, and pass locale to
  `onCopy`.
- Modify `packages/react/src/group-row.tsx` — accept the compiled registry and
  resolve inherited number formatting for aggregates.
- Modify `packages/react/src/copy.ts` — add locale to the public args and share
  the resolver between standalone and surface-owned serialization.
- Modify `packages/react/src/public_api.ts` — re-export `numberFormats` and
  `PretableCurrencyFormatOptions` from core.

### Public wrappers

- Modify `packages/react/src/pretable.tsx` — accept/forward locale and render
  `formattedValue` in its built-in body renderer.
- Modify `packages/react/src/labeled-grid-surface.tsx` — accept/forward locale,
  expose `formattedValue` to its beta callback, and preserve `column.render`
  precedence.
- Modify `packages/react/src/__tests__/pretable.test.tsx` and
  `packages/react/src/__tests__/labeled-grid-surface.test.tsx` — wrapper
  behavior and precedence.

### Integration evidence

- Create `packages/react/src/__tests__/number-formatting-surface.test.tsx` —
  cell formatting, locale updates, renderer input, raw sort/filter/edit
  invariants, construction budget, and explicit-locale hydration.
- Modify `packages/react/src/__tests__/group-row-render.test.tsx` — native
  aggregate inheritance and callback precedence.
- Modify `packages/react/src/__tests__/copy.test.ts` — plain/HTML clipboard,
  aggregate, locale, invalid configuration, and unformatted fallback coverage.
- Modify `packages/react/src/__tests__/paste-surface.test.tsx` — prove paste
  receives parsed raw values under number formatting.

### Consumer contract and release intent

- Create `apps/website/content/docs/grid/number-formatting.mdx` — canonical
  guide.
- Modify `apps/website/app/docs/_nav.ts` — add the guide to Grid navigation.
- Modify `apps/website/content/docs/grid/api-reference.mdx` — document the
  column field, helper exports, locale props, and input types.
- Modify `apps/website/content/docs/grid/pretable-component.mdx` — add locale.
- Modify `apps/website/content/docs/grid/pretable-surface.mdx` — add locale and
  labeled-wrapper precedence.
- Modify `apps/website/content/docs/grid/grouping.mdx` — explain native
  aggregate inheritance without weakening the `formatAggregate` rule.
- Modify `apps/website/content/docs/grid/clipboard.mdx` — add locale and the
  shared native formatting path.
- Modify `apps/website/content/docs/grid/cell-renderers.mdx` — replace its
  per-cell `new Intl.NumberFormat` example with the compiled column option.
- Modify `apps/website/e2e/docs.spec.ts` — assert the new page and nav entry.
- Modify `README.md` — add one concise finance-capable bullet and docs link.
- Modify `packages/core/core.api.md` and `packages/react/react.api.md` — generated
  public API truth.
- Create `.changeset/<generated-name>.md` — minor release intent for core and
  React; the fixed package group will align all four public package versions.

Do not manually edit package changelogs. Changesets generates them in the
version PR; the feature PR supplies release intent and refreshed API reports.

## Task 1: Add the core column contract and presets

**Files:**

- Modify: `packages/grid-core/src/types.ts`
- Create: `packages/core/src/number-formats.ts`
- Modify: `packages/core/src/public_api.ts`
- Create: `packages/core/src/__tests__/number-formats.test.ts`

- [ ] **Step 1: Write the failing core tests**

Create `packages/core/src/__tests__/number-formats.test.ts` with these cases:

```ts
import { describe, expect, it } from "vitest";

import {
  createGrid,
  numberFormats,
  type PretableColumn,
  type PretableCurrencyFormatOptions,
} from "../index";

describe("numberFormats", () => {
  it("builds plain money options without forcing fraction digits", () => {
    const options = numberFormats.money({
      currency: "JPY",
      currencyDisplay: "code",
    });

    expect(options).toEqual({
      currencyDisplay: "code",
      style: "currency",
      currency: "JPY",
      currencySign: "standard",
    });
    expect(Object.getPrototypeOf(options)).toBe(Object.prototype);
  });

  it("builds strict Intl accounting options", () => {
    expect(
      numberFormats.accounting({
        currency: "USD",
        maximumFractionDigits: 2,
      }),
    ).toEqual({
      maximumFractionDigits: 2,
      style: "currency",
      currency: "USD",
      currencySign: "accounting",
    });
  });

  it("forces preset-defining fields after untyped JavaScript input", () => {
    const unsafe = {
      currency: "USD",
      style: "percent",
      currencySign: "accounting",
    } as unknown as PretableCurrencyFormatOptions;

    expect(numberFormats.money(unsafe)).toMatchObject({
      style: "currency",
      currency: "USD",
      currencySign: "standard",
    });
  });

  it("is usable as plain native column configuration", () => {
    const column = {
      id: "amount",
      type: "number",
      numberFormat: numberFormats.money({ currency: "USD" }),
    } satisfies PretableColumn;

    expect(column.numberFormat.style).toBe("currency");
  });

  it("keeps transaction values raw under number formatting", () => {
    const grid = createGrid({
      columns: [
        {
          id: "amount",
          numberFormat: numberFormats.money({ currency: "USD" }),
        },
      ],
      rows: [{ id: "r1", amount: 1 }],
      getRowId: (row) => row.id,
    });

    grid.applyTransaction({ update: [{ id: "r1", amount: 7.5 }] });
    const row = grid.getSnapshot().visibleRows[0];
    expect(row?.kind).toBe("data");
    if (row?.kind === "data") expect(row.row.amount).toBe(7.5);
  });
});

// These properties define the preset and are intentionally unavailable as
// caller overrides.
// @ts-expect-error style is fixed by the helper
numberFormats.money({ currency: "USD", style: "percent" });
// @ts-expect-error currencySign is selected by money/accounting
numberFormats.accounting({ currency: "USD", currencySign: "standard" });
```

- [ ] **Step 2: Run the test to prove the public names do not exist**

Run:

```bash
pnpm --filter @pretable-internal/grid-core build
pnpm --filter @pretable/core exec vitest run src/__tests__/number-formats.test.ts
```

Expected: FAIL because `numberFormats` is not exported and `numberFormat` is not
part of `PretableColumn`.

- [ ] **Step 3: Add the column field**

Add beside `format` in `packages/grid-core/src/types.ts`:

```ts
/**
 * Native, opt-in number presentation. Applied only to `number` and `bigint`
 * values; it does not affect sorting, filtering, aggregation, or editing.
 */
numberFormat?: Intl.NumberFormatOptions;
```

Do not condition this field on `column.type`. Do not change any engine
processor.

- [ ] **Step 4: Implement the pure preset constructors**

Create `packages/core/src/number-formats.ts`:

```ts
/** Options callers may add to Pretable's currency presets. @public */
export type PretableCurrencyFormatOptions = Omit<
  Intl.NumberFormatOptions,
  "style" | "currency" | "currencySign"
> & {
  currency: string;
};

function currencyOptions(
  options: PretableCurrencyFormatOptions,
  currencySign: "standard" | "accounting",
): Intl.NumberFormatOptions {
  const { currency, ...rest } = options;
  return {
    ...rest,
    style: "currency",
    currency,
    currencySign,
  };
}

/** Transparent native number-format presets. @public */
export const numberFormats = {
  money(options: PretableCurrencyFormatOptions): Intl.NumberFormatOptions {
    return currencyOptions(options, "standard");
  },
  accounting(
    options: PretableCurrencyFormatOptions,
  ): Intl.NumberFormatOptions {
    return currencyOptions(options, "accounting");
  },
} as const;
```

Export both names from `packages/core/src/public_api.ts`:

```ts
export { numberFormats } from "./number-formats";
export type { PretableCurrencyFormatOptions } from "./number-formats";
```

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
pnpm --filter @pretable/core test -- src/__tests__/number-formats.test.ts
pnpm --filter @pretable/core typecheck
```

Expected: PASS. The `@ts-expect-error` assertions must be consumed; an unused
directive is a failure.

- [ ] **Step 6: Commit the core contract**

```bash
git add packages/grid-core/src/types.ts packages/core/src/number-formats.ts packages/core/src/public_api.ts packages/core/src/__tests__/number-formats.test.ts
git commit -m "feat(core): add native number format presets"
```

## Task 2: Build the shared React value-formatting seam

**Files:**

- Create: `packages/react/src/value-formatting.ts`
- Create: `packages/react/src/__tests__/value-formatting.test.ts`

- [ ] **Step 1: Write failing resolver tests**

Cover these named behaviors in
`packages/react/src/__tests__/value-formatting.test.ts`:

```ts
it("compiles one native formatter per configured column");
it("reuses unaffected column formatters during configuration reconciliation");
it("adds the column id and native cause to construction failures");
it("lets a data-cell format callback outrank numberFormat");
it("formats only number and bigint values without coercion");
it("leaves nullish values blank and non-numbers on the supplied fallback");
it("passes NaN and infinities to native Intl");
it("lets formatAggregate outrank inherited numberFormat");
it("never calls the data-row format callback for an aggregate");
```

Use stable `en-US` expectations such as:

```ts
const columns: PretableColumn<Row>[] = [
  {
    id: "amount",
    numberFormat: {
      style: "currency",
      currency: "USD",
      currencySign: "accounting",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  },
];

const registry = compileNumberFormatters(columns, "en-US");
expect(
  formatDataCellValue({
    value: -12,
    row: { id: "r1", amount: -12 },
    column: columns[0]!,
    numberFormatters: registry,
    fallback: (value) => String(value ?? ""),
  }),
).toBe("($12.00)");
```

For the error test, use `{ style: "currency", currency: "US" }`; expect the
wrapper message to contain `column "amount"` and `error.cause` to be the native
`RangeError`.

- [ ] **Step 2: Run the new test and confirm the module is absent**

Run:

```bash
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/value-formatting.test.ts
```

Expected: FAIL because `../value-formatting` does not exist.

- [ ] **Step 3: Implement the focused module**

Create `packages/react/src/value-formatting.ts` with this boundary:

```ts
import type { PretableGroupRow, PretableRow } from "@pretable/core";

import type { PretableColumn } from "./types";

export type NumberFormatterRegistry = ReadonlyMap<string, Intl.NumberFormat>;

export interface NumberFormatterCacheState {
  locale: Intl.LocalesArgument | undefined;
  optionsByColumnId: ReadonlyMap<string, Intl.NumberFormatOptions>;
  formatters: NumberFormatterRegistry;
}

export interface NumberFormatterCache {
  resolve<TRow extends PretableRow>(
    columns: readonly PretableColumn<TRow>[],
    locale?: Intl.LocalesArgument,
  ): NumberFormatterRegistry;
}

function createNumberFormatter(
  columnId: string,
  locale: Intl.LocalesArgument | undefined,
  options: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale, options);
  } catch (cause) {
    throw new Error(
      `[pretable] invalid numberFormat for column "${columnId}"`,
      { cause },
    );
  }
}

export function reconcileNumberFormatters<TRow extends PretableRow>(
  previous: NumberFormatterCacheState | undefined,
  columns: readonly PretableColumn<TRow>[],
  locale?: Intl.LocalesArgument,
): NumberFormatterCacheState {
  const sameLocale = previous !== undefined && Object.is(previous.locale, locale);
  const optionsByColumnId = new Map<string, Intl.NumberFormatOptions>();
  const formatters = new Map<string, Intl.NumberFormat>();

  for (const column of columns) {
    const options = column.numberFormat;
    if (!options) continue;
    optionsByColumnId.set(column.id, options);

    const reusable =
      sameLocale && previous.optionsByColumnId.get(column.id) === options
        ? previous.formatters.get(column.id)
        : undefined;
    formatters.set(
      column.id,
      reusable ?? createNumberFormatter(column.id, locale, options),
    );
  }

  return { locale, optionsByColumnId, formatters };
}

export function createNumberFormatterCache(): NumberFormatterCache {
  let state: NumberFormatterCacheState | undefined;

  return {
    resolve(columns, locale) {
      state = reconcileNumberFormatters(state, columns, locale);
      return state.formatters;
    },
  };
}

export function compileNumberFormatters<TRow extends PretableRow>(
  columns: readonly PretableColumn<TRow>[],
  locale?: Intl.LocalesArgument,
): NumberFormatterRegistry {
  return reconcileNumberFormatters(undefined, columns, locale).formatters;
}

function formatNativeNumber(
  value: unknown,
  columnId: string,
  numberFormatters: NumberFormatterRegistry,
): string | undefined {
  if (typeof value !== "number" && typeof value !== "bigint") return undefined;
  return numberFormatters.get(columnId)?.format(value);
}

export function formatDataCellValue<TRow extends PretableRow>(input: {
  value: unknown;
  row: TRow;
  column: PretableColumn<TRow>;
  numberFormatters: NumberFormatterRegistry;
  fallback: (value: unknown) => string;
}): string {
  const { value, row, column, numberFormatters, fallback } = input;
  if (column.format) return column.format({ value, row, column });
  return formatNativeNumber(value, column.id, numberFormatters) ?? fallback(value);
}

export function formatAggregateValue<TRow extends PretableRow>(input: {
  column: PretableColumn<TRow>;
  group: PretableGroupRow;
  scope: "all" | "loaded";
  numberFormatters: NumberFormatterRegistry;
  fallback: (value: unknown) => string;
}): string {
  const { column, group, scope, numberFormatters, fallback } = input;
  const value = group.aggregates[column.id];
  if (column.formatAggregate) {
    return column.formatAggregate({ value, column, group, scope });
  }
  return formatNativeNumber(value, column.id, numberFormatters) ?? fallback(value);
}
```

Keep the registry internal to React; do not export it from `public_api.ts`.
The reconciliation test must construct two columns, replace only one column's
`numberFormat` object, and prove exactly one additional native constructor call.
Also exercise `createNumberFormatterCache().resolve(...)` to prove the cache is
grid-local and retains the reconciliation state without React refs. Locale and
option equality are by identity under the documented immutable-prop contract;
do not serialize options or add a global cache.

- [ ] **Step 4: Run the resolver suite**

Run:

```bash
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/value-formatting.test.ts
pnpm --filter @pretable/react typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the resolver**

```bash
git add packages/react/src/value-formatting.ts packages/react/src/__tests__/value-formatting.test.ts
git commit -m "feat(react): compile native number formatters"
```

## Task 3: Integrate data cells and group aggregates

**Files:**

- Modify: `packages/react/src/pretable-surface.tsx`
- Modify: `packages/react/src/group-row.tsx`
- Modify: `packages/react/src/__tests__/group-row-render.test.tsx`
- Create: `packages/react/src/__tests__/number-formatting-surface.test.tsx`

- [ ] **Step 1: Write failing surface and group tests**

In the focused surface test, cover:

```ts
it("formats a numeric cell with explicit locale and native options");
it("does not format from type number alone");
it("lets column.format win while render receives its formattedValue");
it("reformats when locale changes without replacing the rows");
it("does not coerce numeric strings or Decimal-like objects");
it("constructs once per formatted column across row, focus, selection, and scroll changes");
it("reconstructs only a changed column and reconstructs all columns for a changed locale");
it("hydrates explicit-locale formatted markup without recovery");
```

Use decimal formatting for stable locale assertions:

```ts
const amountColumn = {
  id: "amount",
  type: "number" as const,
  numberFormat: { minimumFractionDigits: 1, maximumFractionDigits: 1 },
};

// 1234.5 -> "1,234.5" under en-US and "1.234,5" under de-DE.
```

For construction counts, wrap and restore the original constructor:

```ts
const NativeNumberFormat = Intl.NumberFormat;
const numberFormatSpy = vi
  .spyOn(Intl, "NumberFormat")
  .mockImplementation(function (...args) {
    return new NativeNumberFormat(...args);
  } as typeof Intl.NumberFormat);
```

Follow `density-hydration.test.tsx` for the hydration case: server-render a
minimal explicitly `en-US` surface, hydrate the same props with
`onRecoverableError`, and require both the formatted text and an empty error
array. Restore the constructor spy in `afterEach`.

In `group-row-render.test.tsx`, add:

```ts
it("inherits numberFormat for an aggregate without formatAggregate");
it("keeps formatAggregate above inherited numberFormat");
```

The inheritance test should give the `qty` sum column
`{ minimumFractionDigits: 2, maximumFractionDigits: 2 }` and assert `3.00`.

- [ ] **Step 2: Run the tests and confirm native formatting is ignored**

Run:

```bash
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/number-formatting-surface.test.tsx src/__tests__/group-row-render.test.tsx
```

Expected: FAIL because the surface and group row do not compile or use a
registry. The construction-budget test must observe zero native constructions,
and the hydration test must observe the current raw value rather than the
expected formatted value.

- [ ] **Step 3: Add locale and memoized compilation to the surface**

Add to `PretableSurfaceProps` and the component destructuring:

```ts
/** Locale list passed to native number formatters. Runtime default if omitted. */
locale?: Intl.LocalesArgument;
```

Immediately after `effectiveColumns`, create one grid-local cache through lazy
state initialization and resolve it on immutable prop identity:

```ts
const [numberFormatterCache] = useState(createNumberFormatterCache);
const numberFormatters = useMemo(
  () => numberFormatterCache.resolve(effectiveColumns, locale),
  [numberFormatterCache, effectiveColumns, locale],
);
```

Do not read or write refs during render and do not suppress React hooks lint
rules. The lazy state value is a stable, grid-local cache object; its resolver
owns the bounded reconciliation state without scheduling React state updates.

Replace the data-row branch with:

```ts
const formattedValue = formatDataCellValue({
  value,
  row,
  column,
  numberFormatters,
  fallback: formatCellValue,
});
```

Do not add locale to `usePretable`; it is presentation context and must not
recreate the core model.

The budget test wraps the native constructor, renders stable columns, then
rerenders with rows, focus/selection, and scroll changes. Its count must remain
one per formatted column. Replacing one column's `numberFormat` object while
retaining the other must add one construction; changing locale must add one per
formatted column. Follow `density-hydration.test.tsx` for the explicit-locale
server-render/hydrate test and require zero recoverable errors.

- [ ] **Step 4: Pass the registry into group rows**

Add `numberFormatters: NumberFormatterRegistry` to `GroupRowProps`, pass it from
`PretableSurface`, and resolve aggregates with:

```ts
formatAggregateValue({
  column,
  group,
  scope,
  numberFormatters,
  fallback: formatCellValue,
})
```

At this stage `copy.ts` can continue using the old aggregate helper; Task 4
migrates it and removes the duplicate.

- [ ] **Step 5: Run targeted React tests and typecheck**

Run:

```bash
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/value-formatting.test.ts src/__tests__/number-formatting-surface.test.tsx src/__tests__/group-row-render.test.tsx
pnpm --filter @pretable/react typecheck
pnpm --filter @pretable/react lint
```

Expected: PASS.

- [ ] **Step 6: Commit cell and aggregate integration**

```bash
git add packages/react/src/pretable-surface.tsx packages/react/src/group-row.tsx packages/react/src/__tests__/number-formatting-surface.test.tsx packages/react/src/__tests__/group-row-render.test.tsx
git commit -m "feat(react): format cells and aggregates natively"
```

## Task 4: Make clipboard serialization use the same formatter

**Files:**

- Modify: `packages/react/src/copy.ts`
- Modify: `packages/react/src/pretable-surface.tsx`
- Modify: `packages/react/src/rendering.ts`
- Modify: `packages/react/src/__tests__/copy.test.ts`
- Modify: `packages/react/src/__tests__/number-formatting-surface.test.tsx`

- [ ] **Step 1: Write failing clipboard tests**

Add cases proving:

```ts
it("serializes native formatting identically in text and HTML");
it("serializes inherited native formatting for group aggregates");
it("honors SerializeRangesArgs.locale");
it("lets column callbacks outrank native formatting");
it("retains Date/object fallbacks for unformatted columns");
it("fails standalone serialization with column context for invalid options");
it("constructs once per formatted column for each standalone serialization call");
```

The construction test uses two formatted columns and the same constructor spy
pattern from Task 3. Each separate call to public `serializeRanges(args)` must
add exactly two constructions; the per-cell loop must add none.

Also add a surface test whose `onCopy` spy asserts `args.locale === "en-US"`.

- [ ] **Step 2: Run clipboard tests and see raw output**

Run:

```bash
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/copy.test.ts src/__tests__/number-formatting-surface.test.tsx
```

Expected: FAIL because `SerializeRangesArgs` has no locale and copy does not use
the compiled formatter. The construction-count case must observe zero native
constructions before integration and one per configured column afterward.

- [ ] **Step 3: Add locale and an internal serializer entry point**

Extend `SerializeRangesArgs`:

```ts
/** Locale list passed to native number formatters. Runtime default if omitted. */
locale?: Intl.LocalesArgument;
```

Keep the public signature, but delegate:

```ts
export function serializeRanges<TRow extends PretableRow>(
  args: SerializeRangesArgs<TRow>,
): CopyPayload | null {
  return serializeRangesWithNumberFormatters(
    args,
    compileNumberFormatters(args.columns, args.locale),
  );
}

export function serializeRangesWithNumberFormatters<TRow extends PretableRow>(
  args: SerializeRangesArgs<TRow>,
  numberFormatters: NumberFormatterRegistry,
): CopyPayload | null {
  // Existing range/TSV/HTML implementation.
}
```

The second function is package-internal: import it within React, but do not add
it to `public_api.ts`.

Replace data-cell resolution inside the serializer with
`formatDataCellValue(..., fallback: defaultCoerceForCopy)` and aggregate
resolution with `formatAggregateValue(..., fallback: formatCellValue)`.

- [ ] **Step 4: Reuse the surface registry for default copy**

Include `locale` in the `SerializeRangesArgs` object passed to `onCopy`.
For the default path, call:

```ts
serializeRangesWithNumberFormatters(args, numberFormatters)
```

An override that calls public `serializeRanges(args)` recompiles once for that
explicit standalone call. Do not expose the surface registry to consumers.

- [ ] **Step 5: Remove migrated formatting code from `rendering.ts`**

After both group rendering and clipboard import from `value-formatting.ts`,
delete the old `formatAggregateValue` from `rendering.ts`. Keep
`formatCellValue` there as the existing display/aggregate fallback and keep
`resolveCellValue` unchanged.

- [ ] **Step 6: Run targeted tests and typecheck**

Run:

```bash
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/copy.test.ts src/__tests__/group-row-render.test.tsx src/__tests__/number-formatting-surface.test.tsx
pnpm --filter @pretable/react typecheck
```

Expected: PASS, including exact text/HTML agreement for configured values.

- [ ] **Step 7: Commit clipboard integration**

```bash
git add packages/react/src/copy.ts packages/react/src/pretable-surface.tsx packages/react/src/rendering.ts packages/react/src/__tests__/copy.test.ts packages/react/src/__tests__/number-formatting-surface.test.tsx
git commit -m "feat(react): share number formatting with clipboard"
```

## Task 5: Fix the public wrapper paths

**Files:**

- Modify: `packages/react/src/pretable.tsx`
- Modify: `packages/react/src/labeled-grid-surface.tsx`
- Modify: `packages/react/src/public_api.ts`
- Modify: `packages/react/src/__tests__/pretable.test.tsx`
- Modify: `packages/react/src/__tests__/labeled-grid-surface.test.tsx`

- [ ] **Step 1: Write failing wrapper tests**

Add these cases:

```ts
it("Pretable forwards locale and displays formattedValue");
it("LabeledGridSurface uses formattedValue when formatValue is absent");
it("LabeledGridSurface formatValue sees raw and formatted values and wins in the wrapper renderer");
it("column.render outranks LabeledGridSurface formatValue");
```

For the last test, attach spies to both callbacks and assert `column.render`
receives the native `formattedValue` while `formatValue` has zero calls.

- [ ] **Step 2: Run wrapper tests and confirm raw rendering fails them**

Run:

```bash
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/pretable.test.tsx src/__tests__/labeled-grid-surface.test.tsx
```

Expected: FAIL because both wrappers currently display their own raw fallback.

- [ ] **Step 3: Update `<Pretable>`**

Add `locale?: PretableSurfaceProps<TRow>["locale"]` to `PretableProps`,
destructure it, forward it, and change the body renderer from `{String(value ??
"")}` to `{formattedValue}`. Do not otherwise redesign its labeled demo
structure.

- [ ] **Step 4: Update `LabeledGridSurface` without changing renderer precedence**

Add:

```ts
locale?: PretableSurfaceProps<TRow>["locale"];
```

Add `formattedValue: string` to `LabeledGridSurfaceFormatValueInput`. Forward
locale. Change its grid-level renderer to:

```tsx
renderBodyCell={({ column, formattedValue, row, value }) => (
  <>
    <span className={labelClassName}>{column.header ?? column.id}</span>
    <span className={valueClassName}>
      {formatValue
        ? formatValue({ column, formattedValue, row, value })
        : formattedValue}
    </span>
  </>
)}
```

Do not touch `CellContentImpl` precedence: `column.render` remains first, so
the wrapper renderer and `formatValue` do not run for that column.

- [ ] **Step 5: Re-export presets from React**

Add to `packages/react/src/public_api.ts`:

```ts
export { numberFormats } from "@pretable/core";
export type { PretableCurrencyFormatOptions } from "@pretable/core";
```

Do not export any registry or resolver internals.

- [ ] **Step 6: Run wrapper tests and public typecheck**

Run:

```bash
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/pretable.test.tsx src/__tests__/labeled-grid-surface.test.tsx
pnpm --filter @pretable/react typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit wrapper correctness**

```bash
git add packages/react/src/pretable.tsx packages/react/src/labeled-grid-surface.tsx packages/react/src/public_api.ts packages/react/src/__tests__/pretable.test.tsx packages/react/src/__tests__/labeled-grid-surface.test.tsx
git commit -m "feat(react): expose locale-aware number formatting"
```

## Task 6: Lock the remaining raw-value invariants

**Files:**

- Modify: `packages/react/src/__tests__/number-formatting-surface.test.tsx`
- Modify: `packages/react/src/__tests__/group-row-render.test.tsx`
- Modify: `packages/react/src/__tests__/paste-surface.test.tsx`

- [ ] **Step 1: Add raw sort, filter, validation, and edit-handoff tests**

Use rows with amounts `2` and `10` and currency-formatted display:

- ascending header sort must produce raw order `2, 10`, not lexicographic
  `"$10.00", "$2.00"`;
- a numeric `gt: 5` filter must retain only `10`;
- opening the number editor must seed the textbox with `2`, not `$2.00`;
- committing `3.5` must call `validate` and `onCellEdit` with the number `3.5`,
  never the display string.

Read order from row ids or unformatted companion cells so rounded display does
not make the assertion circular.

- [ ] **Step 2: Add grouping-key and aggregate-input characterization**

In `group-row-render.test.tsx`:

- group a numeric column whose data cells have currency formatting and assert
  the engine/group row keys remain the raw numbers `2` and `10`, not formatted
  strings;
- use a custom `PretableAggregator` whose `accumulate` spy records each input and
  assert it receives the original numbers;
- assert only the final aggregate display goes through `numberFormat`.

These are characterization tests for an engine boundary this feature must not
change. They may pass on first execution; a failure indicates formatting leaked
into core processing and must be fixed before proceeding.

- [ ] **Step 3: Add the paste and application-boundary invariant**

In `paste-surface.test.tsx`, configure an editable number column with
`numberFormat` and paste `3.5`. Assert the accepted `PastedCell.value` is the
number `3.5`, never the formatted string. Together with Task 1's transaction
test and the edit/validation assertions above, this covers every current
application-facing mutation handoff. Pretable has no history API in this scope;
future history consumes these raw handoffs rather than formatted presentation.

- [ ] **Step 4: Run the focused invariant suite**

Run:

```bash
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/number-formatting-surface.test.tsx src/__tests__/group-row-render.test.tsx src/__tests__/paste-surface.test.tsx
```

Expected: PASS with raw values at every processor and application boundary.

- [ ] **Step 5: Run the whole React package before committing**

Run:

```bash
pnpm --filter @pretable/react test
```

Expected: all React tests PASS.

- [ ] **Step 6: Commit invariant evidence**

```bash
git add packages/react/src/__tests__/number-formatting-surface.test.tsx packages/react/src/__tests__/group-row-render.test.tsx packages/react/src/__tests__/paste-surface.test.tsx
git commit -m "test(react): lock number formatting invariants"
```

## Task 7: Publish the consumer contract and release intent

**Files:**

- Create: `apps/website/content/docs/grid/number-formatting.mdx`
- Modify: `apps/website/app/docs/_nav.ts`
- Modify: `apps/website/content/docs/grid/api-reference.mdx`
- Modify: `apps/website/content/docs/grid/pretable-component.mdx`
- Modify: `apps/website/content/docs/grid/pretable-surface.mdx`
- Modify: `apps/website/content/docs/grid/grouping.mdx`
- Modify: `apps/website/content/docs/grid/clipboard.mdx`
- Modify: `apps/website/content/docs/grid/cell-renderers.mdx`
- Modify: `apps/website/e2e/docs.spec.ts`
- Modify: `README.md`
- Modify (generated): `packages/core/core.api.md`
- Modify (generated): `packages/react/react.api.md`
- Create: `.changeset/<generated-name>.md`

- [ ] **Step 1: Generate API reports and observe the documentation guard fail**

Run:

```bash
pnpm --filter @pretable/core build
pnpm --filter @pretable/react build
pnpm api
pnpm --filter @pretable/app-website exec vitest run lib/docs/__tests__/docs-api-surface.test.ts
```

Expected: API generation succeeds; the docs-surface test FAILS because the
complete column and prop tables do not yet include `numberFormat` / `locale`.

- [ ] **Step 2: Write the canonical number-formatting page**

Create `apps/website/content/docs/grid/number-formatting.mdx` with this outline:

```mdx
---
title: Number formatting
description: Locale-aware decimal, money, and accounting display with native Intl options.
---

# Number formatting

## Native options, not format codes
## Decimal formatting is opt-in
## Money and accounting presets
## Locale and server rendering
## Aggregates inherit number formatting
## Display, clipboard, and raw-value boundaries
## Custom values and callbacks
## Deliberate limits
```

Required examples:

```tsx
import { numberFormats, type PretableColumn } from "@pretable/react";

const columns: PretableColumn<Row>[] = [
  {
    id: "revenue",
    type: "number",
    aggregate: "sum",
    numberFormat: numberFormats.money({ currency: "USD" }),
  },
  {
    id: "netIncome",
    type: "number",
    numberFormat: numberFormats.accounting({ currency: "USD" }),
  },
];

<Pretable locale="en-US" columns={columns} rows={rows} getRowId={(row) => row.id} />;
```

State explicitly: no implicit formatting from `type`, no forced two decimals,
strict Intl accounting only, locale is app context, numeric strings/Decimal
objects require `format`, and raw operations never see formatted strings.

- [ ] **Step 3: Update navigation and existing guides**

Add **Number formatting** after Filtering and before Row grouping. Update:

- the complete `PretableColumn` table with `numberFormat`;
- complete `PretableProps`, `PretableSurfaceProps`, and `SerializeRangesArgs`
  tables with `locale`;
- API examples/exports for `numberFormats` and
  `PretableCurrencyFormatOptions`;
- grouping prose so `formatAggregate` remains the callback contract while
  native `numberFormat` inherits automatically;
- clipboard prose so configured callbacks/native formatting match display and
  unformatted fallbacks remain channel-specific;
- renderer docs so no example constructs `Intl.NumberFormat` per cell;
- labeled wrapper docs with `column.render` → wrapper renderer →
  `formatValue`-inside-wrapper precedence.

Add one root README bullet such as:

```md
- Locale-aware decimal, money, and accounting display uses native `Intl`
  options and stays consistent across cells, aggregates, and clipboard output.
```

Link the phrase to `/docs/grid/number-formatting` using the repository's
existing absolute-site link convention where applicable.

- [ ] **Step 4: Add the docs route assertion**

Extend `apps/website/e2e/docs.spec.ts` with a small route/nav test that opens
`/docs/grid/number-formatting`, asserts the level-one heading, and asserts the
active sidebar link targets that route. No new live financial demo is required.

- [ ] **Step 5: Add Changesets release intent**

Create a uniquely named file under `.changeset/`:

```md
---
"@pretable/core": minor
"@pretable/react": minor
---

Add opt-in native number formatting with locale-aware money and accounting
presets, aggregate inheritance, and matching clipboard output.
```

Do not edit `CHANGELOG.md`; Changesets will do so in the version PR.

- [ ] **Step 6: Regenerate API reports and run documentation checks**

Run:

```bash
pnpm --filter @pretable/core build
pnpm --filter @pretable/react build
pnpm api
pnpm --filter @pretable/app-website exec vitest run lib/docs/__tests__/docs-api-surface.test.ts
pnpm --filter @pretable/app-website test
pnpm --filter @pretable/app-website typecheck
```

Expected: all commands PASS; API Extractor emits no forgotten-export warning.

- [ ] **Step 7: Run the focused docs browser test**

In terminal A, start the local website:

```bash
pnpm --filter @pretable/app-website dev
```

After it reports ready, run in terminal B:

```bash
BASE_URL=http://127.0.0.1:3000 pnpm --filter @pretable/app-website exec playwright test e2e/docs.spec.ts
```

Expected: PASS, including the new number-formatting route and active nav state.

- [ ] **Step 8: Commit the consumer contract**

```bash
git add README.md .changeset apps/website/app/docs/_nav.ts apps/website/content/docs/grid apps/website/e2e/docs.spec.ts packages/core/core.api.md packages/react/react.api.md
git commit -m "docs: publish native number formatting"
```

## Task 8: Run full release verification

**Files:**

- Verify only; modify files only if a failing check reveals a scoped defect.

- [ ] **Step 1: Verify formatting and whitespace**

Run:

```bash
pnpm exec prettier --check packages/grid-core/src packages/core/src packages/react/src apps/website/content/docs/grid apps/website/app/docs/_nav.ts README.md .changeset
git diff --check origin/main...HEAD
```

Expected: PASS with no whitespace errors.

- [ ] **Step 2: Verify lint and types**

Run:

```bash
pnpm lint
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Verify all tests**

Run:

```bash
pnpm test
```

Expected: PASS with zero failing suites.

- [ ] **Step 4: Verify builds and public API reports**

Run:

```bash
pnpm build
pnpm api:check
pnpm lint:packaging
```

Expected: PASS. `core.api.md` and `react.api.md` match generated output, and
packed public packages expose `numberFormats`,
`PretableCurrencyFormatOptions`, the locale props, and `numberFormat`.

- [ ] **Step 5: Verify final scope and history**

Run:

```bash
git status --short
git diff --name-only origin/main...HEAD
git log --oneline origin/main..HEAD
```

Expected: clean worktree; only files enumerated by this plan plus the design and
plan documents; small, task-scoped commits in the planned order.

- [ ] **Step 6: Stop for branch-finishing review**

Do not push, open a PR, or merge from this step. Invoke
`superpowers:finishing-a-development-branch`, present the verified branch state,
and obtain the user's integration choice.
