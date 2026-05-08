# Contributing

Thanks for helping improve Pretable. This guide covers the public contribution
path for issues, pull requests, and package changes.

## Development Setup

Use Node.js 22+ and pnpm 10+.

```bash
pnpm install
```

Run commands from the repository root so workspace packages, API reports, and
benchmark scripts resolve consistently.

## Useful Commands

```bash
pnpm lint
pnpm test
pnpm typecheck
pnpm build
pnpm api:check
pnpm lint:packaging
```

For website work:

```bash
pnpm --filter @pretable/app-website dev
pnpm --filter @pretable/app-website smoke
```

For benchmark work:

```bash
pnpm dev:bench
pnpm bench:e2e -- --project=chromium
pnpm bench:matrix -- --project=chromium --adapters=pretable --scenarios=S2 --scripts=scroll --repeats=3
```

## Repository Boundaries

Public package work belongs in:

- `packages/core`
- `packages/react`
- `packages/ui`
- `packages/stream-adapter`
- `packages/json-stream`

Packages named `@pretable-internal/*` are implementation details. They can
change freely to support the public packages and benchmark proof surface.

## Issues

Use GitHub Issues for reproducible bugs and concrete feature requests. Include:

- Package or app affected.
- Pretable version or commit.
- Node.js, pnpm, browser, and operating system versions when relevant.
- A minimal reproduction, failing test, or benchmark command.
- Expected behavior and actual behavior.

Use GitHub Discussions for usage questions, design discussions, and exploratory
ideas. Do not file security vulnerabilities as public issues; follow
[SECURITY.md](./SECURITY.md).

## Pull Requests

Keep PRs focused and describe the user-visible behavior change. Include:

- What changed.
- Why it changed.
- How you validated it.
- Screenshots or benchmark artifact paths for UI/performance changes.

Before opening a PR, run the smallest validation lane that proves the change.
For broad package changes, run:

```bash
pnpm lint
pnpm test
pnpm typecheck
pnpm build
```

For public API changes, also run:

```bash
pnpm api
pnpm api:check
```

Commit updated API report files only when the public surface intentionally
changes.

## Changesets

Add a changeset when a publishable package changes runtime behavior, public
types, package exports, documentation that should appear in release notes, or
anything users need to notice during upgrade.

```bash
pnpm exec changeset
```

No changeset is usually needed for internal-only tests, CI, benchmarks,
repository docs, or non-published apps.

## Benchmarks

Pretable performance claims must stay tied to evidence. When changing rendering,
layout, virtualization, scrolling, selection, filtering, sorting, or streaming,
include the benchmark command you ran and any generated artifact path under
`status/`.

Do not claim a benchmark improvement from local impressions alone.

## CLA And DCO

Pretable does not currently require a Contributor License Agreement or Developer
Certificate of Origin sign-off. By contributing, you agree that your
contribution is licensed under the MIT License used by this repository.

If the project later needs CLA or DCO enforcement, it should be added as an
explicit repository policy and CI check before being required from
contributors.

## Code Of Conduct

All participation is covered by [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
