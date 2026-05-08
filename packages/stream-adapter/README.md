# @pretable/stream-adapter

RAF-batched streaming integration for [pretable](https://pretable.dev/). Bridges async streams (HTTP SSE, WebSocket, partial-JSON from LLMs) into the grid with predictable per-frame batching.

## When to reach for this

Use `@pretable/stream-adapter` when you need to drive a grid from a live data stream and want one DOM mutation per animation frame regardless of incoming stream rate. The package ships:

- A **batcher** ([`createBatcher`](#createbatcher)) that coalesces `add` / `update` / `remove` into one `applyTransaction` per RAF tick.
- Two **connect** functions that wire an `AsyncIterable` source through the batcher into a grid.
- Two **parse** functions that turn raw UTF-8 string streams (e.g., `fetch().body`) into typed row iterables.

If you only need one-shot row mounting, use `<Pretable>` from `@pretable/react` instead — this package is for live streams.

## Install

```sh
npm install @pretable/stream-adapter
# or pnpm add @pretable/stream-adapter, yarn add @pretable/stream-adapter
```

## Minimal example — element stream

```ts
import { connectElementStream, parseElementStream } from "@pretable/stream-adapter";
import { createGrid } from "@pretable/core";

const grid = createGrid({ columns: [...], rows: [] });

const response = await fetch("/api/rows");
const stringStream = response.body!.pipeThrough(new TextDecoderStream());
const rowStream = parseElementStream<MyRow>(stringStream);

const connection = connectElementStream(grid, rowStream);
await connection.done; // resolves when the server closes the response
```

## Minimal example — partial-update stream (e.g., LLM)

When an LLM is streaming partial JSON, every chunk is an incomplete row. `connectPartialStream` upserts by row id so each chunk visibly fills out the corresponding row.

```ts
import {
  connectPartialStream,
  parsePartialStream,
} from "@pretable/stream-adapter";

const partialStream = parsePartialStream<MyRow>(stringStream);
const connection = connectPartialStream(grid, partialStream, { rowId: "id" });
```

## API

See **[`stream-adapter.api.md`](./stream-adapter.api.md)** for the full generated public-API report.

### `createBatcher`

Returns a `TransactionBatcher` that buffers add / update / remove calls and applies them once per `requestAnimationFrame`. Use directly when you have a custom stream source that doesn't fit the `connect*Stream` shape.

### `connectElementStream` / `parseElementStream`

`connectElementStream(grid, stream)` drives a grid from an `AsyncIterable<TRow>`. `parseElementStream(stream)` turns a string stream into an `AsyncIterable<TRow>` by parsing top-level array elements.

### `connectPartialStream` / `parsePartialStream`

Same shape, but for incremental field updates: `parsePartialStream` emits `Partial<TRow>` values as the streaming parser fills each element; `connectPartialStream` upserts by `options.rowId`.

### Types

`GridLike<TRow>` is the structural grid contract — any object with `applyTransaction({ add?, update?, remove? })` works, including a custom adapter. `TransactionBatcher<TRow>` and `StreamConnection` are the handle types returned by the constructors above. `PartialStreamOptions` is the options bag for `connectPartialStream`.

## License

MIT — see [LICENSE](../../LICENSE).
