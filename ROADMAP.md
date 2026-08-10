# Pretable roadmap

Last reviewed: 2026-08-09

Pretable is a batteries-included React data grid built to be the fastest and best grid for demanding, financial-grade applications. Reference workloads include live portfolio-management systems and collaborative financial planning.

## Governing principles

- Performance and correctness are product features; every major capability has an explicit complexity and memory budget, deterministic workload, and committed evidence.
- Pretable ships working grid behavior and UI, not interfaces alone.
- One canonical derived model governs rendering, focus, selection, editing, clipboard, accessibility, and virtualization.
- Finance-capable but domain-agnostic; apps own valuation, formulas, permissions, storage endpoints, and retention.
- Public state and protocols are versioned and migration-aware.

## Current baseline

The released grid includes local sorting and typed filtering, selection, keyboard navigation, copy and validated bulk paste, typed async editing, column virtualization and layout, row grouping and aggregation, variable-height rows, and batched streaming transactions. Changelogs and API reports are shipped truth.

- [Core changelog](packages/core/CHANGELOG.md)
- [React changelog](packages/react/CHANGELOG.md)
- [Core API report](packages/core/core.api.md)
- [React API report](packages/react/react.api.md)
- [Comparator-aware evaluators milestone](status/milestones/2026-05-12-comparator-aware-evaluators.hypotheses.json)

## Now — harden and measure

- Repair API and docs contract drift and consistent stable row identity.
- Finish grouping adoption: React option plumbing, public API cleanup, consumer docs, benchmarks, and panel overflow.
- Add deterministic PMS and planning benchmark profiles without weakening 60 Hz, zero-gap, or interaction-continuity gates.

## Next — describe and manipulate financial views

1. Financial field schema, nested column bands, chooser, format descriptors, and view management.
2. Saved-view persistence: versioned portable document, migration, reconciliation, browser-local store, remote adapter, and shared/personal layers.
3. Typed commands, atomic edit/paste, inverses, and bounded local undo/redo. Saved views precede command history.

## Later — remote scale, analytics, and collaboration

1. Remote/live row model with bounded cache, typed query plan, cancellation, partial/stale/error, and ordered resync.
2. Revisioned mutations with IDs/base revisions, optimistic/pessimistic, conflicts, rollback/retry/resync.
3. Parallel tracks: PMS analytics (incremental grouping/aggregation, totals, pivot, drill-through, context actions, export); financial planning (range edit, fill, row create/reorder, formula/provenance, time/scenario comparison columns).
4. Durable audit/version history, history UI, revert-as-new-command, redaction, retention, and collaboration.
5. Convergence: shared/personal config, capability-aware UI, tree data, localization, and accessibility.

## Not planned

- Hosted Pretable backend/auth.
- Finance-domain valuation/formula/scenario/permission policy.
- Chart/page-layout/financial-app platform.
- Persist complete runtime grid snapshots.

## Persistence and history sequence

Saved views → command foundation/local undo-redo → revisioned mutations → durable audit/version history.

- [Persistence and history design](docs/superpowers/specs/2026-08-09-persistence-and-history-design.md)
- [Persistence and history documentation plan](docs/superpowers/plans/2026-08-09-persistence-and-history-documentation.md)

## How roadmap items ship

Focused approved design + plan before implementation; complete only when API reports, consumer docs, correctness tests, and benchmark evidence agree. Roadmap outcomes; changelogs shipped work; plans historical recipes.
