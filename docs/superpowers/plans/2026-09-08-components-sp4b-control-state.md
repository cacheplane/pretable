# Control state and refs implementation plan

> For agentic workers: use superpowers:subagent-driven-development for bounded
> tasks, with spec and quality reviews. Existing user authorization covers
> execution in this session; no execution-choice prompt is needed.

**Goal:** fix audit A8/A9/A10/A14 without mixing overlay or editor redesign.
**Architecture:** value-based internal listbox state and explicit textValue;
shared internal ref composition with void callback/null-detach compatibility.
**Tech stack:** React 18/19, TypeScript, Vitest, Playwright, pinned pnpm 10.12.1.

Spec: `docs/superpowers/specs/2026-09-08-components-sp4b-control-state-design.md`.
Existing worktree/branch: `codex/component-kit-audit`, baseline `c1cc8290`.
Use `PATH=/tmp/pretable-kit-bin:$PATH pnpm` to select the repository version.

## Task 1: listbox roster and text (one owner)

Files: `packages/react/src/components/listbox.tsx`, `select.tsx`,
`packages/react/src/__tests__/components-listbox.test.tsx`,
`components-select.test.tsx`; type-level test in existing typecheck patterns.

- [ ] Add failing tests for active identity on reorder/insertion/removal,
  disabled active/selected options, empty open Select closing and repopulating,
  all-disabled no-highlight/no-commit, and live option target references.
- [ ] Add rich-label textValue behavior/type tests and reopen-within-500ms
  typeahead regression; observe intended failures with component test scripts.
- [ ] Store/reconcile active value; derive index from current enabled roster
  every render and keyboard event. Seed on opening and reconcile to first
  enabled fallback. Empty Select closes and clears ARIA references.
- [ ] Add primitive/rich label option union with explicit textValue support;
  reset session buffer, keeping accumulated-prefix behavior otherwise intact.
- [ ] Run focused component and enum tests. Temporarily remove identity and
  session-reset guards to prove corresponding regressions fail; restore.
- [ ] Typecheck/lint/format owned files, review and commit. Do not build while
  another worker edits; root builds after stable source.

## Task 2: callback cleanup (separate owner)

Files: new `packages/react/src/components/compose-refs.ts`,
`checkbox.tsx`, `text-input.tsx`, dedicated ref tests. The owner provides the
small Select integration diff to root after Task1 releases `select.tsx`.

- [ ] Write control lifecycle and helper null-detach tests. Observe current
  returned-cleanup failure with real Checkbox/TextInput/Select ref callbacks.
- [ ] Implement stable internal helper supporting object, void callback and
  cleanup-returning callback refs. Callback exposed to React returns void;
  null detach invokes saved cleanup once and clears internal nodes.
- [ ] Test ref replacement, repeated detach, StrictMode, and stable rerenders;
  no callback(null) after cleanup. Test the React18-compatible void return.
- [ ] Integrate Checkbox/TextInput; root integrates Select after Task1 commit.
  Mutation-check cleanup invocation; restore, typecheck/lint/format, review
  and commit only owned files.

## Task 3: integration and delivery (root)

Files: Select helper integration; component docs, React API report,
`.changeset/*`, audit/spec/plan evidence; existing browser tests as applicable.

- [ ] Integrate Select composition helper, rerun lifecycle regressions.
- [ ] Update docs for textValue migration, dynamic roster behavior and refs;
  correct touched inaccurate button.value prose. Add a minor React changeset
  explaining the breaking type tightening in this pre-1.0 package.
- [ ] Build dependencies sequentially, generate React API report and check it;
  run full React test suite/typecheck, changed-file lint/format and docs guards.
- [ ] Build production website; run existing Select/filter browser workflows
  in Chromium and WebKit against local build. No CSS changes/visual claims.
- [ ] Obtain independent spec/quality review; resolve findings and revalidate
  relevant changes. Mark only A8/A9/A10/A14 resolved with evidence.
- [ ] Commit final docs/evidence; clean working tree, preserve local branch.

## Execution evidence

To be recorded as each task completes.
