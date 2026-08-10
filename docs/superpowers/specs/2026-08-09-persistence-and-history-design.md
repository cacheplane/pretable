# Persistence and history — design

**Date:** 2026-08-09

**Status:** planned

**Implementation plan:**
[`2026-08-09-persistence-and-history-documentation.md`](../plans/2026-08-09-persistence-and-history-documentation.md)

## Context

Pretable is becoming a batteries-included, financial-grade grid. Two reference
workloads guide that direction:

- live portfolio-management grids with dense data, high-frequency updates,
  grouping, aggregation, pivoting, drill-through, and saved analytical views;
- collaborative financial-planning grids with remote data, large edits and
  pastes, validation, conflicts, undo/redo, comparisons, and durable history.

Pretable already has useful in-memory continuity primitives. The React surface
can control sort, filters, selection, focus, grouping, column widths, column
order, and pinning. `setRows` reconciles focus, selection, and editing by stable
row id. Editing and paste emit application-owned callbacks, and transactions
batch local add/update/remove operations.

Those primitives are not a persistence or history contract:

- `PretableSurfaceState` is experimental and incomplete as a saved-view format.
- `PretableGridSnapshot` mixes durable intent with derived and transient state.
- no public codec, migration, view store, undo/redo controller, revision model,
  audit provider, or resynchronization protocol exists;
- edits and paste explicitly defer undo, while applications currently own all
  durable mutation behavior.

The repository also lacks a current roadmap. Dated specs and plans preserve
valuable history, but the only explicit roadmap is an April snapshot whose
projects are already complete. `docs/research/repo-memory.md` stops in May even
though implementation and design work continued through August.

This design establishes both the product architecture and the documentation
structure needed to plan persistence and history without promising unshipped
public APIs.

## Goals

1. Establish one canonical, concise roadmap for a financial-grade Pretable.
2. Define documentation authority and lifecycle so shipped truth, plans,
   decisions, and evidence cannot be confused.
3. Separate saved-view persistence, command undo/redo, and durable audit history
   while giving them a compatible revision and command vocabulary.
4. Keep Pretable batteries-included: ship working state machines, stores,
   components, and defaults rather than interfaces alone.
5. Preserve application ownership of finance-domain logic, authentication,
   canonical remote storage, and retention policy.
6. Make every future implementation slice independently shippable and
   benchmarkable.

## Non-goals

- Implementing persistence or history in this documentation slice.
- Freezing exact public TypeScript names before focused child designs.
- Persisting complete runtime snapshots.
- Building a hosted Pretable backend, authentication system, or finance model.
- Defining formulas, scenario semantics, valuation logic, or application ACLs.
- Publishing speculative APIs in the consumer documentation site.
- Retrofitting metadata onto every historical spec and plan in one change.

## Documentation architecture

### Canonical roadmap

Create `ROADMAP.md` at the repository root and link it from the README status
section. It is the only current prioritization document.

The roadmap stays concise and contains:

- product thesis and governing performance principles;
- current baseline and last-reviewed date;
- `Now`, `Next`, `Later`, and `Not planned` outcomes;
- links to approved designs, implementation plans, releases, and benchmark
  evidence;
- explicit placement of saved views, command history, and durable history in
  the broader financial-grade roadmap.

The roadmap tracks outcomes, not task checkboxes. Shipped work links to package
changelogs and API reports rather than relying on unchecked boxes in historical
plans.

The initial tiers are fixed for this documentation slice:

- **Now — harden and measure:** repair current API/documentation contract drift,
  finish grouping adoption and option plumbing, and add PMS and financial-
  planning benchmark profiles.
- **Next — describe and manipulate financial views:** add the financial field
  schema, nested headers, view-management surface, saved-view persistence
  (persistence slice 1), and the typed command foundation with bounded local
  undo/redo (history slice 2). Saved views precede the command foundation within
  this tier.
- **Later — remote scale, analytics, and collaboration:** add the remote/live row
  model, revisioned mutations (slice 3), parallel PMS analytics and planning-
  interaction tracks, durable audit history (slice 4), and their production
  convergence. Slice 3 precedes slice 4.
- **Not planned:** a hosted Pretable backend, authentication system, finance-
  domain model, chart/page platform, or persistence of complete runtime
  snapshots.

### Documentation index

Create `docs/README.md` to define authority and lifecycle:

1. package changelogs and generated API reports are shipped truth;
2. `ROADMAP.md` is current prioritization;
3. dated design specs capture approved decisions;
4. dated implementation plans are execution recipes, not status trackers;
5. `status/milestones` contains committed performance evidence;
6. research and handoffs are historical context unless a current document links
   to them explicitly.

New specs should carry date, status, supersession links when applicable, and
implementation references once shipped. Supported statuses are `draft`,
`approved`, `planned`, `in-progress`, `shipped`, and `superseded`.

### Historical documents

Preserve
`docs/superpowers/specs/2026-04-20-roadmap-fix-then-expand-design.md` and
`docs/research/repo-memory.md`, but add an additive banner at the top of each
file marking it historical and pointing to `ROADMAP.md`. Do not rewrite their
original content or use them as live backlogs.

