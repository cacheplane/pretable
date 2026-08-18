# Canonical Calendar Dates on the Incremental Row Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `type: "date"` a strict `YYYY-MM-DD | null` calendar-date domain and add cached, locale-aware native date formatting across the incremental row model, editing, aggregates, rendering, clipboard, CSV, SSR, and public documentation.

**Architecture:** A new zero-dependency `@pretable-internal/calendar-date` package owns strict validation, comparison, UTC presentation conversion, and bounded arithmetic. `@pretable-internal/row-model` owns typed column/query semantics and lowers date extrema to private associative aggregators. `@pretable/react` owns editing and one cached native presentation pipeline shared by cells, groups, clipboard, CSV, and hydration; core and React expose only the intended validator and option type.

**Tech Stack:** TypeScript 6, React 19, RFC 3339 full-date strings, ECMA-402 `Intl.DateTimeFormat`, Vitest, Testing Library, jsdom, React server rendering/hydration, fast-check, API Extractor, Next.js MDX documentation, Playwright, pnpm, Changesets.

**Design:** [`docs/superpowers/specs/2026-08-18-canonical-calendar-dates-row-model-design.md`](../specs/2026-08-18-canonical-calendar-dates-row-model-design.md)

---

## Delivery rules

- Use `superpowers:test-driven-development` for every behavior change.
- Use `superpowers:systematic-debugging` for any unexpected failure; do not
  weaken a date assertion to accommodate legacy coercion.
- Commit after every task and run the named focused checks before committing.
- Do not cherry-pick the old `blove/calendar-date-formatting` implementation.
  It targeted a deleted engine. Behavioral cases may be consulted and manually
  re-expressed against current APIs.
- Do not add a Temporal/polyfill/date dependency, public coercion helper,
  public date-value brand, `datetime` column type, locale parser, or
  compatibility mode.
- Do not manually edit package changelogs. Changesets and the release process
  own them.
- Do not build sibling packages from a package script. Each package owns one
  builder; workspace dependency edges determine root build order.

## File map

### Shared calendar primitive

- Create `packages/calendar-date/package.json` — private internal package
  manifest with one-package build/test/lint/typecheck scripts and `fast-check`
  as a test-only dependency.
- Create `packages/calendar-date/tsconfig.json` and
  `packages/calendar-date/tsconfig.typecheck.json` — build declarations from
  `src/index.ts` and typecheck tests.
- Create `packages/calendar-date/src/calendar-date.ts` — strict parser,
  validator, comparison, UTC conversion, min/max constants, and bounded
  day/month arithmetic.
- Create `packages/calendar-date/src/index.ts` — internal package exports.
- Create `packages/calendar-date/src/__tests__/calendar-date.test.ts` — exact
  shape, Gregorian boundaries, low years, comparison, UTC, and arithmetic.
- Modify `packages/core/package.json`, `packages/core/tsup.config.ts`, and
  `pnpm-lock.yaml` — bundle the private package into core.
- Modify `packages/core/src/public_api.ts` — expose only
  `isValidDateValue` publicly.
- Create `packages/core/src/__tests__/calendar-date.test.ts` — public guard and
  no-private-export contract.

### Strict incremental row-model semantics

- Modify `packages/row-model/package.json` and `pnpm-lock.yaml` — add the direct
  private calendar dependency.
- Modify `packages/row-model/src/column-types.ts` — strict string date value and
  operand types; remove `Date` group identity.
- Modify `packages/row-model/src/compiled-query.ts` — strict filter evaluation,
  valid-first date comparison, sibling parity, and semantic invalid-operand
  fail-closed behavior.
- Modify `packages/row-model/src/errors.ts`,
  `packages/row-model/src/types.ts`, and
  `packages/row-model/src/distinct-values.ts` — remove `Date` from stable local
  group/distinct identity and its runtime encoding.
- Modify row-model tests under `packages/row-model/src/__tests__/` for compiled
  queries, flat queries, grouping, distinct values, transitions, external
  authority, and type contracts.
- Modify `type-tests/core/columns.types.ts`,
  `type-tests/core/local-row-model.types.ts`,
  `type-tests/core/query-and-aggregate.types.ts`, and the generated-scale
  fixtures `type-tests/performance/columns-{100,500}.ts` — migrate date values
  and operands to canonical strings while retaining type-performance scale.

### Type-aware date extrema

- Create `packages/row-model/src/calendar-date-aggregates.ts` — private
  associative calendar `min`/`max` aggregators and runtime lowering.
- Create `packages/row-model/src/__tests__/calendar-date-aggregates.test.ts` —
  valid-only extrema, empty output, merge laws, and immutability.
- Modify `packages/row-model/src/column-types.ts` — make built-in aggregate
  availability and output depend on both value and column type.
- Modify `packages/row-model/src/compiled-query.ts` — lower only date
  `min`/`max` before aggregate leaves reach the persistent aggregate tree.
- Modify `packages/row-model/src/transaction-draft.ts` — recognize the two
  private lowered calendar aggregators and retain built-in structural no-op
  detection for unrelated updates.
- Modify `packages/react/src/types.ts` and affected core/React type fixtures —
  thread the new `TType` generic without widening every `min` output.
- Modify grouping, transition, aggregate-law, and type tests to prove canonical
  date extrema and numeric/custom non-regression.

### Strict React editing and filtering

- Modify `packages/react/package.json`, React tsconfig path maps, and
  `pnpm-lock.yaml` — add the direct private calendar dependency without adding
  row-model runtime duplication.
- Rewrite `packages/react/src/editors/date-utils.ts` — UI-only calendar matrix,
  labels, and viewer-today behavior composed from shared primitives.
- Modify `packages/react/src/editors/DateCellEditor.tsx` — strict seeds,
  controlled draft synchronization, bounded navigation, placeholders, and
  provenance-aware blur.
- Modify `packages/react/src/editors/type-parsing.ts` — canonical string/null
  built-in parsing only.
- Modify `packages/react/src/use-cell-edit-controller.ts` — carry private
  type-to-replace provenance from the explicit key entry into the surface begin
  wrapper without changing public edit state.
- Modify `packages/react/src/filter-menu/filter-operators.ts` — invalid,
  incomplete, or cleared date drafts remove the menu-owned filter.
- Modify `packages/react/src/pretable-surface.tsx` — key type-to-replace
  provenance to a private monotonic edit-session token shared by every begin
  and cancel wrapper.
- Rewrite/extend focused React editor, parser, filter-menu, editing-surface, and
  paste tests.

### Public native date presentation

- Modify `packages/row-model/src/column-types.ts` — public strict
  `PretableDateFormatOptions` and `dateFormat` on typed definitions/options.
