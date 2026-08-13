# CSV export

**Date:** 2026-08-13
**Status:** approved
**Research:** six parallel tracks, primary-sourced. Findings inline; inference marked.

## Why

CSV/file export is the last unbuilt item on the v1 table-stakes list. Every
other ranked gap — cell editing, filter UI and operators, multi-sort,
right-pinned columns, paste, row grouping, theming — has shipped. `grep` for
`csv|downloadRows|toFile|exportRows` in `packages/react/react.api.md` and
`packages/core/core.api.md` returns nothing.

The primitives already exist: `serializeRanges`, `defaultCoerceForCopy`,
`formatDataCellValue`, `formatAggregateValue`, and a compiled
`NumberFormatterRegistry`. This is assembly, not invention.

## The thesis: be the grid that does not lie about what it exported

Every mainstream grid silently ships incomplete files. Verified in source:

|                        | AG Grid SSRM/Infinite | MUI server pagination | MUI lazy loading      |
| ---------------------- | --------------------- | --------------------- | --------------------- |
| Unloaded rows          | Omitted               | Omitted               | **Blank rows**        |
| Row count looks right? | No                    | No                    | **Yes — and it lies** |
| End-user warning       | **None**              | **None**              | **None**              |

AG Grid's `gridSerializer.ts` drops stub rows on a branch whose own comment
reads `node.stub // skip SSRM stub/loading rows` — no counter, no callback, no
log. Its export-selected path does warn, but the warning names
`getSelectedNodes` rather than export, fires once per page load, degrades to a
bare id in production without the ValidationModule, and does not fire at all for
the common case where blocks were never loaded. MUI's lazy-loading path is worse
still: skeleton rows survive `defaultGetRowsToExport` (which filters only
`type !== 'footer'`), so the file carries one row per skeleton with every cell
empty — the row count is right and the data is gone, defeating the one sanity
check a user performs. (That last is source-backed inference; not run.)

Pretable already has the machinery to refuse this. `resolveDataScope`
(`packages/react/src/data-scope.ts`) returns `"all"` only when the grid can
_prove_ it holds everything, degrading to `"loaded"` under external filtering —
the same honesty doctrine that governs `aria-rowcount`. Export inherits it.

Power BI is the precedent for what to do about it: it caps CSV export and
**embeds the warning in the artifact** — "Exported data exceeded the allowed
volume. Some data might have been omitted." In the file, so it survives being
emailed onward.

## Architecture: isomorphic to clipboard

Copy already established the shape for "data out". Export mirrors it exactly
rather than inventing a second idiom.

| Piece            | Clipboard                            | Export                                        |
| ---------------- | ------------------------------------ | --------------------------------------------- |
| Override hook    | `onCopy(args) → CopyPayload \| null` | `onExport(args) → PretableExportFile \| null` |
| Sink             | `copyToClipboard(payload)`           | `saveFile(file)`                              |
| Exported default | `serializeRanges`                    | `serializeCsv`                                |
| Default sink     | `defaultCopyToClipboard`             | `defaultSaveFile`                             |
| A11y             | live-region announcement             | same                                          |

Returning `null` from the hook cancels, as with copy.

### Values

Reuse `formatDataCellValue` / `formatAggregateValue` / the number-formatter
registry. Anything else guarantees the file disagrees with the screen.

### Column order

The **drawn** order from `grid.getColumns()`, row-select column filtered by id —
never the `columns` prop. This is already a test-pinned invariant here after
seven consumers got it wrong, and it is a live defect in MUI, whose export reads
`gridVisibleColumnDefinitionsSelector` and therefore ignores pinning: a
right-pinned column exports in its unpinned position. AG Grid gets this right
via `visibleCols.allCols`.

## Decisions

### Value fidelity — the column's configured format

Default to the formatted value, matching AG Grid (`useValueFormatterForExport`,
default `true`), MUI (`formattedValue`), Syncfusion, and pretable's own
clipboard.

**This does not mean "prettified".** Neither AG Grid nor pretable has a default
formatter — a column without `numberFormat`/`format` exports its raw value
already. "Formatted" means _the formatter the consumer configured_, and
silently discarding that is the larger surprise.

The known cost, documented rather than defaulted around: a grouped number like
`1,234.57` contains the delimiter, so it is quoted, so Excel imports it as text
and the column will not sum.

Escape hatch: `rawValues`, accepting `boolean | { csvExport?: boolean }`.
MUI's per-channel split (CSV vs clipboard) is the right granularity given
pretable already has clipboard; AG Grid's per-column lever is deferred until
asked for.

### Formula escaping — ON, gated on `column.type`

The grid field is split (Telerik, MUI, Jira default on; AG Grid has no option at
all, Handsontable/DevExpress/SheetJS/Google default off) and the split is
recent. What is _not_ split is the failure mode:

- **Atlassian** shipped a naive leading-character check and ate a multi-version
  data-corruption regression — `-1000` exporting as `'-1000` (JRASERVER-77480,
  9.9.0–9.12.2).
- **MUI X has the identical gap today**: `['=','+','-','@','\t','\r'].includes(v[0])`
  with no numeric exemption.
