# Pretable roadmap

Last reviewed: 2026-08-10

Pretable is a batteries-included React data grid built to be the fastest and
best grid for demanding, financial-grade applications. The roadmap uses two
reference workloads: live portfolio-management systems and collaborative
financial planning.

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

The aligned public-package baseline is `0.0.14`. The released grid already
includes local sorting and typed filtering, selection, keyboard navigation,
copy and validated bulk paste, typed asynchronous editing, column virtualization
and layout, configurable row grouping and aggregation with an overflow-safe
group panel, number-column alignment with tabular number/date figures,
variable-height rows, and batched streaming transactions. Package changelogs
and generated API reports are the source of truth for shipped behavior.

See the current [core changelog](packages/core/CHANGELOG.md),
[React changelog](packages/react/CHANGELOG.md),
[core API report](packages/core/core.api.md),
[React API report](packages/react/react.api.md), and
[committed comparative benchmark evidence](status/milestones/2026-05-12-comparator-aware-evaluators.hypotheses.json).

## Now — harden and measure

- Add deterministic PMS and financial-planning benchmark profiles without
  weakening existing 60 Hz, zero-gap, and interaction-continuity gates.

## Next — describe and manipulate financial views

1. Add a financial field schema, nested column bands, field chooser, formatting
   descriptors, and view-management surface.
2. Ship saved-view persistence: a versioned portable view document, migrations,
   schema reconciliation, browser-local storage, remote store adapter, and
   shared/personal view layers.
3. Add a typed command foundation with atomic edit/paste batches, inverses, and
   bounded local undo/redo. Saved views precede command history.

## Later — remote scale, analytics, and collaboration

1. Add a remote/live row model with bounded caching, typed query plans,
   cancellation, partial/stale/error state, and ordered resynchronization.
2. Add revisioned mutations with command IDs, base revisions, optimistic and
   pessimistic execution, conflicts, rollback, retries, and resync.
3. Develop parallel application tracks:
   - PMS analytics: incremental grouping/aggregation, totals, pivot,
     drill-through, context actions, and export.
   - Financial planning: range editing, fill, row creation/reordering, formula
     and provenance surfaces, and time/scenario comparison columns.
4. Add provider-backed durable audit/version history, history UI,
   revert-as-new-command, redaction, retention hooks, and collaborative updates.
5. Converge both tracks with shared/personal configuration, capability-aware UI,
   tree data, localization, and accessibility hardening.

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
