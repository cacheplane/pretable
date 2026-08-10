# @pretable/stream-adapter

## 0.2.0

## 0.1.1

## 0.1.0

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

> **Versioning note.** `0.1.0` was published to npm on 2026-08-06 from a
> changeset cut as a minor. Every other package in the org is on the `0.0.x`
> line, so this package rejoins it at `0.0.3`. Entries below are newest-first by
> release date, which is why `0.0.3` sits above `0.1.0`. npm never reuses a
> published version, so `0.1.0` stays on the registry as a deprecated release
> rather than being renumbered here.

## 0.0.3

### Patch Changes

- Realign to the `0.0.x` line shared by `@pretable/core`, `@pretable/react`,
  `@pretable/ui`, and `@cacheplane/json-stream`. No source changes — this
  release exists to bring the version numbers back into step.
- Updated dependencies []:
  - @cacheplane/json-stream@0.0.3

## 0.1.0

Published to npm in error; superseded by `0.0.3`, which carries the same code.

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
