# Post-release follow-ups design

Date: 2026-08-30

## Goal

Finish the open maintenance and correctness work after the `0.11.0` release
without combining unrelated risk into one merge. Every lane starts from the
then-current `main`, carries its own evidence, and merges only after required
checks pass.

## Reassessment against current main

The released package architecture is already on `main`. Since the original
handoff, PR #539 also merged, so follow-up branches must start at or after
`ac1cbb41` rather than the release commit.

Two open issues describe work that has already shipped:

- #491 was fixed by PR #508. The journal path now uses the same exact-ref then
  old-neighbour anchor ladder as the replacement path, and the renderer test
  pins the previously divergent scroll result.
- #452 was addressed by PR #479 for sort and PR #487 for filters. Their
  same-run measurements show sort interactions at or better than TanStack and
  filter interaction latency in the 15-18 ms band. Those issues need fresh
  verification and closure, not another speculative optimization.

#524 remains an unresolved ownership seam. A controller publish may compute an
anchored `scrollTop`, after which React's viewport-feed layout effect can run
because controller status changed and reapply the DOM/grid snapshot's older
pixel offset. The fix must define authority at a publish boundary rather than
paper over one replace scenario.

## Delivery lanes

### 1. Minor and patch dependency group (#538)

Refresh the Dependabot branch onto current `main`. Preserve historical
benchmark truth: do not edit recorded comparator versions. The existing S2
milestone is already superseded for pinning asymmetry, so add an explicit
`adapterVersions.superseded` record naming the four comparator version moves
and stating that its numbers describe the older releases. Run the full repo,
packaging, audit, and browser checks before merge.

### 2. Atomic Changesets v3 migration (#474 + #476)

Changesets' official migration contract requires CLI 3 and Action 2 to move
together: Action v1 is the CLI 2 maintenance line, and Action v2 validates CLI 3. Extend PR #474 into the atomic migration and close #476 as superseded only
after #474 merges. Prove the repository config parses, status/version commands
work on a disposable branch state, publish preflight still fails closed, and
the release workflow contract remains green. Migrate the renamed Action
inputs/outputs and explicit `github-token` input in the same commit series.

### 3. Other major updates (#472, #475, #476)

Each major gets dedicated compatibility evidence:

- fuzzysort 4: verify the documented API change against every website call
  site and preserve search ranking/result behavior with focused tests.
- jest-dom 7: verify the Vitest setup, matcher types, Node floor, and all DOM
  suites.
- PR #476 is resolved by the atomic Changesets migration above, not by a second
  release-workflow merge.

### 4. Scroll authority (#524)

The engine owns scroll position while committing an anchored row-layout
publish. The DOM owns new scroll intent only when an actual viewport event or
imperative viewport command changes the grid snapshot. A controller status
transition alone must not manufacture new DOM intent.

Implement this at the React/controller seam. First add a regression that makes
the controller publish an anchor-adjusted `scrollTop` while the grid snapshot
still holds the old value, then proves a status-only rerender cannot overwrite
the anchored value. Keep legitimate height, width, overscan, column, and user
scroll feeds intact. Verify with controller-level and React integration tests.

### 5. Closure audits (#491 and #452)

For #491, run the focused journal-anchor mutation test on current `main`, link
PR #508, and close the issue.

For #452, run the current Chromium S2 sort, filter-metadata, and filter-text
matrix for Pretable and TanStack in one environment. Record the fresh runset
or an issue comment with exact command, revisions, and results. Close only if
the current measurements still establish that the originally reported
interaction-latency gap is gone; otherwise reopen implementation scope from
the evidence.

## Verification and merge policy

Each lane is a separate PR or an update to the existing Dependabot PR. Before
merge: focused tests, full `pnpm test`, typecheck, lint, formatting, build,
packaging checks, packed consumers, React compatibility, and security audit as
applicable. Browser-sensitive changes additionally run Chromium and WebKit
smoke/bench coverage. Merge only when required GitHub checks are green, then
pull the new `main` before beginning the next lane.

No benchmark record is rewritten to claim an unperformed measurement. No
major upgrade is accepted solely because installation succeeds.
