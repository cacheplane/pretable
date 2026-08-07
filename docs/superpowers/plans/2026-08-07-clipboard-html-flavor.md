# Clipboard `text/html` Flavor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the grid's copy serializer emit a real `<table>` on the `text/html` clipboard flavor alongside the existing TSV, so pastes into Excel and Sheets carry structure, line breaks, and type hints instead of relying on delimiter quoting.

**Architecture:** `packages/react/src/copy.ts` already walks each selected range cell-by-cell to build TSV. That single walk now feeds two encoders: `escapeTsvField` (unchanged) and a new `escapeHtmlText`. Each range becomes its own `<table>`; the tables concatenate behind one `<meta charset="utf-8">`. The gnarly range-bounds branch ladder gets extracted to a helper first so the dual-emit loop stays readable. `serializeRangesAsTsv` is renamed to `serializeRanges` with no alias.

**Tech Stack:** TypeScript, React, vitest (jsdom), api-extractor, Next.js MDX docs.

**Spec:** `docs/superpowers/specs/2026-08-07-clipboard-html-flavor-design.md`

---

## Background for the implementer

You need three facts about this repo before you start.

**1. The public API is gated.** `packages/react/react.api.md` is a generated report. CI runs `api:check` as a **required** status on main, so any change to an exported signature must be followed by `pnpm api` and the regenerated report committed. Forgetting this blocks the merge.

**2. There is no backward compatibility to preserve.** pretable is pre-1.0 with no external consumers. When this plan says rename, it means rename — do not leave a deprecated alias behind.

**3. Local test runs are flaky under load; targeted runs are not.** A full `pnpm --filter @pretable/react test` on a loaded machine times out 1–2 random unrelated tests. That is a known local artifact, not your bug. Use the targeted command below for iteration and only run the full suite at the end.

### Commands

Warm the dependency `dist/` directories once at the start (the react test script builds four workspace packages before running vitest):

```bash
pnpm --filter @pretable/react test
```

After that, iterate with the targeted run — seconds instead of minutes, and immune to the load flake:

```bash
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/copy.test.ts
```

Typecheck:

```bash
pnpm --filter @pretable/react typecheck
```

Regenerate the API report:

```bash
pnpm --filter @pretable/react api
```

---

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `packages/react/src/copy.ts` | Clipboard serialization: value coercion, TSV escaping, HTML escaping, range-bounds resolution, dual-flavor emit | Modify |
| `packages/react/src/__tests__/copy.test.ts` | Unit coverage for all of the above | Modify |
| `packages/react/src/pretable-surface.tsx` | Calls the serializer; writes both flavors to the clipboard (already implemented) | Modify (rename only) |
| `packages/react/src/public_api.ts` | Re-exports the public surface | Modify (rename only) |
| `packages/react/src/paste.ts` | Paste parsing; one prose comment references the old name | Modify (comment only) |
| `packages/react/react.api.md` | Generated API report | Regenerate |
| `apps/website/content/docs/grid/clipboard.mdx` | Copy documentation | Modify (substantial) |
| `apps/website/content/docs/grid/api-reference.mdx` | Type index | Modify (rename only) |
| `apps/website/content/docs/grid/paste.mdx` | Paste documentation | Modify (rename only) |

`copy.ts` grows from ~180 to ~260 lines. That stays within the file's single responsibility — clipboard serialization — so it is not split.

Dated records under `docs/superpowers/plans/` and `docs/superpowers/specs/` describe what was true when written and are **not** updated by this plan.

---

## Task 1: Rename `serializeRangesAsTsv` → `serializeRanges`

This goes first so every test written in later tasks uses the final name.

**Files:**
- Modify: `packages/react/src/copy.ts:11`, `packages/react/src/copy.ts:88`
- Modify: `packages/react/src/pretable-surface.tsx:89`, `:359`, `:1705`
- Modify: `packages/react/src/public_api.ts:53`
- Modify: `packages/react/src/paste.ts:242`
- Modify: `packages/react/src/__tests__/copy.test.ts` (import + all call sites)
- Regenerate: `packages/react/react.api.md`

- [ ] **Step 1: Rename across the live source tree**

Run:

```bash
grep -rl "serializeRangesAsTsv" packages/react/src packages/react/react.api.md apps/website/content | xargs sed -i '' 's/serializeRangesAsTsv/serializeRanges/g'
```

This deliberately excludes `docs/superpowers/` — those are dated records.

- [ ] **Step 2: Verify no live references remain**

Run:

```bash
grep -rn "serializeRangesAsTsv" packages apps --include="*.ts" --include="*.tsx" --include="*.mdx" --include="*.md" | grep -v node_modules | grep -v "/dist/"
```

