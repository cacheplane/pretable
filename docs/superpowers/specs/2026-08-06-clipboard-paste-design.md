# Clipboard paste — design (P1 sub-project 3 of 3)

**Date:** 2026-08-06
**Branch:** `claude/paste` (off `main` after #204)
**Status:** approved (design confirmed in-session)

## Context

Clipboard support is copy-only. `serializeRangesAsTsv` (`packages/react/src/copy.ts`)
emits TSV with RFC4180-style escaping added in #204 (`escapeTsvField`: quote a field iff
it contains TAB/CR/LF/`"`, double embedded quotes). Editing is controlled and
pessimistic — `onCellEdit({rowId, columnId, value, row})` per cell with async
`editable`/`validate`/`parseEditValue`; the grid never mutates rows.

Paste is the last P1 gap (multi-sort ✅ #196 → right-pin ✅ #199 → paste).

## Research: what ag-grid and Excel actually do

Verified against `~/repos/ag-grid` @ `11fb3b0dcdb`, quoted here because several
decisions below deliberately diverge:

- **Overflow:** ag-grid **clips** (`clipboardService.ts:664-691`, `if (!rowNode) continue`);
  no option controls it — their docs push row creation onto `processDataFromClipboard` +
  `applyTransaction`. **Excel grows** (and auto-expands a Table). Their range-extension is
  additionally all-or-nothing (`rangeService.ts:632-643`): a 10-row paste into a 3-row
  range with 5 rows available writes 3, not 5. **We clip but report; we do not copy the
  all-or-nothing quirk.**
- **Tiling:** repeat only on exact integer multiples, else anchor top-left
  (`clipboardService.ts:384-394`); matches Excel. **We match.**
- **Escaping:** ag-grid copies with `suppressQuotes: true` — it never quotes — so cells
  containing tabs/newlines round-trip wrong through its own clipboard, and its parser
  retains quote characters in the value (`stringToArray` → `'"say ""hi"""'`).
  **We already escape correctly (#204); our parser will fully unescape.**
- **Trailing newline:** Excel-on-Windows appends one; ag-grid's trim is opt-in and off by
  default (`suppressLastEmptyLineOnPaste`), so their default Excel paste gains a blank
  row. **We trim one trailing blank line by default.**
- **Non-editable targets:** ag-grid skips silently, per cell, with no event or count, and
  inconsistently — skipped _rows_ shift the clipboard cursor, skipped _columns_ consume
  and drop. **We report rejections and use one consistent rule (see below).**
- **Multi-range:** ag-grid stacks blocks with `\n`, documented as lossy, and replays the
  same matrix into each active range. Excel largely refuses multi-area copy. **We treat
  the clipboard as one matrix and document it.**

## Decisions (locked in brainstorm)

1. **One bulk `onPaste` callback.** Not per-cell `onCellEdit` fan-out (500 cells = 500
   async callbacks + 500 renders + half-applied state on failure).
2. **Excel semantics: anchor + tile + clip.** Single selected cell = anchor, block writes
   down/right. Multi-cell selection: tile when the selection is an exact integer multiple
   of the block in that dimension, else write once from the top-left. Overflow clipped.
3. **Skip rejected cells, apply the rest**, reporting rejections with reasons.
4. **Clip on row overflow, report the clipped count.** No row creation: the grid cannot
   invent row ids under a controlled data model.

## Trigger

A DOM `paste` listener on the surface root, reading
`event.clipboardData.getData("text/plain")`. **Not** `navigator.clipboard.readText()` —
that needs a permission prompt and varies by engine; the paste event carries the data
with no permission at all.

- `preventDefault()` when we handle it.
- **Ignored while a cell editor input is focused** (the editor owns its own paste),
  mirroring the existing ⌘C input guard.
- Inert when `onPaste` is not supplied — paste is opt-in, exactly like `onCellEdit`.

## Pure modules (`packages/react/src/paste.ts`)

Both React-free and unit-tested in isolation.

### `parseTsv(text: string): string[][]`

The exact inverse of `escapeTsvField`. A field starting with `"` is quoted: read to the
closing quote, `""` → `"`, and a quoted field may contain TAB/CR/LF. Handles CRLF, CR,
and LF row separators. **Trims exactly one trailing blank line** (Excel-on-Windows).
Round-trip property tests against `escapeTsvField` are the acceptance bar.

### `mapPasteToTargets(args): { cells, rejected, clippedRows, clippedColumns }`

Pure geometry — no validation, no async:

```ts
interface MapPasteArgs<TRow> {
  matrix: string[][];
  anchor: PretableCellAddress; // selection top-left (or focused cell)
  selectionSize: { rows: number; columns: number }; // 1×1 when a single cell
  visibleRows: readonly PretableVisibleRow<TRow>[];
  columns: readonly PretableColumn<TRow>[]; // data columns; row-select excluded
}
```

- Target area = the block's size anchored at `anchor`, **unless** the selection is larger
  and an exact multiple in a dimension, in which case the block tiles across that
  dimension to fill the selection.
- Rows/columns past the end are dropped and counted into `clippedRows`/`clippedColumns`.
- The synthetic row-select column is excluded from targets entirely.
- **Consistent skip rule:** a target cell that can't be written (non-editable, invalid)
  still _consumes_ its position in the matrix — the block keeps its rectangular shape and
  neighbours don't shift. This is deliberate and documented (ag-grid is inconsistent here).

## Pipeline (surface)

1. Parse the text; bail if the matrix is empty.
2. Map to targets (pure).
3. For each target, coerce via the column's `parseEditValue(raw, input)` when present —
   this inherits the typed-editor work, so number/date/boolean columns produce typed
   values instead of strings. A `parseEditValue` that throws ⇒ rejection
   `reason: "invalid"`.
4. Resolve `editable` (boolean or possibly-async predicate) and `validate` (possibly
   async) for every candidate **in parallel** (`Promise.all`). Non-editable ⇒
   `reason: "not-editable"`; `validate` returning a string ⇒ `reason: "invalid"` with
   that message.
5. Fire `onPaste` once with the survivors.

Concurrency note: a stale-token guard (mirroring `useCellEditController`'s) discards the
result if another paste starts, or the grid's rows/columns change identity, while the
async gate is in flight.

## Public API

```ts
/** @public */
export interface PastedCell<TRow extends PretableRow = PretableRow> {
  rowId: string;
  columnId: string;
  value: unknown;   // post-parseEditValue
  raw: string;      // the clipboard text for this cell
  row: TRow;
}

/** @public */
export interface RejectedPasteCell {
  rowId: string;
  columnId: string;
  raw: string;
  reason: "not-editable" | "invalid";
  message?: string; // validate's message, when it supplied one
}

/** @public */
export interface PastePayload<TRow extends PretableRow = PretableRow> {
  cells: PastedCell<TRow>[];
  rejected: RejectedPasteCell[];
  source: { rows: number; columns: number };  // parsed block shape
  clipped: { rows: number; columns: number }; // dropped past the grid's edges
}

// on PretableSurfaceProps:
onPaste?: (payload: PastePayload<TRow>) => void | Promise<void>;
```

`parseTsv` is exported publicly alongside `serializeRangesAsTsv`/`escapeTsvField` so
consumers can pre-process clipboard text themselves. `mapPasteToTargets` stays internal
until someone asks for it.

## Demo + docs

- **Hero**: `onPaste` wired so a range of Qty cells can be pasted from a spreadsheet,
  reusing the existing guardrail/desk-rejection validation. Rejections surface in the
  existing sidebar messaging rather than a new UI.
- **Docs**: `/docs/grid/paste` (nav-registered next to Editing) covering the trigger,
  Excel semantics with a shape-mismatch table, the rejection contract, the clip-and-report
  overflow policy with a worked "append the rest yourself" snippet, and the TSV format
  (explicitly noting we quote-iff-needed and unescape, unlike ag-grid). Update
  `/docs/grid/clipboard` to link it.

## Testing

- **`parseTsv`**: round-trip against `escapeTsvField` (property-style over generated
  strings with tabs/newlines/quotes), CRLF/CR/LF, quoted fields containing separators,
  `""` unescaping, one-trailing-blank-line trim, ragged rows, empty input.
- **`mapPasteToTargets`**: anchor placement; tile on exact multiples in each dimension
  and both; no tile on non-multiples; clipping counts at both edges; row-select column
  excluded; skip-consumes-position.
- **Surface RTL**: paste event applies and fires `onPaste` with the expected payload;
  non-editable and failing-`validate` cells land in `rejected` while the rest apply;
  `parseEditValue` coercion (a number column yields a number); no `onPaste` prop ⇒ inert;
  paste ignored while an editor input is focused; stale-token guard.
- **Playwright smoke**: a real paste into the hero in both engines — clipboard data
  written via the browser, `⌘/Ctrl+V`, assert the cells changed. This is the one that
  proves the event path works outside jsdom (the right-pin lesson).
- Full sweep + `pnpm api` for the new exports.

## Risks

- **Clipboard in tests.** Playwright clipboard permissions differ per engine; if WebKit
  proves hostile, dispatch a synthetic `ClipboardEvent` with a `DataTransfer` payload —
  still exercises the real listener, and say so in the test rather than pretending it's a
  full OS-clipboard test.
- **Async gate on large blocks.** Thousands of cells each awaiting `validate` could stall;
  `Promise.all` parallelism plus the stale-token guard is the mitigation. If a column's
  `validate` is expensive this is the consumer's cost, and documented as such.
- **`editable` as an async predicate** is legal today; the gate must await it, not
  truthiness-test the function.

## Out of scope

Row creation on overflow (reported, not performed); multi-range reconstruction; cut
(`⌘X`); pasting HTML/rich flavours; undo.
