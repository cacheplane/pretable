# @pretable-internal/renderer-dom

## 0.0.2

### Patch Changes

- Updated dependencies []:
  - @pretable/core@0.12.0

## 0.0.1

### Patch Changes

- A column change no longer re-ingests the whole height index. ([#522](https://github.com/cacheplane/pretable/pull/522))

  `setColumns` changes only the estimator's inputs — the height-index
  replacement source never reads columns — yet it restarted a full cooperative
  replacement, which made one grouping apply cost three full-set height-index
  passes at 50k rows (the engine's reset, then the group-column roster commit
  and the merged-width commit, each cancelling the build before it). The
  controller now absorbs a column change in place: on an idle controller it
  clears estimates synchronously (`RowHeightIndex.clearEstimates`, new in
  layout-core — measurements survive; they are DOM facts, not arithmetic) and
  republishes, and during an active replacement it just updates the live
  columns, which the in-flight build's finishing publish already reads. A
  grouping apply now costs exactly one height-index replacement, test-pinned
  end to end.

- Updated dependencies [[`693f01e`](https://github.com/cacheplane/pretable/commit/693f01ed15580ec5313186496d2d247d27a24877), [`762bcb0`](https://github.com/cacheplane/pretable/commit/762bcb04354dea5117904ab0cc13839c4fe5633a), [`076a36f`](https://github.com/cacheplane/pretable/commit/076a36fb10a0e304f4dc567d6230f764aea7ab15), [`2a4cd7a`](https://github.com/cacheplane/pretable/commit/2a4cd7a7bdc9d173a3ece006ae9a05271a013b4c), [`305f8f4`](https://github.com/cacheplane/pretable/commit/305f8f4e123d7f423e14ba1dea1697ad9cd2e5a3), [`3124591`](https://github.com/cacheplane/pretable/commit/31245910a77efbeb03aa36db174c92ec23154ef9), [`0eb5236`](https://github.com/cacheplane/pretable/commit/0eb5236fda9a1eec8872a260b52ef08eb1485fcd), [`96ecb33`](https://github.com/cacheplane/pretable/commit/96ecb3317f9aaa558556d8ee087dce8a4519b691), [`a29298a`](https://github.com/cacheplane/pretable/commit/a29298a048868d089e6aa376cbeac142b6a2400a), [`ab87c43`](https://github.com/cacheplane/pretable/commit/ab87c43c58ae7c00365379f8c6e896450deabcef), [`f37fa1c`](https://github.com/cacheplane/pretable/commit/f37fa1caa7baa2cd9c00ffd42168bb58621be1b0), [`01a7d60`](https://github.com/cacheplane/pretable/commit/01a7d6044ee3fba6aa47098930a87d4987ea7293)]:
  - @pretable/core@0.11.0
  - @pretable-internal/layout-core@0.0.1