Expected: no output.

- [ ] **Step 3: Update the docstring, which still says "tab-separated"**

In `packages/react/src/copy.ts`, the TSDoc above `serializeRanges` currently opens:

```
 * Serialize one or more `PretableCellRange`s to a tab-separated text + HTML payload suitable for clipboard write.
```

Leave that line alone for now — Task 4 rewrites this whole docblock once the HTML flavor actually exists. Renaming it twice is churn.

- [ ] **Step 4: Run the targeted tests**

Run: `pnpm --filter @pretable/react test`

Expected: PASS. (This is the one full run — it also warms the dependency `dist/` directories for later tasks.)

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @pretable/react typecheck`

Expected: no errors.

- [ ] **Step 6: Regenerate the API report**

Run: `pnpm --filter @pretable/react api`

Then confirm the report moved:

```bash
git diff --stat packages/react/react.api.md
```

Expected: the file shows a change. `sed` already rewrote the name in it, so this run should be a no-op confirming agreement — if `api` produces *additional* changes, that is fine and expected to be committed.

- [ ] **Step 7: Commit**

```bash
git add -A packages/react apps/website
git commit -m "refactor(react)!: rename serializeRangesAsTsv to serializeRanges"
```

---

## Task 2: `escapeHtmlText` helper

**Files:**
- Modify: `packages/react/src/copy.ts` (add after `escapeTsvField`)
- Test: `packages/react/src/__tests__/copy.test.ts`

- [ ] **Step 1: Write the failing tests**

Add this block at the end of `packages/react/src/__tests__/copy.test.ts`:

```ts
describe("escapeHtmlText", () => {
  it("passes ordinary text through unchanged", () => {
    expect(escapeHtmlText("")).toBe("");
    expect(escapeHtmlText("plain")).toBe("plain");
    expect(escapeHtmlText("has spaces")).toBe("has spaces");
    expect(escapeHtmlText("a,b;c'd\te")).toBe("a,b;c'd\te");
  });

  it("escapes the four markup-significant characters", () => {
    expect(escapeHtmlText("&")).toBe("&amp;");
    expect(escapeHtmlText("<")).toBe("&lt;");
    expect(escapeHtmlText(">")).toBe("&gt;");
    expect(escapeHtmlText('"')).toBe("&quot;");
  });

  it("escapes a full tag", () => {
    expect(escapeHtmlText("<b>bold</b>")).toBe("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("escapes & first so following entities are not double-escaped", () => {
    // Regression guard: replacing < before & yields "&amp;lt;" here.
    expect(escapeHtmlText("&<")).toBe("&amp;&lt;");
    expect(escapeHtmlText("&amp;")).toBe("&amp;amp;");
  });

  it("converts each line-break form to exactly one <br>", () => {
    expect(escapeHtmlText("a\nb")).toBe("a<br>b");
    expect(escapeHtmlText("a\rb")).toBe("a<br>b");
    expect(escapeHtmlText("a\r\nb")).toBe("a<br>b");
  });

  it("does not escape the <br> it just emitted", () => {
    // Regression guard: converting newlines before escaping produces "&lt;br&gt;".
    expect(escapeHtmlText("<i>\n</i>")).toBe("&lt;i&gt;<br>&lt;/i&gt;");
  });
});
```

And extend the import at the top of the file to include `escapeHtmlText`:

```ts
import {
  defaultCoerceForCopy,
  escapeHtmlText,
  escapeTsvField,
  serializeRanges,
  type SerializeRangesArgs,
} from "../copy";
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/copy.test.ts`

Expected: FAIL — `escapeHtmlText is not a function` (or a TS resolution error on the import).

- [ ] **Step 3: Implement**

In `packages/react/src/copy.ts`, immediately after the `escapeTsvField` function, add:

```ts
/**
 * Escape one already-stringified field for the HTML clipboard flavor.
 *
 * Two passes, in this order:
 *
 * 1. `&`, `<`, `>`, `"` become entities. `&` must go first or it
 *    double-escapes the entities the later replacements produce.
 * 2. Line breaks (CRLF, CR, LF) become a single `<br>` each. This runs after
 *    escaping so the emitted tag survives instead of becoming `&lt;br&gt;`.
 *
 * `"` is escaped even though cell text is only ever emitted into a text node,
 * so the helper stays safe if it is later reused for an attribute value.
 *
 * @internal
 */
export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r\n|\r|\n/g, "<br>");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/copy.test.ts`

Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/copy.ts packages/react/src/__tests__/copy.test.ts
git commit -m "feat(react): add escapeHtmlText for the clipboard HTML flavor"
```

