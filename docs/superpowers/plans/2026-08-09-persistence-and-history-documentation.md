# Persistence and History Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Establish one concise financial-grade product roadmap, document repository planning authority, and place saved views, undo/redo, revisioned mutations, and durable audit history in an explicit delivery sequence.

**Architecture:** ROADMAP.md becomes the only current prioritization document; docs/README.md explains how that roadmap relates to specs, plans, shipped API truth, research, and benchmark evidence. Historical roadmap/memory files remain intact behind additive banners, while the root README links the canonical roadmap. This change is documentation-only and does not add or advertise persistence/history APIs.

**Tech Stack:** Markdown, Prettier, Git path-existence checks

---

## Scope and file responsibilities

**Read for authority:**

- docs/superpowers/specs/2026-08-09-persistence-and-history-design.md — approved architecture and acceptance criteria.
- README.md — product thesis, package status, evidence, and repository map.
- GOVERNANCE.md — maintainer-led, evidence-backed roadmap policy.
- Package CHANGELOG.md and generated API reports — shipped truth.

**Create:**

- ROADMAP.md — current product priorities and sequencing only.
- docs/README.md — documentation authority, lifecycle, and metadata conventions.

**Modify:**

- README.md — link the canonical roadmap and name it in the repository map.
- docs/superpowers/specs/2026-04-20-roadmap-fix-then-expand-design.md — additive historical banner only.
- docs/research/repo-memory.md — additive historical banner only.

**Do not modify:**

- Consumer MDX, packages, dependencies, API reports, changelogs, or benchmark artifacts.
- Original historical content below the two new banners.
- Product APIs or implementation.

### Task 1: Create the canonical financial-grade roadmap

**Files:**

- Create: ROADMAP.md
- Reference: docs/superpowers/specs/2026-08-09-persistence-and-history-design.md
- Reference: packages/core/CHANGELOG.md
- Reference: packages/react/CHANGELOG.md
- Reference: status/milestones/2026-05-12-comparator-aware-evaluators.hypotheses.json

- [ ] **Step 1: Confirm the roadmap does not already exist**

Run:

```bash
test ! -e ROADMAP.md
```

Expected: exit 0 with no output.

- [ ] **Step 2: Create ROADMAP.md**

Write a concise document with this exact structure and content:

```markdown
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

- Close remaining public API/documentation gaps and make stable row identity
  consistent across entry points.
- Finish grouping adoption with dedicated consumer documentation and committed
  benchmark evidence.
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
```

Do not add delivery dates, promises, owners, checkboxes, speculative public type names, or links to sibling repositories.

- [ ] **Step 3: Verify roadmap scope and sequencing**

Run:

```bash
rg -n "^## (Now|Next|Later|Not planned)|Saved views.*command foundation" ROADMAP.md
rg -n "revisioned mutations|durable audit/version history" ROADMAP.md
rg -n "hosted Pretable backend|complete runtime grid snapshots" ROADMAP.md
```

Expected: all four tiers, the four-step sequence, and the explicit non-goals appear.

- [ ] **Step 4: Format and validate the roadmap**

Run:

```bash
pnpm exec prettier --write ROADMAP.md
pnpm exec prettier --check ROADMAP.md
git diff --check -- ROADMAP.md
test -e docs/superpowers/specs/2026-08-09-persistence-and-history-design.md
```

Expected: Prettier passes, Git is silent, and the design target exists.

- [ ] **Step 5: Commit the roadmap**

Run:

```bash
git add ROADMAP.md
git commit -m "docs: add financial-grade roadmap"
```

Expected: one commit adding only ROADMAP.md.

### Task 2: Define documentation authority and preserve historical context

**Files:**

- Create: docs/README.md
- Modify: docs/superpowers/specs/2026-04-20-roadmap-fix-then-expand-design.md:1
- Modify: docs/research/repo-memory.md:1

- [ ] **Step 1: Create docs/README.md**

Write:

```markdown
# Pretable documentation

This directory preserves product decisions, execution recipes, research, and
handoffs. It is an archive with explicit authority rules, not the current
roadmap.

## Authority

1. Package changelogs and generated API reports describe shipped behavior.
2. [ROADMAP.md](../ROADMAP.md) describes current prioritization.
3. docs/superpowers/specs/ contains approved design and decision records.
4. docs/superpowers/plans/ contains execution recipes, not live status.
5. status/milestones/ contains committed performance evidence.
6. docs/research/ and handoffs are historical unless a current document links
   to them explicitly.

When documents disagree, use the highest applicable source above. Public
consumer documentation must describe released behavior and should not advertise
speculative roadmap APIs.

## Lifecycle

New design specs use docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md.
Implementation plans use docs/superpowers/plans/YYYY-MM-DD-<topic>.md.

Every new spec should include:

- Date
- Status: draft, approved, planned, in-progress, shipped, or superseded
- Supersedes / Superseded by when applicable
- implementation plan, PR/commit, and released version when those exist

Status meanings:

- draft: under discussion
- approved: design accepted; no implementation plan is implied
- planned: an implementation plan exists
- in-progress: implementation is active
- shipped: released behavior exists; changelogs/API reports remain authoritative
- superseded: retained for history and linked to its replacement

Unchecked boxes in an old plan do not prove work remains. Confirm shipped state
from changelogs, API reports, and implementation history.

## Repository map

- superpowers/specs/: dated designs and decision records
- superpowers/plans/: dated implementation recipes
- research/: diagnostics, closeouts, and historical memory
- handoffs/ and superpowers/handoffs/: point-in-time transfer notes
- ../status/milestones/: committed benchmark evidence

## Maintenance

- Keep ROADMAP.md short and outcome-oriented.
- Mark superseded documents; do not delete decision history.
- Link corrections to the evidence they replace.
- Update public documentation, API reports, and changelogs with shipped APIs.
- Review roadmap claims against committed evidence before publishing them.
```