### Consumer documentation

Public MDX pages describe released behavior only. Each implementation slice
updates its consumer guides when the corresponding API ships. Until then, the
current editing, paste, controlled-state, and streaming limitations remain
explicit.

## Product model

Persistence and history are three related systems with distinct guarantees.

| System                | Purpose                                               | Default lifetime          |
| --------------------- | ----------------------------------------------------- | ------------------------- |
| View persistence      | Restore query and presentation intent                 | Across sessions           |
| Command history       | Reverse recent local grid operations                  | Bounded current session   |
| Audit/version history | Explain accepted revisions across actors and sessions | Durable, provider-defined |

They share command IDs, revisions, typed operations, and structured results, but
they do not share retention, reversibility, or authorization guarantees.

## Saved-view persistence

### Separate durable and runtime types

`PretableGridSnapshot` remains a runtime observation model. A separate,
JSON-safe view document becomes the durable contract. The conceptual shape is:

```ts
interface PretableViewDocument {
  formatVersion: number;
  schemaId?: string;
  state: PretablePersistedViewState;
  extensions?: Record<string, JsonValue>;
}
```

Exact names require a child design, but the separation is fixed.

### Durable state

The persisted view can contain:

- column order, width, visibility, and pinning;
- sort and typed filter expressions;
- row grouping, pivot, and aggregation choices;
- optional expansion state;
- density and display preferences;
- namespaced extension data.

It excludes:

- row data and remote-data caches;
- derived visible rows and aggregate results;
- focus, selection, and scroll position by default;
- edit drafts, pending requests, validation errors, and loading state;
- open menus, hover state, telemetry, and renderer measurements.

### State layers

Persistence applies deterministic layers:

```text
column defaults
→ shared saved view
→ personal overlay
→ runtime controlled state
```

A shared view captures report intent. A personal overlay can retain widths,
expansion, density, or other preferences without mutating the shared view.
Runtime controlled state always wins for the current render.

### Built-in behavior and adapters

Pretable should eventually ship:

- view encode, decode, validation, and migration;
- schema reconciliation for removed, renamed, and new fields;
- memory and browser-local stores;
- a remote `ViewStore` contract;
- a batteries-included persistence option on the top-level React grid;
- save, save-as, rename, reset, delete, and default-view UI;
- configurable debounced autosave;
- explicit shared and personal scopes.

Store records wrap the portable document with key, revision, owner, timestamps,
and scope. Storage metadata does not belong in the portable document.

### Compatibility and failure rules

- Corrupt or unsupported views never prevent the grid from rendering.
- Missing columns are ignored and new columns receive defaults.
- Renames require explicit schema migration rather than label matching.
- Unknown extension namespaces survive a decode/save round trip.
- Remote saves use an expected revision and never overwrite concurrent changes
  silently.
- Conflicts keep the local dirty view and offer reload, authorized overwrite,
  or save-as-new.
- Storage failures leave a usable in-memory grid and emit typed diagnostics.

## Commands and local history

Every user mutation becomes a typed command before it changes row data. The
conceptual envelope is:

```ts
interface GridCommand {
  commandId: string;
  baseRevision?: string;
  operations: readonly GridOperation[];
  atomic: boolean;
  metadata?: Record<string, JsonValue>;
}
```

The command controller records an inverse against the state on which the
command was based.

### Command grouping

- Repeated typing in one cell may coalesce into one command.
- Paste, fill, and multi-cell edits are one atomic command by default.
- Row insertion, deletion, and reordering have built-in inverses.
- Custom operations are undoable only when the application supplies an inverse.
- View changes use a separate history channel so ordinary data undo does not
  unexpectedly restore a filter or column width.
- Remote changes from other actors update revision and audit state but do not
  enter the local undo stack.

The in-memory history is bounded by count and/or memory. Eviction removes the
oldest reversible entries and never affects durable audit records.

### Undo and redo

In local mode, undo applies the recorded inverse and moves the original command
to the redo stack. In provider-backed mode, undo submits the inverse as a new
command against the current revision. Redo is also a new command. Neither action
deletes or rewrites durable history.

Redo clears when a new local command or an incompatible remote revision changes
the branch.

## Mutation lifecycle

```text
gesture
→ command + inverse
├─ local mode → local apply → bounded command history
└─ provider mode → optional optimistic apply → mutation provider
   → accepted or rejected result
   ├─ accepted → bounded command history
   └─ accepted + audit provider configured → durable audit event
```

The mutation and audit providers are independent, optional branches. Local mode
does not require a revision, mutation provider, or durable audit event. A host
may also feed provider-authored history events into the audit surface without
using Pretable's mutation provider.

Providers return a typed result:

- accepted with the new revision;
- validation error with operation or cell context;
- forbidden;
- revision conflict with current revision and retry guidance;
- transient failure.

Pessimistic mode applies and records only after acceptance. Optimistic mode
applies immediately and retains the inverse, but does not expose the command as
undoable until acceptance.