---

## Task 3: Extract `resolveRangeBounds`

Pure refactor. No test changes — the existing suite is the safety net, and it must stay green from start to finish.

**Files:**
- Modify: `packages/react/src/copy.ts:101-144` (the branch ladder inside the range loop)

- [ ] **Step 1: Confirm the suite is green before touching anything**

Run: `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/copy.test.ts`

Expected: PASS. If it is not green here, stop — you are about to refactor on top of a broken baseline.

- [ ] **Step 2: Add the helper above `serializeRanges`**

In `packages/react/src/copy.ts`, insert before the `serializeRanges` docblock:

```ts
interface RangeBounds {
  rowLo: number;
  rowHi: number;
  colLo: number;
  colHi: number;
}

/**
 * Resolve one range's id-based bounds to inclusive row/column indices, or
 * `null` when the range addresses nothing emittable.
 *
 * The synthetic row-select column is positioned BEFORE all data columns in
 * `effectiveColumns`. When it appears as a range bound it logically means
 * "start of the visible row", so it translates to the first data column. A
 * range whose *both* ends are the synthetic column has no data to emit.
 */
function resolveRangeBounds(
  range: PretableCellRange,
  rowIndex: ReadonlyMap<string, number>,
  colIndex: ReadonlyMap<string, number>,
  dataColumnCount: number,
): RangeBounds | null {
  const startRow = rowIndex.get(range.startRowId);
  const endRow = rowIndex.get(range.endRowId);
  if (startRow === undefined || endRow === undefined) return null;
  const rowLo = Math.min(startRow, endRow);
  const rowHi = Math.max(startRow, endRow);

  const startIsSynth = range.startColumnId === ROW_SELECT_COLUMN_ID;
  const endIsSynth = range.endColumnId === ROW_SELECT_COLUMN_ID;
  const startCol = colIndex.get(range.startColumnId);
  const endCol = colIndex.get(range.endColumnId);

  let colLo: number;
  let colHi: number;
  if (startIsSynth && endIsSynth) {
    return null;
  } else if (startIsSynth && endCol !== undefined) {
    colLo = 0;
    colHi = endCol;
  } else if (endIsSynth && startCol !== undefined) {
    colLo = startCol;
    colHi = 0;
  } else if (startCol !== undefined && endCol !== undefined) {
    colLo = Math.min(startCol, endCol);
    colHi = Math.max(startCol, endCol);
  } else if (startCol !== undefined) {
    colLo = colHi = startCol;
  } else if (endCol !== undefined) {
    colLo = colHi = endCol;
  } else {
    return null;
  }

  if (colLo > colHi) {
    [colLo, colHi] = [colHi, colLo];
  }
  colLo = Math.max(colLo, 0);
  colHi = Math.min(colHi, dataColumnCount - 1);
  if (colLo > colHi) return null;

  return { rowLo, rowHi, colLo, colHi };
}
```

- [ ] **Step 3: Replace the inline ladder with a call**

In `serializeRanges`, delete everything from `const startRow = rowIndex.get(range.startRowId);` through `if (!haveRows || rowLo > rowHi) continue;` — the whole block currently spanning lines 102-144 — and replace it with:

```ts
    const bounds = resolveRangeBounds(
      range,
      rowIndex,
      colIndex,
      dataColumns.length,
    );
    if (!bounds) continue;
    const { rowLo, rowHi, colLo, colHi } = bounds;
```

Everything below (the `const lines: string[] = []` header/body emit) is unchanged and still references `rowLo`, `rowHi`, `colLo`, `colHi`.

- [ ] **Step 4: Run the tests — this must be green with zero test edits**

Run: `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/copy.test.ts`

Expected: PASS, same count as Step 1. If any test changed status, the extraction changed behavior — revert and redo it rather than adjusting the test.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @pretable/react typecheck`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/copy.ts
git commit -m "refactor(react): extract resolveRangeBounds from the copy range loop"
```

---

## Task 4: Emit the HTML flavor

**Files:**
- Modify: `packages/react/src/copy.ts` (the emit loop and the return)
- Test: `packages/react/src/__tests__/copy.test.ts`

- [ ] **Step 1: Loosen the existing TSV assertions so they survive a second flavor**

Fourteen existing assertions use `expect(out).toEqual({ text: "..." })`. Once `html` is present those fail on the extra key — but the TSV bytes must not move, so the assertions have to keep asserting the exact same strings.

In `packages/react/src/__tests__/copy.test.ts`, change every `expect(out).toEqual({ text: X })` to `expect(out?.text).toBe(X)`. Do **not** touch the `expect(out).toBeNull()` assertions.