- Modify `packages/core/src/types.ts`, `packages/core/src/public_api.ts`, and
  core type tests — public option type and validator only.
- Modify `packages/react/src/types.ts`, `packages/react/src/use-pretable.ts`, and
  `packages/react/src/public_api.ts` — React column paths, model merge, legacy
  column, and re-exports.
- Create `packages/react/src/date-formatters.ts` — strict own-key validation and
  UTC-locked native formatter reconciliation.
- Create `packages/react/src/__tests__/date-formatters.test.ts` — compile/runtime
  safety, low years, locale, error context, and cache behavior.
- Create `type-tests/core/date-format.types.ts` and
  `type-tests/react/date-format.types.tsx` — public option/helper/legacy/model
  type coverage.

### Rendering, groups, clipboard, CSV, and SSR

- Refactor `packages/react/src/value-formatting.ts` — one number/date registry
  and precedence resolver.
- Modify `packages/react/src/pretable-surface.tsx` — compile once after
  authoritative columns and reuse for mounted rendering/export.
- Modify `packages/react/src/group-row.tsx` — date aggregate presentation.
- Modify `packages/react/src/copy.ts` and `packages/react/src/csv.ts` — the same
  resolver and registry for standalone and mounted export.
- Create `packages/react/src/__tests__/date-formatting-surface.test.tsx` and
  `packages/react/src/__tests__/column-helper-date-format.test.tsx`.
- Extend value-formatting, grouping, copy, CSV, indexed presentation, external
  authority, and SSR/hydration tests.

### Consumer documentation and release evidence

- Create `apps/website/content/docs/grid/date-formatting.mdx` and
  `apps/website/app/docs/__tests__/date-formatting.types.tsx`.
- Modify grid API, editing, filtering, sorting, grouping, clipboard, export,
  cell-renderer, cell-presentation, and surface documentation plus navigation.
- Modify `apps/website/app/api/docs/rows/dataset.ts` and its unit test so the
  server-data demo implements the same canonical contract.
- Modify documentation API/fence tests and `apps/website/e2e/docs.spec.ts`.
- Modify `README.md`, generated API reports, `ROADMAP.md`, and this design's
  lifecycle metadata only as required to describe planned/released truth.
- Create one minor fixed-group changeset with explicit **Breaking** migration
  prose.

## Task 1: Add the private calendar package and public validator

**Files:**

- Create: `packages/calendar-date/package.json`
- Create: `packages/calendar-date/tsconfig.json`
- Create: `packages/calendar-date/tsconfig.typecheck.json`
- Create: `packages/calendar-date/src/calendar-date.ts`
- Create: `packages/calendar-date/src/index.ts`
- Create: `packages/calendar-date/src/__tests__/calendar-date.test.ts`
- Modify: `packages/core/package.json:35-40`
- Modify: `packages/core/tsup.config.ts:11-13`
- Modify: `packages/core/src/public_api.ts:9-27`
- Create: `packages/core/src/__tests__/calendar-date.test.ts`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Create the package skeleton and write failing tests**

Create the manifest and tsconfigs first so pnpm can select the new package. Add
`fast-check` as a dev dependency. Create `src/index.ts` exporting the wished-for
module, then write the tests while `src/calendar-date.ts` is still absent.

Create table-driven tests for this internal API:

```ts
import {
  MAX_DATE_VALUE,
  MIN_DATE_VALUE,
  addDateValueDays,
  addDateValueMonths,
  compareDateValues,
  dateValueToUtcMs,
  isValidDateValue,
  parseDateValue,
} from "../calendar-date";

expect(MIN_DATE_VALUE).toBe("0000-01-01");
expect(MAX_DATE_VALUE).toBe("9999-12-31");
expect(isValidDateValue("2024-02-29")).toBe(true);
expect(isValidDateValue("2026-02-30")).toBe(false);
expect(parseDateValue("0000-02-29")).toEqual({ year: 0, month: 2, day: 29 });
expect(compareDateValues("2026-01-02", "2026-02-01")).toBeLessThan(0);
expect(new Date(dateValueToUtcMs("0050-01-01")).toISOString()).toBe(
  "0050-01-01T00:00:00.000Z",
);
expect(addDateValueDays("0000-01-01", -1)).toBe("0000-01-01");
expect(addDateValueDays("9999-12-31", 1)).toBe("9999-12-31");
expect(addDateValueMonths("2024-01-31", 1)).toBe("2024-02-29");
```

The rejection table includes `null`, `undefined`, `""`, padded values, loose
dates, overflows, date-times with/without offsets, `Date`, finite/infinite
numbers, arrays, objects, and hostile proxies. Pin Gregorian century rules and
years `0000`, `0001`, `0050`, `0099`, `0100`, and `9999`. Read the source and
assert it contains no `Date.parse`. Add fast-check properties for parse/format
round trips and Gregorian validity across the entire supported domain,
comparator antisymmetry/transitivity, and bounded day/month arithmetic including
endpoint clamping without ever leaving `0000-01-01` through `9999-12-31`.

- [ ] **Step 2: Write the failing public-core test**

