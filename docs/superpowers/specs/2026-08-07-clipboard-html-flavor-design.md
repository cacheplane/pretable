# Clipboard `text/html` flavor — design

Date: 2026-08-07
Status: approved, ready for planning

## Problem

`serializeRangesAsTsv` (`packages/react/src/copy.ts`) returns only `{ text }`. It
never populates `CopyPayload.html`, even though `defaultCopyToClipboard`
(`packages/react/src/pretable-surface.tsx:100-116`) already writes a `text/html`
clipboard flavor via `ClipboardItem` whenever `html` is present. The HTML half of
the pair has been plumbed but never produced.

Excel and Google Sheets both prefer `text/html` when both flavors are on the
clipboard. Emitting a real `<table>`:

- sidesteps delimiter ambiguity structurally — no reliance on the RFC 4180
  quoting added in PR #204;
- carries per-cell type hints, so a value like `1-2` is not silently
  date-coerced on paste;
- represents wrapped-text line breaks as `<br>` rather than a quoted newline the
  receiving app may or may not unquote;
- resolves the one residual ambiguity PR #204 left open: the `\n\n` separator
  between multi-range blocks can collide with a quoted cell that legally
  contains `\n\n`.

PR #204 fixed TSV escaping and explicitly deferred this as separate work.

## Non-goals

- No change to the `text/plain` flavor. Its bytes stay identical for every input.
- No `data-sheets-value` emission. Google Sheets' equivalent of the Excel type
  hint is proprietary and version-fragile; we do not chase it.
- No new surface prop to disable the HTML flavor (see "Opting out").
- No use of `column.render` in serialization.

## Design

### Payload shape

Every non-null return carries both flavors: `{ text, html }`. When the function
returns `null` (empty selection, no data columns, unresolvable ranges) neither
flavor exists — that path is unchanged.

The HTML is **one `<table>` per range**, concatenated, with a single leading
`<meta charset="utf-8">`:

```html
<meta charset="utf-8"><table style="white-space:pre-wrap"><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>a1</td><td>b1</td></tr></tbody></table>
```

The `<meta>` is belt-and-braces: the `Blob` written by `defaultCopyToClipboard`
carries `type: "text/html"` with no charset parameter.

One table per range — rather than one table with separator rows — because ranges
can legitimately have different column counts, which a single table cannot
represent without ragged rows. It also eliminates the `\n\n` collision
structurally: there is no separator to collide with.

`<thead>` is emitted only when `copyWithHeaders` is true. The TSV's blank
separator line between header and body has no HTML analogue and is not
reproduced. `<tbody>` is always present.

### `white-space:pre-wrap` on `<table>`

This is load-bearing, not decoration. HTML collapses runs of whitespace, so a
cell holding `"a  b"` would paste as `"a b"`. Because the receiving app *prefers*
`text/html`, that would be a silent fidelity regression against today's
TSV-only behavior.

`white-space` is an inherited CSS property, so one attribute on `<table>` covers
every `<th>` and `<td>` without per-cell repetition.

### Escaping and line breaks

A new `escapeHtmlText` helper lives in `copy.ts`, marked `@internal` and exported
for tests — the same treatment `escapeTsvField` gets.

1. Escape `&`, `<`, `>`, `"` to `&amp;`, `&lt;`, `&gt;`, `&quot;`.
   `&` must be replaced first or it double-escapes the other entities.
2. Then replace line breaks — `\r\n`, `\r`, `\n` — with `<br>`. This runs *after*
   escaping so the emitted tag is not itself escaped. A CRLF produces a single
   `<br>`, not two.

Cell text and header text both go through this helper. Neither is ever
interpolated into an attribute value, but `"` is escaped anyway so the helper is
safe if reused.

### Per-cell type hints

Cells from columns with `type: "text"` or `type: "enum"` carry
`style="mso-number-format:'\@'"` — Excel's force-as-text format. Untyped columns
and columns typed `number`, `date`, or `boolean` emit a bare `<td>`.

This makes `column.type` the documented lever for paste-safety and never guesses
on the consumer's behalf. Force-formatting untyped columns as text would catch
the motivating `1-2` case more often but would also left-align genuine numbers in
untyped columns as text strings in Excel.

The backslash in `'\@'` is part of Excel's syntax — `\@` is the escaped
text-format code — so the JavaScript source literal is
`"mso-number-format:'\\@'"`. Dropping the backslash silently disables the hint.

Header cells (`<th>`) never carry the hint — headers are labels, not data.

The hint composes with the table-level `white-space` rule; they live on different
elements, so no style-attribute merging is needed.

Google Sheets ignores `mso-number-format`. That is accepted: Sheets users get the
escaping, `<br>`, and block-separation wins, but not the type hint.

### `format` returns text, never markup

`column.format`'s return value is escaped like any other cell text. A
`format: () => "<b>x</b>"` copies the literal characters `<b>x</b>`; it does not
produce bold text in the pasted cell.

