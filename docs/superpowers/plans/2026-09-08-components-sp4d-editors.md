# SP4D editor completion plan

> Use superpowers:subagent-driven-development and independent spec/quality
> reviews. User explicitly authorizes continuous execution through green merge.

**Goal:** close A4–A6 and remaining kit/date/documentation follow-ups.
**Architecture:** canonical enum choice draft, shared composition/direction
policy, separate date cursor, native kit controls. Keep controller authority.
**Stack:** React18/19, TS, Vitest, Playwright, Chrome MCP. Pinned pnpm10.12.1
via PATH=/tmp/pretable-kit-bin:$PATH. Existing isolated worktree baseline04dc1b5e.
Spec: docs/superpowers/specs/2026-09-08-components-sp4d-editors-design.md.

## 1. React corrections (single owner)

- [x] Before implementation, capture production editor baseline screenshots and
  computed geometry in Chromium/WebKit, including error and number/date controls;
  compare matched after screenshots and forced-color calendar states.

- [x] In editors/{EnumCellEditor,enum-options,type-parsing,use-editor-field,
  NumberCellEditor,MultilineCellEditor,DateCellEditor}, controller and surface,
  add RED tests for canonical duplicate choices, ambiguous typed text, empty
  commits, reverse commands, composition state/native/fallback and date cursor.
- [x] Implement internal tagged enum selection and custom-parser unwrapping;
  share composition/direction helpers; complete date combobox state and separate
  browse/commit. Keep error/pending/authorization guards and typed text semantics.
- [x] Add components/textarea.tsx plus context/public_api exports/type tests.
  Migrate all five fields and date/number action buttons through resolved kit.
  Verify consumer replacements, refs, autofocus, native props and pending state.
- [x] Use existing observeAnchor for editor popup layout; test lifecycle.
  Fix remaining inaccurate source comments/warning test names as touched.
- [x] Focused tests, mutations of identity/composition/date-no-write guards,
  restore, scoped type/lint/format. Commit stable sources; no builds while editing.

## 2. UI states and docs/integration (root)

- [x] Inspect baseline editor/kit selectors. Add RED CSS state guards and repair
  geometry, invalid+focus, pending and date cursor normal/forced-color states.
- [x] Read website AGENTS and local Next guide; add real surface fixture/tests
  for duplicate enum identity/clear, composition, reverse navigation/date browse
  and replacements. Update docs, API bindings, changeset and compatibility usage.
- [x] Independent spec review then quality review; resolve and reverify.
- [x] Sequential stable dependency builds, public API reports/checks/typechecks;
  full affected suites, docs, lint/format and packed React18/19 compatibility.
- [x] Production Chromium/WebKit flows and direct Chrome MCP interactions,
  accessibility tree and visual inspection. Record physical IME/human AT boundary.

## 3. PR, merge, post-merge verification

- [ ] Audit closure with exact commands/evidence; commit clean worktree. Fetch
  main, handle actual conflicts if any; push branch and create reviewable PR.
- [ ] Inspect required CI and reviews; fix failures, never bypass required checks.
  Merge only after green checks for final head. User already authorizes merge.
- [ ] Verify merge SHA and resulting production deployment; Chrome MCP final
  interaction/snapshot/console checks. Report remaining external validation
  boundaries accurately rather than representing automation as a human pass.


## Verification record

Implementation: `45f9e073`; controlled-row browser correction: `71c4c13a`.
Independent spec and quality reviews approved, including the corrective focus
change and the test setup repair. Production baseline preceded the migration;
matched screenshots and geometry are in `docs/research/assets/sp4d/`.

With Node24.20.0 and pnpm10.12.1 (`PATH=/tmp/pretable-kit-bin:$PATH`):

- `pnpm test`: 469 Node script tests and 4,522 Vitest tests passed across the
  workspace, including 2,043 React, 122 UI, 212 benchmark and 625 website tests.
- `pnpm typecheck`: passed. The first run exposed an older pending-draft test
  calling `setEditStatus("checking")`; it now enters through `beginEdit` as the
  public contract requires. All 177 grid-core tests passed after correction.
- `pnpm react:compat`: packed React18.0.0,18.3.1,19.2.8 passed after Textarea
  integration. CI repeats the matrix against the final PR head.
- `pnpm api:check`, `pnpm lint:packaging`, public type-test configs and
  `node scripts/check-type-performance.mjs`: passed.
- `pnpm lint`, `pnpm format`, production website build: passed.
- `pnpm security:audit`: clean after targeted js-yaml3.15.2/4.3.2 patches.
  Registry integrity and frozen-lockfile installation were verified.
- Production Playwright: editor-kit, edit-lifecycle, components and
  overlay-scope, 34 tests passed across Chromium and WebKit. Direct Chrome MCP
  confirmed corrected controlled-row Shift+Tab, date browsing without a write,
  valid active-descendant/control targets, native text selection and clean console.

RED and mutation evidence includes canonical enum identity, composition guards,
date cursor writes, replacement ref attachment, all four controlled-row commit
directions, and narrow date-field text measurement. Review added removed and
formatted pristine choices, navigated enum blur, whitespace date clearing,
pristine empty enums, delayed acknowledgement and cancelled acknowledgement.
All temporary mutations were restored.

Physical OS IME and human screen-reader validation were not performed. Synthetic
composition events, DOM/AX inspection and forced-color emulation are bounded
automated evidence, not a claim of those human/platform passes. GitHub records
final PR checks, merge and deployment; the task's completion report links them.