In `describe("serializeRanges escaping")`, the `oneCell` helper's callers use the same pattern — `expect(oneCell(...)).toEqual({ text: X })` becomes `expect(oneCell(...)?.text).toBe(X)`.

Run: `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/copy.test.ts`

Expected: PASS — this edit alone changes no behavior.

- [ ] **Step 2: Write the failing HTML tests**

Append to `packages/react/src/__tests__/copy.test.ts`:

```ts
const META = '<meta charset="utf-8">';
const TABLE_OPEN = '<table style="white-space:pre-wrap">';

describe("serializeRanges HTML flavor", () => {
  it("wraps a single cell in a table with the whitespace rule", () => {
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "a")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
    });
    expect(out?.html).toBe(
      `${META}${TABLE_OPEN}<tbody><tr><td>a1</td></tr></tbody></table>`,
    );
  });

  it("emits one tr per row and one td per column", () => {
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r2", "a", "b")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
    });
    expect(out?.html).toBe(
      `${META}${TABLE_OPEN}<tbody>` +
        "<tr><td>a1</td><td>b1</td></tr>" +
        "<tr><td>a2</td><td>b2</td></tr>" +
        "</tbody></table>",
    );
  });

  it("omits thead when copyWithHeaders is false", () => {
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "b")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
    });
    expect(out?.html).not.toContain("<thead>");
  });

  it("emits thead when copyWithHeaders is true", () => {
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "b")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
      copyWithHeaders: true,
    });
    expect(out?.html).toBe(
      `${META}${TABLE_OPEN}` +
        "<thead><tr><th>A</th><th>B</th></tr></thead>" +
        "<tbody><tr><td>a1</td><td>b1</td></tr></tbody></table>",
    );
  });

  it("emits one table per range for a discontiguous selection", () => {
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "a"), range("r3", "r3", "c", "c")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
    });
    // The separate tables are what resolve the \n\n block-separator ambiguity:
    // there is no separator token left to collide with cell content.
    expect(out?.html).toBe(
      `${META}` +
        `${TABLE_OPEN}<tbody><tr><td>a1</td></tr></tbody></table>` +
        `${TABLE_OPEN}<tbody><tr><td>c3</td></tr></tbody></table>`,
    );
    expect(out?.html.match(/<table/g)).toHaveLength(2);
  });

  it("emits the meta charset exactly once", () => {
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "a"), range("r3", "r3", "c", "c")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
    });
    expect(out?.html.match(/<meta/g)).toHaveLength(1);
  });

  it("escapes markup in cell values", () => {
    const row: Row = { id: "r1", a: "<b>x</b> & y", b: "b1", c: "c1" };
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "a")],
      visibleRows: makeVisibleRows([row]),
      columns: baseColumns,
    });
    expect(out?.html).toContain("<td>&lt;b&gt;x&lt;/b&gt; &amp; y</td>");
  });

  it("escapes markup in header values", () => {
    const cols: PretableColumn<Row>[] = [{ id: "a", header: "<A>" }];
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "a")],
      visibleRows: makeVisibleRows(rows),
      columns: cols,
      copyWithHeaders: true,
    });
    expect(out?.html).toContain("<th>&lt;A&gt;</th>");
  });

  it("renders a multi-line cell as <br>, not a quoted newline", () => {
    const row: Row = { id: "r1", a: "line one\nline two", b: "b1", c: "c1" };
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "a")],
      visibleRows: makeVisibleRows([row]),
      columns: baseColumns,
    });
    expect(out?.html).toContain("<td>line one<br>line two</td>");
    // The TSV flavor still quotes it — the two encodings are independent.
    expect(out?.text).toBe('"line one\nline two"');
  });

  it("treats format output as text, not markup", () => {
    const cols: PretableColumn<Row>[] = [
      { id: "a", header: "A", format: () => "<b>bold</b>" },
    ];
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "a")],
      visibleRows: makeVisibleRows(rows),
      columns: cols,
    });
    expect(out?.html).toContain("<td>&lt;b&gt;bold&lt;/b&gt;</td>");
  });

  it("excludes the synthetic row-select column, as the TSV does", () => {
    const cols: PretableColumn<Row>[] = [
      { id: ROW_SELECT_COLUMN_ID, header: "" },
      ...baseColumns,
    ];
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", ROW_SELECT_COLUMN_ID, "c")],
      visibleRows: makeVisibleRows(rows),
      columns: cols,
      copyWithHeaders: true,
    });
    expect(out?.html).toBe(
      `${META}${TABLE_OPEN}` +
        "<thead><tr><th>A</th><th>B</th><th>C</th></tr></thead>" +
        "<tbody><tr><td>a1</td><td>b1</td><td>c1</td></tr></tbody></table>",
    );
  });

  it("carries no html when the selection serializes to null", () => {
    const out = serializeRanges<Row>({
      ranges: [],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
    });
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/copy.test.ts`

