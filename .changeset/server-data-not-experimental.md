---
"@pretable/core": patch
"@pretable/react": patch
---

The server-controlled data surface is no longer marked experimental. External
filter/sort authority (`PretableProcessingAuthority`, `PretableProcessingOptions`),
the `dataState` lifecycle (`PretableDataState`, `PretableBodyStateKind`) and
result metadata (`PretableMatchingTotal`, `PretableResultMeta`) shipped across
five releases, are locked behind the API-surface gate and carry e2e coverage, so
the `@experimental` hedge on their TSDoc has been dropped. Their types and
behavior are unchanged.
