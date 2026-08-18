# Canonical calendar dates on the incremental row model — design

**Date:** 2026-08-18

**Status:** planned

**Supersedes:**

- the date-specific value, parsing, filtering, and editor decisions in
  [`2026-08-05-typed-cell-editors-design.md`](2026-08-05-typed-cell-editors-design.md);
- the `Date.parse` date normalization and filtering rule in
  [`2026-06-18-filter-engine-model-design.md`](2026-06-18-filter-engine-model-design.md).

Their non-date decisions remain authoritative.

**Implementation plan:**
[`2026-08-18-canonical-calendar-dates-row-model.md`](../plans/2026-08-18-canonical-calendar-dates-row-model.md)

## Decision summary

Pretable will treat a `date` column as a calendar-date column, not as a
JavaScript timestamp column. Its built-in domain is the RFC 3339 full-date
string `YYYY-MM-DD` or `null`, with years `0000` through `9999` in the
proleptic Gregorian calendar.

The implementation will target the current incremental row-model architecture.
It will not merge or restore the superseded grid-core implementation from the
unreleased `blove/calendar-date-formatting` branch.

A new private, zero-dependency `@pretable-internal/calendar-date` package will
own calendar arithmetic and validation shared by the row model and React. The
row model will own typed query, grouping, sorting, and aggregate semantics.
React will own native presentation, editing, clipboard, CSV, and hydration.

This is intentionally a breaking correction. Pretable will not preserve
support for `Date` objects, epoch numbers, date-time strings, or permissive
native parsing in built-in date behavior.

## Why this belongs on the roadmap

Financial applications exposed the problem, but the feature is not
finance-specific. Portfolio, planning, operations, inventory, and reporting
grids all need a date without a time zone, predictable sorting and filtering,
locale-aware display, safe editing, and stable export.

The product lesson is broader: Pretable should turn common application-level
correctness work into small, coherent grid primitives. Native money,
accounting, and number formatting established that pattern. Canonical calendar
dates are the next instance.

## Current problem

The released `0.10.0` architecture has two incompatible notions of a date:

- the row model accepts `Date`, epoch numbers, full timestamps, and date
  strings through coercive conversion;
- React separately normalizes mixed values for the date editor;
- date sorting can fall through generic null and string comparison;
- filters accept `string | number | Date` operands;
- built-in date extrema are not expressible without widening string aggregates;
- native number formatting has one coherent presentation pipeline, but native
  date formatting does not exist.

That ambiguity is unsafe for date-only values. A birthday, statement date, or
fiscal-period boundary must not move because of the host time zone, implicit
`Date.parse` rules, or a local-midnight conversion.

## Goals

1. Define one strict, portable date-only value contract across typed columns,
   local derivation, controlled query state, editing, display, copy, and CSV.
2. Share validation, comparison, UTC conversion, and bounded arithmetic without
   coupling the row model to React or duplicating date logic.
3. Give date columns valid-first chronological sort and grouping behavior,
   strict filtering, and type-safe `min`, `max`, and `count` aggregates.
4. Add locale-aware native date formatting with the same precedence, caching,
   explicit-model support, and SSR guarantees as native number formatting.
5. Preserve raw application values. Presentation and editing helpers must not
   rewrite row data merely because a grid opened or rendered it.
6. Keep hot paths allocation-conscious and preserve incremental row-model
   invalidation guarantees.

## Non-goals

- Date-times, instants, time zones, durations, fiscal calendars, or recurrence.
- Compatibility with `Date`, epoch numbers, or noncanonical date strings.
- Finance-domain field schemas, formulas, scenarios, or application workflows.
- A public calendar utility package or public exports for parsing and
  arithmetic internals.
- A second row engine or restoration of deleted grid-core processing paths.
- Per-cell formatter construction or hidden data normalization.

## Canonical value contract

The built-in date domain is:

```ts
type PretableDateValue = string | null;
```

This notation describes the contract; it does not require a separate public
`PretableDateValue` alias.

A non-null value is valid only when all of these are true:

- it is exactly ten ASCII characters in `YYYY-MM-DD` form;
- the year is `0000` through `9999`;
- the month is `01` through `12`;
- the day exists in that month under proleptic Gregorian leap-year rules.

Whitespace, partial dates, timestamps, locale-formatted text, `Date` objects,
numbers, `undefined`, and invalid calendar combinations are not dates.

`null` is the canonical empty value. Existing rows may still contain other raw
values at runtime because JavaScript and remote data are not type-safe. The grid
must retain and render those values through its normal fallback path, but it
must not treat them as valid date values.

Core will publicly export:

```ts
function isValidDateValue(value: unknown): value is string;
```