Expected: FAIL — the new suite reports `undefined` for `out?.html` on every case.

- [ ] **Step 4: Implement the dual emit**

In `packages/react/src/copy.ts`, replace the body of `serializeRanges` from `const blocks: string[] = [];` through the final `return` with:

```ts
  const textBlocks: string[] = [];
  const htmlTables: string[] = [];

  for (const range of args.ranges) {
    const bounds = resolveRangeBounds(
      range,
      rowIndex,
      colIndex,
      dataColumns.length,
    );
    if (!bounds) continue;
    const { rowLo, rowHi, colLo, colHi } = bounds;

    const lines: string[] = [];
    let headHtml = "";

    if (args.copyWithHeaders) {
      const headerCells: string[] = [];
      let headerRowHtml = "";
      for (let c = colLo; c <= colHi; c += 1) {
        const col = dataColumns[c]!;
        const header = col.header ?? col.id;
        headerCells.push(escapeTsvField(header));
        headerRowHtml += `<th>${escapeHtmlText(header)}</th>`;
      }
      lines.push(headerCells.join("\t"));
      lines.push("");
      headHtml = `<thead><tr>${headerRowHtml}</tr></thead>`;
    }

    let bodyHtml = "";
    for (let r = rowLo; r <= rowHi; r += 1) {
      const row = args.visibleRows[r]!;
      const cells: string[] = [];
      let rowHtml = "";
      for (let c = colLo; c <= colHi; c += 1) {
        const col = dataColumns[c]!;
        const raw = col.value
          ? col.value(row.row)
          : (row.row as Record<string, unknown>)[col.id];
        const text = col.format
          ? col.format({ value: raw, row: row.row, column: col })
          : defaultCoerceForCopy(raw);
        cells.push(escapeTsvField(text));
        rowHtml += `<td>${escapeHtmlText(text)}</td>`;
      }
      lines.push(cells.join("\t"));
      bodyHtml += `<tr>${rowHtml}</tr>`;
    }

    textBlocks.push(lines.join("\n"));
    htmlTables.push(
      `${HTML_TABLE_OPEN}${headHtml}<tbody>${bodyHtml}</tbody></table>`,
    );
  }

  if (textBlocks.length === 0) return null;

  return {
    text: textBlocks.join("\n\n"),
    html: `${HTML_META}${htmlTables.join("")}`,
  };
}
```

Add these two module constants near the top of the file, after the imports:

```ts
// The Blob written by defaultCopyToClipboard carries `type: "text/html"` with
// no charset parameter, so state it in the payload itself.
const HTML_META = '<meta charset="utf-8">';

// `white-space` is an inherited property, so one declaration on the table
// covers every th/td. Without it HTML collapses runs of spaces and a cell
// holding "a  b" would paste as "a b" — a silent regression against the TSV
// flavor, since receiving apps prefer text/html when both are present.
const HTML_TABLE_OPEN = '<table style="white-space:pre-wrap">';
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/copy.test.ts`

Expected: PASS, all suites — including every pre-existing TSV assertion.

- [ ] **Step 6: Update the `serializeRanges` docblock**

Replace the TSDoc above `serializeRanges` with:

```ts
/**
 * Serialize one or more `PretableCellRange`s to a two-flavor clipboard payload.
 *
 * `text` is TSV: tab-separated cells, newline-separated rows, blocks joined by
 * a blank line, every field escaped with {@link escapeTsvField}.
 *
 * `html` is a real `<table>` per range, concatenated behind a single
 * `<meta charset="utf-8">`. Excel and Google Sheets both prefer `text/html`
 * when both flavors are on the clipboard, and the table form sidesteps
 * delimiter ambiguity structurally: line breaks become `<br>` rather than a
 * quoted newline, and separate ranges become separate tables rather than
 * relying on a `\n\n` separator that a cell could legally contain.
 *
 * Cell text is escaped, never interpreted — a `column.format` returning
 * `<b>x</b>` copies those literal characters. `column.render` is not consulted.
 *
 * @public
 */
```

- [ ] **Step 7: Typecheck and regenerate the API report**

Run:

```bash
pnpm --filter @pretable/react typecheck && pnpm --filter @pretable/react api
```

Expected: no type errors. The report may be unchanged — the exported signature (`CopyPayload | null`) did not move, only which fields get populated.

