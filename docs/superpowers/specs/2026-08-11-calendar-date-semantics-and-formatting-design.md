# Canonical calendar dates and native date formatting

Date: 2026-08-11
Status: approved
Implementation plan: [`2026-08-30-pr-480-calendar-date-reconciliation.md`](../plans/2026-08-30-pr-480-calendar-date-reconciliation.md)
Supersedes: the mixed date coercion contract in
[`2026-08-05-typed-cell-editors-design.md`](./2026-08-05-typed-cell-editors-design.md)
and the released date-filter/editor behavior derived from it. The rest of that
design remains historical and authoritative for the features it shipped.

## Context

Pretable is a batteries-included, domain-neutral data grid. Financial-grade
applications are a useful proving ground because they make small correctness
errors expensive: a calendar date that shifts by one day, sorts by presentation
text, or changes meaning after an edit is not a cosmetic defect.

Pretable's released date behavior mixes two different temporal domains:

- a calendar date, such as a settlement date or reporting period, has a year,
  month, and day but no time or time zone;
- an instant, such as an order execution timestamp, identifies a point on the
  global timeline and requires an offset or time-zone interpretation.

`type: "date"` currently accepts strict `YYYY-MM-DD` strings, ISO date-times,
`Date` instances, and finite epoch-millisecond numbers. Zoned date-times are
bucketed by their UTC day, zone-less date-times use their literal date portion,
and the built-in editor commits the result as a `YYYY-MM-DD` string. Filtering
and editing implement that rule in separate "twin" helpers. Sorting does not use
the rule at all: it falls back to string comparison unless every cell is a
number. The accepted input domain therefore changes with the subsystem, and an
edit can change the stored type.