Import `isValidDateValue` from `../index`, prove type narrowing, and assert that
`parseDateValue`, arithmetic helpers, and constants are absent from the public
module type/runtime surface.

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @pretable-internal/calendar-date test
pnpm --filter @pretable/core exec vitest run src/__tests__/calendar-date.test.ts
```

Expected: FAIL because the package and public export do not exist.

- [ ] **Step 4: Create the package and primitive**

Complete the skeleton using the same private-package manifest/tsconfig pattern
as `packages/layout-core`; keep runtime dependencies empty.

Implement exact-shape parsing with `^(\d{4})-(\d{2})-(\d{2})$`, explicit
Gregorian month lengths, and these signatures:

```ts
export interface CalendarDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export const MIN_DATE_VALUE = "0000-01-01";
export const MAX_DATE_VALUE = "9999-12-31";
export function parseDateValue(value: unknown): CalendarDateParts | null;
/** @public */
export function isValidDateValue(value: unknown): value is string;
export function dateValueToUtcMs(value: string): number;
export function compareDateValues(left: string, right: string): number;
export function addDateValueDays(value: string, days: number): string;
export function addDateValueMonths(value: string, months: number): string;
```

`dateValueToUtcMs` returns `NaN` for invalid runtime input. For years below
100, construct year + 400 and subtract `146_097 * 86_400_000`; do not use
`Date.UTC(year, ...)` directly. Arithmetic clamps to supported endpoints and
month movement clamps the day to the destination month.

The validator carries `@public` because core re-exports it into an
API-Extractor-controlled public bundle. All other private exports omit public
release tags.

- [ ] **Step 5: Wire the private/public package boundaries**

Add `@pretable-internal/calendar-date: "workspace:*"` to core dev dependencies,
add it to core's `noExternal`, refresh the lockfile, and re-export only:

```ts
export { isValidDateValue } from "@pretable-internal/calendar-date";
```

Do not add the private package to the root TypeScript reference list: recursive
workspace scripts and the dependency edge own its build ordering.

- [ ] **Step 6: Run GREEN and package-boundary checks**

```bash
pnpm --filter @pretable-internal/calendar-date test
pnpm --filter @pretable-internal/calendar-date typecheck
pnpm --filter @pretable-internal/calendar-date lint
pnpm --filter @pretable/core test
pnpm --filter @pretable/core build
pnpm --filter @pretable/core typecheck
node --test scripts/__tests__/workspace-scripts-own-one-package.test.mjs scripts/__tests__/public-api-forgotten-exports.test.mjs
```

Expected: all pass; the public bundle contains the validator but no private
calendar helper exports.

- [ ] **Step 7: Commit**

```bash
git add packages/calendar-date packages/core/package.json packages/core/tsup.config.ts packages/core/src/public_api.ts packages/core/src/__tests__/calendar-date.test.ts pnpm-lock.yaml
git commit -m "feat(core): define canonical calendar dates"
```

## Task 2: Make typed queries and row ordering canonical

**Files:**

- Modify: `packages/row-model/package.json:24-32`
- Modify: `packages/row-model/src/column-types.ts:10-19,44-56,168-181,450-532`
- Modify: `packages/row-model/src/compiled-query.ts:1-9,622-757,930-960,1130-1327,1520-1568`
- Modify: `packages/row-model/src/errors.ts:131-171`
- Modify: `packages/row-model/src/types.ts:328-346`
- Modify: `packages/row-model/src/distinct-values.ts:250-305`
- Modify tests: `packages/row-model/src/__tests__/{compiled-query,flat-query,grouping,distinct-values,transitions,external-filter-authority,types}.test.ts`
- Modify: `type-tests/core/columns.types.ts`
- Modify: `type-tests/core/local-row-model.types.ts`
- Modify: `type-tests/core/query-and-aggregate.types.ts`
- Modify: `type-tests/performance/columns-100.ts`
- Modify: `type-tests/performance/columns-500.ts`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Write failing public type tests**

Change date rows to `string | null` and pin these outcomes:

```ts
interface DatedRow {
  id: number;
  asOf: string | null;
  instant: Date;
}

const dated = createColumnHelper<DatedRow>();
dated.accessor("asOf", { type: "date" });
// @ts-expect-error Date instances are not built-in calendar dates
dated.accessor("instant", { type: "date" });

type _DateOperand = Expect<
  Equal<PretableFilterOperandFor<string | null, "date">, string>
>;
```

Prove direct and computed accessors cannot escape the rule. Remove `Date` from
`PretableGroupKey` and `PretableDistinctColumnIdOf`. Replace every date value
and operand in the 100/500-column performance fixtures with canonical strings;
replace `.toISOString()` formatting with direct string formatting while keeping
the same tuple widths and query counts.

- [ ] **Step 2: Write failing strict filter and ordering tests**

In `compiled-query.test.ts`, cover all date operators with canonical strings.
Assert:

- `Date`, numbers, arrays, and objects are structured validation errors at the
  exact `query.filters[i].value` path;
- a wrong-length `dateBetween` array is a structured validation error;
- a string with invalid calendar semantics is accepted as controlled state but
  evaluates every row false;
- `dateBetween` evaluates every row false when either string bound is invalid;
- valid cell strings compare lexically/chronologically without `Date` objects;
- invalid cell strings, empty strings, `null`, and `undefined` match no date
  comparison operator.

Add row and sibling-group ordering cases where canonical dates sort first and
chronologically, while every non-date remains in one terminal rank for both
`asc` and `desc`, ignoring the date column's `nulls` setting. Equal dates and
equal terminal-rank values must fall through to later keys, then source order.
Pin custom comparator precedence.

- [ ] **Step 3: Write failing transition and authority tests**

Cover `text -> date` and `date -> text` derivation transitions with active sort,
filter, grouping, and distinct-value work. Assert exactly one semantic
invalidation and no unrelated index discard using current work counters.

Under external filter/sort authority, publish canonical date query state while
retaining upstream membership and order. Do not add a finance-specific
benchmark.

- [ ] **Step 4: Run RED**

```bash
pnpm --filter @pretable-internal/row-model exec vitest run src/__tests__/compiled-query.test.ts src/__tests__/flat-query.test.ts src/__tests__/grouping.test.ts src/__tests__/distinct-values.test.ts src/__tests__/transitions.test.ts src/__tests__/external-filter-authority.test.ts src/__tests__/types.test.ts
pnpm typecheck:public
```

Expected: FAIL on Date-valued types/coercion, generic string ordering, and Date
group/distinct identity.

- [ ] **Step 5: Tighten the public types and local identity contract**

Add the calendar package to row-model dev dependencies. Change
`PretableColumnTypeFor<TValue>` so only a wholly string/null value can select
`"date"`; all non-string branches exclude `"date"`. Change the date operand to
`string`, remove `Date` from grouping/distinct unions, and make runtime
`isPretableGroupKey` reject every object. Update the group-key error message and
remove Date-specific distinct encoding.

Keep arbitrary custom column comparators and aggregators capable of holding
application-owned objects; do not globally remove Date cloning from generic
owned option snapshots.

- [ ] **Step 6: Replace coercive query semantics**

Import `isValidDateValue` and `compareDateValues`. Delete `toDayMs`,
`ISO_DATETIME_RE`, native date parsing, and Date-specific filter snapshot logic.

Date operand validation becomes shape-only:

```ts
const values = filter.operator === "dateBetween" ? filter.value : [filter.value];
if (
  !Array.isArray(values) ||
  (filter.operator === "dateBetween" && values.length !== 2) ||
  values.some((value) => typeof value !== "string")
) {
  fail("date operand must be a string", path, column.id);
}
```

Do not reject a string merely because its calendar semantics are invalid; the
evaluator checks `isValidDateValue` for the cell and every operand and returns
false when any required value is noncanonical.

In `compareValues`, preserve custom comparator precedence, then handle dates
before generic null handling:

```ts
if (column.type === "date" && column.compare === undefined) {
  const leftValid = isValidDateValue(left);
  const rightValid = isValidDateValue(right);
  if (leftValid !== rightValid) return leftValid ? -1 : 1;
  if (!leftValid) return 0;
  const result = compareDateValues(left, right);
  return ordering.direction === "desc" ? -result : result;
}
```

The same `compareValues` path already serves sibling groups; do not duplicate
group comparison.

- [ ] **Step 7: Run GREEN, full row-model, and type-performance gates**

```bash
pnpm --filter @pretable-internal/row-model test
pnpm --filter @pretable-internal/row-model typecheck
pnpm --filter @pretable-internal/row-model lint
pnpm typecheck:public
pnpm typecheck:performance
```

Expected: all pass with the same type-performance budget class; date operations
contain no `Date.parse`, timestamp, or local-time conversion.

- [ ] **Step 8: Commit**

```bash
git add packages/row-model type-tests/core type-tests/performance pnpm-lock.yaml
git commit -m "feat(core): enforce canonical date queries"
```

## Task 3: Add type-safe date extrema without widening strings

**Files:**

- Create: `packages/row-model/src/calendar-date-aggregates.ts`
- Create: `packages/row-model/src/__tests__/calendar-date-aggregates.test.ts`
- Modify: `packages/row-model/src/column-types.ts:44-56,108-166,198-308,419-448,594-652`
- Modify: `packages/row-model/src/compiled-query.ts:38-68,228-235,622-668,1487-1502`
- Modify: `packages/row-model/src/transaction-draft.ts:380-420`
- Modify: `packages/row-model/src/__tests__/{compiled-query,grouping,transitions,transactions,aggregator-law,types}.test.ts`
- Modify: `packages/react/src/types.ts:1-12,375-550`
- Modify: `packages/react/src/__tests__/cross-emission-type-identity.types.ts`
- Modify: `type-tests/core/query-and-aggregate.types.ts`
- Modify: `type-tests/react/model-inference.types.tsx`

- [ ] **Step 1: Write failing aggregate type tests**

Pin the public generic shape from the design:

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
```

