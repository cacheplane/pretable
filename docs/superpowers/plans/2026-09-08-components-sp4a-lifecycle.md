# Edit lifecycle safety implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Close audit A1–A3: no save before permission, no duplicate dispatch, recoverable callback errors, and no draft write unlocking a pending edit.

**Architecture:** The indexed core rejects pending draft changes. The existing controller owns permission, operation admission, and session identity; the surface bridges its existing session token. Fields provide pending UX but are not an authorization boundary.

**Tech Stack:** TypeScript, React 18/19, Vitest/jsdom, indexed grid core, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-08-components-sp4a-lifecycle-design.md`.

## Environment and sequence

Use the current isolated `codex/component-kit-audit` worktree. The audit's
targeted baseline is green. Use pnpm 10.12.1, available here as
`node /Users/blove/.npm/_npx/86ec7d1239b732c4/node_modules/pnpm/bin/pnpm.cjs`;
the machine's default pnpm 11 has an incompatible install-policy wrapper.
For child scripts that invoke `pnpm`, prepend that pinned package's `bin`
directory to PATH through a temporary executable shim outside the repository.
Do not change dependency manifests or lockfiles to configure the machine.

Execute tasks sequentially with spec and quality review after each code task.
No concurrent builds. Every changed guard gets a targeted mutation check;
restore it immediately and record the test and observed failure in the commit.

## Task 1: pending draft writes stay pending

**Files:** `packages/grid-core/src/create-grid-ui-core.ts` and
`packages/grid-core/src/__tests__/grid-ui-core.test.ts` (or a focused sibling
using the same real-core fixture).

- [x] Add table-driven real-core tests for changed and unchanged draft writes
  in checking/validating/saving. Assert the whole editing state stays equal.
  Assert editing/error states still accept drafts and clear displayed errors.
- [x] Run `pnpm --filter @pretable-internal/grid-core test`; observe the new
  pending cases fail before changing source.
- [x] Before publishing in `setEditDraft`, return when the edit status is
  checking, validating, or saving. Preserve the null/Object.is fast paths and
  current editable/error behavior. Do not alter explicit `setEditStatus`.
- [x] Re-run tests. Remove the phase predicate temporarily and prove the
  pending regression fails. Restore, review, and commit with mutation name.

## Task 2: controller authority and failure recovery

**Files:** `packages/react/src/use-cell-edit-controller.ts`,
`packages/react/src/pretable-surface.tsx` (controller adapter only),
`packages/react/src/__tests__/use-cell-edit-controller.test.ts`; add a focused
controller/core regression sibling if needed. Use `dev-warn.ts`'s existing
`warnOnce` for pre-session failures with a stable `edit-begin-failed` key.

- [x] Extend the stateful factory test fixture with a per-begin session token
  and checking transition. Add deferred-promise regressions for commit before
  denied permission, duplicate validation/save, same-tick parser/permission
  reentrancy, failed callback retries, and `keep-open` blocking.
- [x] Cover throwing/rejecting editable, parser, validator, save, formatter,
  row/value lookup. Test stale rejection/resolve after cancel, invalidation,
  replacement (including same address), and failed replacement begin. Reset
  diagnostic keys and assert a pre-session error is reported once.
- [x] Run `pnpm --filter @pretable/react test use-cell-edit-controller` and
  record intended failures. Add a real indexed-core parser that calls
  setEditDraft and verify the admitted draft cannot be changed.
- [x] Add internal adapter access to the surface session token and a checking
  transition; capture identity after begin and compare generation, token and
  address before and after consumer callbacks. Use an internal session record
  with authorization and phase. Retire previous snapshot before begin lookup.
- [x] Commit admission synchronously acquires a barrier and marks validating
  before lookup/parsing. Checking rejects commits. Permission-error retry
  marks checking before rechecking; denial cancels; rejection retains an
  unauthorized error session. Authorized retries retain permission. Preserve
  existing optional exact-begin authorization checks for boolean operations.
- [x] Catch all consumer callback boundaries. For active sessions retain draft
  and show error; before a new session exists leave no orphan and diagnose.
  Check staleness after synchronous callbacks too. `keep-open` holds the
  saving barrier until surface reconciliation ends/replaces the session.
- [x] Run controller and surface editing/boolean suites; update test adapters
  only as required by the new internal contract. Mutation-check admission,
  authorization and identity guards using distinct behavioral tests. Review
  then commit with mutation evidence. No enum semantic redesign in this task.

## Task 3: pending fields and surface integration

**Files:** `packages/react/src/editors/use-editor-field.ts`,
`EnumCellEditor.tsx`, `MultilineCellEditor.tsx`, and other editor handlers only
where necessary; existing editor tests and
`packages/react/src/__tests__/pretable-surface-editing.test.tsx`.

- [x] Add failing pending-key tests for shared Enter/Tab, multiline
  Ctrl/Cmd+Enter and enum selection. Escape still cancels. Add a deferred
  permission surface enum with differing value/label: pending draft/status
  unchanged, true resolution normalizes once, false closes with no save.
- [x] Add surface integration regressions with real controller/core for
  unauthorized built-in/custom editor commits, repeated save while pending,
  permission rejection/retry, controlled-row `keep-open`, boolean immediate
  authorization, and model/unmount invalidation. Reuse existing fixtures and
  extend only missing cases rather than duplicate passing coverage.
- [x] Run `pnpm --filter @pretable/react test cell-editor pretable-surface-editing`
  and observe intended new failures.
- [x] Consume pending commit/navigation keys without commit; preserve Escape.
  Guard specialized paths. Normalize enum display once after initial
  permission success, not merely once at mount and not after later retries.
  Keep native input props/refs, IME/directions/enum identity/calendar behavior
  unchanged for their later audited repairs.
- [x] Re-run all affected tests. Mutation-check pending-key and enum
  normalization guards. Review and commit with evidence.

## Task 4: delivery evidence and documentation

**Files:** `apps/website/content/docs/grid/editing.mdx`,
`.changeset/<descriptive-name>.md`, audit/spec/plan documents. Browser fixture
or test additions only when required to exercise the changed lifecycle.

- [x] Document pending draft restriction, serialization, permission retry,
  and errors, without claiming cancellation rolls back dispatched writes.
  Add patch changesets for `@pretable/react` and `@pretable/core` (core ships
  the internal indexed engine); document intentional behavior restrictions.
- [x] Build dependencies, run full affected package tests and React/core type
  checks, lint changed TS/TSX and format changed documents. Check API reports
  only if public exports changed; internal adapter additions do not require
  fabricated API changes.
- [x] Run existing browser editing coverage from the bench and/or website
  after building their consumed dist; locate controlled-row/boolean cases by
  repository search and record exact commands/results. Read the website's
  AGENTS.md and local Next docs before any fixture implementation. No CSS
  changes in this patch, so the visual baseline task remains with SP4B.
- [x] Independently review the whole branch against the spec, resolve findings,
  and update audit A1–A3 with concrete evidence. Do not mark later audit
  findings fixed. Commit docs/evidence and leave a clean reviewable branch.

## Completion

Each task records its actual tests, red/green result and mutation outcomes
below as executed. Finish this approved lifecycle repair in the current
session without another execution-choice prompt. The user's instruction to
continue already authorizes execution; publishing or merging is not part of
this plan.

## Execution log

- Planning: user approved the written lifecycle spec; plan review approved.
- Task 1: `8f4268ac`; 177 grid-core tests passed. RED and
  `remove-pending-draft-phase-guard` mutation each failed the three changed
  pending-draft cases. Spec and code-quality reviews approved. Dependencies
  rebuilt successfully after the core change.

- Task 2: `c8e94e4e`, `b70e6637`; 105 controller/editing/boolean
  tests passed with typecheck and changed-file lint/format. Nine initial
  regressions failed before implementation; nine async-parser regressions
  failed before await. Admission, denial, generation/session, adapter identity,
  pending core draft barrier and parser-await mutants were killed. Both
  reviews approved. Production website build passed after Task 2.

- Task 3: `bc6c3065`; 119 focused editor/surface/controller tests passed,
  including 16 new regressions. Initial RED had seven failures. Shared pending
  key, enum permission-normalization, and user-correction guards were each
  removed temporarily and killed by three, three, and two tests respectively;
  all restored. Spec and independent quality reviews approved. Type checking
  caught test-fixture labels/schema inference; corrected without runtime edits.
- Task 4: final independent whole-branch review approved A1–A3. Root validation
  used Node 24.20.0 and pinned pnpm 10.12.1:
  - `pnpm --filter @pretable/react test`: 138 files, 1,939 tests passed.
    After test-fixture type corrections, `test pending-cell-editor
    pretable-surface-edit-lifecycle` reran both changed suites: 16 passed.
  - `pnpm --filter @pretable-internal/grid-core test`: 6 files, 177 passed.
  - `pnpm --filter @pretable/core test`: 4 files, 17 passed.
  - React and core `typecheck`: passed. Changed source/tests and browser test
    ESLint passed. Changed documents/tests formatted; `git diff --check` clean.
  - Website `exec vitest run --environment jsdom` for `docs-api-surface` and
    `docs-links`: 2 files, 26 tests passed.
  - `pnpm --filter @pretable/app-website build`: passed, including dependency
    builds, registry generation, and production Next build.
  - Against that production build at `http://127.0.0.1:3210`, website
    `exec playwright test e2e/edit-lifecycle.spec.ts e2e/grid-keyboard-a11y.spec.ts
    --grep 'rejected save|boolean keyboard|F2 opens' --workers=1`: 6 passed
    across Chromium and WebKit. Covers rejected-save correction, controlled
    rows, boolean save reconciliation, and existing F2 editor entry.
  - No public exports changed, so no API report changes were necessary.
    Existing Vite configuration, jsdom canvas/navigation, and terminal color
    warnings were non-fatal. Browser checks are functional, not a visual/AT audit.

The lifecycle repair is complete locally. Findings A4–A14 remain open and need
separate scoped repairs; no package publication, push, or merge was performed.