Validation and authorization rejection roll back optimistic changes. Revision
conflicts roll back or resynchronize before retry. Transient failures follow an
explicit retry policy and never disappear silently.

Commands are atomic by default. Partial application requires an explicitly
non-atomic command and per-operation results.

## Durable audit history

A provider-backed history event conceptually contains:

```ts
interface GridHistoryEvent {
  revision: string;
  commandId: string;
  actor?: GridActor;
  committedAt: string;
  operations: readonly GridOperationSummary[];
  undoOf?: string;
  redoOf?: string;
  source: string;
  metadata?: Record<string, JsonValue>;
}
```

Pretable should provide paginated history state and a built-in history panel.
The provider controls retention, permissions, redaction, actor identity, and
whether detailed values or summaries are available.

Reverting a durable event always creates a new command. Derived calculation
events may appear in the timeline, but are reversible only when their provider
supplies a valid inverse.

## Ownership boundary

Pretable owns:

- versioned codecs, migrations, and schema reconciliation;
- local stores and remote-store contracts;
- command construction, grouping, inverse generation, and bounded undo/redo;
- pending, validation, rejection, conflict, and resync state machines;
- view-management, undo/redo, and history UI;
- provider contracts, diagnostics, and reusable contract tests.

Applications own:

- remote storage, canonical revisions, and durable audit retention;
- authentication, authorization, redaction, and actor identity;
- finance-domain validation and operations;
- inverses for custom operations;
- formulas, scenarios, valuation, and other business semantics.

## Delivery sequence

### Slice 1: saved views

- stable view document;
- codec, validation, migration, and schema reconciliation;
- memory and browser-local stores;
- remote store contract;
- view-management UI.

### Slice 2: command foundation

- typed commands and operation batches;
- atomic edit and paste semantics;
- inverse generation;
- bounded local undo/redo.

### Slice 3: revisioned mutations

- mutation provider;
- command IDs and base revisions;
- optimistic and pessimistic execution;
- conflict, rollback, retry, and resynchronization.

### Slice 4: durable history

- audit/history provider;
- paginated and filtered history UI;
- actor metadata, redaction, and retention hooks;
- revert-as-new-command;
- collaborative revision updates.

Saved views intentionally precede the collaborative mutation protocol. The two
systems share versioning concepts, but view restoration does not need to wait for
multi-user data history.

Each slice receives its own focused design and implementation plan when promoted
to `Now`.

## Verification strategy

Future child designs must include:

- golden fixtures for every saved-view format version;
- round-trip, validation, and migration property tests;
- compatibility tests for removed, renamed, and new columns;
- command/inverse invariants showing that an operation followed by its inverse
  restores prior state;
- atomic batch, rollback, retry, conflict, and resync tests;
- reusable contract suites for view, mutation, and history providers;
- end-to-end reload, save-conflict, paste-undo, remote-revision, and history-
  redaction flows;
- memory bounds for caches and history;
- performance evidence showing history capture does not add full-grid work;
- financial workload benchmarks for large undo batches and view restoration;
- API-report and changeset updates for every shipped public capability.

The current benchmark discipline remains governing: no feature is complete
without explicit complexity and memory budgets, a deterministic workload, and
correctness checks for focus, selection, editing, clipboard, accessibility, and
streaming continuity.

## Documentation-slice acceptance criteria

- The documentation-only change set is limited to `ROADMAP.md`,
  `docs/README.md`, `README.md`, this spec,
  `docs/superpowers/plans/2026-08-09-persistence-and-history-documentation.md`,
  `docs/superpowers/specs/2026-04-20-roadmap-fix-then-expand-design.md`, and
  `docs/research/repo-memory.md`.
- `ROADMAP.md` is the linked canonical prioritization document.
- `docs/README.md` explains documentation authority and lifecycle.
- This design captures the approved persistence/history architecture.
- The April roadmap and `repo-memory.md` are visibly historical and point to the
  current roadmap.
- The roadmap places saved views, command history, revisioned mutations, and
  durable audit history in the broader financial-grade delivery sequence.
- No consumer documentation presents speculative APIs as shipped.
- `git diff --check` and Prettier pass for all changed Markdown files.
- Every new repository-relative link resolves to an existing file, verified by
  explicit path-existence checks recorded in the implementation plan.

## Risks

1. **Snapshot leakage.** Consumers may persist runtime snapshots before the
   durable format ships. Documentation must explicitly discourage this.
2. **Undo/audit conflation.** A local inverse stack cannot provide compliance or
   multi-user history. The public vocabulary must preserve the distinction.
3. **Unbounded memory.** Inverses for large pastes or deletions can be expensive.
   Child designs must set count and byte budgets.
4. **False portability.** Custom functions, aggregators, and renderers are not
   serializable. Saved views persist stable registry keys, never closures.
5. **Revision ambiguity.** View-store revisions and data revisions may use the
   same shape but remain separate domains.
6. **Premature API freeze.** This architecture fixes responsibilities and
   semantics, not every final public type name.
