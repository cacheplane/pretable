# Clipboard Paste — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clipboard paste into the grid — Excel anchor/tile/clip semantics, typed value coercion, per-cell editability + validation gating, and one bulk `onPaste` callback carrying applied cells, rejections, and clip counts.

**Architecture:** Two pure, React-free modules (`parseTsv`, `mapPasteToTargets`) do all parsing and geometry and are unit-tested in isolation. The surface adds a DOM `paste` listener that runs them, then an async gate (`parseEditValue` → `editable` → `validate`, resolved in parallel with a stale-token guard) before firing `onPaste` once. The grid never mutates rows — the app applies `cells` in one state update, exactly like `onCellEdit`.

**Tech Stack:** TypeScript, Vitest + RTL, Playwright, api-extractor (required gate). Commands: `pnpm --filter @pretable/react test`, `pnpm -r typecheck`/`lint`/`test`, `pnpm format`/`format:write`, `pnpm api`.

**Key facts (verified at `main` = #204):**

- `packages/react/src/copy.ts` exports `escapeTsvField(text)` — quotes iff `/["\t\r\n]/`, doubles embedded `"`. `parseTsv` must be its exact inverse. Copy joins multiple ranges with `"\n\n"` and emits a blank line after headers when `copyWithHeaders`.
- `ROW_SELECT_COLUMN_ID` is in `packages/react/src/constants.ts`; `serializeRangesAsTsv` filters it out of data columns — paste must too.
- Editing hooks on `PretableColumn` (`packages/grid-core/src/types.ts`): `editable?: boolean | ((input) => boolean | Promise<boolean>)`, `validate?: (value, input) => (true | string) | Promise<true | string>`, `parseEditValue?: (raw: string, input) => unknown`. `PretableEditInput` is the input shape — read it and construct it correctly.
- The surface's ⌘C handler is at `pretable-surface.tsx` ~`:1091` (`event.metaKey || event.ctrlKey`) with an input-focus guard; mirror that guard's shape for paste.
- `useCellEditController` (`packages/react/src/use-cell-edit-controller.ts` or similar — locate it) has the monotonic staleness-token pattern to mirror.
- Prior gotchas: run `pnpm format` before finishing; build react sequentially before `pnpm api` if a report looks stale; jsdom has no layout AND no real clipboard — the browser smoke is what proves the event path.

---

## Task 1: `parseTsv` (pure, exact inverse of `escapeTsvField`)

**Files:**

- Create: `packages/react/src/paste.ts`
- Test: `packages/react/src/__tests__/paste-parse.test.ts`

- [ ] **Step 1: Write the failing tests.** Cover:
  - plain `a\tb\nc\td` → `[["a","b"],["c","d"]]`
  - CRLF and bare-CR row separators
  - quoted field containing a TAB: `"a\tb"\tc` → `[["a\tb","c"]]`
  - quoted field containing a newline → one row, embedded `\n` in the value
  - `""` unescaping: `"say ""hi"""` → `say "hi"`
  - a bare field that merely _starts_ with a quote mid-string is not treated as quoted (e.g. `a"b`)
  - exactly one trailing blank line trimmed; a second trailing blank line is preserved as an empty row
  - ragged rows preserved (rows of differing length)
  - empty string → `[]`
  - **round-trip property**: for a list of tricky strings (tabs, newlines, quotes, empty, unicode), `parseTsv(row.map(escapeTsvField).join("\t"))` deep-equals `[row]`
- [ ] **Step 2: Run → FAIL** (`pnpm --filter @pretable/react test -- paste-parse`).
- [ ] **Step 3: Implement `parseTsv`.** Single-pass character scanner with an `inQuotes` flag:
  - a `"` at field start opens a quoted field; inside, `""` appends one `"`, a lone `"` closes;
  - outside quotes, TAB ends the field, and `\r\n` / `\n` / `\r` end the row;
  - push the final field/row at EOF; then trim exactly one trailing empty row (a row that is a single empty field).
    Do NOT use `split()` — quoted separators break it.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(react): parseTsv — RFC4180-style clipboard parser`

---

## Task 2: `mapPasteToTargets` (pure geometry)

**Files:**

- Modify: `packages/react/src/paste.ts`
- Test: `packages/react/src/__tests__/paste-map.test.ts`

- [ ] **Step 1: Write the failing tests.** With a fixture of 5 visible rows × 4 data columns:
  - **anchor**: 1×1 selection at (r1,c1) + a 2×2 block → 4 targets at r1..r2 × c1..c2
  - **tile rows**: 4-row selection + 2-row block → block repeats twice (exact multiple)
  - **tile columns**: 4-col selection + 2-col block → repeats twice
  - **tile both**
  - **no tile on non-multiple**: 3-row selection + 2-row block → block written once from the top-left, remaining selection untouched
  - **clip rows**: anchor at the 4th of 5 rows with a 4-row block → 2 targets, `clipped.rows === 2`
  - **clip columns** symmetrically
  - row-select column never appears as a target (pass it in `columns` and assert it's excluded)
  - a matrix cell whose target row/column doesn't resolve is counted as clipped, not silently dropped
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Signature per the spec. Resolve `anchor` to indices in `visibleRows` / data-columns; compute `targetRows`/`targetCols` = block size, or the selection size when it's an exact multiple in that dimension; walk the target area taking `matrix[r % blockRows][c % blockCols]`; count anything past the ends into `clipped`. Return `{ cells: {rowId, columnId, raw}[], clipped }` — no validation here, no `value`, no `row` (the surface adds those).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(react): mapPasteToTargets — Excel anchor/tile/clip geometry`

---

## Task 3: Surface wiring — paste listener, async gate, `onPaste`

**Files:**

- Modify: `packages/react/src/pretable-surface.tsx`, `packages/react/src/public_api.ts`
- Test: `packages/react/src/__tests__/paste-surface.test.tsx`

- [ ] **Step 1: Types.** Add `PastedCell`, `RejectedPasteCell`, `PastePayload` (spec has the exact shapes) to `paste.ts`; export the types + `parseTsv` from `public_api.ts`. Keep `mapPasteToTargets` internal. Add `onPaste?: (payload: PastePayload<TRow>) => void | Promise<void>` to `PretableSurfaceProps` and destructure it.
- [ ] **Step 2: Failing RTL tests.** Fire a `paste` ClipboardEvent (construct a `DataTransfer`, or a `{ clipboardData: { getData: () => text } }` stub — whichever the jsdom version supports; verify) on the surface root and assert:
  - a 2×2 paste anchored on a selected cell fires `onPaste` once with 4 `cells`, correct `rowId`/`columnId`/`raw`
  - `parseEditValue` coercion: a number column yields `value` as a **number**, not a string
  - a non-editable column's cells land in `rejected` with `reason: "not-editable"` while the others still apply
  - a column whose `validate` returns a string ⇒ `rejected` with `reason: "invalid"` + `message`; the rest apply
  - async `editable` and async `validate` are awaited (return promises in the fixture)
  - `clipped` counts are reported when the block overflows
  - **no `onPaste` prop ⇒ inert** (no throw, nothing applied)
  - paste is **ignored while a cell editor input is focused** (focus an editor, fire paste, assert `onPaste` not called)
  - `event.preventDefault()` was called when handled
- [ ] **Step 3: Implement the listener + pipeline** per the spec's 5 steps. Attach the listener to the surface root element (not `document`) so multiple grids don't cross-fire. Guard: bail early when `onPaste` is undefined, when an editor is focused, or when the text is empty. Build the `PretableEditInput` for each cell correctly (read its type). Run `parseEditValue` in a try/catch → `reason: "invalid"`. Resolve `editable` + `validate` with `Promise.all`. Use a monotonic token (mirroring `useCellEditController`) captured before the await and re-checked after; discard on mismatch.
- [ ] **Step 4: Verify** `pnpm --filter @pretable/react test` + `typecheck`.
- [ ] **Step 5: Commit** — `feat(react): paste into the grid via a bulk onPaste callback`

---

## Task 4: Hero adoption, docs, api, full validation + browser smoke

**Files:**

- Modify: `apps/website/app/components/HeroGrid.tsx` (+ tests)
- Create: `apps/website/content/docs/grid/paste.mdx`; modify `apps/website/app/docs/_nav.ts`, `apps/website/content/docs/grid/clipboard.mdx`
- Modify: `apps/website/e2e/smoke.spec.ts`
- Generated: `*.api.md`

- [ ] **Step 1: Hero.** Wire `onPaste` so pasting into the Qty column applies through the hero's existing edited-qty override path (the same map that survives streaming ticks). Reuse the existing guardrail/desk-rejection validation — rejections should already flow through `validate`, so `rejected` arrives populated. Surface a brief count in the existing sidebar messaging; don't invent new UI. Update the hero legend to mention paste. Add/extend an RTL test.
- [ ] **Step 2: Docs.** `paste.mdx` (frontmatter `nav: Grid`, sensible `order`; register in the hardcoded `_nav.ts` next to Editing) covering: the trigger and the editor-focus exception; a shape-mismatch table (anchor / tile-on-exact-multiple / write-once otherwise / clip); the rejection contract with a worked "N of M applied" snippet; the clip-and-report overflow policy **with a snippet showing how to append the extra rows yourself**; and the TSV format — state plainly that we quote-iff-needed and fully unescape, and that multi-range copies flatten to one matrix. Link it from `clipboard.mdx`. Ground every claim in the shipped code.
- [ ] **Step 3: API.** `pnpm --filter @pretable/react build`, then `pnpm api`. Expect: `onPaste` on `PretableSurfaceProps`, plus `PastedCell` / `RejectedPasteCell` / `PastePayload` / `parseTsv` exports. `mapPasteToTargets` must NOT appear. Commit reports.
- [ ] **Step 4: Full validation.**
  ```bash
  pnpm -r typecheck && pnpm -r lint && pnpm -r test
  pnpm format
  pnpm --filter @pretable/app-website build
  pnpm api   # second run must be a clean no-op
  ```
- [ ] **Step 5: Browser smoke — the acceptance gate.** Add a Playwright test that pastes for real into the hero: write TSV to the clipboard (`page.evaluate` + `navigator.clipboard.writeText`, granting the `clipboard-write` permission where the engine needs it) then press `⌘/Ctrl+V` and assert the target cells changed. **If WebKit refuses clipboard access**, fall back to dispatching a synthetic `ClipboardEvent` carrying a `DataTransfer` — that still exercises the real listener — and say so explicitly in a test comment rather than implying full OS-clipboard coverage. Run `cd apps/website && pnpm build`, `npx next start -p 3123 &`, `BASE_URL=http://localhost:3123 pnpm smoke --workers=1`; kill the server. The known pre-existing showcase resize-drag flake is NOT yours.
- [ ] **Step 6: Commit** — `feat(website): paste in the hero; document paste; refresh API reports`

---

## Self-Review notes (for the executor)

- **Spec coverage:** parser (T1) ✓; geometry (T2) ✓; listener + coercion + gating + `onPaste` (T3) ✓; hero, docs, api, smoke (T4) ✓.
- **The two things most likely to be got wrong:** (a) `parseTsv` must be a scanner, not `split()` — a quoted field can contain the separators; (b) the skip rule — a rejected cell **consumes its position**, the block does not re-flow.
- **Don't** use `navigator.clipboard.readText()` for the trigger; the paste event carries the data without a permission prompt.
- **Don't** fan out to `onCellEdit` — one bulk callback is the decision.
- No row creation. Report `clipped`, never invent row ids.
- **Type consistency:** `parseTsv`, `mapPasteToTargets`, `PastedCell`, `RejectedPasteCell`, `PastePayload`, `onPaste`, `reason: "not-editable" | "invalid"` used identically across tasks.