No public parser, UTC converter, comparator, or arithmetic helper is required.
`@pretable/react` re-exports both `isValidDateValue` and the public date-format
options type so React consumers do not need a second package import.

## Package ownership

### Private calendar package

Create `packages/calendar-date` with package name
`@pretable-internal/calendar-date`. It has no runtime dependencies and is not a
published public entry point.

It owns:

- strict parsing and validation;
- canonical classification and comparison;
- conversion to a UTC presentation instant;
- bounded day and month arithmetic for the editor;
- minimum and maximum supported values;
- detached, immutable calendar parts where needed.

It must not call `Date.parse`, accept coercive inputs, or expose a helper that
silently normalizes invalid values.

Low years require an explicit UTC construction rule because `Date.UTC` remaps
years `0` through `99` to `1900` through `1999`. The implementation should
construct the equivalent year plus 400 and subtract exactly 146,097 days.
Tests must pin years `0000`, `0001`, `0050`, `0099`, `0100`, and `9999`.

### Dependency direction

The allowed dependency graph is:

```text
@pretable-internal/row-model -> @pretable-internal/calendar-date
@pretable/core               -> row-model + calendar-date
@pretable/react              -> @pretable/core + calendar-date
```

Core bundles its private dependencies and hand-exports only the public
validator and public column types. React bundles the private calendar helper.
React must not import the row-model runtime merely to perform date arithmetic,
and the row model must not depend on React or presentation code.

Each package retains one builder. Package scripts must build only their own
package; the workspace build graph orders dependencies.

## Typed column API

`type: "date"` accepts only `string | null` values in the typed column helper.
`Date` is removed from `PretableGroupKey`, date inference, date filter operands,
and all built-in date-specific types.

Because this is a breaking release, compile failures are the intended migration
signal for consumers using `Date` or numeric date values.

`dateFormat` mirrors the established `numberFormat` presentation field:

```ts
const columns = [
  column.accessor("asOf", {
    type: "date",
    dateFormat: { year: "numeric", month: "short", day: "2-digit" },
  }),
] as const;
```

It is presentation configuration and does not affect query-plan identity,
sorting, filtering, grouping, editing, or raw row-model reads. It must survive
the same schema and explicit-model presentation paths as `numberFormat`.

`dateFormat` may be present on a non-date column, just as `numberFormat` is
independent of `type`. It formats only a canonical string value; otherwise the
normal fallback applies. This keeps presentation composable without making
column type an implicit renderer switch.

## Native date formatting

Define a public `PretableDateFormatOptions` type with this strict allowlist:

- `localeMatcher`
- `calendar`
- `numberingSystem`
- `dateStyle`
- `weekday`
- `era`
- `year`
- `month`
- `day`
- `formatMatcher`

Every other `Intl.DateTimeFormatOptions` key is represented as optional
`never`, including `timeZone`, time fields, and time-zone-name fields. Pretable
always formats the internally constructed instant in UTC.

The type belongs with the public column contract in the row-model column types,
is re-exported by core, and is re-exported again by React. The private calendar
package owns no presentation configuration.

Runtime validation must inspect `Reflect.ownKeys(options)`. It rejects:

- enumerable or non-enumerable unknown string keys;
- every symbol key;
- every forbidden native option, even when its value is `undefined`.

Pretable must not silently strip invalid options before constructing the native
formatter. Errors identify the column and invalid option.

Native output is deliberately locale- and runtime-dependent. In particular,
some calendars or locales may present year `0000` as an era-based year. The
contract guarantees the correct UTC calendar instant, not a literal `0000` in
localized output.

## One presentation pipeline

Generalize the existing number-formatter registry rather than building a
parallel date-only path. For each authoritative column and locale, compile at
most one number formatter and one date formatter. Reuse the same registry for
mounted cell rendering, group aggregates, copy, and CSV.

Data-cell precedence is:

1. `format`
2. valid canonical value plus compiled `dateFormat`
3. compatible raw value plus compiled `numberFormat`
4. existing fallback stringification

Group-aggregate precedence is:

1. `formatAggregate`
2. valid canonical aggregate plus compiled `dateFormat`
3. compatible numeric aggregate plus compiled `numberFormat`
4. existing aggregate fallback

`count` remains numeric and may inherit `numberFormat`; it does not inherit
`dateFormat`. Copy and CSV use these same chains verbatim. Custom cell renderers
continue to own their rendered output while export follows the documented value
pipeline.

Formatter caches are keyed by authoritative column identity, option identity,
and locale identity. Column reorder and removal must not produce a half-coherent
cache. No formatter or options object is constructed in the per-cell hot path.

## Row-model processing

### Sorting and grouping

Date comparison first classifies each raw value:

