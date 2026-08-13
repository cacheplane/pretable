---
"@pretable/react": minor
---

Add `serializeCsv`, the pure CSV serializer behind file export.

It reuses the clipboard's value pipeline — the same `formatDataCellValue`,
`formatAggregateValue` and number-formatter registry — so a CSV agrees with the
screen, and it resolves columns against the **drawn** order rather than the
`columns` prop, so reordering and pinning are reflected in the file.

Two decisions worth knowing:

- **Formula escaping is on by default and vouches on the RUNTIME VALUE**, not on
  the leading character and not on `column.type`. Escaping from the first
  character corrupts negative numbers — a shipped bug in Jira (`-1000` exported
  as `'-1000` across 9.9.0–9.12.2), in MUI X today, and in CsvHelper. Gating on
  the declared type instead has the opposite failure: `PretableRow` is
  `Record<string, unknown>`, so a string from an API sits happily in a
  `type: "number"` column and its formula ships unescaped. Exempting genuine
  numbers, bigints, booleans and Dates by their JavaScript type keeps the
  anti-Jira property while closing that hole.
- **The file reports WHY it is incomplete, not merely that it is.** `omissions`
  is a discriminated union — `unloaded-rows` carries the scope that proved it,
  `collapsed-groups` carries the expansion override count — and `complete` is
  derived from it rather than maintained beside it. A boolean was the wrong
  shape: "is this complete" is an open question, and the flag grew a term per
  review round. A union closes it differently — a new reason is a new variant,
  so an exhaustive consumer gets a compile error rather than a silently wrong
  `true`. The shape is borrowed from `@hashbrownai/core`'s frame union. The marker is
  deliberately not written into the CSV: RFC 4180 has no comment syntax, so a
  marker row is a data row, and trading a silent short file for a silently
  corrupted one is not an improvement.

`scope` is a **required** argument, not an optional one. Defaulting it to
`"all"` would have made the honesty reporting opt-in: a caller who simply forgot
it would get a confidently-labelled complete file over a partial window, which
is the behaviour this exists to refuse.
