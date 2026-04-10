# Pretable

Pretable is a modern `pnpm` monorepo for a text-aware data grid, its public packages, and its benchmark tooling.

## Workspace Layout

- `packages/core`: framework-agnostic public package
- `packages/react`: React adapter package
- `packages/*`: internal engine and benchmark packages
- `apps/bench`: benchmark harness
- `apps/playground`: manual debug surface

## Bootstrap

```bash
pnpm install
```

## Verification

```bash
pnpm lint
pnpm test
pnpm typecheck
pnpm build
```