Assert number `min` output is `number | null`, date `min`/`max` output is
`string | null`, `count` output is `number | null`, and custom finalizers keep
their exact output. Add `@ts-expect-error` cases for date `sum`/`avg`, text
`min`/`max`, and Date-valued extrema. Prove `formatAggregate` receives the exact
correlated output in both core and React helpers.

- [ ] **Step 2: Write failing aggregate runtime and law tests**

Test private `calendarDateMin`/`calendarDateMax` aggregators against canonical,
invalid, null, and empty input. Empty/all-invalid returns `null`. Test every
partition and merge order used by `aggregator-law.test.ts`; accumulators and
finalized outputs must remain detached and immutable.

Add grouped row-model tests for date min/max under insert, update, remove,
filter, expansion, and type transition. Numeric built-ins and custom aggregate
snapshots must be unchanged. Add work-counter and aggregate-root identity
assertions proving an unrelated row update does not churn a lowered date
extremum when its value, source order, and sort-key dependencies are unchanged.

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @pretable-internal/row-model exec vitest run src/__tests__/calendar-date-aggregates.test.ts src/__tests__/compiled-query.test.ts src/__tests__/grouping.test.ts src/__tests__/transitions.test.ts src/__tests__/transactions.test.ts src/__tests__/aggregator-law.test.ts src/__tests__/types.test.ts
pnpm typecheck:public
```

Expected: FAIL because date extrema are rejected and every built-in extremum is
typed numeric.

- [ ] **Step 4: Thread column type through aggregate types**

Change `PretableAggregateSpec` and `PretableAggregateOutputOf` to accept
`TType`, then thread it through `PretableColumnDefinition`, options/helper
overloads, callback context/input, `ColumnAggregateValueOf`,
`PretableAggregatesFor`, compatible aggregate specs, derivations, and React
factory types. Use:

```ts
export type PretableAggregateOutputOf<
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

Do not introduce `string | number | null` as a universal extremum output. Keep
the custom structural-finalize inference and cross-emission type identity tests.

- [ ] **Step 5: Lower date extrema before the aggregate tree**

Create two frozen private `PretableAggregator` instances whose accumulator is a
canonical string or `null`. `accumulate` ignores noncanonical values; `merge`
compares two canonical accumulator strings; `finalize` returns the accumulator.

Expose one internal resolver:

```ts
export function lowerCalendarDateAggregate(
  columnType: string,
  aggregate: string | PretableAggregator<object, unknown, unknown, unknown>,
): string | PretableAggregator<object, unknown, unknown, unknown> {
  if (columnType !== "date") return aggregate;
  if (aggregate === "min") return calendarDateMin;
  if (aggregate === "max") return calendarDateMax;
  return aggregate;
}
```

Call it while constructing each runtime compiled aggregate leaf. Public
derivation snapshots retain the original `"min"`/`"max"` token. Do not change
`aggregateTreeBuiltinAggregators`, its numeric overloads, or arbitrary string
aggregate support.

Keep a module-private identity predicate for the two frozen calendar
aggregators; do not export it from the row-model package entry point. In
`transaction-draft.ts`, route only those two identities through the same
value/source-order/sort-key structural comparison used by built-in string
aggregators. Every application-provided object aggregator retains the existing
row/value/dependency identity rule. This preserves incremental no-op detection
without making private lowering observable in public derivation snapshots.

Update compiled-query aggregate validation so `sum`/`avg` remain number-only,
`min`/`max` are legal for number or date columns, and `count` remains legal for
every column. No other string aggregate becomes valid.

- [ ] **Step 6: Run GREEN and full affected type/runtime gates**

```bash
pnpm --filter @pretable-internal/row-model test
pnpm --filter @pretable-internal/row-model typecheck
pnpm --filter @pretable/core build
pnpm --filter @pretable/react typecheck
pnpm typecheck:public
pnpm typecheck:performance
```

Expected: all pass; date extrema are strings, numeric extrema remain numbers,
and the persistent aggregate tree API is unchanged.

- [ ] **Step 7: Commit**

```bash
git add packages/row-model packages/react/src/types.ts packages/react/src/__tests__/cross-emission-type-identity.types.ts type-tests/core/query-and-aggregate.types.ts type-tests/react/model-inference.types.tsx
git commit -m "feat(core): aggregate canonical date extrema"
```

## Task 4: Make React date input strict, bounded, and session-safe

**Files:**

- Modify: `packages/react/package.json:40-49`
- Modify: `packages/react/tsconfig.json:3-12`
- Modify: `packages/react/tsconfig.build.json:3-16`
- Modify: `packages/react/tsconfig.typecheck.json:5-17`
- Rewrite: `packages/react/src/editors/date-utils.ts`
- Modify: `packages/react/src/editors/DateCellEditor.tsx:1-221`
- Modify: `packages/react/src/editors/type-parsing.ts`
- Modify: `packages/react/src/use-cell-edit-controller.ts:8-115`
- Modify: `packages/react/src/filter-menu/filter-operators.ts:130-190`
- Modify: `packages/react/src/pretable-surface.tsx:3199-3214,6230-6291`
- Modify tests: `packages/react/src/__tests__/{date-utils,date-cell-editor,type-parsing,use-cell-edit-controller,filter-operators,filter-menu,filter-menu-row-model-boundary,filter-menu-surface,paste-surface,pretable-surface-editing}.test.ts(x)`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Write failing parser, menu, and paste tests**

