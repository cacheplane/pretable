# Pretable

Pretable is a modern `pnpm` monorepo for a text-aware data grid, its public packages, and its benchmark tooling.

The publishable npm surface is intentionally small:

- `@pretable/core`: framework-agnostic grid primitives
- `@pretable/react`: React adapter built on top of `@pretable/core`

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

## App Entry Points

```bash
pnpm dev:bench
pnpm dev:playground
```

## Verification

```bash
pnpm lint
pnpm test
pnpm typecheck
pnpm build
```
