---
"@pretable/stream-adapter": patch
---

Consume `@cacheplane/json-stream` from npm instead of the workspace.

The package carried the `@cacheplane` scope but lived in this repo. It now lives
in `cacheplane/cacheplane` alongside `@cacheplane/partial-json` and
`@cacheplane/partial-markdown`, with its history preserved, and is depended on
here as `~0.0.4`.

Nothing changes for consumers of `@pretable/stream-adapter`: the import
specifier is identical and the exported surface never leaked json-stream's
types. `~0.0.4` rather than `^0.0.4` is deliberate — carets do not range on
`0.0.x` (`^0.0.4` resolves to exactly `0.0.4`), so a caret would require a
pretable release to pick up every json-stream patch.