Assert the built-in parser accepts an exact canonical string without
modification, maps only an exact user-cleared empty draft to `null`, and rejects
`Date`, epoch, date-time, loose, overflow, padded, and whitespace values. No
built-in edit or paste path trims. Paste accepts only canonical/exact-empty
cells and reports every rejected shape with `reason: "invalid"` and the
canonical guidance message.

For the menu, complete canonical input emits a date filter. Incomplete,
cleared, or invalid input emits `null` and removes the currently applied filter.
The row-model-boundary test separately proves an application-controlled invalid
string remains active and zero-matches.

- [ ] **Step 2: Write failing editor and session-provenance tests**

Cover:

- canonical raw input is seeded unchanged;
- without `formatEditValue`, raw `Date`, epoch, date-time, padded, empty-string,
  whitespace, and `undefined` seeds remain visible as raw text and untouched
  blur cancels without calling the parser or row-change callback;
- untouched canonical string and canonical `null` retain their value;
- a custom parser runs on blur only after an actual user change;
- controlled canonical rerenders synchronize cursor, selection, displayed
  month, active descendant, and boundary controls;
- controlled invalid rerenders clear selection without replacing the useful
  cursor or letting Enter substitute it;
- Arrow/Page navigation marks the draft user-modified and commits on blur;
- navigation/buttons clamp at `0000-01-01` and `9999-12-31`;
- out-of-range filler slots are disabled null placeholders;
- a type-to-replace edit followed in one React batch by public
  `cancelEdit(); beginEdit(...)`, or by direct edit replacement, cannot leak
  provenance into the new session;
- an immediately resolved async `editable` gate preserves the typing session;
- controlled-row reconciliation that closes an edit through the pending-row
  layout-effect path also clears the active/typed session tokens.

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/date-utils.test.ts src/__tests__/date-cell-editor.test.tsx src/__tests__/type-parsing.test.ts src/__tests__/use-cell-edit-controller.test.ts src/__tests__/filter-operators.test.ts src/__tests__/filter-menu.test.tsx src/__tests__/filter-menu-row-model-boundary.test.ts src/__tests__/filter-menu-surface.test.tsx src/__tests__/paste-surface.test.tsx src/__tests__/pretable-surface-editing.test.tsx
```

Expected: FAIL on coercion, boundary overflow, untouched blur mutation, and the
free boolean edit provenance.

- [ ] **Step 4: Wire React to the private package**

Add the calendar package to React dev dependencies and all three React tsconfig
path maps (`src` for local tests, `dist` for build/typecheck). Refresh the
lockfile. The existing `/^@pretable-internal\//` tsup rule bundles it; do not add
row-model as a React runtime import.

- [ ] **Step 5: Rewrite UI utilities over shared primitives**

Delete `toIsoDate`, `parseIsoDate`, ISO date-time parsing, and `Date.parse`.
Retain only React/UI policy: viewer-local `todayIso`, English month labels, and a
Monday-first six-week matrix. Represent boundary cells as:

```ts
export interface CalendarDay {
  readonly iso: string | null;
  readonly day: number | null;
  readonly inMonth: boolean;
  readonly disabled: boolean;
}
```

Only positions outside the supported domain have `iso: null`. All valid filler
days remain selectable.

- [ ] **Step 6: Implement provenance-aware editor state**

Use one atomic render-time-synchronized state object, not effect-driven prop
state:

```ts
interface DateEditorState {
  readonly observedDraft: unknown;
  readonly cursor: string;
  readonly selected: string | null;
  readonly userModified: boolean;
  readonly userDraft: unknown;
}
```

Guard synchronization with `Object.is(state.observedDraft, input.draft)`. A
changed canonical controlled draft retargets cursor and selection; a changed
invalid draft clears selection but preserves the last useful cursor. `onChange`
and successful navigation atomically set `userModified`/`userDraft` before
calling `input.setDraft`.

Blur commits exact canonical/null seeds, user-modified canonical/empty drafts,
or a user-modified custom-parser draft. Untouched noncanonical seeds cancel.
Boundary navigation no-ops do not create provenance.

- [ ] **Step 7: Key typing provenance to edit identity**

Replace the free `seededFromTyping: boolean` with a private session record:

```ts
interface EditSessionState {
  readonly activeToken: number | null;
  readonly typedToken: number | null;
}

const editSessionSequenceRef = useRef(0);
const [editSession, setEditSession] = useState<EditSessionState>({
  activeToken: null,
  typedToken: null,
});
```

Create one private `beginEditWithSession(input, seededFromTyping)` wrapper. It
increments the sequence, installs that value as `activeToken` and, only for the
explicit printable-key entry path, as `typedToken`, and then calls
`indexedGrid.beginEdit`. Route controller begins and the public surface-grid
facade through that wrapper; every non-typing begin sets `typedToken` to `null`.
Route every cancel and successful commit wrapper through a private
session-ending helper that increments the sequence, clears both tokens, and
then cancels the engine edit. A direct begin while another edit is active
therefore replaces the active token before React renders.

Extend only the private `CellEditController.begin` signature with an optional
entry-provenance argument and forward it through the controller's private grid
`beginEdit` payload. The printable-key handler calls
`editController.begin(addr, key, { seededFromTyping: true })`; Enter, F2,
boolean editing, and all other controller calls omit it. The facade consumes
that field in `beginEditWithSession` and never forwards it into public engine
state. Add controller-unit assertions for exact forwarding and default-false
behavior.

Replace every direct `indexedGrid.cancelEdit()` in the surface—including the
pending controlled-row reconciliation layout effect—with the session-ending
helper. Keep the public `surfaceGrid.beginEdit` signature unchanged and route
it through `beginEditWithSession(input, false)`. Search the surface after the
change to prove no begin/cancel bypass remains.

Draft and status updates do not change the token, so immutable engine edit-state
replacements and immediately resolved async `editable` gates retain provenance.
Pass `seededFromTyping={snapshot.editing !== null &&
editSession.activeToken !== null && editSession.activeToken ===
editSession.typedToken}`. Do not read a just-issued begin back through the
facade snapshot, compare engine edit objects, add a public edit field, or depend
on observing an intermediate no-edit render.

- [ ] **Step 8: Run GREEN and full React checks**

