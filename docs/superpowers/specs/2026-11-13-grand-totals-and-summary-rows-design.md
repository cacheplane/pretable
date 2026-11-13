# Grand totals and summary rows

Date: 2026-11-13
Status: draft for discussion; not approved for implementation
Implementation plan: pending

## Purpose

Add a domain-neutral summary area that answers both “what matches this view?”
and “what is the total across my data?” without manufacturing editable data
rows. Follow the next-feature sequence in the approved
[calendar-date design](./2026-08-11-calendar-date-semantics-and-formatting-design.md#roadmap-consequences).

The user approved both filtered and all-input totals plus explicit server-supplied
values on 2026-11-13. The contracts below are the proposed design within that
scope; implementation still requires review of this complete design.

## Existing foundations

- `packages/row-model/src/group-index.ts` maintains separate all and filtered
  aggregate roots for groups. These are useful mechanisms, not an existing
  public whole-dataset summary API.
- `packages/row-model/src/persistent/aggregate-tree.ts` supplies scalar cells
  for sum/average/count and ordered aggregate trees for min/max/custom folds.
- `packages/row-model/src/column-types.ts` defines typed built-in and custom
  aggregators, including date-aware minimum/maximum contracts.
- `packages/react/src/value-formatting.ts` owns shared aggregate formatting
  and cached native number/date formatters.
- Server-data scope and population counts already distinguish loaded data from
  a complete dataset. A row-count claim is not an aggregate-value claim.

## Approaches considered

1. **Dedicated summaries backed by the row model — recommended.** Incremental
   aggregation and shared formatting; separate summary identity and rendering.
   Requires a small explicit summary contract and renderer integration.
2. **Synthetic rows in the data model.** Reuses ordinary row rendering but
   pollutes sorting, filtering, row counts, focus, selection, editing, paste,
   grouping, and remote-window identity. Reject for this feature.
3. **Application-rendered footer only.** Easy to compose, but every application
   must recompute aggregates, align columns, and explain partial data itself.
   Retain ordinary composition as an escape hatch, not the built-in feature.

## Proposed first release

An opt-in, bottom summary area supports up to two rows, one per configured scope:
filtered input and all input. Each scope independently declares engine or server
authority. Both use the same presentation contract; no extra rows are introduced
when an authority changes. Arbitrary formulas, arbitrary numbers of custom rows, top/bottom
pinning choices, group footers, selection totals, pivot, and summary editing are
out of scope for this first design.

Use the effective column aggregate configuration, including supported aggregate
overrides, rather than introducing a second aggregation vocabulary. Columns
without an aggregate are blank. An explicit row label identifies scope; the
label must not overwrite a numeric result when the first drawn column itself
has an aggregate. Propose a full-width caption immediately above each summary
value row, preserving every column slot for its result. This costs vertical
space but remains legible on narrow grids. Both rows are opt-in; disabling the
summary area restores all of its viewport space.

### Meaning and data ownership

- **Filtered:** aggregate matching data rows before grouping/collapse and before
  viewport virtualization. Collapsing a group or scrolling never changes it.
- **All input:** aggregate all rows owned by the local model before filters.
  This is not a claim about records absent from a remote window.
- With partial/external data, engine-computed values are labelled as totals of
  loaded rows. An exact population count does not prove their completeness.
- Server totals explicitly state their population scope and availability.
  Matching totals are tied to the application's current query identity; a new
  query must not silently display an old answer as current.
- Loading, unavailable, error, and stale answers are distinct from zero or an
  empty dataset. Preserve prior values only with an explicit stale indication.
- Applications own fetching, permissions, and the truth of supplied aggregates;
  this feature must not become a network/cache orchestration API.

### Server answers and provenance

A conceptual per-scope descriptor has an authority, an application-visible
scope label, and a result. Public TypeScript names remain an implementation-plan
review item; the behavioral contract is fixed by this proposal:

- Engine authority owns its computed result and never consumes a server value.
  Server authority never silently falls back to a loaded-row calculation.
- For each server scope the application supplies a current request key and
  answers tagged with that key. The key changes whenever the answer would mean
  something different: applicable filters, aggregate definitions/overrides,
  dataset/authorization context, relevant data revision, and applicable sort keys,
  sort authority, or externally supplied order revisions for order-sensitive
  custom aggregates. No grid-generated
  serialization or hashing of application queries.
- Results are discriminated as loading, ready, stale, error, or unavailable.
  Ready answers require the current key. A mismatched answer is not rendered as
  ready; the grid shows unavailable until a current state arrives. Out-of-order
  completion can therefore never overwrite a current total silently.
- A stale answer explicitly carries its original key and an application label
  explaining its age/context. Only this state may display an earlier value. A
  loading or error state does not retain old numbers implicitly. Answers also
  carry an aggregate-definition key, supplied by the application and changed
  whenever column identity/value semantics or effective aggregate definitions
  change. Stale values render only when that key matches the current one. An
  incompatible key makes the value unavailable, even if explicitly marked stale.
  Pure locale/presentation changes do not change that semantic key.
- Ready/stale values are keyed by canonical column identity and use the current
  summary formatting path only after the semantic-compatibility check. An omitted value means unavailable, not zero;
  explicit null retains the aggregator's empty-result meaning. Unknown column
  keys are ignored. No aggregation method is inferred from a number's shape.
- Server-supplied values carry a completeness claim: complete or partial. A
  partial claim is visibly labelled, even when the server knows an exact row
  count. Estimates are deferred rather than encoded as falsely complete values.
- Changing a tool-panel aggregate override invalidates the applicable server
  answer key. The application must request a replacement; Pretable owns no
  endpoint, retries, or remote cache.

“All input” is always bounded by the application's dataset and permissions. In
external mode a loaded window of an already-filtered result cannot reconstruct
an unfiltered dataset; engine labels must say “All loaded rows” and “Matching
loaded rows,” never “All records.” Only explicitly server-authoritative answers
may make a full remote-population claim in this first release.

### Aggregation correctness

Aggregate source data directly. Never sum group totals or average group
averages: nested grouping can double-count, and averages need their underlying
sum/count. Reuse existing built-in empty-input and invalid-value behavior, date
validation, and numeric accumulation. Custom folds follow the compiled row comparator: active local sort keys, then
stable source order. With external sort authority they fold in supplied source
order. Both scopes use this ordering; the filtered scope omits rejected rows.
Sorting may change order-sensitive custom outputs and must update their trees,
while built-in numeric/date results remain order-independent. No implicit currency conversion,
rounding policy, or formula engine.

Summaries work with or without grouping. A row mutation and its summary update
publish together in one coherent snapshot. A cooperative filter rebuild must
not expose rows from one generation with totals from another.

### Rendering and interaction

Propose a bottom summary region aligned to the same planned columns, widths,
pinning, and horizontal scroll as the data viewport. It does not consume a data
row ID, change data-row counts, or enter the editable/paste/selection row space.

Introduce a summary-specific column callback, proposed as `formatSummary`,
receiving the raw value, column, and a summary context (scope, authority,
completeness, and ready/stale state). It receives no data row or group. Resolution
is: summary callback, applicable cached native date/number formatter, then the
existing generic display fallback. Missing/loading/error values render their
status placeholder without calling a value formatter.

Existing `formatAggregate` callbacks remain group-only and unchanged: the React
contract requires a real group object, which a grand total cannot honestly
supply. Do not fabricate a group or invoke a data-cell `format` callback. Reuse
the native formatter registry and domain guards, not the group-dependent
resolver. Document how applications can share a value-formatting function across
their group and summary callbacks. Raw summary values remain available to
headless consumers. Locale changes affect display,
not aggregate state. Existing data-copy/export remains unchanged; any explicit
summary-copy affordance must label its scope rather than silently append totals
to a selected data range. The first release adds no summary copy/export action;
applications can consume the headless raw result explicitly.

Accessibility must expose a labelled, read-only summary structure with column
associations. The preferred starting point is a separate summary table adjacent
to the data grid so data-grid row indices and keyboard navigation remain stable.
Confirm screen-reader behavior and narrow-screen label placement with a small
prototype before accepting this rendering decision. Do not announce every
streaming tick through an assertive live region.

### Performance and architecture

Keep the summary computation framework-neutral and expose it through immutable
row-model snapshots. React renders results; it does not scan source rows.

Allocate summary state only when enabled. Reuse scalar/tree aggregation
mechanisms without duplicating the full grouping index. Proposed budgets:

- O(1) cached read per summary cell;
- no aggregate recomputation on focus, selection, scroll, or ordinary render;
- scalar built-ins update per affected row/aggregate; ordered folds retain their
  tree-update complexity rather than scanning the dataset on each tick;
- initial construction and changed filters may scan input, using the existing
  cooperative scheduling/publication discipline;
- no global caches or formatter construction in the per-cell render path.

Measure both enabled overhead and disabled-mode parity before promising a
specific implementation or benchmark threshold.

## Verification required before implementation is complete

- Empty input, invalid/empty numeric/date cells, weighted averages, nested
  groups, collapsed groups, zero filter matches, and deterministic custom folds.
- Streaming insert/update/remove, changed aggregate overrides, filter rebuilds,
  sort-sensitive custom folds, and atomic snapshot publication.
- Partial windows, eviction, external query changes, missing server answers,
  and stale/error state without false “grand total” claims. Include stale values
  after aggregate-type changes and server answers invalidated by sort changes.
- Column resize/reorder/hide/pin, horizontal scrolling, locale changes, SSR,
  narrow layouts, and keyboard/screen-reader navigation.
- Summary callback/native/fallback precedence, unchanged group-dependent
  callbacks, missing-value behavior, and locale-only formatting changes.
- Unchanged selection, paste, editing, row IDs, row counts, and data export.
- Headless API/type tests, API reports, consumer docs, changeset, browser tests,
  and performance evidence that summary updates do not introduce full-row scans.

## Design review

Scope is approved: both total scopes and server-supplied values. Review the
remaining proposed decisions together before implementation planning:

1. Bottom summary area, with a caption above each value row and a separate
   accessible summary table.
2. Explicit per-scope authority, keyed server answers, and visible partial/stale
   states.
3. Existing custom-fold ordering and no new summary-copy interaction in v1.

After these decisions, review the complete design before writing an
implementation plan. No runtime code changes are part of this draft.
