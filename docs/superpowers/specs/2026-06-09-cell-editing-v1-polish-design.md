# Cell editing v1 polish — design

**Date:** 2026-06-09
**Status:** Approved (brainstorm)
**Branch:** `editing-v1-polish` (off latest `main`)

## Goal

Close the two known v1 follow-ups from the cell-editing feature (PR #174) and
ship a **productized, all-themes** editor skin:

1. **Blur-to-commit** — fix the stuck-edit-on-outside-click wart.
2. **Surface validation/commit errors + pending state** in the default editor,
   with a11y, and **ship the skin for every theme** (not just DOM hooks).

Both touch the same files, so they ship together.

## Architecture context (verified)

- `@pretable/react` ships **layout-only inline styles** (`styles.ts`: "no colors,
  no fonts, no skin"). The skin lives in `@pretable/ui`'s `grid.css`, in
  `@layer pretable`, referencing `--pretable-*` **semantic** tokens.
- Token tiers: `tokens.css` defines primitive `--pt-*` palette (incl.
  `--pt-sev-err: #b91c1c`); the semantic `--pretable-*` grid tokens are defined
  **per theme**: `themes/material.css` (`:root` light + `[data-theme="dark"]` +
  density variants) and `themes/excel.css` (`:root` light only).
- No error/invalid semantic token exists today.
- The editing feature already emits `data-pretable-edit-status` on the editing
  cell and renders the default editor via `CellEditor` (`packages/react/src/
cell-editor.tsx`); the surface constructs the `PretableEditorInput` where
  `snapshot.editing` (with `status`/`error`) is in scope
  (`packages/react/src/pretable-surface.tsx`).

## Part A — `@pretable/react`: structure, behavior, a11y

### A1. Extend `PretableEditorInput`

Add `status: PretableEditStatus` and `error?: string` (from `snapshot.editing`).
Gives the default editor AND custom `renderEditor`s the lifecycle phase + message
(parity). The surface already has these values where it builds the input. Public
type change → regenerate `react.api.md`.

### A2. Blur → commit in place

Default editor: `onBlur={() => { if (input.status === "editing") input.commit(); }}`
— commit with **no direction** (no focus move), guarded to the `editing` phase so
it cannot double-submit during an in-flight `validating`/`saving`. A blur fired by
the editor unmounting after a successful commit is a safe no-op (the controller's
`commit` early-returns when `snapshot.editing` is null). Add an RTL test asserting
no double-submit when blurring during `saving`.

### A3. Error + pending + a11y in the default editor

- Render an error element when `input.error` is set:
  `<div data-pretable-edit-error role="alert">{input.error}</div>` adjacent to the
  input. (Shown for both `invalid` — status back to `editing` with a message — and
  `error` — commit failure.)
- Input ARIA: `aria-label={column.header ?? columnId}`; `aria-invalid={!!input.error}`;
  `aria-busy` true during `checking`/`validating`/`saving`.
- Input `readOnly` during `checking`/`validating`/`saving` (no draft edits
  mid-flight); editable on `editing`/`error` (so `Enter` retries after a commit
  failure — already supported by the controller).
- Custom `renderEditor`s receive `status`/`error` via the input and may render
  their own treatment; the default editor is unaffected by their choice.

## Part B — `@pretable/ui`: the skin, shipped for every theme

### B1. New semantic tokens (minimal set)

- `--pretable-edit-bg` — editor field surface.
- `--pretable-text-error` — invalid-input outline color + error-message text.
- Reuse the existing `--pretable-focus-ring` for the active-editor outline (no new
  token).

### B2. Define the tokens in all themes

- `themes/material.css`: `:root` (light) **and** `[data-theme="dark"]` (a lighter
  red for dark-mode contrast; `--pretable-edit-bg` = the dark editor surface).
- `themes/excel.css`: `:root` (light only).
- Light error value may reference the primitive `--pt-sev-err` (#b91c1c) or a
  theme-appropriate red; dark uses a lighter red (e.g. #f2b8b5-ish per M3) for
  contrast on the dark surface.

### B3. `grid.css` rules (in `@layer pretable`)

- `.pretable-cell-editor`: `background: var(--pretable-edit-bg)`, outline using
  `--pretable-focus-ring`, inherit grid font/size, fill the cell box.
- `[aria-invalid="true"].pretable-cell-editor`: outline/border in
  `var(--pretable-text-error)`.
- `[data-pretable-edit-error]`: small error text in `var(--pretable-text-error)`,
  positioned within/under the cell, `font-size` from the cell scale.
- Pending: `[data-pretable-edit-status="saving"] , [..."validating"] , [..."checking"]`
  (or `.pretable-cell-editor[aria-busy="true"]`) → reduced opacity + `cursor: wait`.
  **CSS-only** — no spinner markup/JS.

## Part C — Testing

- **react** (RTL, in `packages/react/src/__tests__/`): blur commits the draft +
  fires `onCellEdit` once; blur during `saving` does NOT double-submit; validate
  reject shows the message + `aria-invalid`; commit reject shows `error` and
  `Enter` retries; `aria-busy` + `readOnly` during a pending async save;
  `aria-label` from `column.header`.
- **ui** (extend the existing `css-cascade`-style contract test in
  `packages/ui/src/__tests__/`): assert `--pretable-edit-bg` and
  `--pretable-text-error` are defined in `material.css` `:root`, material
  `[data-theme="dark"]`, and `excel.css` `:root`; assert `grid.css` contains the
  `.pretable-cell-editor` / `[data-pretable-edit-error]` / pending rules.

## Part D — Docs

- Update `apps/website/content/docs/grid/editing.mdx`: document blur-commits and
  the error/pending/a11y behavior.
- Update the theming **token reference** (`apps/website/content/docs/theming/
token-reference.mdx`) with `--pretable-edit-bg` and `--pretable-text-error`.

## Scope

**In:** both follow-ups + the all-themes skin (material light+dark, excel light)

- a11y + docs. **Out (unchanged):** optimistic commit, drag-fill,
  paste-into-range, multi-cell editing, undo, a spinner/animated busy indicator.

## Coordination note

This writes into `themes/material.css`, `themes/excel.css`, and the theming token
reference — files under active parallel theming work. The additions are small and
purely additive (two new semantic tokens + their values + grid rules), but the
theme files will need careful merge/sequence with that parallel work.

## Risks / open items

- Exact placement of `[data-pretable-edit-error]` relative to a variable-height
  cell (overlay vs push-down) — settle in planning against the real cell DOM;
  default to a compact inline element that doesn't disrupt row height during the
  brief error window.
- Confirm `excel.css` has no dark variant to mirror (verified: light-only) so the
  token set there is `:root` only.
