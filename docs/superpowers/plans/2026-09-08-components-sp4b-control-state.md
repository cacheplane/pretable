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

- [x] Add failing tests for active identity on reorder/insertion/removal,
  disabled active/selected options, empty open Select closing and repopulating,
  all-disabled no-highlight/no-commit, and live option target references.
- [x] Add rich-label textValue behavior/type tests and reopen-within-500ms
  typeahead regression; observe intended failures with component test scripts.
- [x] Store/reconcile active value; derive index from current enabled roster
  every render and keyboard event. Seed on opening and reconcile to first
  enabled fallback. Empty Select closes and clears ARIA references.
- [x] Add primitive/rich label option union with explicit textValue support;
  reset session buffer, keeping accumulated-prefix behavior otherwise intact.
- [x] Run focused component and enum tests. Temporarily remove identity and
  session-reset guards to prove corresponding regressions fail; restore.
- [x] Typecheck/lint/format owned files, review and commit. Do not build while
  another worker edits; root builds after stable source.

## Task 2: callback cleanup (separate owner)

Files: new `packages/react/src/components/compose-refs.ts`,
`checkbox.tsx`, `text-input.tsx`, dedicated ref tests. The owner provides the
small Select integration diff to root after Task1 releases `select.tsx`.

- [x] Write control lifecycle and helper null-detach tests. Observe current
  returned-cleanup failure with real Checkbox/TextInput/Select ref callbacks.
- [x] Implement stable internal helper supporting object, void callback and
  cleanup-returning callback refs. Callback exposed to React returns void;
  null detach invokes saved cleanup once and clears internal nodes.
- [x] Test ref replacement, repeated detach, StrictMode, and stable rerenders;
  no callback(null) after cleanup. Test the React18-compatible void return.
- [x] Integrate Checkbox/TextInput; root integrates Select after Task1 commit.
  Mutation-check cleanup invocation; restore, typecheck/lint/format, review
  and commit only owned files.

## Task 3: integration and delivery (root)

Files: Select helper integration; component docs, React API report,
`.changeset/*`, audit/spec/plan evidence; existing browser tests as applicable.

- [x] Integrate Select composition helper, rerun lifecycle regressions.
- [x] Update docs for textValue migration, dynamic roster behavior and refs;
  correct touched inaccurate button.value prose. Add a minor React changeset
  explaining the breaking type tightening in this pre-1.0 package.
- [x] Build dependencies sequentially, generate React API report and check it;
  run full React test suite/typecheck, changed-file lint/format and docs guards.
- [x] Extend the packed React compatibility fixtures with composed-ref runtime
  teardown and public rich-label option usage. Run `pnpm react:compat` across
  React 18.0, 18.3 and 19.2 after source stabilizes. Root observed the packed
  ref regression fail against the old dist: all three cleanups were skipped.
- [x] Build production website; run existing Select/filter browser workflows
  in Chromium and WebKit against local build. No CSS changes/visual claims.
- [x] Obtain independent spec/quality review; resolve findings and revalidate
  relevant changes. Mark only A8/A9/A10/A14 resolved with evidence.
- [x] Commit final docs/evidence; clean working tree, preserve local branch.

## Execution evidence

- Spec and plan reviewed before implementation. Existing user authorization
  covered this corrective continuation.
- Task 1: `e0a648d1`; 59 targeted Select/Listbox/enum tests passed. Initial
  RED: nine failed, fifteen passed; public types rejected unsupported
  textValue. Added failing inline-roster render-loop regression and repaired
  semantic reconciliation. Identity and session-reset mutants both failed
  their targeted regressions and were restored. Spec and quality approved.
- Task 2: `8b6a1bf3`; all three controls reproduced skipped cleanup (six
  failures initially). Helper cleanup mutation failed actual control and
  helper detach tests and was restored. Spec and quality approved. Root
  observed two remaining Select failures before integrating useComposedRefs;
  combined integration then passed 56 tests.
- Root packed-ref fixture failed against old dist with zero cleanup calls and
  three null callbacks. Browser rapid-reopen regression failed against old
  production build in both Chromium and WebKit: expected count, remained avg.
- Full React suite: 140 files, 1,964 tests passed. Documentation guards: 26
  passed. Compatibility-runner unit tests: nine passed. Source/type-test/browser
  lint and formatting passed. The public compatibility fixture retains its
  existing mixed-export Fast Refresh warning.
- API/type checking initially overlapped the compatibility runner rebuilding
  UI declarations; those transient results are superseded by the final checks
  below after all builds complete.

- Final verification (Node 24.20.0, pinned pnpm 10.12.1):
  - `pnpm --filter @pretable/react test`: 140 files, 1,964 passed.
  - `pnpm react:compat`: passed all packed React 18.0.0, 18.3.1 and 19.2.8
    runtime/type rows and the React17 unsupported-peer negative control.
    The new runtime fixture verifies all three control cleanups on actual
    runtimes; no synthetic compatibility assumption is needed for that claim.
  - `pnpm --filter @pretable/app-website build`: passed, including dependencies,
    example registry and production Next build.
  - After that build, React `api` regeneration, `api:check`, `typecheck`, and
    `pnpm exec tsc -p type-tests/tsconfig.react.json --noEmit` all passed.
    Final API diff is only the intended PretableSelectOption union.
  - Website `exec vitest run --environment jsdom` for docs-api-surface and
    docs-links: 26 passed. `node --test
    scripts/__tests__/check-react-compatibility.test.mjs`: nine passed.
  - `BASE_URL=http://127.0.0.1:3210 pnpm --filter @pretable/app-website exec
    playwright test e2e/components.spec.ts --workers=1`: ten passed, covering
    replaced controls, menu anchoring/focus, picker typeahead/reopen, nested
    filter selection/Escape, and checkbox keyboard/label activation in both
    Chromium and WebKit. Old build failed the new reopen check in both.
  - Changed source/test lint and formatting passed; no CSS changes. Existing
    jsdom canvas/navigation and API Extractor compiler-version warnings were
    non-fatal. `git diff --check` passed.
- Final independent whole-change review approved. A8/A9/A10/A14 are resolved;
  A4–A7 and A11–A13 remain open. Local branch retained; nothing published or
  merged. The preview server was stopped after verification.
