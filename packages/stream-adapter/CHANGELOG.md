# @pretable/stream-adapter

## 0.10.0

## 0.9.0

## 0.8.0

## 0.7.0

## 0.6.2

## 0.6.1

## 0.6.0

## 0.5.2

## 0.5.1

## 0.5.0

### Minor Changes

- Release the work merged since 0.4.0. Ten commits landed on `main` without changesets and so were never published; this releases them together. ([#330](https://github.com/cacheplane/pretable/pull/330))

  **Row model (#321)** — the incremental row-model migration completes, changing public surface in `@pretable/core` (grid construction, the local row model, and the exported types).

  **Cell presentations (#318, #319)** — the semantic ramp and the first cell presentations, then badge and entity presentations, added to `@pretable/react`'s public API.

  **Theming (#322)** — `pretable.css` is the house theme and the documented default; Excel and Material become compatibility skins.

  **Fixes (#324, #325)** — a focused cell now draws exactly one ring rather than two, which also restores the pinned-column seam the duplicate ring had been evicting from its `box-shadow` slot; the Material dark checkmark moves from 1.70:1 to 7.73:1 contrast; and the row-height floor follows `--pretable-row-height` instead of a hard-coded 44px, so a themed density change is honored by measured and estimated rows alike.

## 0.4.0

## 0.3.2

## 0.3.1

## 0.3.0

## 0.2.0

## 0.1.1

This version was assigned in the repository but was never published. The next
published `@pretable/stream-adapter` version was `0.2.0`.

## 0.0.14

## 0.0.13

## 0.0.12

## 0.0.11

## 0.0.10

## 0.0.9

## 0.0.8

## 0.0.7

## 0.0.5

### Patch Changes

- Consume `@cacheplane/json-stream` from npm instead of the workspace. ([#231](https://github.com/cacheplane/pretable/pull/231))

  The package carried the `@cacheplane` scope but lived in this repo. It now lives
  in `cacheplane/cacheplane` alongside `@cacheplane/partial-json` and
  `@cacheplane/partial-markdown`, with its history preserved, and is depended on
  here as `~0.0.4`.

  Nothing changes for consumers of `@pretable/stream-adapter`: the import
  specifier is identical and the exported surface never leaked json-stream's
  types. `~0.0.4` rather than `^0.0.4` is deliberate — carets do not range on
  `0.0.x` (`^0.0.4` resolves to exactly `0.0.4`), so a caret would require a
  pretable release to pick up every json-stream patch.

## 0.0.4

### Patch Changes

- Updated dependencies []:
  - @cacheplane/json-stream@0.0.4

## 0.0.3

### Patch Changes

- Realign to the `0.0.x` line shared by `@pretable/core`, `@pretable/react`,
  `@pretable/ui`, and `@cacheplane/json-stream`. No source changes — this
  release exists to bring the version numbers back into step.
- Updated dependencies []:
  - @cacheplane/json-stream@0.0.3

## 0.1.0

This version was published to npm in error and then withdrawn. It is no longer
installable, and npm permanently reserves the version so it cannot be reused.
`0.0.3` carries the same code.

### Minor Changes

- Promote stream-adapter from `@pretable-internal/` to the public ([`327d6c6`](https://github.com/cacheplane/pretable/commit/327d6c60471b7215bda8bc4607daad8737b0f298))
  `@pretable/` namespace. Same exports, same behavior. The package was
  previously private and unreachable from npm despite being referenced in
  the marketing copy and the AI-agent setup prompt at https://pretable.ai.

### Patch Changes

- Add MIT license metadata, repository links, homepage links, and issue tracker ([#104](https://github.com/cacheplane/pretable/pull/104))
  metadata to the public packages as part of the open-source community health
  pass.
- Updated dependencies [[`a63886d`](https://github.com/cacheplane/pretable/commit/a63886d2131150f810c5210e0e1861f3ac6f8d09)]:
  - @cacheplane/json-stream@0.0.2

## 0.0.1

### Patch Changes

- Updated dependencies [[`c1fb1d3`](https://github.com/cacheplane/pretable/commit/c1fb1d3266dad24153de60b92931147f14667d5a)]:
  - @cacheplane/json-stream@0.0.1
