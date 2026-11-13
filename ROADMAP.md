# Pretable roadmap

Last reviewed: 2026-11-13

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

The aligned public-package baseline is `0.20.2`. The shipped grid includes local
sorting and typed filtering, selection, keyboard navigation, copy and validated
bulk paste, typed asynchronous editing, column virtualization and layout,
configurable row grouping and aggregation, variable-height rows, and batched
streaming transactions. It also includes native number and canonical calendar-date
formatting, a configurable tool panel, replaceable UI components, and external
processing/window metadata for application-owned server data.

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

## Now — design grand totals and summary rows

- Define grand totals and summary rows as a general analytical-grid primitive,
  following the sequence in the approved
  [calendar-date design](docs/superpowers/specs/2026-08-11-calendar-date-semantics-and-formatting-design.md#roadmap-consequences).
- Resolve aggregation scope (all rows, filtered rows, or an externally supplied
  result), rendering and accessibility, streaming invalidation, and performance
  budgets in a focused design before implementation. These are design questions,
  not promised public APIs.
- Preserve existing correctness, 60 Hz, zero-gap, and interaction-continuity
  gates while extending representative workloads.

## Next — saved views and local history

1. Ship saved-view persistence: a versioned portable view document, migrations,
   schema reconciliation, browser-local storage, remote store adapter, and
   shared/personal view layers.
2. Add a typed command foundation with atomic edit/paste batches, inverses, and
   bounded local undo/redo. Saved views precede command history.

These priorities replace the older financial field-schema and application UI
track. Applications continue to own domain schemas and policy.

## Later — remote scale, analytics, and collaboration

1. Extend the existing external-processing and window primitives into a
   remote/live row model with bounded caching, typed query plans, cancellation,
   partial/stale/error state, and ordered resynchronization.
2. Add revisioned mutations with command IDs, base revisions, optimistic and
   pessimistic execution, conflicts, rollback, retries, and resync.
3. Develop domain-neutral analytical and manipulation features: pivot,
   drill-through, context actions, export, range editing, fill, and row
   creation/reordering. Applications own formulas and scenario semantics.
4. Add provider-backed durable audit/version history, history UI,
   revert-as-new-command, redaction, retention hooks, and collaborative updates.
5. Continue shared/personal configuration, capability-aware UI, tree data,
   localization, and accessibility hardening.

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