- [ ] **Step 8: Commit**

```bash
git add packages/react
git commit -m "feat(react): emit a text/html table flavor from serializeRanges"
```

---

## Task 5: Per-cell type hints

**Files:**
- Modify: `packages/react/src/copy.ts` (import `ColumnType`, add `cellStyleAttr`, use it in the body loop)
- Test: `packages/react/src/__tests__/copy.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/react/src/__tests__/copy.test.ts`:

```ts
describe("serializeRanges HTML type hints", () => {
  // Excel's force-as-text format code. The backslash is part of Excel's
  // syntax (\@ is the escaped text-format code), so the JS literal doubles it.
  const TEXT_HINT = " style=\"mso-number-format:'\\@'\"";

  function oneTypedCell(
    value: string,
    type: PretableColumn<Row>["type"],
  ): string {
    const row: Row = { id: "r1", a: value, b: "b1", c: "c1" };
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "a")],
      visibleRows: makeVisibleRows([row]),
      columns: [{ id: "a", header: "A", type }],
    });
    return out?.html ?? "";
  }

  it("hints a text column so Excel does not date-coerce 1-2", () => {
    expect(oneTypedCell("1-2", "text")).toContain(
      `<td${TEXT_HINT}>1-2</td>`,
    );
  });

  it("hints an enum column — its labels are text too", () => {
    expect(oneTypedCell("1-2", "enum")).toContain(
      `<td${TEXT_HINT}>1-2</td>`,
    );
  });

  it("leaves an untyped column bare rather than guessing", () => {
    expect(oneTypedCell("1-2", undefined)).toContain("<td>1-2</td>");
  });

  it("leaves number, date, and boolean columns bare", () => {
    expect(oneTypedCell("42", "number")).toContain("<td>42</td>");
    expect(oneTypedCell("2026-01-02", "date")).toContain(
      "<td>2026-01-02</td>",
    );
    expect(oneTypedCell("true", "boolean")).toContain("<td>true</td>");
  });

  it("never hints a header cell — headers are labels, not data", () => {
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "a")],
      visibleRows: makeVisibleRows(rows),
      columns: [{ id: "a", header: "A", type: "text" }],
      copyWithHeaders: true,
    });
    expect(out?.html).toContain("<th>A</th>");
    expect(out?.html).not.toContain(`<th${TEXT_HINT}>`);
  });

  it("keeps the table-level whitespace rule alongside the cell hint", () => {
    const html = oneTypedCell("a  b", "text");
    expect(html).toContain('<table style="white-space:pre-wrap">');
    expect(html).toContain(`<td${TEXT_HINT}>a  b</td>`);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/copy.test.ts`

Expected: FAIL on the text/enum cases — they render `<td>1-2</td>` with no style attribute. The untyped/number/date/boolean cases already pass, which is correct: they assert the status quo.

- [ ] **Step 3: Implement**

Extend the type import at the top of `packages/react/src/copy.ts`:

```ts
import type {
  ColumnType,
  PretableCellRange,
  PretableRow,
  PretableVisibleRow,
} from "@pretable/core";
```

Add near the other module constants:

```ts
// Excel's force-as-text number format. The backslash is Excel's own syntax —
// `\@` is the escaped text-format code — so dropping it silently disables the
// hint. Google Sheets ignores this property; its equivalent is the proprietary
// and version-fragile data-sheets-value, which we deliberately do not emit.
const HTML_TEXT_FORMAT_ATTR = ` style="mso-number-format:'\\@'"`;

/**
 * Attribute string for one body cell.
 *
 * Only columns explicitly typed `text` or `enum` are pinned to text format.
 * Untyped columns are left bare on purpose: forcing text there would catch
 * more date-coercion cases but would also left-align genuine numbers as
 * strings. `column.type` is the documented lever.
 */
function cellStyleAttr(type: ColumnType | undefined): string {
  return type === "text" || type === "enum" ? HTML_TEXT_FORMAT_ATTR : "";
}
```

Then in the body loop, change the `<td>` emit line from:

```ts
        rowHtml += `<td>${escapeHtmlText(text)}</td>`;
```

to:

```ts
        rowHtml += `<td${cellStyleAttr(col.type)}>${escapeHtmlText(text)}</td>`;
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/copy.test.ts`

