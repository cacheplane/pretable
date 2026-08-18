# Pretable roadmap

Last reviewed: 2026-08-18

Pretable is a batteries-included React data grid built to be the fastest and
best grid for demanding applications. Financial applications are a proving
ground for performance, precision, dense interaction, and data integrity—not
the product boundary.

## Governing principles

- Performance and correctness are product features: every major capability gets
  an explicit complexity/memory budget, deterministic workload, and committed
  evidence.
- Pretable ships working grid behavior and UI, not interfaces alone.
- One canonical derived model governs rendering, focus, selection, editing,
  clipboard, accessibility, and virtualization.
- The grid remains domain-agnostic; applications own valuation, formulas,
  permissions, storage endpoints, and retention policy.
- Public state and protocols are versioned and migration-aware.

## Current baseline

The latest published aligned-package baseline recorded in the repository is
`0.10.0`. That release includes an incremental typed local row model; sorting,
filtering, grouping, aggregation, distinct values, and transactions;
virtualization and variable-height rows; selection, focus, keyboard navigation,
editing, validated paste, copy, and CSV; native number formatting with money and
accounting presets; cell presentations; stable row identity across entry points;
and server-controlled windowed data with eviction-safe selection, row-height
continuity, and explicit result metadata. Current main additionally contains
unreleased external sort/filter authority suppression. Package changelogs,
pending changesets, and generated API reports distinguish released from
current-main behavior.

See the current [core changelog](packages/core/CHANGELOG.md),
[React changelog](packages/react/CHANGELOG.md),
[core API report](packages/core/core.api.md),
[React API report](packages/react/react.api.md), and
[committed comparative scroll evidence](status/milestones/2026-08-16-s2-comparative-pinned.json)
and [interaction evidence](status/milestones/2026-08-16-s2-mount-and-interaction.json).

## Now — correct the typed data contract

- Ship canonical calendar-date semantics and native date formatting across the
  incremental row model, React presentation, editing, copy, and CSV. See the
  [planned design](docs/superpowers/specs/2026-08-18-canonical-calendar-dates-row-model-design.md).
- Preserve Pretable's stable scroll and structural efficiency while closing the
  measured local sort/filter interaction gap. Add evidence for product work,
  not finance-specific workload profiles.
- Keep public APIs, generated reports, migration guidance, and consumer docs
  aligned with the breaking typed contract.

## Next — complete reusable analytical workflows

1. Add grand totals and summary rows as domain-neutral companions to grouping
   and aggregation.
2. Ship saved-view persistence: a versioned portable view document, migrations,
   schema reconciliation, browser-local storage, remote store adapter, and
   shared/personal view layers.
3. Add a typed command foundation with atomic edit/paste batches, inverses, and
   bounded local undo/redo. Saved views precede command history.

## Later — remote scale and advanced interaction

1. Extend the shipped server-controlled window contract into an optional
   remote/live row model with fetching, bounded caching, cancellation, and
   ordered resynchronization.
2. Add revisioned mutations with command IDs, base revisions, optimistic and
   pessimistic execution, conflicts, rollback, retries, and resync.
3. Add pivoting, range editing, fill, row creation/reordering, and extensible
   context actions as general grid capabilities.
4. Add provider-backed durable audit/version history, history UI,
   revert-as-new-command, redaction, retention hooks, and collaborative updates.
5. Continue tree data, localization, accessibility, and capability-aware UI
   hardening without embedding application-domain policy.

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
