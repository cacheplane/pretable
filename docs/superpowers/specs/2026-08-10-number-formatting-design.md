# Native number formatting and currency presets

Date: 2026-08-10
Status: approved

## Context

Pretable is a batteries-included, financial-grade grid without being a
financial application framework. Portfolio-management and financial-planning
applications repeatedly need the same small presentation primitive: numbers,
money, and accounting values must be locale-aware, precise, fast to render, and
consistent across detail rows, aggregates, custom renderers, and clipboard
output.

Pretable currently offers only callbacks:

- `PretableColumn.format` formats a data cell;
- `PretableColumn.formatAggregate` separately formats a group aggregate;
- the React surface and clipboard serializer each contain their own formatting
  branch;
- `Pretable` installs a grid-level renderer that displays `value` rather than
  the already-resolved `formattedValue`.

Applications can build currency formatting from those primitives, but doing so
requires repeated callback wiring, duplicates aggregate behavior, cannot be
represented as plain configuration, and makes formatter construction in the
hot cell path an easy mistake.

The platform already provides the right formatting vocabulary.
[`Intl.NumberFormat`](https://402.ecma-international.org/) covers decimal,
currency, percent, grouping, notation, sign display, currency-specific minor
units, accounting signs, and modern rounding options. Current Handsontable
likewise [migrated from Numbro patterns to native `Intl.NumberFormat`
options](https://handsontable.com/docs/angular-data-grid/migration-from-17.1-to-18.0/).
Pretable should adopt that standard rather than create a format language.

## Goals

1. Make locale-aware number, money, and accounting display batteries-included.
2. Use native `Intl.NumberFormatOptions` as the persisted, inspectable
   configuration shape.
3. Preserve callbacks as the escape hatch for application-specific values.
4. Apply one precedence contract to cells, aggregates, renderers, and formatted
   clipboard output.
5. Construct formatters per column configuration, never per cell.
6. Keep sorting, filtering, grouping, aggregation, editing, validation, and
   history on raw values.
7. Improve Pretable's finance-capable, domain-agnostic positioning through
   consumer documentation rather than a financial-product UI.

## Non-goals

- Excel, Numbro, Numeral.js, or other format-string grammars.
- A third-party number-formatting dependency or Pretable-specific descriptor
  language.
- Dash-for-zero, currency-symbol alignment, or spreadsheet accounting layout.
- Parsing numeric strings, arbitrary-precision decimal objects, or localized
  edit input.
- Inferring currency or locale from row data.
- Date-format helpers, additional presets, a general field-schema system, or a
  new export subsystem.
- Finance-domain calculations, formulas, valuation, scenario, or permission
  logic.
- Compatibility aliases or a translator for legacy format codes. The existing
  callbacks remain because they are the general-purpose override, not as a
  compatibility shim.

## Decision

Add native number-format options to the column, add a presentation locale to
the React entry points and clipboard serializer, and ship two transparent
currency helpers. Do not add preset tokens to the column document.

Conceptually, the public additions are:

```ts
interface PretableColumn<TRow> {
  numberFormat?: Intl.NumberFormatOptions;
  format?: (input: PretableFormatInput<TRow>) => string;
  formatAggregate?: (input: PretableAggregateFormatInput<TRow>) => string;
}

interface PretableProps<TRow> {
  locale?: Intl.LocalesArgument;
}

interface PretableSurfaceProps<TRow> {
  locale?: Intl.LocalesArgument;
}

interface LabeledGridSurfaceProps<TRow> {
  locale?: Intl.LocalesArgument;
}

interface SerializeRangesArgs<TRow> {
  locale?: Intl.LocalesArgument;
}
```

`numberFormat` is opt-in. `type: "number"` alone continues to control numeric
filtering, editing, alignment, and clipboard type hints, but it must not apply
implicit grouping or rounding. Native decimal defaults can round visible
precision, so silently enabling them would be unsafe.

Conversely, `numberFormat` does not require `type: "number"`. It formats a
numeric raw value wherever it is declared. Documentation should normally show
both fields because `type` supplies the rest of the numeric-column behavior,
but presentation and processing remain orthogonal contracts.

## Money and accounting helpers

`@pretable/core` exports a `numberFormats` object and the options type used by
its two helpers:

```ts
type PretableCurrencyFormatOptions = Omit<
  Intl.NumberFormatOptions,
  "style" | "currency" | "currencySign"
> & {
  currency: string;
};

declare const numberFormats: {
  money(options: PretableCurrencyFormatOptions): Intl.NumberFormatOptions;
  accounting(options: PretableCurrencyFormatOptions): Intl.NumberFormatOptions;
};
```

The React package re-exports both names from core so the normal React consumer
does not need a second import source.

Example:

```ts
import { numberFormats, type PretableColumn } from "@pretable/react";

const columns: PretableColumn<LedgerRow>[] = [
  {
    id: "price",
    type: "number",
    numberFormat: numberFormats.money({ currency: "USD" }),
  },
  {
    id: "netIncome",
    type: "number",
    aggregate: "sum",
    numberFormat: numberFormats.accounting({
      currency: "USD",
      maximumFractionDigits: 2,
    }),
  },
];
```

The helpers return new plain option objects:

- `money` forces `style: "currency"`, the required `currency`, and
  `currencySign: "standard"`;
- `accounting` forces `style: "currency"`, the required `currency`, and
  `currencySign: "accounting"`;
- caller options can configure native concerns such as `currencyDisplay`,
  grouping, notation, precision, rounding, and `signDisplay`;
- caller input cannot override the three defining fields at the type level, and
  the implementation applies those fields last so untyped JavaScript cannot
  undermine the preset accidentally;
- neither helper forces two decimal places. Native currency metadata therefore
  gives currencies such as USD and JPY their standard minor-unit behavior.

Accounting means strict locale-aware `Intl` accounting semantics. It does not
turn zero into a dash, align symbols, or reproduce Excel cell layout. Those are
separate presentation policies and are outside this feature.

The helper result, not a token such as `{ preset: "money" }`, is what an
application may persist. This preserves standard configuration and leaves no
Pretable preset version to migrate.

## Locale ownership

Locale is presentation context supplied to `Pretable`, `PretableSurface`,
`LabeledGridSurface`, or a standalone `serializeRanges` call. It is not grid
engine state and is not part of the column document.

- Omitting `locale` passes `undefined` to `Intl.NumberFormat`, selecting the
  runtime's default locale.
- Applications requiring deterministic SSR, tests, or cross-user rendering
  should pass an explicit locale.
- Changing locale recompiles the affected formatters and updates formatted
  strings without recreating the core grid model or changing raw state.
- Locale is not persisted by Pretable. A saved-view system can persist the
  semantic `numberFormat` options while the application supplies the current
  user's locale.

No per-column or per-row locale override is added. A grid normally presents all
currencies in the user's locale; genuinely heterogeneous presentation can use a
custom `format` callback.

## Resolution contract

### Data cells

For a normal data cell:

1. If `column.format` exists, call it and use its string.
2. Otherwise, if `column.numberFormat` exists and the raw value is a `number` or
   `bigint`, use the compiled native formatter.
3. Otherwise, use the existing display fallback.

### Aggregate cells

For a group aggregate:

1. If `column.formatAggregate` exists, call it with the current aggregate scope
   and use its string.
2. Otherwise, if `column.numberFormat` exists and the aggregate is a `number` or
   `bigint`, use the same compiled native formatter as the column's data cells.
3. Otherwise, use the existing aggregate fallback.

`format` remains illegal for aggregates because it is entitled to a concrete
data row. Native `numberFormat` is row-independent, so inheriting it does not
weaken that boundary. This removes duplicated currency callbacks without
pretending an aggregate has a backing row.

### Values and overrides

- `null` and `undefined` produce an empty string before native formatting.
- Numeric strings, decimal-library objects, dates, arrays, and other values are
  never coerced into numbers. They use the existing fallback unless a callback
  handles them.
- `NaN` and positive or negative infinity are numbers and retain the native
  locale's `Intl` representation.
- `format` and `formatAggregate` errors propagate as they do today.
- `render`, `renderBodyCell`, class hooks, and prop hooks receive the final
  `formattedValue` but continue to receive the raw `value` as well.
- `formatEditValue` and `parseEditValue` remain the editing contract;
  `numberFormat` never seeds or parses an editor.

The plain-text and HTML clipboard flavors use the same callback or native
number-format result as the displayed cell. Columns with no configured
formatter retain their existing channel-specific fallbacks, including stable
clipboard handling for dates and objects; this feature does not rewrite
unformatted copy semantics.

## Raw-value guarantees

Formatting is a terminal presentation operation. These systems continue to
consume the raw value returned by `column.value` or `row[column.id]`:

- sorting and comparison;
- filtering;
- grouping keys;
- aggregate accumulation;
- editing, parsing, and validation;
- paste mapping;
- transactions, controlled rows, and future history records.

Formatted currency symbols, grouping separators, accounting parentheses, and
rounded strings must never enter those paths.

## Runtime architecture

### Presets and types

Core owns the framework-neutral column field, helper implementations, and
public types. The helpers are pure constructors with no cache and no dependency
beyond the platform `Intl` implementation.

### Compiled formatter registry

The React adapter owns an internal formatter compiler and resolver. A surface
builds a grid-local map from column id to `Intl.NumberFormat` whenever the
column definitions or locale change.

- At most one formatter is constructed per configured column for a stable
  `(columns, locale)` pair.
- Row changes, selection, focus, scroll, virtualization, and ordinary React
  re-renders reuse the registry.
- There is no global cache, serialized option key, or mutable state shared
  between grid instances.
- Columns and their `numberFormat` objects follow the existing immutable-prop
  convention. Consumers replace configuration objects rather than mutating
  them in place.

Formatter construction validates every declared `numberFormat`, even if a
custom callback currently wins. This makes invalid configuration fail at the
column boundary rather than remain latent until a later callback change.

### One resolver for existing outputs

The data-cell and aggregate resolution functions live together and are used by
normal rendering, group-row rendering, and clipboard serialization. This
replaces the three independent native-format branches that would otherwise
develop.

The default surface-copy path reuses the surface's compiled registry through an
internal serializer entry point. Public `serializeRanges(args)` compiles at
most one formatter per configured column for that standalone call, then uses
the same serializer implementation. No registry or cache object becomes public
API.

`SerializeRangesArgs.locale` is included in the args delivered to `onCopy`, so
an override that calls the public serializer preserves the surface locale.

The drop-in `Pretable` component forwards `locale` and changes its built-in
grid-level body renderer to display `formattedValue`, not `String(value)`. It
may still show its current header label, but it must not bypass column
formatting. `PretableSurface` remains the lower-level authoritative renderer.

`LabeledGridSurface` is also a public wrapper with a grid-level body renderer.
It gains and forwards `locale`. Its `LabeledGridSurfaceFormatValueInput` gains
`formattedValue`, and the existing renderer precedence remains authoritative:

1. `PretableSurface` resolves `column.format` → native `numberFormat` → its
   display fallback into `formattedValue` for every ordinary data cell.
2. If `column.render` exists, it renders the cell with raw `value` and resolved
   `formattedValue`; the wrapper's grid-level renderer and `formatValue` are not
   called.
3. Otherwise `LabeledGridSurface`'s grid-level renderer owns the labeled cell.
   If its `formatValue` exists, the callback receives raw `value` and resolved
   `formattedValue` and returns the value slot's final display string.
4. Without `formatValue`, the labeled value slot displays `formattedValue`
   directly.

The wrapper-specific override does not change clipboard output, matching the
existing rule that React renderers are display-only. A consumer that needs
custom display and clipboard strings uses the column-level `format` callback.
This keeps `LabeledGridSurface` from bypassing native formatting by default
without silently changing the meaning of its explicit `formatValue` prop.

`InspectionGrid` uses fixed inspection columns and an intentional
`formatValue` override, so it does not gain a locale prop in this feature. Its
display-only override and existing clipboard behavior remain unchanged.

A future export API must use the same resolution contract. Building that API is
not part of this feature.

## Failure behavior

`Intl.NumberFormat` construction is the source of truth for locale, currency,
and option validation. If construction throws, Pretable fails while compiling
the registry rather than falling back to an unformatted financial value.

The adapter wraps the native error with a message that identifies the offending
column id and retains the native error as `cause`. The same failure behavior
applies to the surface and standalone clipboard serializer. No public custom
error class is required.

Non-numeric cell values are not configuration errors. They remain visible
through the fallback instead of crashing an otherwise useful heterogeneous
grid. Pretable does not warn because values such as `"N/A"` can be intentional;
documentation makes the no-coercion rule explicit.

## Performance contract

The implementation is unacceptable if it constructs `Intl.NumberFormat` while
iterating visible cells or copied cells. Tests must prove:

- one construction per formatted column for the initial stable surface;
- no additional construction for row-only updates, selection/focus changes,
  scrolling, or virtualization churn;
- one replacement construction per affected column when locale or column
  configuration changes;
- one construction per formatted column for a standalone serialization call.

Formatting the value itself remains per visible or copied cell. No formatted
string cache is added because invalidation across mutable rows, accessors,
streaming updates, aggregate scope, and callbacks would be more expensive and
error-prone than the native call.

## Documentation and positioning

Implementation adds a consumer page, **Number formatting**, to the grid docs
navigation. It covers:

- opt-in decimal formatting with raw precision made explicit;
- money and accounting helpers;
- locale and SSR behavior;
- aggregate inheritance;
- cell, clipboard, edit, sort, and filter boundaries;
- numeric strings and decimal-object callbacks;
- the absence of Excel format codes, dash-for-zero, and symbol alignment.

Update the API reference, grouping guide, clipboard guide, `Pretable`,
`PretableSurface`, and `LabeledGridSurface` prop references, package API
reports, and package changelogs. The root README gains one concise
finance-capable feature bullet and links to the number-formatting guide; it does
not turn the first-grid example or homepage into a financial application
showcase.

## Verification

### Core

- Public type tests accept native number-format options.
- `money` and `accounting` return new plain objects with their defining fields
  forced after caller options.
- USD and JPY retain native currency-specific fraction defaults.
- Caller precision, display, grouping, notation, and rounding options survive.
- Core and React public exports and generated API reports include the new names.

### React and clipboard

- Custom data-cell and aggregate callbacks win over native formatting.
- An aggregate without `formatAggregate` inherits `numberFormat`.
- A declared `format` is never called for an aggregate.
- `numberFormat` works independently of `column.type`; `type: "number"` alone
  does not format or round.
- Nullish, non-numeric, `bigint`, `NaN`, and infinite values follow the contract.
- Column and grid-level renderers receive the resolved `formattedValue`.
- `Pretable` and `PretableSurface` show the same formatted value.
- `LabeledGridSurface` forwards locale, uses `formattedValue` by default, and
  gives its explicit `formatValue` the final display-only override with access
  to both raw and formatted values.
- A column-level `render` continues to outrank the `LabeledGridSurface` wrapper
  renderer, receives `formattedValue`, and prevents `formatValue` from running.
- Displayed values, group aggregates, and both clipboard flavors agree whenever
  a column-level callback or native number formatter applies.
- A locale prop change updates output without replacing raw grid state.
- Explicit-locale server rendering and client hydration agree.
- Invalid locale or option configuration fails with the column id and native
  cause.
- Formatter-construction instrumentation proves the performance contract.

### Raw-state invariants

Focused tests demonstrate that number formatting does not change sort, filter,
aggregate, edit, validation, or paste inputs. The existing package test,
typecheck, API-report, documentation-surface, and build checks must remain
green.

## Acceptance criteria

The feature is ready to release when:

1. A React consumer can configure decimal formatting directly with native
   options or create USD/JPY money and accounting options through the two
   helpers.
2. The same configured value appears in detail cells, inherited group
   aggregates, custom render inputs, and clipboard output.
3. Raw grid operations are unchanged and no implicit numeric formatting occurs.
4. Invalid configuration fails early with column context.
5. Tests prove formatter construction is outside the hot cell path.
6. Public docs explain both the convenience and the deliberate boundaries
   without positioning Pretable as a financial application product.
