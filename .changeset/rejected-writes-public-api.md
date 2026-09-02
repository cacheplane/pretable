---
"@pretable/react": minor
---

The grid can now tell you when its rendered data no longer matches what you
passed. Since invalid `rows`, `derivations`, and `query` updates became
rejected writes, the grid kept its last-good value and stayed alive — but the
only signal was a console warning that latches per fault kind, and there was
no API to ask whether the rendered rows match the ones you passed. Now there
is:

- `model.rejectedWrites` (on `usePretable`'s return) is a per-kind record:
  `{ rows, derivations, query }`, each `null` when in sync or
  `{ kind, code, message, columnId? }` describing the most recent rejection.
  Nothing latches — every rejection replaces the record — and a slot clears
  on its own when a valid value lands.
- `onRejectedWriteChange` on `PretableSurface` (and `LabeledGridSurface`)
  fires on every transition, including recovery, so a direct-Surface consumer
  can render a banner, retry, or fall back.
- Rejections in `useLocalRowModel` (rows and derivations) surface through the
  same record, so model-mode consumers get the same answer.

Console warnings are unchanged. Fatal faults (`disposed-model`,
`reentrant-mutation`, foreign errors) still throw.