```bash
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/date-utils.test.ts src/__tests__/date-cell-editor.test.tsx src/__tests__/type-parsing.test.ts src/__tests__/use-cell-edit-controller.test.ts src/__tests__/filter-operators.test.ts src/__tests__/filter-menu.test.tsx src/__tests__/filter-menu-row-model-boundary.test.ts src/__tests__/filter-menu-surface.test.tsx src/__tests__/paste-surface.test.tsx src/__tests__/pretable-surface-editing.test.tsx
pnpm --filter @pretable/react test
pnpm --filter @pretable/react typecheck
pnpm --filter @pretable/react lint
```

Expected: all pass with no new warning and no `react-hooks/set-state-in-effect`
suppression.

- [ ] **Step 9: Commit**

```bash
git add packages/react/package.json packages/react/tsconfig.json packages/react/tsconfig.build.json packages/react/tsconfig.typecheck.json packages/react/src/editors packages/react/src/filter-menu packages/react/src/use-cell-edit-controller.ts packages/react/src/pretable-surface.tsx packages/react/src/__tests__ pnpm-lock.yaml
git commit -m "feat(react): make date input canonical"
```

## Task 5: Add the public date-format contract and compiler

**Files:**

- Modify: `packages/row-model/src/column-types.ts:97-166,198-308`
- Modify: `packages/core/src/types.ts:53-116`
- Modify: `packages/core/src/public_api.ts:28-142`
- Modify: `packages/react/src/types.ts:204-550,580-620`
- Modify: `packages/react/src/use-pretable.ts:26-89`
- Modify: `packages/react/src/public_api.ts:145-165`
- Create: `packages/react/src/date-formatters.ts`
- Create: `packages/react/src/__tests__/date-formatters.test.ts`
- Create: `type-tests/core/date-format.types.ts`
- Create: `type-tests/react/date-format.types.tsx`
- Modify: `packages/react/src/__tests__/column-helper-number-format.test.tsx`
- Modify: `packages/react/src/__tests__/indexed-presentation.test.tsx`

- [ ] **Step 1: Write failing public type tests**

Declare valid granular and `dateStyle` options with
`satisfies PretableDateFormatOptions`. Add `@ts-expect-error` cases for `hour`,
`timeZone`, `timeStyle`, `fractionalSecondDigits`, and assignment from a broadly
typed `Intl.DateTimeFormatOptions` variable. Assert `PretableDateFormatKey` is
not public.

Prove `dateFormat` works on direct/computed core helpers, React-augmented
helpers, hand-declared `PretableColumn`, and explicit-model presentation input
under the same schema-authoritative merge policy as `numberFormat`. Import both
the option type and validator from `@pretable/react`.

- [ ] **Step 2: Write failing compiler/cache tests**

Cover:

- `en-US` and `en-GB` output for `dateStyle` and granular fields;
- UTC anchoring under a non-UTC process time zone;
- allowed `calendar` and `numberingSystem` options;
- year `0000` with explicit era (native locale output, not literal `0000`);
- contextual `[pretable] invalid dateFormat for column "due"` errors with
  retained `cause`;
- rejection of enumerable/non-enumerable unknown or forbidden own string keys,
  all symbol keys, and forbidden keys whose value is `undefined`;
- native-invalid combinations such as `dateStyle` plus a granular component;
- one formatter per stable column/options/locale; only changed option identity
  rebuilds one; locale identity rebuilds all; removal/reorder stays coherent.

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @pretable/core build
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/date-formatters.test.ts src/__tests__/column-helper-number-format.test.tsx src/__tests__/indexed-presentation.test.tsx
pnpm typecheck:public
```

Expected: FAIL because the option type, column field, compiler, and React
re-exports do not exist.

- [ ] **Step 4: Add the strict public option type and column field**

Keep the key alias internal and export:

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

export type PretableDateFormatOptions = Pick<
  Intl.DateTimeFormatOptions,
  PretableDateFormatKey
> &
  Partial<
    Record<
      Exclude<keyof Intl.DateTimeFormatOptions, PretableDateFormatKey>,
      never
    >
  >;
```

Add `dateFormat?: PretableDateFormatOptions` beside `numberFormat` in typed
definitions/options, React presentation/factory/legacy columns, and model
schema merging. Re-export the type and validator from core and React. TSDoc
states that formatting accepts canonical strings only and never affects
derivation/editing.

- [ ] **Step 5: Implement strict formatter reconciliation**

Create an internal module with:

```ts
export type DateFormatterRegistry = ReadonlyMap<string, Intl.DateTimeFormat>;

export interface DateFormatterCacheState {
  readonly locale: Intl.LocalesArgument | undefined;
  readonly optionsByColumnId: ReadonlyMap<string, PretableDateFormatOptions>;
  readonly formatters: DateFormatterRegistry;
}

export function reconcileDateFormatters<TRow extends PretableRow>(
  previous: DateFormatterCacheState | undefined,
  columns: readonly PretableColumn<TRow>[],
  locale?: Intl.LocalesArgument,
): DateFormatterCacheState;
```

Validate every `Reflect.ownKeys(options)` entry against the exact string
allowlist before constructing
`new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" })`. Reject all
symbols. Never strip invalid keys. Reuse by `Object.is(locale)` and options
reference identity, keyed by column ID.

- [ ] **Step 6: Run GREEN and public API type checks**

```bash
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/date-formatters.test.ts src/__tests__/column-helper-number-format.test.tsx src/__tests__/indexed-presentation.test.tsx
pnpm --filter @pretable/core typecheck
pnpm --filter @pretable/core build
pnpm --filter @pretable/react typecheck
pnpm typecheck:public
```

Expected: all pass; React consumers import both public date symbols from one
entry point and no private helper leaks.

- [ ] **Step 7: Commit**

```bash
git add packages/row-model/src/column-types.ts packages/core/src/types.ts packages/core/src/public_api.ts packages/react/src/types.ts packages/react/src/use-pretable.ts packages/react/src/public_api.ts packages/react/src/date-formatters.ts packages/react/src/__tests__ type-tests/core/date-format.types.ts type-tests/react/date-format.types.tsx
git commit -m "feat: add native date format options"
```

## Task 6: Integrate one native formatter pipeline across every channel

**Files:**

- Modify: `packages/react/src/value-formatting.ts:1-159`
- Modify: `packages/react/src/pretable-surface.tsx:350-380,1808-1849,4740-4770,5720-5900`
- Modify: `packages/react/src/group-row.tsx:1-220`
- Modify: `packages/react/src/copy.ts:1-390`
- Modify: `packages/react/src/csv.ts:1-590`
- Modify: `packages/react/src/__tests__/value-formatting.test.ts`
- Create: `packages/react/src/__tests__/date-formatting-surface.test.tsx`
- Create: `packages/react/src/__tests__/column-helper-date-format.test.tsx`
- Modify: `packages/react/src/__tests__/{group-row-render,copy,csv,csv-export-surface,indexed-presentation,external-filter-authority,external-sort-authority,paste-surface}.test.ts(x)`

