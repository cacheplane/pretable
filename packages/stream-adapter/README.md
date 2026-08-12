# @pretable/stream-adapter

RAF-batched streaming integration for [Pretable](https://pretable.dev/). It bridges async sources such as SSE, WebSockets, and partial JSON into an ID-generic row model with one atomic transaction per animation frame.

## When to reach for this

Use `@pretable/stream-adapter` when a live source emits faster than the browser should publish row-model revisions. The package ships:

- A **batcher** that coalesces `add`, `{ id, changes }` updates, and ID removals into one transaction per RAF tick.
- Two **connectors** that consume `AsyncIterable` sources and target a structural row model.
- Two **parsers** that turn raw UTF-8 string streams into typed row iterables.

If your data changes only through ordinary React props, pass `rows` to `@pretable/react` instead. This package is for explicit streaming ownership.

## Install

```sh
npm install @pretable/stream-adapter
# or pnpm add @pretable/stream-adapter, yarn add @pretable/stream-adapter
```

## Element streams

`connectElementStream` treats every complete element as a row to add. Pass a Pretable row model or any object satisfying `RowModelLike<TRow, TRowId>`.

```ts
import {
  connectElementStream,
  parseElementStream,
} from "@pretable/stream-adapter";

const response = await fetch("/api/rows");
const stringStream = response.body!.pipeThrough(new TextDecoderStream());
const rows = parseElementStream<MyRow>(stringStream);

const connection = connectElementStream(rowModel, rows);
await connection.done;
```

## Partial streams

`connectPartialStream` sends every partial to the fixed `options.rowId` as `{ id, changes }`. The target row must already exist unless `createRow(partial, id)` is provided. The connector never asserts that a partial is a complete row.

```ts
import {
  connectPartialStream,
  parsePartialStream,
} from "@pretable/stream-adapter";

const partials = parsePartialStream<ChatRow>(stringStream);
const connection = connectPartialStream(rowModel, partials, {
  rowId: "assistant-1",
  onIssue(issue) {
    console.warn(issue.code, issue.rowId);
  },
  createRow(partial, id) {
    return { id, role: "assistant", content: partial.content ?? "" };
  },
});
```

When the model returns an `unknown-update-id` issue, `onIssue` receives it. If `createRow` is present, its complete result is added in a separate atomic transaction; otherwise nothing is fabricated.

## Direct batching

Use `createBatcher` when your source does not fit either connector:

```ts
const batcher = createBatcher(rowModel);

batcher.update([{ id: 42, changes: { status: "ready" } }]);
batcher.remove([7]);
// The scheduled RAF flushes automatically; flush() is also available.
```

The batcher preserves string and number IDs. It detaches the transaction payload before publication, clears the published batch before calling the model, and remains usable if `applyTransaction` throws.

## API

See **[`stream-adapter.api.md`](./stream-adapter.api.md)** for the generated public-API report.

- `createBatcher(rowModel)` returns a `TransactionBatcher<TRow, TRowId>`.
- `connectElementStream(rowModel, stream)` adds complete streamed rows.
- `connectPartialStream(rowModel, stream, options)` updates one fixed row ID.
- `parseElementStream(stream)` parses complete top-level array elements.
- `parsePartialStream(stream)` parses incremental partial objects.
- `RowModelLike<TRow, TRowId>` is the dependency-free structural model contract.
- `PartialStreamOptions<TRow, TRowId>`, `TransactionBatcher<TRow, TRowId>`, and `StreamConnection` describe the connector and lifecycle handles.

## License

MIT — see [LICENSE](../../LICENSE).