- [ ] **Step 2: Add the April-roadmap historical banner**

Insert immediately after its title:

```markdown
> **Status: Historical.** This point-in-time roadmap is preserved for decision
> history; its projects are no longer the current backlog. See the canonical
> [ROADMAP.md](../../../ROADMAP.md) for current priorities.
```

Do not modify original content below the banner.

- [ ] **Step 3: Add the repo-memory historical banner**

Insert immediately after its title:

```markdown
> **Status: Historical through 2026-05-15.** This chronological record is
> preserved as project history and is not a current backlog. See the canonical
> [ROADMAP.md](../../ROADMAP.md) for current priorities.
```

Do not modify original content below the banner.

- [ ] **Step 4: Verify the banners are additive**

Run:

```bash
git diff --unified=3 -- docs/superpowers/specs/2026-04-20-roadmap-fix-then-expand-design.md docs/research/repo-memory.md
test -e ROADMAP.md
```

Expected: only one banner is added to each historical file and the roadmap exists.

- [ ] **Step 5: Format and validate**

Run:

```bash
pnpm exec prettier --write docs/README.md
pnpm exec prettier --check docs/README.md
git diff --check
```

Expected: checks pass. Do not run Prettier with --write on the historical files, because original archival content must remain byte-for-byte unchanged below each banner.

- [ ] **Step 6: Commit the index and notices**

Run:

```bash
git add docs/README.md docs/superpowers/specs/2026-04-20-roadmap-fix-then-expand-design.md docs/research/repo-memory.md
git commit -m "docs: define planning document authority"
```

Expected: one commit containing the index and two additive banners.

### Task 3: Link the roadmap and verify the complete documentation slice

**Files:**

- Modify: README.md:16-29
- Modify: README.md:124-139
- Verify: all approved documentation paths

- [ ] **Step 1: Link the roadmap from README status**

After the public/internal package-boundary paragraph, add:

```markdown
See the [roadmap](./ROADMAP.md) for current priorities and the financial-grade
product direction.
```

- [ ] **Step 2: Add the roadmap to the repository map**

Add this as the first line inside the Repository Layout code block:

```text
ROADMAP.md                 Current product priorities and sequencing
```

Do not fix unrelated README drift in this PR.

- [ ] **Step 3: Verify required files and links exist**

Run:

```bash
test -e ROADMAP.md
test -e docs/README.md
test -e docs/superpowers/specs/2026-08-09-persistence-and-history-design.md
test -e docs/superpowers/plans/2026-08-09-persistence-and-history-documentation.md
test -e docs/superpowers/specs/2026-04-20-roadmap-fix-then-expand-design.md
test -e docs/research/repo-memory.md
test -e packages/core/CHANGELOG.md
test -e packages/react/CHANGELOG.md
test -e packages/core/core.api.md
test -e packages/react/react.api.md
test -e status/milestones/2026-05-12-comparator-aware-evaluators.hypotheses.json
```

Expected: every command exits 0.

- [ ] **Step 4: Verify the documentation-only boundary**

Run:

```bash
git diff --name-only origin/main...HEAD
git status --short
```

Expected paths are limited to:

```text
README.md
ROADMAP.md
docs/README.md
docs/research/repo-memory.md
docs/superpowers/plans/2026-08-09-persistence-and-history-documentation.md
docs/superpowers/specs/2026-04-20-roadmap-fix-then-expand-design.md
docs/superpowers/specs/2026-08-09-persistence-and-history-design.md
```

- [ ] **Step 5: Run final validation**

Run:

```bash
pnpm exec prettier --check README.md ROADMAP.md docs/README.md docs/research/repo-memory.md docs/superpowers/plans/2026-08-09-persistence-and-history-documentation.md docs/superpowers/specs/2026-04-20-roadmap-fix-then-expand-design.md docs/superpowers/specs/2026-08-09-persistence-and-history-design.md
git diff --check origin/main...HEAD
git diff --check
pnpm test
```

Expected: formatting passes for all seven approved Markdown paths; both committed
and working-tree diffs have no whitespace errors; tests pass. If the known S7
five-second timeout recurs only under concurrent package execution, rerun pnpm
--filter @pretable-internal/scenario-data test to record whether the isolated
suite passes, but do not alter product code in this PR.

- [ ] **Step 6: Commit the README link**

Run:

```bash
git add README.md
git commit -m "docs: link the canonical roadmap"
```

Expected: one focused README commit.

- [ ] **Step 7: Inspect the branch**

Run:

```bash
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
git status --short --branch
```

Expected: documentation-only commits, the seven approved paths, and a clean working tree.
