# Pretable roadmap

Last reviewed: 2026-11-19

Pretable is a batteries-included, domain-neutral React data grid. Correctness,
performance, and developer experience govern its roadmap. Financial-grade
applications are a proving ground, not the product boundary.

## Governing principles

- Performance and correctness are product features: every major capability gets
  an explicit complexity/memory budget, deterministic workload, and committed
  evidence.
- Pretable ships working grid behavior and UI, not interfaces alone.
- One canonical derived model governs rendering, focus, selection, editing,
  clipboard, accessibility, and virtualization.
- The grid remains finance-capable but domain-agnostic; applications own
  valuation, formulas, permissions, storage endpoints, and retention policy.
- Public state and protocols are versioned and migration-aware.

## Current baseline

The aligned public-package baseline is `0.21.0`. The shipped grid includes local
sorting and typed filtering, selection, keyboard navigation, copy, CSV export, and validated
bulk paste, typed asynchronous editing, column virtualization and layout,
configurable row grouping and aggregation, variable-height rows, and batched
streaming transactions. It also includes native number and canonical calendar-date
formatting, a configurable tool panel, replaceable UI components, and external
processing/window metadata for application-owned server data.

Grand totals and summary rows shipped in `0.21.0` via
[#622](https://github.com/cacheplane/pretable/pull/622), released through
[#628](https://github.com/cacheplane/pretable/pull/628). Filtered and all-input
scopes have independent engine or keyed server authority, cached raw aggregates,
explicit completeness/freshness states, and fixed-bottom read-only summary
tables. Summary rows do not enter selection, clipboard, or CSV output. The
separate benchmark fix in [#623](https://github.com/cacheplane/pretable/pull/623)
accounts for measured browser refresh cadence while retaining processing and
correctness limits.

Canonical calendar dates shipped in `0.14.0` via
[#480](https://github.com/cacheplane/pretable/pull/480); the calendar-date design
is not pending implementation. The S8 PMS benchmark profile is implemented;
financial-planning workloads remain deferred. Package changelogs and generated
API reports are the source of truth for shipped behavior. The external-data
primitives do not yet constitute the complete remote/live row-model protocol
listed below.

See the current [core changelog](packages/core/CHANGELOG.md),
[React changelog](packages/react/CHANGELOG.md),
[core API report](packages/core/core.api.md),
[React API report](packages/react/react.api.md), and
[committed comparative benchmark evidence](status/milestones/2026-05-12-comparator-aware-evaluators.hypotheses.json).

## Now — remote datasets implementation planning

Design the missing remote-data orchestration around the existing external-data
primitives. **Server-side grouping is required in the first release** (product
direction confirmed 2026-11-19), including branch loading, stable group identity,
server aggregates, expansion, bounded caching, and explicit partial/error state.
The first release is read-only grouped browsing with range access and exact
immediate-child counts, confirmed on 2026-11-19. Browsing uses one consistent
result version with explicit Refresh. Selection survives scrolling and collapse
within that result, clears on Refresh or query change, and selects only loaded
leaves in the expanded view through the header checkbox.
Full-result server CSV export is also required: all matching leaf records from
the viewed result version, regardless of collapsed or unloaded branches.
Flat-only delivery does not satisfy this requirement.

The first design must distinguish query identity from result consistency,
branch positions from leaf counts, and loaded records from unloaded slots.
Preserve local-mode behavior and the existing server-supplied summary contract.
Live subscriptions and revisioned writes are separate later slices; the initial
remote design must leave compatible extension points without promising them.

See the [research evidence](docs/research/2026-11-19-remote-datasets-research.md),
the [design approved for planning](docs/superpowers/specs/2026-11-19-remote-datasets-design.md),
and the [implementation plan](docs/superpowers/plans/2026-11-19-remote-datasets.md).
Existing application-managed windows remain supported; shared layout changes must
preserve their coordinate, eviction, accessibility and interaction contracts.
Implementation planning is complete; runtime implementation has not started.

## Next — saved views and local history

1. Ship saved-view persistence: a versioned portable view document, migrations,
   schema reconciliation, browser-local storage, remote store adapter, and
   shared/personal view layers.
2. Add a typed command foundation with atomic edit/paste batches, inverses, and
   bounded local undo/redo. Saved views precede command history.

These priorities replace the older financial field-schema and application UI
track. Applications continue to own domain schemas and policy.

## Later — remote scale, analytics, and collaboration

1. Extend the grouped remote read model with live updates, ordered replay,
   gap detection, and resynchronization; add revisioned mutations with command
   IDs, base revisions, conflicts, rollback, and retries.
2. Add analytical views: pivot, drill-through, grouped column headers, native
   Excel export, and more expressive filter-building UI.
3. Add manipulation features: range editing, fill, cut/clipboard extensions,
   context actions, and row creation/reordering.
4. Add provider-backed durable audit/version history, history UI,
   revert-as-new-command, redaction, retention hooks, and collaborative updates.
5. Add tree data and master/detail as distinct capabilities from grouping;
   consider cell spanning and built-in pagination/navigation controls.
6. Continue shared/personal configuration, capability-aware UI, packaged UI
   localization, and accessibility hardening.

## Capability gaps to track

This is a gap inventory against broader grids such as AG Grid Community and
Enterprise, not a commitment to match every feature or a claim of performance
parity. The current prioritization above governs delivery.

| Area                     | Shipped foundation                                                                                   | Remaining gap                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote datasets          | External sort/filter ownership, lifecycle UI, window metadata, eviction continuity, server summaries | Managed datasource, hierarchical branch cache, scheduling/cancellation, snapshot-aware refresh, server grouping; later live resynchronization |
| Saved views              | Controlled query and presentation state                                                              | Portable versioned documents, migration/reconciliation, stores, view-management UI                                                            |
| Editing and manipulation | Typed async editing, validated paste, multi-range selection                                          | Atomic command history, undo/redo, fill, general multi-cell editing, cut, HTML paste, row drag/reorder                                        |
| Analytics                | Local grouping/aggregation; filtered/all-input summaries                                             | Pivot and drill-through; remote group aggregates belong to the first remote release                                                           |
| Export                   | CSV serialization and delivery with partial-result reporting                                         | Native Excel workbooks; explicit remote full-result export integration; summary export policy                                                 |
| Filtering                | Typed query expressions and per-column filter controls                                               | Advanced cross-column expression-builder UI and remote capability-aware controls                                                              |
| Layout and hierarchy     | Column pin/resize/reorder, variable-height rows, local groups                                        | Grouped column headers, spanning cells, arbitrary tree data, master/detail                                                                    |
| Navigation and actions   | Keyboard navigation, header menus, tool panels                                                       | Built-in remote pagination/navigation UI and general context actions                                                                          |
| Ecosystem and assurance  | React integration, headless primitives, locale formatting/messages, browser and accessibility tests  | Packaged translations, broader assistive-technology evidence; other framework renderers require a separate product decision                   |

CSV export, multi-range selection, grouping, clipboard paste, and tool panels
are already shipped and must not be listed as wholly missing. Integrated charts
and formula engines remain outside the current product scope; adding them would
require a deliberate scope change. Commercial support and ecosystem maturity are
not features that a source-code checklist can establish.

## Not planned

- A hosted Pretable backend or authentication system.
- Finance-domain valuation, formula, scenario, or permission policy.
- A chart, page-layout, or financial-application platform.
- Persistence of complete runtime grid snapshots.

## Persistence and history sequence

Saved views → command foundation and local undo/redo → revisioned mutations →
durable audit/version history.

See the approved [persistence and history design](docs/superpowers/specs/2026-08-09-persistence-and-history-design.md)
and its [documentation implementation plan](docs/superpowers/plans/2026-08-09-persistence-and-history-documentation.md).

## How roadmap items ship

An item moves into implementation only after an approved focused design and
implementation plan. It is complete only when public API reports, consumer
documentation, correctness tests, and relevant benchmark evidence agree with the
released behavior. The roadmap tracks outcomes; changelogs track shipped work,
and dated plans remain historical execution recipes.