- [ ] **Step 1: Write failing pure precedence and cache tests**

Pin data precedence `format -> canonical dateFormat -> compatible numberFormat
-> fallback` and aggregate precedence `formatAggregate -> canonical dateFormat
-> compatible numberFormat -> fallback`.

Invalid/non-string date values use each channel's existing fallback. A numeric
date-column `count` may use `numberFormat` but never `dateFormat`. Canonical date
min/max/custom aggregate strings may use `dateFormat`. Spy on the UTC converter
and ensure one conversion/parse per native date format operation.

- [ ] **Step 2: Write failing surface, authority, and SSR tests**

Cover localized canonical display, `dateFormat` on a non-date column, invalid
raw fallback, locale/options updates, construction budget, raw custom-renderer
`value` plus localized `formattedValue`, and callback precedence.

Prove rows mode and explicit model mode. With external sort/filter authority,
presentation applies locally while upstream order/membership and controlled
query state remain untouched. Use `renderToString` plus hydration with an
explicit locale. Assert timezone stability and document/test the equivalent-ICU
precondition rather than promising cross-ICU byte equality.

Change only a column's `dateFormat` options and assert the row-model snapshot,
derived-row identities, and processing work counters remain unchanged while
the rendered presentation updates. This is the regression for the design's
presentation-only invalidation guarantee.

- [ ] **Step 3: Write failing group/copy/CSV tests**

Cover date min/max inheritance, custom canonical aggregates, numeric count,
TSV and HTML, CSV data/group rows, formula-safety raw-vouch behavior, standalone
locale, mounted registry reuse, invalid values, column reorder/removal, and
formatted-copy/noncanonical-paste rejection.

- [ ] **Step 4: Run RED**

```bash
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/value-formatting.test.ts src/__tests__/date-formatting-surface.test.tsx src/__tests__/column-helper-date-format.test.tsx src/__tests__/group-row-render.test.tsx src/__tests__/copy.test.ts src/__tests__/csv.test.ts src/__tests__/csv-export-surface.test.tsx src/__tests__/indexed-presentation.test.tsx src/__tests__/external-filter-authority.test.tsx src/__tests__/external-sort-authority.test.tsx src/__tests__/paste-surface.test.tsx
```

Expected: FAIL because only number registries reach consumers.

- [ ] **Step 5: Generalize the existing cache owner**

Refactor `value-formatting.ts` to expose one internal registry:

```ts
export interface ValueFormatterRegistry {
  readonly numbers: ReadonlyMap<string, Intl.NumberFormat>;
  readonly dates: ReadonlyMap<string, Intl.DateTimeFormat>;
}

export interface ValueFormatterCache {
  resolve<TRow extends PretableRow>(
    columns: readonly PretableColumn<TRow>[],
    locale?: Intl.LocalesArgument,
  ): ValueFormatterRegistry;
}

export function createValueFormatterCache(): ValueFormatterCache;
export function compileValueFormatters<TRow extends PretableRow>(
  columns: readonly PretableColumn<TRow>[],
  locale?: Intl.LocalesArgument,
): ValueFormatterRegistry;
```

Compose number and date reconciliation into one coherent state. Format a
canonical string by converting it exactly once with `dateValueToUtcMs` and
passing that finite result to the UTC-locked formatter. Do not call the
validator and converter separately on the cell hot path.

- [ ] **Step 6: Thread the registry through all consumers**

Instantiate `createValueFormatterCache()` once per mounted surface. Immediately
after `authoritativeColumns`, resolve that persistent cache in a memo with exact
`[authoritativeColumns, locale]` dependencies. Pass the exact returned registry
to surface rendering, group rows, mounted copy, and mounted CSV. Replace
`numberFormatters` arguments/props with `valueFormatters` throughout.

Mounted copy reuses the surface registry. Public standalone `serializeRanges`
and `serializeCsv` use `compileValueFormatters` once per invocation. Preserve
raw values delivered to row-model accessors, callbacks, renderers, edit/paste,
CSV formula-safety vouching, and each channel's existing fallback.

- [ ] **Step 7: Run GREEN and full React checks**

```bash
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/value-formatting.test.ts src/__tests__/date-formatting-surface.test.tsx src/__tests__/column-helper-date-format.test.tsx src/__tests__/group-row-render.test.tsx src/__tests__/copy.test.ts src/__tests__/csv.test.ts src/__tests__/csv-export-surface.test.tsx src/__tests__/indexed-presentation.test.tsx src/__tests__/external-filter-authority.test.tsx src/__tests__/external-sort-authority.test.tsx src/__tests__/paste-surface.test.tsx
pnpm --filter @pretable/react test
pnpm --filter @pretable/react typecheck
pnpm --filter @pretable/react lint
```