- canonical date;
- non-date, including `null`, `undefined`, invalid strings, objects, and
  numbers.

Canonical dates sort chronologically. Non-dates form one terminal rank and
remain last for both ascending and descending date sorts. The public `nulls`
setting does not move this terminal date rank. It continues to govern generic
column null behavior.

Equal canonical dates and equal terminal-rank values fall through to later sort
keys and then stable source order. Sibling date groups use exactly the same
comparison policy.

A custom column comparator remains authoritative when supplied. The built-in
calendar policy applies only in its absence.

### Filtering

Date filter operands are canonical strings at the type level and are validated
again at runtime.

Built-in date operators compare canonical calendar values only. Invalid or
empty cells never satisfy a date comparison. A string operand with invalid
calendar semantics remains an active controlled/headless filter that matches
zero rows; the grid does not silently remove application-owned query state. A
runtime operand of the wrong JavaScript type still raises the row model's
structured query-validation error. `dateBetween` matches zero rows when either
string member is noncanonical. In the React filter menu, an incomplete, cleared,
or invalid draft emits `null` and removes the applied filter; it never leaves a
previous valid filter active under invalid visible input.

When filter or sort authority is external, the row model continues to publish
the query without applying it locally. Date presentation remains local. A
windowed, server-controlled result must never be reordered or refiltered by the
new date semantics.

### Aggregation

Make built-in aggregate typing column-type-aware rather than widening string
aggregation globally. The public generic shape becomes:

```ts
type PretableBuiltinAggregate<TValue, TType extends PretableColumnType> =
  | "count"
  | (TType extends "number"
      ? NonNullable<TValue> extends number
        ? "sum" | "avg" | "min" | "max"
        : never
      : TType extends "date"
        ? NonNullable<TValue> extends string
          ? "min" | "max"
          : never
        : never);

type PretableAggregateOutputOf<
  TAggregate,
  TType extends PretableColumnType,
> = TAggregate extends {
  readonly finalize: (accumulator: never) => infer TOutput;
}
  ? TOutput
  : TAggregate extends "min" | "max"
    ? TType extends "date"
      ? string | null
      : number | null
    : TAggregate extends "sum" | "avg" | "count"
      ? number | null
      : never;
```

The custom-aggregator branch preserves the repository's existing structural
finalize inference. The architectural decision is that built-in output is a
function of both aggregate token and column type.

Thread `TType` through `PretableAggregateSpec`, `PretableColumnDefinition`,
`PretableColumnOptions`, column-helper overloads, callback contexts,
`PretableAggregateFormatInput`, `PretableCompatibleAggregateSpec`,
`PretableColumnDerivation`, `PretableAggregatesFor`, and the React column factory
and presentation types. Do not replace the existing one-parameter generic with
a union that makes every `"min"` output `string | number | null`.

The resulting legal built-ins are:

- number columns: `sum`, `avg`, `min`, `max`, `count`;
- date columns with canonical string values: `min`, `max`, `count`;
- other columns: `count` unless a compatible custom aggregator is supplied.

Date `min` and `max` return a canonical string or `null`. They ignore
noncanonical and empty values. `count` retains its existing meaning and numeric
output.

At runtime, query compilation lowers date `min` and `max` to private immutable,
associative calendar aggregators before values reach the aggregate tree. Do not
broaden the tree's numeric built-ins or make arbitrary string `min` and `max`
legal.

Aggregate output inference must distinguish numeric extrema from date extrema
through the column descriptor/type parameter. Custom aggregator inference must
remain unchanged.

### Incremental invalidation

Column `type` already participates in semantic query-plan comparison and must
continue to do so. Transitions into or out of `date` invalidate affected filter,
sort, grouping, distinct-value, and aggregate work exactly once without
discarding unrelated indexes.

Tests must cover both directions of type transitions with active queries and
group aggregates. Presentation-only `dateFormat` changes must not invalidate the
derived row model.

## Editing and paste

The built-in date editor accepts and commits only canonical dates. A user-cleared
draft commits `null`. Paste uses the same strict parser.

Opening and blurring an untouched noncanonical raw seed must never normalize or
commit it. This includes an empty string, padded strings, whitespace,
`undefined`, and values accepted only by a custom parser. User provenance must
be keyed to a private monotonically increasing edit-session token so draft and
status replacements within one edit retain provenance while batched
cancel/begin transitions cannot leak type-to-replace state into another edit.
The built-in parser never trims; only an exact user-cleared empty draft maps to
`null`.

Applications with a different model retain the existing escape hatches:
`formatEditValue`, `parseEditValue`, custom editors, custom filter UI, and value
projection. Those hooks can own a noncanonical application model, but they do
not restore built-in date sorting, filtering, grouping, or aggregation. To use
all built-in date processing, rows or `column.value` must project
`YYYY-MM-DD | null`.

