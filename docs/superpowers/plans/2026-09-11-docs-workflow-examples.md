# Documentation workflow examples implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for bounded implementation and review tasks.

**Goal:** Complete Editing, Selection, CSV export, and Paste example expansions, each in its own PR, merged on green and verified in production.

**Architecture:** Follow the existing example.ts/demo.tsx/source registry pattern and use public Pretable APIs. Examples own local application state, explain a concrete reader task, and include complete copyable source. Preserve existing integration examples and API contracts. No global stylesheet imports in lazy modules; client boundaries belong on React entry components.

**Tech Stack:** React, TypeScript, MDX, Pretable, Vitest, Playwright Chromium/WebKit, Chrome MCP.

## 1. Editing — blove/editor-type-examples

- [x] Add six small self-contained examples under `apps/website/content/examples/editor-{text,multiline,number,boolean,enum,date}`. Each uses a tiny real grid, controlled rows/onRowChange, the built-in editor, and visible saved-value feedback.
- [x] Place previews beside the corresponding typed-editor sections in `apps/website/content/docs/grid/editing.mdx`, adding a single-line text section. Keep existing async and custom editor demos and avoid dangling snippet fixtures.
- [x] Verify text commit/cancel, multiline newline/commit, number stepping/invalid/null, boolean direct toggle, enum label-to-value selection/rejection, and date canonical commit/rejection/clearing in `apps/website/e2e/editor-type-examples.spec.ts`.
- [x] Regenerate examples; run website tests, typecheck, lint, format, production build, focused browsers, mobile/desktop Chrome inspection, and independent review.
- [ ] PR, CI green, merge, production Chrome + focused tests, production CI green.

## 2. Selection — blove/selection-workflow-example

- [ ] Add `controlled-row-selection` example with an orders grid, controlled checkbox state, selected count, bulk status action, and programmatic clear. Keep cell ranges conceptually separate. Subscribe to the public grid state and preserve symbolic selection; resolve selected local orders with isRowSelected.
- [ ] Embed beside controlled checked-set guidance in `apps/website/content/docs/grid/selection.mdx`.
- [ ] Test select/clear/select-all and actual row changes from bulk action, source availability, and mobile fit.
- [ ] Review, validate, separate PR, green merge, production verification.

## 3. CSV export — blove/export-preview-example

- [ ] Add `export-preview` example showing actual exported content from public API with selectable columns, headers, delimiter, and formatted output (the API has no raw/formatted toggle). Download must match preview using the same options and data.
- [ ] Embed beside export options guidance in `apps/website/content/docs/grid/export.mdx`. Keep existing selected-row download demo.
- [ ] Test meaningful CSV content changes, quoting, actual download content, source availability, and mobile fit.
- [ ] Review, validate, separate PR, green merge, production verification.

## 4. Paste — blove/paste-validation-example

- [ ] Add `paste-validation` inventory example: supply a copyable TSV block containing valid and invalid quantities, apply accepted cells via onPaste, preserve rejected values, and show visible row-specific rejection reasons. Use native paste through the built-in validation path.
- [ ] Embed near coercion/rejections guidance in `apps/website/content/docs/grid/paste.mdx`; retain geometry/overflow demo.
- [ ] Test mixed accepted/rejected changes, corrective retry, reset, source availability, and mobile fit.
- [ ] Review, validate, separate PR, green merge, production verification.

## Verification commands

Use `PATH=/tmp/pretable-kit-bin:$PATH pnpm` (pinned pnpm 10.12.1). Website commands: `examples:gen`, `examples:check`, `typecheck`, `lint`, `build`, and `exec vitest run --environment jsdom`. Run focused Playwright with explicit `BASE_URL=http://localhost:3011` against a production build via `next start --port 3011`; never rebuild package dependencies while browser checks are running. Verify the deployed commit via `/version.json`. Wait for all PR checks before merging and full production CI before completing each arc.
