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

- [ ] Write regressions and observe baseline failures for sibling triggers,
  nested portal presses, external stopPropagation, own-toggle and focus.
- [ ] Implement hidden origin + display:contents portal boundary registration,
  logical containment and capture-phase outside press with trigger exemption.
  Integrate existing menu paths; preserve independent drag handlers.
- [ ] Add provider null/default/custom/nested/switch/SSR tests; implement public
  provider and exports. Container selection uses nearest context; null waits.
  Preserve open intent while target unavailable; gate Select expanded/controls
  and enum/date active-descendant ARIA on actual target readiness. Focus-taking
  menus focus on attachment rather than initial component mount. Test opening
  before null→target, target removal/replacement and hydration without repeated
  focus steals. Minimal editor ARIA edits are part of this integration.
- [ ] Rename Listbox emitted active marker to data-pretable-active; CSS owner
  handles stylesheet/tests, root handles docs. No CSS edits by this owner.
- [ ] Run focused tests/typecheck/lint; mutate containment ancestry and trigger
  exemption, observe failures, restore. Commit owned files; notify root stable.
  No builds while other sources are changing. Root owns API report/docs/browser.

## Task 2: visual baseline and CSS (independent owner)

Files: `packages/ui/grid.css`, `packages/ui/src/__tests__/css-cascade.test.ts`
and other existing CSS guards as necessary; browser measurement harness and
before/after screenshot evidence under task-local artifact directory.

- [ ] Capture baseline state screenshots before modifying CSS. Use exact kit
  markup and checked-in styles in a browser harness; no Next build needed.
  Measure light/dark and Chromium forced colors. Record defects precisely.
- [ ] Add failing state-combination guards; rename active CSS/test marker to
  data-pretable-active. Implement disabled hover/ink/cursor, forced-color
  active outline, selected-disabled option and checked/mixed-disabled checkbox
  system-color pairs. Keep ordinary enabled states stable.
- [ ] Run UI suite; browser computed-state checks plus inspect before/after
  screenshots, ordinary Chromium/WebKit + forced Chromium. Demonstrate guards
  catch removed active/disabled rules, restore. Commit only owned CSS/tests;
  send screenshot paths and evidence for root report. No React/build edits.

## Task 3: production integration and delivery (root)

Files: new `apps/website/app/fixtures/overlay-scope/page.tsx` and corresponding
E2E spec for live scopes/nesting; existing component E2E parent assertions;
component/theming docs, API report, changesets and audit/spec/plan evidence.

- [ ] Read website AGENTS/local Next docs. Add two local scopes with explicit
  portal hosts, custom tokens and live dir/theme updates; exercise Select and
  nested FilterMenu through real grid. Add provider public usage/type coverage.
- [ ] Document container setup, null behavior, constraints and active-attribute
  migration. Correct touched context/props prose. Add minor React/UI changeset.
- [ ] After stable source, sequential production build then API update/check,
  package/public typecheck. Full React/UI tests and docs guards; changed lint
  and formatting. Do not run API/types during dependency rebuilds.
- [ ] Run component and scoped-overlay production E2E in Chromium/WebKit.
  Inspect actual scoped popup screenshots/computed variables. No unverified AT
  or physical high-contrast claims; record remaining human-validation boundary.
- [ ] Independent spec and quality review; resolve findings and revalidate.
  Update only A7/A11/A12/A13 + marker correction. Commit clean local branch.

## Evidence

Record actual tests, mutations, screenshots and final verification below.
