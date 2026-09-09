# Overlay ownership and state implementation plan

> Use superpowers:subagent-driven-development and independent spec/quality
> reviews. The user has authorized continuing repairs in this session.

**Goal:** resolve A7/A11/A12/A13 with correct nested ownership and scoped visuals.
**Architecture:** logical portal-origin registry, capture outside-press helper,
public explicit portal-target provider, and complete control state selectors.
**Stack:** React18/19, TypeScript, Vitest, Playwright; pinned pnpm10.12.1 via
`PATH=/tmp/pretable-kit-bin:$PATH`. Baseline `356e447f` in existing worktree.

Spec: `docs/superpowers/specs/2026-09-08-components-sp4c-overlays-design.md`.

## Task 1: overlay behavior and API (one owner)

Files: `packages/react/src/overlay/OverlayPortal.tsx`, new portal-context and
outside-pointer/containment modules as needed, `overlay/menu-keyboard.ts`,
`components/select.tsx`, `components/listbox.tsx`, `filter-menu/FilterMenu.tsx`,
`column-menu/ColumnMenu.tsx`, tool-panel menu callers and surface adapter only
as needed; `public_api.ts`; focused/new behavior tests and public type tests.

- [x] Write regressions and observe baseline failures for sibling triggers,
  nested portal presses, external stopPropagation, own-toggle and focus.
- [x] Implement hidden origin + display:contents portal boundary registration,
  logical containment and capture-phase outside press with trigger exemption.
  Integrate existing menu paths; preserve independent drag handlers.
- [x] Add provider null/default/custom/nested/switch/SSR tests; implement public
  provider and exports. Container selection uses nearest context; null waits.
  Preserve open intent while target unavailable; gate Select expanded/controls
  and enum/date active-descendant ARIA on actual target readiness. Focus-taking
  menus focus on attachment rather than initial component mount. Test opening
  before null→target, target removal/replacement and hydration without repeated
  focus steals. Minimal editor ARIA edits are part of this integration.
- [x] Rename Listbox emitted active marker to data-pretable-active; CSS owner
  handles stylesheet/tests, root handles docs. No CSS edits by this owner.
- [x] Run focused tests/typecheck/lint; mutate containment ancestry and trigger
  exemption, observe failures, restore. Commit owned files; notify root stable.
  No builds while other sources are changing. Root owns API report/docs/browser.

## Task 2: visual baseline and CSS (independent owner)

Files: `packages/ui/grid.css`, `packages/ui/src/__tests__/css-cascade.test.ts`
and other existing CSS guards as necessary; browser measurement harness and
before/after screenshot evidence under task-local artifact directory.

- [x] Capture baseline state screenshots before modifying CSS. Use exact kit
  markup and checked-in styles in a browser harness; no Next build needed.
  Measure light/dark and Chromium forced colors. Record defects precisely.
- [x] Add failing state-combination guards; rename active CSS/test marker to
  data-pretable-active. Implement disabled hover/ink/cursor, forced-color
  active outline, selected-disabled option and checked/mixed-disabled checkbox
  system-color pairs. Keep ordinary enabled states stable.
- [x] Run UI suite; browser computed-state checks plus inspect before/after
  screenshots, ordinary Chromium/WebKit + forced Chromium. Demonstrate guards
  catch removed active/disabled rules, restore. Commit only owned CSS/tests;
  send screenshot paths and evidence for root report. No React/build edits.

## Task 3: production integration and delivery (root)

Files: new `apps/website/app/fixtures/overlay-scope/page.tsx` and corresponding
E2E spec for live scopes/nesting; existing component E2E parent assertions;
component/theming docs, API report, changesets and audit/spec/plan evidence.

- [x] Read website AGENTS/local Next docs. Add two local scopes with explicit
  portal hosts, custom tokens and live dir/theme updates; exercise Select and
  nested FilterMenu through real grid. Add provider public usage/type coverage.
- [x] Document container setup, null behavior, constraints and active-attribute
  migration. Correct touched context/props prose. Add minor React/UI changeset.