Expected: all pass; no formatter construction occurs per cell and copy/CSV
match display precedence.

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/value-formatting.ts packages/react/src/pretable-surface.tsx packages/react/src/group-row.tsx packages/react/src/copy.ts packages/react/src/csv.ts packages/react/src/__tests__
git commit -m "feat(react): format calendar dates natively"
```

## Task 7: Publish the canonical contract and release evidence

**Files:**

- Create: `apps/website/content/docs/grid/date-formatting.mdx`
- Create: `apps/website/app/docs/__tests__/date-formatting.types.tsx`
- Modify: `apps/website/app/docs/_nav.ts:20-50`
- Modify: `apps/website/content/docs/grid/api-reference.mdx`
- Modify: `apps/website/content/docs/grid/editing.mdx`
- Modify: `apps/website/content/docs/grid/filtering.mdx`
- Modify: `apps/website/content/docs/grid/sorting.mdx`
- Modify: `apps/website/content/docs/grid/grouping.mdx`
- Modify: `apps/website/content/docs/grid/clipboard.mdx`
- Modify: `apps/website/content/docs/grid/export.mdx`
- Modify: `apps/website/content/docs/grid/cell-renderers.mdx`
- Modify: `apps/website/content/docs/grid/cell-presentations.mdx`
- Modify: `apps/website/content/docs/grid/pretable-surface.mdx`
- Modify: `apps/website/app/api/docs/rows/dataset.ts:154-212,226-298,337-369`
- Modify: `apps/website/app/api/docs/rows/__tests__/dataset.test.ts`
- Modify: `apps/website/lib/docs/__tests__/docs-api-surface.test.ts`
- Modify: `apps/website/e2e/docs.spec.ts`
- Modify: `README.md`
- Modify generated: `packages/core/core.api.md`
- Modify generated: `packages/react/react.api.md`
- Create: `.changeset/<generated-calendar-date-name>.md`
- Modify: `docs/superpowers/specs/2026-08-18-canonical-calendar-dates-row-model-design.md`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Write failing docs and server-fixture tests**

Register a typed fixture for every date-formatting code fence. Extend docs API
surface tests and Playwright to require the route, nav entry, canonical
`YYYY-MM-DD`, `dateFormat`, `PretableDateFormatOptions`, and
`isValidDateValue`.

In the server-data dataset tests, require canonical string comparison, invalid
semantic string zero-match, and wrong JavaScript operand type error. Confirm
there is no `Date.parse` or date-time coercion in the demo backend.

Run RED:

```bash
pnpm --filter @pretable/app-website exec vitest run lib/docs/__tests__/docs-api-surface.test.ts app/api/docs/rows/__tests__/dataset.test.ts
```

Expected: FAIL because the guide/fixture does not exist and the server demo is
coercive.

- [ ] **Step 2: Write the guide and correct existing claims**

Document:

- calendar date versus instant;
- canonical `YYYY-MM-DD | null` storage and public validator;
- typed `createColumnHelper` and explicit-model/rows-mode usage;
- `dateFormat` with `dateStyle` and granular fields;
- exact option allowlist and internal UTC anchor;
- locale/ICU SSR requirements;
- valid-first/non-date-last sorting and the date-specific `nulls` rule;
- strict filters, invalid controlled zero-match, and invalid menu-draft removal;
- `min`, `max`, and numeric `count` aggregate behavior;
- callback/date/number/fallback precedence across display, group, copy, and CSV;
- formatted copy does not round-trip through strict paste;
- migration from Date/epoch/date-time values at the application boundary;
- no unsafe `toISOString().slice(0, 10)` recommendation without a chosen UTC
  policy.

Remove mixed-date claims from editing, filtering, renderer, clipboard, export,
surface, and API docs. Keep application-owned `Date` examples only when clearly
named as instants and paired with explicit projection/hooks.

- [ ] **Step 3: Align the server-data demo**

Import `isValidDateValue` from the public core entry point. Remove
`ISO_DATETIME_RE`, `utcDayOf`, `isoDayMs`, and `toDayMs`. Date operand shape
validation accepts strings/2-string ranges; `matchesDate` returns false when a
cell or operand string is noncanonical and otherwise compares canonical strings
directly. Preserve every non-date operator and fixture count.

- [ ] **Step 4: Add navigation, README, lifecycle, and release intent**

Place “Date formatting” after “Number formatting”. Add one concise README
capability/guide link. Keep the design `Status: planned` and its plan link until
release. Keep the roadmap item in `Now` and label the link “planned design”.

Create one changeset:

```md
---
"@pretable/core": minor
"@pretable/react": minor
---

**Breaking:** Make date columns strict RFC 3339 full-date values and add native,
locale-aware date formatting. Applications must project Date, epoch, date-time,
or localized values to `YYYY-MM-DD | null` to retain built-in date processing.
```

Do not list UI or stream-adapter; the fixed release group aligns packages. Do
not use a major changeset because that would publish `1.0.0` prematurely.

- [ ] **Step 5: Generate and inspect API reports**

```bash
pnpm api
pnpm api:check
```

Expected: reports include `dateFormat`, `PretableDateFormatOptions`, and
`isValidDateValue`; they do not expose `PretableDateFormatKey`, calendar parts,
parser, arithmetic, UTC conversion, or formatter registries.

- [ ] **Step 6: Run documentation and packaging gates**

```bash
pnpm --filter @pretable/app-website test
pnpm --filter @pretable/app-website typecheck
pnpm --filter @pretable/core build
pnpm --filter @pretable/react build
pnpm lint:packaging
pnpm exec prettier --check README.md ROADMAP.md .changeset apps/website/content/docs/grid apps/website/app/docs/_nav.ts apps/website/app/docs/__tests__/date-formatting.types.tsx apps/website/app/api/docs/rows apps/website/e2e/docs.spec.ts packages/core/core.api.md packages/react/react.api.md docs/superpowers/specs/2026-08-18-canonical-calendar-dates-row-model-design.md
git diff --check
```

The full website suite has one known load-sensitive strict-mode test that once
timed out on a clean main baseline and passed the package rerun plus five
isolated reruns. If it recurs, use systematic debugging and fresh reruns to
distinguish load from a date regression; do not skip or extend the new tests.

- [ ] **Step 7: Build and test the local docs branch in real browsers**

Playwright defaults to the deployed site, so start this branch locally:

```bash
set -e
pnpm --filter @pretable/app-website build
pretable_docs_log=$(mktemp)
pnpm --filter @pretable/app-website exec next start --hostname 127.0.0.1 --port 3107 >"$pretable_docs_log" 2>&1 &
pretable_docs_pid=$!
trap 'kill "$pretable_docs_pid" 2>/dev/null || true' EXIT
for attempt in {1..120}; do
  if curl -fsS http://127.0.0.1:3107/docs/grid/date-formatting >/dev/null; then
    break
  fi
  sleep 0.25
done
curl -fsS http://127.0.0.1:3107/docs/grid/date-formatting >/dev/null
BASE_URL=http://127.0.0.1:3107 pnpm --filter @pretable/app-website exec playwright test e2e/docs.spec.ts --project=chromium --project=webkit
kill "$pretable_docs_pid"
trap - EXIT
```

Expected: both browsers pass against the local route.

- [ ] **Step 8: Commit**

```bash
git add README.md ROADMAP.md .changeset apps/website packages/core/core.api.md packages/react/react.api.md docs/superpowers/specs/2026-08-18-canonical-calendar-dates-row-model-design.md
git commit -m "docs: publish canonical date contract"
```

## Final verification and review

After all seven tasks pass their task-level spec and quality reviews:

- [ ] Dispatch one final reviewer against the design, this plan, and the complete
  branch diff.
- [ ] Resolve every Critical/Important finding and re-review.
- [ ] Run fresh full gates:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm api:check
pnpm lint:packaging
pnpm publish:preflight
git diff --check origin/main...HEAD
```

- [ ] Verify scope and forbidden leftovers:

```bash
rg -n "toIsoDate|toDayMs|ISO_DATETIME_RE|Date\.parse" packages/calendar-date/src packages/row-model/src packages/react/src/editors apps/website/app/api/docs/rows
rg -n "Cells may be.*Date|epoch milliseconds|ISO datetimes" apps/website/content/docs/grid
git status --short
```

Expected: the first two searches return no live-contract leftovers. Generic
clipboard serialization and application-owned instant examples may still use
`Date`; inspect every match rather than deleting unrelated support. The worktree
is clean.

- [ ] Use `superpowers:requesting-code-review`, then
  `superpowers:verification-before-completion`, then
  `superpowers:finishing-a-development-branch` and follow the user's requested
  PR/merge workflow.
