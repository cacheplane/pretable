---
"@pretable/react": patch
---

A rejected `rows` update no longer leaves the grid describing itself with the
array it refused.

`usePretable` treats an invalid `rows` prop as a rejected write: the row model
keeps its previous rows, and the array is deliberately recorded as "last
requested" so it is never retried. Four things downstream still read the `rows`
prop and `resultMeta.window` as though that write had landed, so the resulting
divergence was permanent rather than lasting a render. All four are rows mode
with `processing: { filter: "external", sort: "external" }`.

- **`aria-rowcount` counted the refused array.** Three rows replaced by a
  seven-row array carrying a duplicate id published `aria-rowcount: 8` over the
  three older rows still on screen.
- **`aria-rowindex` relocated the kept rows.** A rejected pager swap moved rows
  loaded at `window.start: 100` to the incoming window's positions —
  102,103,104 becoming 202,203,204 — while the rows themselves never changed.
- **`telemetry.windowGap` misreported the fetch offset.** It measured the new
  window against the old rows, which a windowing consumer turns straight into a
  request for a page it already has.
- **The scroll extent was at risk.** The same window feeds the row layout
  controller's leading and trailing spacers, so the extent depends on the
  window and the loaded rows agreeing.

The grid now counts the row model, and resolves the window to the one that
landed **with** the rows it is holding, while the array on screen is one the
model refused. That keeps the kept rows announced where they actually are,
keeps the scroll extent intact across a replan, and keeps `windowGap` live and
correct — so a windowing consumer's fetch loop can still recover on its own. A
later valid `rows` array returns everything to the consumer's live `resultMeta`.

Grids without `processing: { filter: "external", sort: "external" }` were never
affected: `aria-rowcount` is resolved from the row model there in every case,
and a grid that publishes no `resultMeta.window` has no window to resolve.

Two things deliberately unchanged. `resultMeta.total` is still read live — it
is the server's claim about the population, which a rejected row array does not
falsify — so a total below the kept row count still warns and downgrades, as it
did before. And there is still no API to ask whether a grid's rows match the
ones you passed; the `rows-rejected` console warning remains the signal.