`column.render` (which returns a `ReactNode`) is **not** consulted for the HTML
flavor at all.

Both are behavior contracts and get explicit statements in the docs — they are
the kind of thing a consumer will otherwise assume the other way.

### Rename

`serializeRangesAsTsv` → `serializeRanges`, with **no** backward-compatible
alias. The old name would misdescribe a return value carrying two flavors, and
pretable is pre-1.0 with no external consumers.

Live call sites to update:

| Location | Change |
| --- | --- |
| `packages/react/src/copy.ts` | the definition, plus the `{@link}` in `SerializeRangesArgs`' TSDoc |
| `packages/react/src/pretable-surface.tsx:89` | import |
| `packages/react/src/pretable-surface.tsx:359` | `{@link}` in the `onCopy` TSDoc |
| `packages/react/src/pretable-surface.tsx:1705` | call site |
| `packages/react/src/public_api.ts:53` | re-export |
| `packages/react/src/paste.ts:242` | prose comment |
| `packages/react/src/__tests__/copy.test.ts` | import + all call sites |
| `packages/react/react.api.md` | regenerated via `pnpm api` |
| `apps/website/content/docs/grid/clipboard.mdx` | several |
| `apps/website/content/docs/grid/api-reference.mdx:187` | one mention |
| `apps/website/content/docs/grid/paste.mdx:283` | one mention |

Dated records under `docs/superpowers/plans/` and `docs/superpowers/specs/` are
**not** updated — they describe what was true when written.

`react.api.md` regeneration is mandatory, not optional: the
"API Extractor — report freshness" check is a required gate on main.

### Targeted cleanup

The range-bounds resolution in `copy.ts` (currently lines 101-144 — the
synthetic-row-select-column branch ladder) is extracted into a
`resolveRangeBounds()` helper returning `{ rowLo, rowHi, colLo, colHi } | null`.
Emitting two formats from that loop makes it materially harder to read otherwise,
and it is code this change already touches. No other refactoring.

Both flavors are produced in a **single pass**: the per-cell loop resolves the
cell's text once, then feeds it to `escapeTsvField` and to the HTML cell encoder.

### Opting out

No new prop. A consumer wanting the TSV flavor alone already has:

```tsx
onCopy={(args) => {
  const payload = serializeRanges(args);
  return payload && { text: payload.text };
}}
```

This gets documented rather than given dedicated surface area.

## Interaction with the existing paste path

The grid's own paste handler reads `text/plain` only
(`packages/react/src/pretable-surface.tsx:873`), so adding an HTML flavor cannot
perturb grid→grid round-trips. `parseTsv` remains the exact inverse of
`escapeTsvField`; nothing about the paste contract changes.

## Risk

This changes what actually lands when a user pastes into Excel — HTML wins over
TSV there, so real-world paste behavior shifts even though the `text` bytes are
byte-identical to today's. The `white-space:pre-wrap` decision above is what
makes that shift lossless for whitespace; the escaping and `<br>` rules make it
lossless for delimiters and line breaks. No unit test can fully cover the
receiving-application half of this, which is why the emitted markup is asserted
precisely instead.

## Testing

New cases in `packages/react/src/__tests__/copy.test.ts`, alongside the existing
suites.

`escapeHtmlText` units:

- plain text passes through unchanged; empty string stays empty
- `&`, `<`, `>`, `"` each escape to the right entity
- `&` escapes without double-escaping a following `<`
- `\n`, `\r`, and `\r\n` each produce exactly one `<br>`

`serializeRanges` HTML output:

- single cell, multi-row, and multi-column ranges produce the expected markup
- `<thead>` present when `copyWithHeaders` is true, absent when it is not
- `<table>` carries `white-space:pre-wrap`
- a value of `1-2` in a `type: "text"` column carries `mso-number-format`
- the same value in an untyped column and in a `type: "number"` column does not
- a `type: "enum"` column carries the hint
- a `<th>` never carries the hint
- a cell value containing `<b>` emits `&lt;b&gt;`
- a multi-line cell value emits `<br>` between the lines
- `format` output is escaped as text, not passed through as markup
- a discontiguous two-range selection emits two `<table>` elements
- the synthetic row-select column is absent from the HTML, as it is from the TSV
- a `null` return carries no `html`
- every existing TSV assertion still holds — the `text` bytes do not move

## Documentation

`apps/website/content/docs/grid/clipboard.mdx`:

- reframe the intro: `Cmd/Ctrl+C` writes **two** flavors, and receiving apps
  choose
- new "HTML flavor" section: the markup shape, why it exists (Excel and Sheets
  prefer it), `<br>` for line breaks, the escaping rule, the whitespace rule
- type hints, framed as `column.type` being the lever, with the Sheets caveat
  stated plainly
- the `format`-is-text and `render`-is-not-consulted contracts
- multi-range → one `<table>` per range, added to the existing multi-range
  section
- the opt-out snippet
- the rename applied throughout, including the `onCopy` example

`api-reference.mdx` and `paste.mdx` need the rename only.
