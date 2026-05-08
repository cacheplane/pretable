# Pretable

[![CI](https://github.com/cacheplane/pretable/actions/workflows/ci.yml/badge.svg)](https://github.com/cacheplane/pretable/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-2563eb.svg)](./LICENSE)

Pretable is a React data grid for AI product teams that need to render messy,
high-signal data: chat transcripts, eval results, support queues, research
tables, tool-call logs, and other text-heavy workflows where fixed-height rows
break down.

It focuses on wrapped text, variable row heights, column virtualization,
streaming-compatible updates, keyboard/selection primitives, and a small public
API that can grow without enterprise-grid ceremony.

## Status

Pretable is pre-1.0. The public packages are intentionally narrow while the
engine hardens:

- `@pretable/react`: React components and hooks.
- `@pretable/core`: framework-agnostic grid state primitives.
- `@pretable/ui`: CSS themes, grid skin, tokens, and Tailwind helpers.
- `@pretable/stream-adapter`: streaming helpers for partial and element streams.
- `@cacheplane/json-stream`: low-level JSON stream parsing utilities.

Packages named `@pretable-internal/*` are repo-local implementation details.
Do not build application code against them.

## Install

```bash
npm install @pretable/react @pretable/ui
```

Peer dependency: `react ^19.0.0`.

Import a theme and the grid skin once in your app entry point:

```css
@import "@pretable/ui/themes/excel.css";
@import "@pretable/ui/grid.css";
```

`@pretable/ui/themes/material.css` is also available. Tailwind v4 users can
import `@pretable/ui/tailwind.css` for token-backed utility aliases.

## First Grid

```tsx
import {
  Pretable,
  type PretableColumn,
  type PretableRow,
} from "@pretable/react";

const columns: PretableColumn[] = [
  { id: "name", header: "Name", value: (row) => row.name },
  { id: "role", header: "Role", value: (row) => row.role },
  { id: "notes", header: "Notes", value: (row) => row.notes },
];

const rows: PretableRow[] = [
  {
    id: "1",
    name: "Ada",
    role: "Engineer",
    notes: "Investigating a long-running eval with wrapped explanation text.",
  },
  {
    id: "2",
    name: "Grace",
    role: "Operator",
    notes: "Triaging streamed tool-call output across several retries.",
  },
];

export function Queue() {
  return <Pretable rows={rows} columns={columns} />;
}
```

For lower-level rendering, selection, keyboard navigation, custom cells, and
measured row heights, use `usePretableModel` from `@pretable/react`.

## Why Pretable

Most grids are strongest when rows are compact, uniform, and human-entered.
AI products often have the opposite shape: long text, unstable row heights,
streaming responses, nested metadata, and high-frequency inspection workflows.

Pretable is built around that shape:

- Variable-height rows and wrapped content are first-class.
- Column virtualization is part of the proof surface, not a later add-on.
- Sorting, filtering, focus, copy, and selection live in a framework-neutral
  core before React renders them.
- Streaming adapters are designed to preserve row stability instead of only
  chasing raw update throughput.
- Benchmarks are committed as repo artifacts so claims can be inspected.

## Evidence

Milestone benchmark summaries live in `status/milestones/` and are committed so
they resolve in every checkout.

- `2026-05-01-h1-satisfied.hypotheses.json`: wrapped-text scroll benchmark with
  16 ms Pretable median `frame_p95`, zero row-height error, zero blank gaps, and
  zero long tasks.
- `2026-05-01-interaction-comprehensive.hypotheses.json`: sort, filter, scroll,
  and interaction hypotheses satisfied across the non-streaming proof surface.
- `2026-05-01-s3-column-virtualization.hypotheses.json`: 2,500 rows x 500
  columns with 160 peak DOM nodes and no blank-gap frames.
- `2026-05-01-streaming-revalidated.hypotheses.json`: streaming update
  validation where Pretable's strongest current wedge is row stability.

The honest current framing: non-streaming wrapped-text and interaction claims
are strong; streaming is implemented and measured, but some comparative
streaming hypotheses remain directional rather than fully satisfied.

## Repository Layout

```text
apps/bench                 Benchmark lab and browser test target
apps/website               Documentation and marketing site
packages/core              Public framework-agnostic grid primitives
packages/react             Public React adapter
packages/ui                Public CSS themes and grid skin
packages/stream-adapter    Public streaming adapter package
packages/json-stream       Public JSON stream parser utilities
packages/*-core            Internal text, layout, and grid engines
packages/renderer-dom      Internal DOM renderer planning layer
packages/scenario-data     Internal benchmark/demo datasets
packages/bench-runner      Internal benchmark artifact utilities
docs/                      Design notes, research, and implementation plans
status/milestones          Committed benchmark evidence
```

## Development

Use Node.js 22+ and pnpm 10+.

```bash
pnpm install
pnpm --filter @pretable/app-website dev
pnpm dev:bench
```

Run validation from the repository root:

```bash
pnpm lint
pnpm test
pnpm typecheck
pnpm build
pnpm api:check
pnpm lint:packaging
```

Heavy workspace commands should run sequentially in one checkout. They build
shared packages and can contend with each other when launched in parallel.

## Documentation

- Product site and docs: [pretable.ai](https://pretable.ai)
- Getting started: [pretable.ai/docs/getting-started](https://pretable.ai/docs/getting-started)
- Grid API reference: [pretable.ai/docs/grid/api-reference](https://pretable.ai/docs/grid/api-reference)
- Streaming docs: [pretable.ai/docs/streaming](https://pretable.ai/docs/streaming)

## Contributing

Public contributions are welcome. Start with [CONTRIBUTING.md](./CONTRIBUTING.md)
for setup, validation, issue, pull request, changeset, and CLA/DCO policy.

Please follow the [Code of Conduct](./CODE_OF_CONDUCT.md). For security issues,
do not open a public issue; follow [SECURITY.md](./SECURITY.md).

## License

MIT. See [LICENSE](./LICENSE).
