---
"@pretable/react": patch
---

Stop repainting the grid on every slice of a cooperative rebuild.

`setQuery` and `setDerivations` rebuild incrementally, publishing a fresh state object per slice whose `status` carries `completedRows`/`totalRows`, while `snapshot` keeps pointing at the current rows until the new ones swap in. The React model subscribed `useSyncExternalStore` to `getState`, so every progress tick was a new identity and re-rendered the whole grid against rows that had not changed — and because those renders land inside the yield between slices, the rebuild itself paid for them.

Measured on a 120-row grouping transition: the row model alone settles in 7ms over 10 scheduler hops; the same model under a surface took 89 hops and roughly 470ms. On a 400-row sort, a consumer rendered 20 times where 4 are material.

The hook now subscribes to the snapshot and to a status coarsened to its kind and transition id. Progress is still published by the row model — subscribe to it directly for a progress indicator — but it no longer forces a render of the grid.