Expected: PASS, all suites.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @pretable/react typecheck`

Expected: no errors.

- [ ] **Step 6: Full suite and lint**

Run:

```bash
pnpm --filter @pretable/react test && pnpm --filter @pretable/react lint
```

Expected: PASS. If 1–2 unrelated tests time out, re-run — that is the known local load flake, not a regression. Confirm by re-running just the reported file.

- [ ] **Step 7: Commit**

```bash
git add packages/react
git commit -m "feat(react): pin text and enum columns to text format in the HTML flavor"
```

---

## Task 6: Documentation

**Files:**
- Modify: `apps/website/content/docs/grid/clipboard.mdx`
- Verify: `apps/website/content/docs/grid/api-reference.mdx`, `apps/website/content/docs/grid/paste.mdx` (Task 1's `sed` already renamed these; confirm the surrounding prose still reads correctly)

- [ ] **Step 1: Rewrite the page opening**

Replace the paragraph on line 8 (`Cmd/Ctrl+C copies the current selection as TSV. …`) with:

```mdx
`Cmd/Ctrl+C` copies the current selection in **two flavors**: `text/plain` (TSV) and `text/html` (a real `<table>`). Both are written in a single clipboard entry, and the receiving application picks. Plain-text targets — a terminal, a code editor — take the TSV; Excel and Google Sheets both prefer the HTML. The synthetic row-select column is filtered out of both, so a copy from a checkbox-enabled grid produces the same output as the same selection from an unchecked grid.
```

Also update the frontmatter `description` to:

```mdx
description: "Cmd+C copy with TSV and HTML clipboard flavors, per-column format, grid-level onCopy override."
```

- [ ] **Step 2: Add the HTML flavor section**

Insert this immediately after the `### Escaping` section (after the current line 31, before `## Per-column format`):

````mdx
## HTML flavor

Alongside the TSV, every copy writes a `text/html` flavor: one `<table>` per selected range, concatenated behind a single `<meta charset="utf-8">`.

```html
<meta charset="utf-8"><table style="white-space:pre-wrap"><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>a1</td><td>b1</td></tr></tbody></table>
```

Excel and Sheets both prefer `text/html` when both flavors are present, so in practice this is what lands when someone pastes into a spreadsheet. It buys three things the TSV cannot:

- **Structure instead of delimiters.** Cell boundaries are `<td>` elements, so there is no quoting rule for a receiving app to get wrong.
- **Real line breaks.** A wrapped, multi-line cell emits `<br>` rather than a quoted newline the other application may or may not unquote.
- **No block-separator ambiguity.** Discontiguous ranges become separate `<table>` elements, so nothing has to encode "new block" as a `\n\n` that a cell could legally contain.