- [x] After stable source, sequential production build then API update/check,
  package/public typecheck. Full React/UI tests and docs guards; changed lint
  and formatting. Do not run API/types during dependency rebuilds.
- [x] Run component and scoped-overlay production E2E in Chromium/WebKit.
  Inspect actual scoped popup screenshots/computed variables. No unverified AT
  or physical high-contrast claims; record remaining human-validation boundary.
- [x] Independent spec and quality review; resolve findings and revalidate.
  Update only A7/A11/A12/A13 + marker correction. Commit clean local branch.

## Evidence

Implementation commits: `21421a79` (CSS) and `19cd1bae` (overlay API/ownership).
Independent spec review approved Task1; CSS and whole-change quality reviews
found no blockers. The visual QA correction `bd5fe3c1` remeasures moved anchors.

- Ownership/provider/editor/header regressions were observed failing before
  implementation; final initial focused run passed 267 tests in 14 files.
- Physical-only containment and missing trigger exemption mutations failed
  their targeted tests; both were restored. CSS mutations removing active
  outlines, disabled hover guards and checkbox system pairs also failed.
- UI: 116 tests in 4 files passed. Computed styles and inspected screenshots
  cover ordinary Chromium/WebKit and Chromium forced light/dark OS palettes.
  Durable screenshots: [visual evidence](../../research/assets/sp4c/README.md).
- Packed React 18.0.0, 18.3.1 and 19.2.8 compatibility includes custom-host popup
  attachment/unmount plus SSR/hydration and callback-ref cleanup. The React17
  negative peer-contract control and 9 script tests also passed.
- Production visual inspection caught stale popup position after direction
  changes, despite the initial 16 browser cases passing. Added position checks
  failed for both Select and header FilterMenu. Unit RED cases cover React
  rerenders, ancestor CSS changes and deferred portal attachment. Their fix
  shares bounded open-overlay observation; no polling or focus changes. Its
  144 tests in 6 suites pass; removing observer disconnects failed the cleanup
  regression, then was restored.
- API report adds only provider and props. Documentation guard coverage now
  binds the provider props table to its generated API names/types; all 38
  selected docs tests passed after regeneration and table registration.

Final checks after `bd5fe3c1` all passed: Logs use `/tmp/pretable-sp4c-*.log` on this machine.
No deployment, publication or human assistive-technology pass is claimed.


- `pnpm react:compat`: exact packed React18.0.0/18.3.1/19.2.8 matrix and React17
  negative peer control, exit0.
- `pnpm --filter @pretable/app-website build`: production build, exit0.
- `pnpm --filter @pretable/react test`: 1,987 tests in142 files, exit0.
- `pnpm --filter @pretable/ui test`: 116 tests in4 files (CSS unchanged since).
- React `api:check`, package typecheck, `tsc -p type-tests/tsconfig.react.json
  --noEmit`, and website typecheck: exit0, run after dependency builds finished.
- Website Vitest docs-links, docs-api-surface and examples-registry-guard:
  38 tests in3 files, exit0. `node --test scripts/__tests__/check-react-compatibility.test.mjs`:
  9 passed.
- Production `playwright test e2e/components.spec.ts e2e/overlay-scope.spec.ts
  --workers=1`, `BASE_URL=http://127.0.0.1:3210`: 16 passed across Chromium/WebKit,
  including new live-position assertions. Final screenshots inspected and saved.
- Changed-file ESLint, Prettier and `git diff --check`: passed.
- Independent final quality review approved `bd5fe3c1`, including stable
  subscriptions, data-theme coverage, disconnects, bounds equality and nested
  repositioning. No unresolved review findings.

Known nonfatal tool warnings: jsdom canvas/navigation stubs, API Extractor's
bundled TypeScript5.9 versus repository6.0, Vite config compatibility and terminal
color settings. No test failures remain. A4–A6/editor migration remain separate;
A7/A11–A13 and the active-attribute correction are closed in the audit.