The platform already provides the correct presentation vocabulary.
[`Intl.DateTimeFormat`](https://402.ecma-international.org/) supplies localized
calendar names, ordering, eras, numbering systems, and date styles. Pretable
should use that standard rather than introduce format tokens. The raw-value
contract needs to be stricter than `Intl`, however: an application should never
have to guess whether a value denotes a calendar date or an instant.

TC39 Temporal is the long-term JavaScript model for that distinction, but it is
scheduled for ECMAScript 2027 and is not available in Pretable's supported
Node.js 22 runtime without a polyfill. Making it a required public value type
now would add installation and serialization friction to an otherwise
dependency-free primitive. Pretable will adopt the same semantic separation
without requiring Temporal.

## Goals

1. Give `type: "date"` one canonical, serializable calendar-date domain.
2. Use the same validation rule for sorting, filtering, editing, paste,
   aggregation, formatting, clipboard output, and SSR.
3. Add opt-in, locale-aware native date formatting with no per-cell formatter
   construction.
4. Prevent time and time-zone options from entering a calendar-date API.
5. Preserve raw values through every processing and mutation path.
6. Give applications a small public validator for API, persistence, import, and
   custom-editor boundaries.
7. Use breaking changes to remove ambiguous coercion rather than perpetuate it.

## Non-goals

- A `datetime`, instant, local-date-time, duration, or interval column type.
- A Temporal or third-party date-library dependency.
- Locale-aware input parsing or implicit `Date.parse`.
- Coercion from `Date`, epoch values, or date-time strings.
- Relative dates, date ranges, min/max editor constraints, or configurable week
  starts.
- Pretable-specific date format strings or preset tokens.
- Finance-specific schemas, calculations, formulas, scenarios, permissions, or
  UI.
- Backward-compatible aliases or a legacy-date compatibility mode.

## Decision

### Canonical value domain

`type: "date"` means a calendar date represented by an RFC 3339 `full-date`
string or an empty value represented by `null`:

```ts
type PretableDateValue = string | null;
```

The conceptual alias above documents the value domain; it is not exported.
Rows remain open data objects and Pretable does not attempt to type a property
from its column definition.

A non-null value is valid only when all of these are true:

- its shape is exactly four-digit year, two-digit month, and two-digit day:
  `YYYY-MM-DD`;
- the year is in the RFC 3339 range `0000` through `9999`;
- the month and day form a real date in the proleptic Gregorian calendar;
- there is no leading or trailing whitespace, time, offset, or zone.

Examples:

| Value                        | Date value? | Reason                               |
| ---------------------------- | ----------- | ------------------------------------ |
| `"2026-08-11"`               | yes         | canonical full-date                  |
| `"0000-02-29"`               | yes         | valid RFC year and Gregorian date    |
| `"2026-02-30"`               | no          | calendar overflow                    |
| `"2026-8-11"`                | no          | not canonical                        |
| `" 2026-08-11 "`             | no          | stored values are not trimmed        |
| `"2026-08-11T00:00:00Z"`     | no          | instant/date-time, not calendar date |
| `new Date("2026-08-11T00Z")` | no          | instant object                       |
| `1786406400000`              | no          | epoch value                          |
| `null`                       | empty       | canonical empty value                |

`undefined` and `""` retain the grid's general empty-cell presentation where
applicable, but they are not canonical stored date values. Editing normalizes an
empty draft to `null`.

### Public validation helper

Core exports one non-coercing type guard, and React re-exports it:

```ts
declare function isValidDateValue(value: unknown): value is string;
```

It returns `true` only for a non-null canonical full-date string. `null` is an
allowed empty cell, not a valid date, so callers can write:

```ts
if (value === null || isValidDateValue(value)) {
  // Valid stored value for a date column.
}
```

Pretable does not export a coercion helper, branded type, template-literal type,
epoch converter, or calendar-component parser:

- coercion would reintroduce the temporal ambiguity this change removes;
- a brand makes normal JSON/API data cumbersome;
- a template literal cannot reject calendar overflow;
- epoch and component representations are implementation details.

### Native formatting API

The engine-level column gains an opt-in date presentation field:

```ts
type PretableDateFormatKey =
  | "localeMatcher"
  | "calendar"
  | "numberingSystem"
  | "dateStyle"
  | "weekday"
  | "era"
  | "year"
  | "month"
  | "day"
  | "formatMatcher";

type PretableDateFormatOptions = Pick<
  Intl.DateTimeFormatOptions,
  PretableDateFormatKey
> &
  Partial<
    Record<
      Exclude<keyof Intl.DateTimeFormatOptions, PretableDateFormatKey>,
      never
    >
  >;

interface PretableColumn<TRow> {
  dateFormat?: PretableDateFormatOptions;
}
```

Core exports `PretableDateFormatOptions`; React re-exports it. The type contains
only standard `Intl.DateTimeFormatOptions` fields that can describe a calendar
date. Every other currently known `Intl.DateTimeFormatOptions` field is present
as optional `never`, rather than merely omitted. This matters structurally: a
variable typed as the broader native options interface cannot carry `hour`,
`timeZone`, or another forbidden field into the narrower API. Native
incompatibilities inside the allowed set, such as mixing `dateStyle` with
granular component fields, remain native `Intl` validation errors.

Example:

```ts
const columns: PretableColumn<Trade>[] = [
  {
    id: "settlementDate",
    type: "date",
    dateFormat: { dateStyle: "medium" },
  },
];

const compactDate = {
  year: "numeric",
  month: "short",
  day: "2-digit",
} satisfies PretableDateFormatOptions;
```

`dateFormat` is presentation configuration and does not require `type: "date"`.
It formats a canonical date string wherever it is declared. Documentation should
normally show both: `type` controls date processing and editing, while
`dateFormat` controls presentation. This matches the separation already used by
`numberFormat` and `type: "number"`.

There are no date preset helpers. Native `dateStyle: "short" | "medium" |
"long" | "full"` already supplies the useful preset vocabulary without a
Pretable versioning layer.

### Locale and time-zone ownership

Date formatting reuses the existing `locale` accepted by `Pretable`,
`PretableSurface`, `LabeledGridSurface`, and `serializeRanges`.

- Omitting `locale` uses the runtime's default locale.
- Applications requiring deterministic SSR, tests, or cross-user output should
  pass an explicit locale.
- Changing locale recompiles the affected formatter and does not recreate the
  core grid model or mutate raw state.
- Locale remains presentation context, not persisted engine state.

Calendar dates have no time zone. Internally Pretable converts validated date
components into a UTC presentation value and constructs the formatter with
`timeZone: "UTC"`. UTC is an implementation anchor, not a claim that the date is
a UTC instant. It prevents the presentation date from shifting with the host
time zone.

Pretable applies the internal `timeZone` after consumer options. TypeScript
therefore rejects a `timeZone`. At runtime, formatter compilation rejects any
own option key outside the date allowlist before calling `Intl`, including a key
whose value is `undefined`. The contextual `invalid dateFormat` error covers
both forbidden keys and native option errors. Options are never silently
stripped, and untyped JavaScript cannot add time output or override the UTC
invariant accidentally.

## Unified processing contract

One framework-neutral calendar-date module in the internal engine owns strict
validation, component extraction, ordinal comparison, UTC presentation values,
and the calendar arithmetic required by the date editor. React imports this
primitive through the internal package boundary. The existing duplicated
`toDayMs` and `toIsoDate` coercion implementations are removed.

No date path calls `Date.parse`.

### Sorting

Local sorting becomes column-type-aware:

- a `type: "date"` sort compares canonical valid dates chronologically;
- lexicographic comparison is sufficient for valid full-date strings, but the
  shared validator classifies values first;
- valid dates sort in chronological order;
- `null`, other empty values, and invalid values sort after valid dates in both
  ascending and descending directions;
- empty and invalid values form one non-date rank; comparing two values in that
  rank returns equality for the date key;
- equal dates likewise return equality for the date key, so later keys in an
  ordered multi-sort cascade may break either tie;
- source order is the final tie-break only after every active sort key returns
  equality.

The same date comparator governs date-valued group sibling keys. A grouped date
column must not fall back to locale/string comparison and disagree with flat-row
ordering.

Formatting is never a sort key. External sort authority continues to receive
the column sort state and owns its backend semantics.

### Filtering

The `on`, `before`, `after`, and `dateBetween` operators accept only canonical
date cells and canonical date operands. An invalid cell matches no date
operator. The two filter entry paths have explicit behavior:

- the built-in filter menu does not emit an invalid operand. An incomplete,
  invalid, or cleared draft maps to `null` and removes the applied filter; once
  the draft is canonical, the menu emits the date filter;
- a controlled or headless filter containing a nonblank invalid operand remains
  active and matches zero rows. `dateBetween` likewise matches zero rows when
  either bound is invalid.

Neither path coerces the operand. This preserves controlled-state honesty—a bad
programmatic filter cannot be silently treated as no constraint—while temporary
invalid menu input clears the constraint instead of emptying the visible grid.

Date comparison uses validated full-date values directly. It does not map
instants into UTC days.

### Editing and paste

The built-in date editor accepts canonical strings or `null` without coercion.
The controller's existing seed precedence remains unchanged: a type-to-replace
draft wins, then `formatEditValue`, then the raw cell value.

- A typed draft may be trimmed before validation because editor text is an
  input channel, not stored state.
- A valid draft commits the canonical full-date string.
- An empty draft commits `null`.
- Invalid, overflowing, date-time, `Date`, and numeric drafts are rejected with
  `"Use YYYY-MM-DD"`.
- The calendar popover continues to commit canonical strings.

Calendar navigation is closed over the canonical year range:

- day, week, month, and page navigation clamp at `0000-01-01` and `9999-12-31`;
- previous/next-month controls are disabled when they would cross a boundary;
- the leading cells before January 0000 and trailing cells after December 9999
  render as disabled placeholders, never malformed or five-digit date values;
- when `formatEditValue` is absent, an invalid existing raw value is shown using
  the input's deterministic `String(value ?? "")` fallback. It has no selected
  calendar day and is never replaced merely by opening, blurring, or cancelling
  the editor. The calendar cursor may start at the viewer's today so the user
  can intentionally choose a replacement.

Paste uses the same draft parser, so locale-formatted or date-time clipboard
text is rejected by default. `parseEditValue` remains the explicit escape hatch
for an application that intentionally accepts another input shape. Likewise,
`formatEditValue` remains the escape hatch for a noncanonical application model.
Its returned string therefore supersedes the raw-value fallback above. Using
either hook makes that conversion application-owned; a noncanonical model
normally supplies both hooks so its edit seed and committed value round-trip.
Pretable does not silently normalize it elsewhere.

### Aggregation

Built-in aggregate behavior becomes column-type-aware:

- `min` and `max` on a `type: "date"` column consider canonical date strings,
  skip invalid and empty values, and return a canonical string or `null`;
- `min` and `max` on other columns retain their numeric-only behavior;
- `sum` and `avg` remain numeric-only for every column type;
- `count` continues to count rows and returns a number.

This is a deliberate breaking extension of the built-in aggregator resolver,
not a global change that treats arbitrary strings as aggregatable. Custom
aggregators remain unchanged.

`dateFormat` applies to a canonical date result from `min`, `max`, or a custom
aggregator. A numeric `count` result does not inherit date formatting and uses
the existing fallback unless `formatAggregate` handles it.

## Formatting resolution contract

### Data cells

For a normal data cell:

1. If `column.format` exists, call it and use its string.
2. Otherwise, if `column.dateFormat` exists and the raw value passes
   `isValidDateValue`, use the compiled native date formatter.
3. Otherwise, if another native presentation such as `numberFormat` applies,
   use it.
4. Otherwise, use the existing display fallback.

No valid raw value satisfies both native number and date domains. The ordering
between those native branches is therefore explicit but not behaviorally
load-bearing.

### Aggregate cells

For a group aggregate:

1. If `column.formatAggregate` exists, call it and use its string.
2. Otherwise, if `column.dateFormat` exists and the aggregate is a canonical
   date, use the same compiled formatter as the data cells.
3. Otherwise, if another native presentation applies, use it.
4. Otherwise, use the existing aggregate fallback.

Invalid configuration throws once at formatter compilation with context:

```text
[pretable] invalid dateFormat for column "settlementDate"
```

The native error is retained as `cause`. Invalid raw cell values do not throw;
they remain visible through fallback formatting so bad upstream data is not
silently erased and one cell cannot crash the grid.

## Clipboard and round-trip behavior

Plain-text and HTML clipboard output use the same callback/native date result
as the displayed cell. SSR uses the same formatter resolver as client render.
An unformatted `Date` in a non-date column keeps the existing generic clipboard
fallback; this feature only changes columns with `dateFormat` or `type: "date"`
processing.

Formatted copy is intentionally not guaranteed to round-trip through strict
paste. For example, `Aug 11, 2026` is a presentation string, not a canonical
stored value. Applications that want formatted text to paste back may provide
`parseEditValue`; applications that prioritize interoperable raw export can use
their own copy/export policy. Pretable does not weaken the storage contract to
make localized presentation text parseable.

## Runtime architecture and performance

The internal formatter registry generalizes the recently shipped native-number
formatter architecture rather than adding a parallel per-cell mechanism.

- A surface compiles at most one `Intl.DateTimeFormat` per column with
  `dateFormat` for a stable `(columns, locale)` pair.
- Stable option object identity and locale allow formatter reuse across row
  updates, selection, focus, scroll, virtualization, and ordinary React
  renders.
- Replacing a column's `dateFormat` object or changing locale recompiles only
  the affected registry state.
- There is no global cache, serialized option key, or mutable state shared
  between grids.
- Standalone `serializeRanges` compiles a request-local registry; a mounted
  surface passes its existing registry into its copy path.
- Formatter construction never occurs in the per-cell render loop.

The formatter resolver should evolve toward a single internal native-value
formatting registry or cache owner so number and date invalidation cannot drift,
while retaining domain-specific formatter types and value guards. The public API
does not expose this internal registry.

## Migration

This change intentionally has no compatibility mode. Applications must
normalize temporal values at their data boundary and choose the correct domain.

Calendar dates should be stored directly:

```ts
type Position = {
  settlementDate: string | null; // YYYY-MM-DD or null
};
```

Applications currently storing `Date`, epoch values, or date-time strings in a
date column have two choices:

1. If the field is semantically a calendar date, normalize it to `YYYY-MM-DD`
   before giving rows to Pretable. The application must choose the business time
   zone or literal-date rule; Pretable cannot infer it safely.
2. If the field is semantically an instant, do not label it `type: "date"`.
   Keep a custom renderer/editor temporarily and migrate to a future distinct
   instant/date-time type when Pretable designs one.

No example should recommend `toISOString().slice(0, 10)` without stating that
it selects the UTC calendar day and may not match the application's business
date.

## Documentation

Consumer documentation must update all currently advertised mixed-date
behavior:

- filtering documents strict canonical date cells and operands;
- editing removes `Date`, timestamp, and date-time normalization examples;
- cell-renderer examples use canonical strings for calendar dates and reserve
  `Date` for explicit custom instant formatting;
- clipboard documentation distinguishes localized presentation output from raw
  date storage;
- the API reference documents `dateFormat`, `PretableDateFormatOptions`, and
  `isValidDateValue`;
- a focused native date-formatting guide demonstrates locale, `dateStyle`,
  granular fields, callback precedence, aggregate inheritance, copy behavior,
  SSR determinism, and migration.

The guide must remain domain-neutral. Financial examples may demonstrate why
correctness matters, but Pretable is not positioned as a financial application
product.

## Verification

### Calendar primitive

- RFC years `0000` and `9999`, leap-year boundaries, month lengths, and
  calendar overflow.
- Boundary month matrices, disabled filler cells, and clamped arrow/week/month
  navigation at `0000-01-01` and `9999-12-31`.
- Exact-shape rejection, including whitespace, loose locale forms, date-times,
  `Date`, numbers, infinities, and objects.
- Validator parity across engine, editor, paste, formatter, and aggregate paths.
- No `Date.parse` in the canonical date implementation.

### Processing

- Date sorting with valid, equal, empty, and invalid values in both directions;
  later-key multi-sort ties; stable final source-order ties; and date group-key
  ordering.
- All date filter operators with canonical and rejected operands, including
  menu-draft behavior and controlled/headless invalid filters.
- Editor and paste commit only canonical strings or `null`.
- Date-aware `min`/`max`; unchanged numeric aggregation elsewhere; `count`
  remains numeric.
- External sort/filter authority remains presentation-only locally.

### Formatting

- Locale and native option behavior, including `dateStyle`, granular fields,
  calendar, numbering system, and year `0000` presentation.
- Compile-time rejection of time and time-zone fields on both object literals
  and variables typed as the broader native options interface.
- Runtime contextual errors for forbidden/unknown keys and invalid native option
  combinations.
- Data/aggregate callback precedence and raw fallback for invalid values.
- Display, custom-renderer `formattedValue`, group aggregates, clipboard, and
  SSR parity.
- Formatter reuse and precise invalidation for column options and locale.
- No formatter construction in the per-cell hot path.

### Documentation and release gates

- Generated core and React API reports contain the new exports and field.
- One minor changeset covers core and React, allowing the configured fixed group
  to keep all four public packages aligned, and contains an explicit
  **Breaking** migration note. Pretable remains pre-1.0; a major changeset would
  incorrectly publish `1.0.0`.
- Package changelogs, migration notes, examples, and API reports agree.
- Documentation tests pass in Chromium and WebKit.
- Repository-wide tests, typecheck, lint, format, build, packaging, and
  publish-preflight gates pass.

## Roadmap consequences

This design is the immediate domain-neutral correctness feature after native
number formatting. It replaces workload-profile work and finance-specific field
schema/UI work as current priorities.

After canonical dates ship, the recommended sequence is:

1. grand totals and summary rows as a general analytical-grid primitive;
2. saved-view persistence using the approved versioned-document design;
3. a typed command foundation and bounded local undo/redo;
4. later remote scale, pivot, range manipulation, revisioned mutations, and
   durable history.

Financial applications remain a proving ground for correctness, performance,
and developer experience. They do not define Pretable's product boundary.