`<thead>` appears only when [`copyWithHeaders`](#copywithheaders) is on. The blank line the TSV puts between headers and body has no HTML analogue and is not reproduced.

The `white-space:pre-wrap` on the table is not cosmetic. HTML collapses runs of whitespace, so without it a cell holding `a  b` would paste as `a b`. It sits on the `<table>` because `white-space` inherits, covering every cell with one declaration.

### Escaping and markup

Cell and header text is escaped — `&`, `<`, `>`, and `"` become entities — and then line breaks become `<br>`. Text is never interpreted as markup:

- A cell value of `<b>x</b>` copies those literal characters. It does not paste as bold text.
- The same holds for [`format`](#per-column-format) output. `format` returns **text**, not HTML. Returning `"<b>x</b>"` from it gets escaped exactly like any other value.
- [`render`](/docs/grid/cell-renderers) is not consulted at all. It returns a `ReactNode` for on-screen display; the clipboard uses `format` (or the default coercion) for both flavors.

### Type hints

A cell from a column declared `type: "text"` or `type: "enum"` carries Excel's force-as-text format:

```html
<td style="mso-number-format:'\@'">1-2</td>
```

This is what stops Excel from silently reading `1-2` as a date, or `007` as the number `7`. Declare `type` on columns whose values are text that merely *looks* numeric — SKUs, part numbers, version strings, zero-padded ids:

```tsx
{ id: "sku", header: "SKU", type: "text" }
```

Columns typed `number`, `date`, or `boolean` emit a bare `<td>` so the spreadsheet can parse them as their real type. **Untyped columns also emit a bare `<td>`** — the grid does not guess, because force-formatting an untyped column would turn genuine numbers into left-aligned text. `type` is the lever.

Google Sheets ignores `mso-number-format`. Sheets users get the structure, escaping, and `<br>` benefits, but not the type hint; its equivalent is a proprietary, version-fragile attribute that Pretable deliberately does not emit.

### Opting out

To write TSV only, drop the `html` field in [`onCopy`](#grid-level-oncopy-override):

```tsx
<PretableSurface
  onCopy={(args) => {
    const payload = serializeRanges(args);
    return payload && { text: payload.text };
  }}
  /* ... */
/>
```
````

- [ ] **Step 3: Update the `onCopy` section's payload description**

The bullet on line 76 currently reads:

```mdx
- `{ text, html? }` — `text` is written as `text/plain`; when `html` is present, the surface also writes `text/html` via the Clipboard API. Excel and Sheets prefer `text/html` when both are present.
```

Replace with:

```mdx
- `{ text, html? }` — `text` is written as `text/plain`; when `html` is present, the surface also writes `text/html` via the Clipboard API. Excel and Sheets prefer `text/html` when both are present. The built-in serializer always populates both — see [HTML flavor](#html-flavor).
```

And in the `onCopy` code example, the comment `// Reuse the built-in TSV, but write CSV instead.` now produces a payload with no HTML flavor. Extend it:

```tsx
    // Reuse the built-in TSV, but write CSV instead. Returning only `text`
    // drops the HTML flavor — see "Opting out" above.
    return { text: tsv.text.replace(/\t/g, ",") };
```

- [ ] **Step 4: Update the "Building your own serializer" opener**

Line 83 currently names three exports. Confirm it reads `serializeRanges` after Task 1's rename, and append a sentence:

```mdx
A custom serializer owns both flavors: return `{ text }` alone and only `text/plain` reaches the clipboard.
```

- [ ] **Step 5: Extend the multi-range section**

After the paragraph on line 139 (`Each block is its own TSV grid; range order matches the order the ranges were added. With copyWithHeaders, the header row is repeated at the top of each block.`), add:

```mdx
On the [HTML flavor](#html-flavor) the same selection becomes one `<table>` per range, in the same order. That is the structural version of the same idea — and it is why the HTML flavor has no block-separator ambiguity: with `copyWithHeaders`, each table gets its own `<thead>`.
```

- [ ] **Step 6: Update the Paste cross-reference**

The paragraph on line 169 says `parseTsv` is the exact inverse of the escaping rule. It still is — paste reads `text/plain` only. Make that explicit by appending to that paragraph:

```mdx
Paste reads the `text/plain` flavor, so the HTML flavor never affects a grid-to-grid round-trip.
```

- [ ] **Step 7: Verify the docs build and the renames read correctly**

Run:

```bash
grep -rn "serializeRanges\|serializeRangesAsTsv" apps/website/content/docs/grid/
```

Expected: only `serializeRanges` appears, and each mention reads correctly in context.

Then build the site:

```bash
pnpm --filter @pretable/app-website build
```

Expected: success. MDX link targets like `#html-flavor` and `#copywithheaders` must resolve to real headings on the page.

- [ ] **Step 8: Commit**

```bash
git add apps/website/content/docs/grid
git commit -m "docs(website): document the clipboard HTML flavor and type hints"
```

---

## Task 7: Full verification and PR

- [ ] **Step 1: Run the full react suite**

Run: `pnpm --filter @pretable/react test`

Expected: PASS. Re-run once if 1–2 unrelated tests time out (known local load flake).

- [ ] **Step 2: Lint and typecheck the whole workspace**

Run:

```bash
pnpm lint && pnpm --filter @pretable/react typecheck
```

Expected: no errors.

- [ ] **Step 3: Confirm the API report is fresh**

Run: `pnpm --filter @pretable/react api:check`

Expected: PASS. This is the required-on-main gate — if it fails, run `pnpm --filter @pretable/react api` and commit the result.

- [ ] **Step 4: Confirm no stray old-name references**

Run:

```bash
grep -rn "serializeRangesAsTsv" packages apps --include="*.ts" --include="*.tsx" --include="*.mdx" | grep -v node_modules | grep -v "/dist/"
```

Expected: no output.

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin blove/modest-archimedes-f17d07
```

PR title: `feat(react): emit a text/html table flavor on copy`

PR body must cover: the two-flavor payload, one table per range, the `format`-is-text and `render`-is-not-consulted contracts, `column.type` as the paste-safety lever with the Sheets caveat, the `white-space:pre-wrap` rationale, and the `serializeRangesAsTsv` → `serializeRanges` rename with no alias.

- [ ] **Step 6: Enable auto-merge**

```bash
gh pr merge --squash --auto
```

---

## Notes on what is deliberately not here

- **No new surface prop** to disable the HTML flavor. `onCopy` already covers it, documented in Task 6 Step 2.
- **No `data-sheets-value`.** Proprietary and version-fragile; the spec rules it out.
- **No change to the paste path.** It reads `text/plain` (`packages/react/src/pretable-surface.tsx:873`) and `parseTsv` remains the exact inverse of `escapeTsvField`.
- **No `text` byte changes.** Every pre-existing TSV assertion survives untouched, which is the regression guard for that claim.
