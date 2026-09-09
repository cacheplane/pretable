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

- [ ] In editors/{EnumCellEditor,enum-options,type-parsing,use-editor-field,
  NumberCellEditor,MultilineCellEditor,DateCellEditor}, controller and surface,
  add RED tests for canonical duplicate choices, ambiguous typed text, empty
  commits, reverse commands, composition state/native/fallback and date cursor.
- [ ] Implement internal tagged enum selection and custom-parser unwrapping;
  share composition/direction helpers; complete date combobox state and separate
  browse/commit. Keep error/pending/authorization guards and typed text semantics.
- [ ] Add components/textarea.tsx plus context/public_api exports/type tests.
  Migrate all five fields and date/number action buttons through resolved kit.
  Verify consumer replacements, refs, autofocus, native props and pending state.
- [ ] Use existing observeAnchor for editor popup layout; test lifecycle.
  Fix remaining inaccurate source comments/warning test names as touched.
- [ ] Focused tests, mutations of identity/composition/date-no-write guards,
  restore, scoped type/lint/format. Commit stable sources; no builds while editing.

## 2. UI states and docs/integration (root)

- [ ] Inspect baseline editor/kit selectors. Add RED CSS state guards and repair
  geometry, invalid+focus, pending and date cursor normal/forced-color states.
- [ ] Read website AGENTS and local Next guide; add real surface fixture/tests
  for duplicate enum identity/clear, composition, reverse navigation/date browse
  and replacements. Update docs, API bindings, changeset and compatibility usage.
- [ ] Independent spec review then quality review; resolve and reverify.
- [ ] Sequential stable dependency builds, public API reports/checks/typechecks;
  full affected suites, docs, lint/format and packed React18/19 compatibility.
- [ ] Production Chromium/WebKit flows and direct Chrome MCP interactions,
  accessibility tree and visual inspection. Record physical IME/human AT boundary.

## 3. PR, merge, post-merge verification

- [ ] Audit closure with exact commands/evidence; commit clean worktree. Fetch
  main, handle actual conflicts if any; push branch and create reviewable PR.
- [ ] Inspect required CI and reviews; fix failures, never bypass required checks.
  Merge only after green checks for final head. User already authorizes merge.
- [ ] Verify merge SHA and resulting production deployment; Chrome MCP final
  interaction/snapshot/console checks. Report remaining external validation
  boundaries accurately rather than representing automation as a human pass.