Calendar navigation uses bounded arithmetic, clamps month/year movement, and
never crosses outside `0000-01-01` through `9999-12-31`. Out-of-range days are
disabled placeholders, not wrapped dates. Controlled draft updates must keep
the cursor, selection, active descendant, and month view coherent without
effect-driven state synchronization.

## Raw-value and SSR guarantees

- Row storage, accessor output, transactions, callbacks, query snapshots, and
  model reads remain raw.
- Rendering or formatting never mutates a row.
- UTC eliminates host-time-zone drift between server and client. Identical text
  additionally requires equivalent `Intl` implementation and locale data; apps
  spanning different ICU data must use a custom formatter or accept the normal
  hydration constraint.
- A canonical date created for presentation must never be interpreted in the
  host local time zone.
- Invalid values reach the documented fallback rather than throwing during a
  cell render.

## Performance requirements

- Parsing and comparison are allocation-conscious and do not construct `Date`
  objects for row-model sorting or filtering.
- Presentation converts a canonical string once per format operation; it does
  not validate by parsing twice.
- Native formatters are compiled once per effective column/locale combination.
- Date aggregation satisfies the same associativity, snapshot isolation, and
  incremental-update laws as existing aggregates.
- The implementation adds focused work-counter assertions for date transitions
  and a representative benchmark only if measurement shows a material new hot
  path. It does not create finance-specific workload profiles.

## Migration

This feature ships as a breaking change. Consumer guidance is direct:

1. Store or project date-only values as `YYYY-MM-DD | null`.
2. Replace `Date`, epoch, timestamp, and localized-string filter operands with
   canonical full-date strings.
3. Use `dateFormat` for native localized display.
4. Use application-owned hooks only when the domain model intentionally differs;
   recognize that display/edit hooks alone do not provide built-in processing.

For example, when the application explicitly chooses UTC calendar semantics and
has already validated an RFC 3339 UTC timestamp, it can project the date prefix
before the value reaches the grid:

```ts
const asCalendarDate = timestamp.slice(0, 10);
```

If an application deliberately starts from a `Date`, it must choose and document
its own calendar-zone policy before projecting the string. Pretable will not
guess whether `new Date("2026-08-11T00:00:00Z")` means the UTC or local calendar
day.

## Documentation and release surface

The implementation includes:

- a date-formatting guide using `createColumnHelper`, `createLocalRowModel`, and
  both rows mode and explicit-model presentation;
- API reference for the canonical contract, exact formatting allowlist,
  precedence, aggregates, external authority, and migration;
- examples for localized display, strict editing, invalid controlled filters,
  date extrema, copy, and CSV;
- generated API reports with only the intended public exports;
- a `minor` changeset for the fixed public-package release group whose summary
  begins with explicit **Breaking** migration prose. A major changeset would
  prematurely publish `1.0.0` under the current release configuration.

Consumer docs must describe shipped behavior only. Until release, this design
and the roadmap carry the planned outcome.

## Verification gates

Implementation is complete only when all of these are green:

- private calendar-package unit and property tests;
- row-model compiled-query, flat-query, grouping, aggregation, transition,
  external-authority, and type tests;
- React editor, filter menu, parser, formatting, group render, copy, CSV,
  indexed rows, explicit-model, SSR, and hydration tests;
- public export and generated API checks;
- package builds, typechecks, lint, formatting, packaging, and the full suite;
- production documentation build and local Chromium/WebKit documentation tests.

Boundary tests must cover leap years, invalid dates, years `0000` and `9999`,
low-year UTC conversion, strict own-key option validation, valid-first ordering
in both directions, multi-sort ties, group siblings, invalid-filter zero match,
date extrema, type transitions, untouched-invalid blur, session provenance, raw
copy fallback, and external query authority.

## Delivery sequence

1. Create and prove the private calendar package.
2. Correct row-model public types and strict query semantics.
3. Add date-aware aggregate typing and runtime lowering.
4. Port strict React editing and filtering onto the shared package.
5. Generalize the presentation registry for native date formatting across
   render, group, copy, and CSV.
6. Publish docs, API reports, migration guidance, and the breaking changeset.

Each step is test-first and independently reviewed. The implementation plan will
name exact files and commands after this design is approved.

## Historical implementation disposition

The old calendar-date branch remains useful as behavioral test evidence, not as
an integration base. Its grid-core processing commits conflict with the current
architecture and must not be cherry-picked. React behavior may be manually
ported only after its assumptions are reconciled with current typed columns,
explicit model mode, windowed data, copy/CSV parity, and the incremental row
model.