- **CsvHelper** has it in the other direction — `Strip` turns `-10` into `10`
  (#2126, open, maintainer "swamped").

All three guessed from the first character of a stringified value. **Power BI
does not**, and documents why: it escapes only when _"the column is defined as
type 'text' in the data model"_. That is the design, it is shipped by Microsoft,
and pretable can do it because it has typed columns — clipboard already uses
`column.type` as exactly this lever for its Excel text-format hint.

So: escape when `column.type` is `text` or `enum` and the value begins with
`=`, `+`, `-`, `@`, TAB or CR. Never for `number`, `date`, `boolean`. The
USENIX WOOT'25 measurement study supports the gate directly — _"an attack is
impossible if the user only controls numeric values."_

Predicate overridable (papaparse's RegExp escape hatch is the precedent).

**Cost, stated because it is real.** On a value that _is_ escaped, the
apostrophe is not clean anywhere: Excel keeps it in the cell's value,
LibreOffice prepends a second one, OpenOffice strips it and leaves a
re-executable formula, Apple Numbers splits the value across two cells. Use the
apostrophe form regardless — OWASP's tab alternative is worse, since TAB is not
legal `TEXTDATA` in RFC 4180 at all.

### File format

| Decision          | Default                             | Why                                                                                                                                                                                                                                           |
| ----------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Encoding          | UTF-8 **with BOM**, `bom?: boolean` | Microsoft's Power Query doc: _"the character set isn't inferred, and UTF-8 is only inferred if it starts with a UTF-8 BOM."_ Both defaults draw complaints (mui#9545 vs ag#3916); the bug in AG Grid is the **missing flag**, not the default |
| Line endings      | `\r\n`                              | RFC 4180; every reader accepts it                                                                                                                                                                                                             |
| Quoting           | Minimal — delimiter, `"`, CR, LF    | `QUOTE_ALL` destroys the Postgres null/empty convention, and blocks the delimiter-breakout attack no less well                                                                                                                                |
| Escaping          | Doubled `""`                        | RFC 4180 rule 7                                                                                                                                                                                                                               |
| Delimiter         | `,`, `delimiter?: string`           | Excel follows the OS list separator (`;` in de/fr/es/it/nl). Do **not** derive from locale — that makes files non-portable between sender and recipient                                                                                       |
| Header row        | On, `includeHeaders?: boolean`      | Universal                                                                                                                                                                                                                                     |
| Null and empty    | Both → empty field                  | CSV cannot carry the distinction; RFC 4180 assigns no semantics. Do not invent a sentinel                                                                                                                                                     |
| Empty header name | Synthetic stable name               | An empty header collides in pandas _and_ hard-errors in Excel and Postgres — the one choice that fails in all three                                                                                                                           |

### Scope, selection, and groups

- **Rows:** filtered + sorted, all pages, collapsed group children included.
  Both grids agree.
- **Selection: capability yes, default OFF.** `onlySelected?: boolean`. MUI
  infers it and [#10314](https://github.com/mui/mui-x/issues/10314) exists
  because _"people may not realize the export is filtered to selections only"_ —
  closed with no flag shipped; their own print export disagrees with their CSV
  export in the same menu. This is the one behaviour in the survey that has
  actively cost users data unnoticed.
- **Group and aggregate rows:** included, `includeGroupRows?: boolean`,
  `includeAggregateRows?: boolean`. Genuine vendor disagreement (AG Grid
  includes footers, MUI excludes), no user harm either way. Aggregates format
  through `formatAggregateValue`, never `format`.

### Delivery

`Blob` → `URL.createObjectURL` → detached `<a download>` → click → remove →
`revokeObjectURL` on a deferred timeout.

**The decisive constraint is the user-gesture asymmetry.** `<a download>` has no
activation requirement — the HTML spec's only guard is the sandboxed-downloads
flag, and Chromium's `DownloadRequestLimiter` is a _rate_ limit. So a download
survives an `await`. `showSaveFilePicker` is transient-activation-gated and
throws `SecurityError` afterwards; Chrome's own docs say to _"get the file
handle first, and only after obtaining the file handle start processing the
data"_, which would make the user name a file before knowing the export
succeeded.

- MIME `text/csv;charset=utf-8`, and the filename **must** end `.csv`. A
  mismatch is something the HTML spec instructs the UA to "fix" by appending an
  extension — the documented Safari `.txt` complaint. Note AG Grid ships
  `text/plain`, which is a bug waiting to surface.
- **Never `application/octet-stream`** — Chromium special-cases it to map to _no_
  extension, so "force a download" yields an extensionless file.
- Filename `{name}-{YYYYMMDD}T{HHMMSS}Z.csv`. Colons must go: Chromium replaces
  `:` with `_` on **every** OS, including Linux. Sanitize to `[A-Za-z0-9._-]`,
  no leading dot, no trailing dot or space, cap ~200 bytes.

### Scale

Build an array of ~1 MB chunks and hand the array to `new Blob(parts)`.
Measured on V8 at 100k × 20 (41.5 MB):

| Approach          | Time       | Peak heap |
| ----------------- | ---------- | --------- |
| naive `+=`        | 281 ms     | 108 MB    |
| array + join      | 219 ms     | 90 MB     |
| **chunked parts** | **216 ms** | **63 MB** |

Not a micro-optimisation: AG Grid accumulates with `this.result += …` and throws
`RangeError: Invalid string length` at 1M × 45 ([#8070](https://github.com/ag-grid/ag-grid/issues/8070),
closed as invalid), with [#501](https://github.com/ag-grid/ag-grid/issues/501)
reporting it _"fails silently"_ — no error, no download. Free to get right now,
expensive to retrofit.

Yield to the event loop every ~5–10k rows so the UI survives (~220 ms here is
0.7–1.1 s on a mid-range device). The download still works afterwards precisely
because the anchor has no activation window to miss.

## API surface (v1)

```ts
interface PretableCsvOptions {
  delimiter?: string; // ","
  bom?: boolean; // true
  includeHeaders?: boolean; // true
  escapeFormulas?:
    boolean | ((value: string, type?: PretableColumnType) => boolean);
  rawValues?: boolean | { csvExport?: boolean };
  onlySelected?: boolean; // false
  includeGroupRows?: boolean; // true
  includeAggregateRows?: boolean; // true
  columnIds?: readonly string[]; // subset AND order
  fileName?: string | (() => string);
}

interface PretableExportFile {
  blob: Blob;
  fileName: string;
  rowCount: number;
  /** What the grid could prove it had. `"loaded"` means the file is partial. */
  scope: "all" | "loaded";
  complete: boolean;
}

function serializeCsv(args: SerializeCsvArgs): PretableExportFile | null;
function defaultSaveFile(file: PretableExportFile): void;
```

Surface props mirror clipboard: `onExport`, `saveFile`, `csvOptions`.

`serializeCsv` returning the file rather than downloading is the seam that makes
it testable, uploadable, and worker-friendly — Handsontable's `exportAsBlob` /
`exportAsString` are the precedent, and both AG Grid and MUI ship a
`getDataAsCsv` equivalent.

**When `scope === "loaded"`**, `complete` is `false` and the file carries a
trailing comment row naming what was omitted. Never a silent partial file.

## Non-goals

- **`showSaveFilePicker`.** ~27% of users, desktop-Chromium only, Mozilla's
  standards position is "harmful", it breaks after `await`, and it is
  untestable — Playwright cannot drive a native OS dialog, so its failures
  would reach production unobserved.
- **Streaming / service workers.** Not until ~500k rows.
- **Web Workers.** Blocked by user `format` functions not being
  structured-cloneable, not by CPU.
- **XLSX.** The real fix for leading zeros and typed cells, and structurally
  immune to injection — but a separate project.
- **A user-facing formatted-vs-raw toggle.** Not one of eight surveyed grids
  offers a _fidelity_ choice; every export UI is a _format_ choice. This is
  developer configuration.
- `prependContent`/`appendContent`, `suppressQuotes`, column-group header rows,
  locale-derived delimiters, `msSaveBlob`, data URLs.

## Verification

1. **`serializeCsv` as a pure function** is where the real coverage lives:
   quoting, doubled quotes, embedded commas/newlines/CRLF, null vs empty, the
   BOM, formatter application, aggregate rows, and **column order resolved from
   `getColumns()`**.
2. **Assert on `blob.text()` for the Blob you hold — never on anything recovered
   from the object URL.** In jsdom, `URL.createObjectURL` exists and _appears_
   to work, but jsdom's `Blob` is not Node's, so the store holds the string
   `"undefined"`: `resolveObjectURL(url).text()` returns `"undefined"` while the
   MIME type survives. A test that round-trips through the URL can pass while
   asserting against garbage. **An assertion that survives the bytes being
   replaced by `"undefined"` is not an assertion.**
3. **Theatre to refuse:** spying on `createObjectURL`; asserting an anchor was
   created with the right `download` and `.click()` called. Both survive the CSV
   body being blanked. jsdom cannot download.
4. **Playwright verifies delivery** — `waitForEvent('download')` started
   _before_ the click, then `download.path()`, parse the CSV, assert cell
   values. `suggestedFilename()` validates the filename end to end. Gate on
   `data-pretable-hydrated` first.
5. Mutation-test every check, per this project's standard.

## Traps recorded

- **`@pretable/react` ships no `"use client"` anywhere.** Export doesn't create
  that problem but widens it. Keep all browser access inside function bodies —
  `'use client'` does _not_ mean browser-only (client modules execute during
  SSR), and `client-only` does not protect against SSR either; it guards the RSC
  graph only.
- **Never compute capability at module scope.**
  `const CAN_SAVE = typeof window !== "undefined" && ...` evaluates safely and
  yields different values on server and client — a hydration mismatch if it
  feeds render.
- **`Content-Security-Policy: sandbox`** as a response header kills downloads
  document-wide, silently, with no error or event. No CSP _fetch_ directive
  applies; `navigate-to` was removed from the spec in 2022.
- **Chrome prompts on the second download per tab.** Scrolling does not reset
  the counter. One click, one file — multi-file export needs a zip.
