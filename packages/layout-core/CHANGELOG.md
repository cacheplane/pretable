# @pretable-internal/layout-core

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
