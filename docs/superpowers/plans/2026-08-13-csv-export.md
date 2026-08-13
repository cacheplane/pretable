# Plan — CSV export

Spec: `docs/superpowers/specs/2026-08-13-csv-export-design.md`
Branch: `blove/csv-export` (from `d730c845`)

Three slices, each independently shippable. Slice 1 is the whole risk; slices 2
and 3 are assembly on top of it.

Follow the clipboard precedent throughout: `packages/react/src/copy.ts` is the
reference implementation for shape, comment density, and how much reasoning to
record in-source. Read it before writing anything.

---

## Slice 1 — `serializeCsv`, the pure function

**Files:** `packages/react/src/csv.ts` (new), `packages/react/src/__tests__/csv.test.ts` (new),
`packages/react/src/public_api.ts`

Everything that can be wrong about a CSV file is wrong here, and none of it
needs a browser. No Blob, no anchor, no DOM — this slice returns a string plus
metadata.

### Build

- `serializeCsv(args): PretableExportFile | null` per the spec's API block, but
  returning `{ text, ... }` at this slice; the Blob is slice 2's job. Return
  `null` for zero data columns, matching `serializeRangesWithNumberFormatters`.
- `escapeCsvField(text, delimiter)` — minimal quoting on delimiter, `"`, CR, LF;
  doubled `""`. Mirror `escapeTsvField`'s shape; do **not** reuse it, the
  trigger set differs.
- Values through `formatDataCellValue` / `formatAggregateValue` and the
  `NumberFormatterRegistry`, exactly as `copy.ts` does. Aggregates use
  `formatAggregateValue`, never `format`.
- Columns from the **drawn** order the caller passes, row-select column filtered
  by `ROW_SELECT_COLUMN_ID`. Same as copy.
- Formula escaping gated on `column.type ∈ {text, enum}`; predicate overridable.
- `scope` / `complete` threaded from the caller's `resolveDataScope` result. On
  `scope === "loaded"`, append the trailing comment row.

### Test, and be honest about what the tests prove

Unit coverage is the deliverable, not a side effect. At minimum: quoting each
trigger character; doubled quotes; embedded CRLF; delimiter override; BOM
present/absent; null vs empty; header on/off; `columnIds` subset **and order**;
aggregate rows; group rows; formatted vs raw; formula escaping ON for a `text`
column and **OFF for a `number` column whose value starts with `-`**.

That last one is the whole point of the type gate — it is the exact bug
Atlassian shipped and MUI still carries. Write it as a named test.

**Mutation-test the suite** before believing it. At least: flip the type gate so
numbers are escaped; swap minimal quoting for quote-all; drop the BOM; reverse
the column order. Each must turn the suite red on its own, and report the real
assertion message. A check that survives any of these is not a check.

### Also pin

The column-order invariant: build a case where the drawn order differs from the
declaration order and assert the file follows the drawn order. Seven consumers
in this repo have got that wrong; MUI has it wrong today.

---

## Slice 2 — delivery

**Files:** `packages/react/src/save-file.ts` (new), `packages/react/src/__tests__/save-file.test.ts` (new)

- `buildExportFileName(name, date)` — pure, and tested as such: sanitize to
  `[A-Za-z0-9._-]`, strip leading dots, no trailing dot or space, reserved
  Windows names, `.csv` appended idempotently, cap ~200 bytes, timestamp
  `YYYYMMDDTHHMMSSZ` with **no colons**.
- `defaultSaveFile(file)` — `new Blob(parts, { type: "text/csv;charset=utf-8" })`,
  `createObjectURL`, detached `<a download>` appended to the document, click,
  remove, `revokeObjectURL` on a deferred timeout.
- Chunked assembly: array of ~1 MB parts into `new Blob(parts)`, never `+=`.

**Constraints that are not negotiable:**

- **No top-level browser access.** No module-scope `document`, `window`, or
  capability probe. `'use client'` would not save it and `client-only` does not
  protect against SSR.
- MIME `text/csv;charset=utf-8` and a `.csv` filename, kept consistent.
- Never `application/octet-stream`.

**Testing.** Assert on `blob.text()` for the Blob you hold. **Never** resolve or
fetch the object URL — in jsdom that silently yields the string `"undefined"`
with the MIME type intact, so such a test can pass against garbage. If you write
an assertion that would survive the CSV body being replaced by `"undefined"`,
delete it.

Do not spy on `createObjectURL` and call it coverage.

---

## Slice 3 — surface integration, docs, e2e

**Files:** `packages/react/src/pretable-surface.tsx`, `apps/website/content/docs/grid/export.mdx` (new),
`apps/website/app/docs/_nav.ts`, `apps/website/lib/docs/__tests__/docs-api-surface.test.ts`,
`apps/website/e2e/`

- Props `onExport`, `saveFile`, `csvOptions`, mirroring `onCopy` /
  `copyToClipboard` / their option bag. Wire `dataScope` in exactly as the copy
  path does (`pretable-surface.tsx` ~line 3320 is the reference).
- Live-region announcement on completion, including the row count — and saying
  the export was partial when `complete === false`.
- Docs page, registered in `app/docs/_nav.ts` (**hand-maintained**; nothing in
  frontmatter can place it) and its props table registered in the
  `docs-api-surface` roster, which now also checks the `Type` column.
- e2e: `page.waitForEvent('download')` started **before** the click, then
  `download.path()`, parse, assert cell values. Gate on
  `data-pretable-hydrated` first — SSR'd controls are painted but inert, and
  that is the #1 flake cause in this repo.

**Changeset required** — this adds public API to `@pretable/react`. Run
`pnpm build` before `pnpm api`, or a stale `dist/` silently strips exports and
`api:check` will not catch it.

---

## Verification (each slice)

```
pnpm --filter @pretable/react test
pnpm --filter @pretable/app-website test
pnpm typecheck && pnpm lint && pnpm format
pnpm api:check
```

e2e from `apps/website`, using **that worktree's** Playwright binary, with
`--workers=1`.

## Open question to settle in slice 1, not by guessing

The trailing comment row for a partial export: RFC 4180 has no comment syntax,
so any marker is a data row to a strict parser. Options are a `#`-prefixed row,
a row whose first cell reads `EXPORT INCOMPLETE`, or metadata only on the
returned object with no file mutation. Power BI embeds it in the artifact and
that is the behaviour worth copying — but decide it with the failure modes
written down, and record the reasoning in-source.
