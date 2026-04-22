# S5b Streaming Adapter Design

## Goal

Ship two packages that enable streaming data into a Pretable grid: a publishable incremental JSON parser (`@cacheplane/json-stream`) and a private stream adapter (`@pretable/stream-adapter`) that batches streaming data into `grid.applyTransaction()` calls via `requestAnimationFrame`.

## Architecture

```
@cacheplane/json-stream (publishable, zero dependencies)
  Incremental streaming JSON parser with partial value extraction,
  identity preservation, and type-safe AST.

@pretable/stream-adapter (private, depends on grid-core)
  RAF-based TransactionBatcher + LLM connectors that accept
  AsyncIterable inputs and pipe through the batcher.
```

Data flows:

```
Element streaming (Vercel AI SDK elementStream, async generators):
  AsyncIterable<TRow> → batcher buffers → RAF flush → grid.applyTransaction({ add })

Partial object streaming (single row being built token by token):
  AsyncIterable<Partial<TRow>> → batcher buffers → RAF flush → grid.applyTransaction({ update })

Raw LLM text → parsed elements:
  AsyncIterable<string> → @cacheplane/json-stream → AsyncIterable<TRow> → batcher → grid
```

---

## Decision Log

| #   | Decision                 | Choice                                                                            | Rationale                                                                                                                                      |
| --- | ------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | v1 adapter scope         | Batcher + LLM streaming adapter only                                              | Ship the differentiator; WebSocket/Firebase adapters follow the same pattern and can be added later                                            |
| 2   | LLM streaming modes      | Element stream + partial object stream                                            | Covers table-filling (complete objects) and single-row-building (token-by-token) use cases                                                     |
| 3   | JSON parser source       | Original implementation referencing production patterns; no external dependencies | Owner holds license to reference implementation; new code is original with distinct naming, improved API ergonomics, and broader test coverage |
| 4   | Package structure        | `@cacheplane/json-stream` (publishable) + `@pretable/stream-adapter` (private)    | Parser is general-purpose with zero grid dependencies; adapter is grid-specific                                                                |
| 5   | Batcher flush strategy   | RAF-only                                                                          | Syncs with display refresh, pauses in background tabs, proven at scale. Timer-based and pluggable strategies deferred                          |
| 6   | Adapter input interface  | `AsyncIterable` only                                                              | Natural shape for LLM streams. Push-based sink deferred to future adapters                                                                     |
| 7   | Parser optimization tier | Correctness + API ergonomics                                                      | LLM token rates (~100 tokens/sec) don't need persistent data structures or string fragment optimization. YAGNI                                 |
| 8   | Node status naming       | `complete` / `incomplete`                                                         | Clear semantics, no naming conflicts with existing implementations                                                                             |

---

## Package 1: `@cacheplane/json-stream`

### Overview

A streaming incremental JSON parser that processes text chunks and builds an AST with partial value extraction. Designed for feeding LLM output into structured consumers. Zero dependencies, isomorphic (browser + Node.js), publishable under the `@cacheplane` org.

### API Surface

```ts
// --- State ---

interface StreamState {
  nodes: AstNode[];
  rootId: number | null;
  error: StreamError | null;
  complete: boolean;
}

interface StreamError {
  message: string;
  index: number;
  line: number;
  column: number;
}

// --- AST Nodes ---

type NodeStatus = "complete" | "incomplete";

interface NullNode {
  id: number;
  kind: "null";
  parentId: number | null;
  status: NodeStatus;
  value: null | undefined;
}

interface BoolNode {
  id: number;
  kind: "boolean";
  parentId: number | null;
  status: NodeStatus;
  value: boolean | undefined;
}

interface NumberNode {
  id: number;
  kind: "number";
  parentId: number | null;
  status: NodeStatus;
  value: number | undefined;
  buffer: string;
}

interface StringNode {
  id: number;
  kind: "string";
  parentId: number | null;
  status: NodeStatus;
  value: string | undefined;
  buffer: string;
}

interface ArrayNode {
  id: number;
  kind: "array";
  parentId: number | null;
  status: NodeStatus;
  value: JsonValue[] | undefined;
  children: number[];
}

interface ObjectNode {
  id: number;
  kind: "object";
  parentId: number | null;
  status: NodeStatus;
  value: Record<string, JsonValue> | undefined;
  children: number[];
  keys: string[];
}

type AstNode =
  | NullNode
  | BoolNode
  | NumberNode
  | StringNode
  | ArrayNode
  | ObjectNode;

// --- Core Functions ---

function create(): StreamState;
function push(state: StreamState, chunk: string): StreamState;
function finish(state: StreamState): StreamState;
function resolve(state: StreamState): JsonValue | undefined;

// --- Type Guards ---

function isArrayNode(node: AstNode): node is ArrayNode;
function isObjectNode(node: AstNode): node is ObjectNode;
function isStringNode(node: AstNode): node is StringNode;
function isNumberNode(node: AstNode): node is NumberNode;
function isBoolNode(node: AstNode): node is BoolNode;
function isNullNode(node: AstNode): node is NullNode;
function isComplete(node: AstNode): boolean;
```

### Behavior Contract

- **Pure functions**: `push()` and `finish()` return new state without mutating the input.
- **Never throws**: All error conditions are captured in `state.error`. Once set, subsequent `push()` calls return immediately.
- **Partial values**: Incomplete containers expose their `value` as children complete. An incomplete array `[1, 2, ` has `value: [1, 2]`. An incomplete object `{"a": 1, "b":` has `value: { a: 1 }`.
- **Identity preservation**: Unchanged subtrees keep the same object references across `push()` calls. When a child completes, only the modified node and its ancestor chain receive new references. React consumers can use `===` to skip re-renders of unchanged subtrees.
- **Chunk-agnostic**: `push()` accepts any chunk size — single characters, whole lines, or the entire document at once.
- **Duplicate keys**: Last-wins behavior. If an object contains `"a": 1, "a": 2`, the resolved value is `{ a: 2 }`.

### State Machine

11 modes, each implemented as a standalone handler function:

```
Value → dispatches by first non-whitespace character
  ├── StringValue → accumulates chars, handles \n \t \uXXXX escapes
  ├── NumberValue → validates format incrementally, rejects 01 1. .5 early
  ├── LiteralValue → matches true / false / null char by char
  ├── ArrayStart → transitions to ArrayItemOrEnd
  └── ObjectStart → transitions to ObjectKeyOrEnd

ArrayItemOrEnd → ] for empty array, or Value
ObjectKeyOrEnd → } for empty object, or StringKey
ObjectColon → expects :
Separator → expects , or closing ] / }
Done → root complete, rejects trailing non-whitespace
Error → sticky, returns immediately
```

### Improvements Over Reference Implementation

1. **Extracted mode handlers**: Each mode is a focused function (20-40 lines) instead of a single 480-line switch/if monolith.
2. **Type guards**: `isArrayNode()`, `isObjectNode()`, etc. eliminate manual type narrowing.
3. **Better error messages**: Include character code and position context, e.g. `"Invalid control character U+0009 (TAB) in string at line 3, column 12"`.
4. **Streaming number validation**: Reject invalid number formats (`01`, `1.`, `.5`, `1e`) as soon as the invalid sequence appears, not after the entire number is buffered.
5. **`kind` discriminant**: Uses `kind` instead of `type` to avoid TypeScript keyword ambiguity.
6. **Cleaner API**: `create()` / `push()` / `finish()` / `resolve()` instead of verbose names.
7. **Documented duplicate key behavior**: Last-wins, explicit in spec and tested.
8. **Broader test coverage**: Number edge cases, deep nesting stress, duplicate keys, all control characters, streaming number rejection.

---

## Package 2: `@pretable/stream-adapter`

### Overview

A private package providing RAF-based transaction batching and LLM stream connectors. Accepts `AsyncIterable` inputs and pipes batched operations into `grid.applyTransaction()`.

### TransactionBatcher

```ts
interface TransactionBatcher<TRow extends Record<string, unknown>> {
  add(rows: TRow[]): void;
  update(patches: Partial<TRow>[]): void;
  remove(ids: string[]): void;
  flush(): void;
  dispose(): void;
}

function createBatcher<TRow extends Record<string, unknown>>(grid: {
  applyTransaction(tx: {
    add?: TRow[];
    update?: Partial<TRow>[];
    remove?: string[];
  }): void;
}): TransactionBatcher<TRow>;
```

**Behavior:**

- Accumulates operations into internal `add`, `update`, `remove` buffers.
- On first mutation after a flush, schedules a `requestAnimationFrame`.
- RAF callback: if any buffer is non-empty, calls `grid.applyTransaction()` with all buffered operations, then clears buffers.
- `flush()`: cancels pending RAF, applies immediately. Useful for tests and for reading snapshot right after mutations.
- `dispose()`: cancels pending RAF, clears buffers, makes subsequent calls no-op.
- Multiple calls between frames are coalesced into a single transaction.

### LLM Stream Connectors

```ts
interface StreamConnection {
  done: Promise<void>;
  dispose(): void;
}

function connectElementStream<TRow extends Record<string, unknown>>(
  grid: {
    applyTransaction(tx: {
      add?: TRow[];
      update?: Partial<TRow>[];
      remove?: string[];
    }): void;
  },
  stream: AsyncIterable<TRow>,
): StreamConnection;

function connectPartialStream<TRow extends Record<string, unknown>>(
  grid: {
    applyTransaction(tx: {
      add?: TRow[];
      update?: Partial<TRow>[];
      remove?: string[];
    }): void;
  },
  stream: AsyncIterable<Partial<TRow>>,
  options: { rowId: string },
): StreamConnection;
```

**`connectElementStream`**: Iterates the async iterable, calls `batcher.add([element])` for each item. RAF coalesces multiple elements that arrive within the same frame.

**`connectPartialStream`**: Each emission becomes `batcher.update([partial])`. The `rowId` option identifies which row is being built. The row must already exist in the grid. RAF coalesces multiple partial updates within the same frame.

**`StreamConnection`**:

- `done`: resolves when the iterable completes; rejects if the iterable throws.
- `dispose()`: stops consuming the iterable, flushes remaining buffered operations, cleans up.

### Raw Text Stream Helpers

```ts
function parseElementStream<TRow>(
  stream: AsyncIterable<string>,
): AsyncIterable<TRow>;

function parsePartialStream<TRow>(
  stream: AsyncIterable<string>,
): AsyncIterable<Partial<TRow>>;
```

**`parseElementStream`**: Feeds text chunks into the `@cacheplane/json-stream` parser. Watches for complete array elements (top-level value is an array; each child that reaches `status: "complete"` is yielded as a `TRow`).

**`parsePartialStream`**: Feeds text chunks into the parser. Expects the root value to be a JSON object (throws if root is an array or primitive). Yields the root object's partial `value` whenever its reference changes (identity-preserving — only yields when the resolved value is a new object).

### Consumer Usage Examples

```ts
// Vercel AI SDK — element stream (no parsing needed)
const { elementStream } = streamText({
  model: openai("gpt-4o"),
  output: Output.array({ element: schema }),
  prompt: "Generate 50 items",
});
const conn = connectElementStream(grid, elementStream);
await conn.done;

// Raw OpenAI text stream — parse then connect
const response = openai.chat.completions.stream({ model: "gpt-4o", ... });
const elements = parseElementStream<MyRow>(response.textStream());
const conn = connectElementStream(grid, elements);
await conn.done;

// Partial object building (single row, token by token)
grid.applyTransaction({ add: [{ id: "row-1", name: "", score: 0 }] });
const partials = parsePartialStream<MyRow>(textChunks);
const conn = connectPartialStream(grid, partials, { rowId: "row-1" });
await conn.done;
```

---

## Benchmark Integration

The existing S5 scenario (20k rows, 30 cols, `batch_every_ms: 50`) and `updates` script exercise the transaction API. The current `measureBenchUpdatesRun` uses a manual `setInterval` + `applyTransaction` loop.

**Refactoring**: Update `measureBenchUpdatesRun` to use the stream adapter's batcher, proving the adapter works under benchmark conditions. The async generator yields update batches on a 50ms cadence matching S5's spec. Same metrics collection (RAF frame durations, long task observer, DOM node counts). No new scenarios or scripts needed.

---

## Test Plan

### `@cacheplane/json-stream`

**Core parsing:**

- Complete values in single chunk (object, array, string, number, boolean, null)
- Empty containers (`[]`, `{}`)
- Nested structures
- Whitespace handling across chunks

**Chunk boundary splitting:**

- Strings split across chunks (including mid-escape, mid-unicode)
- Numbers split across chunks (mantissa, exponent boundaries)
- Literals split across chunks (t-r-u-e, f-a-l-s-e, n-u-l-l)
- Object keys with escapes across chunks
- Deep nesting across boundaries

**Streaming behavior:**

- Incomplete containers expose partial `value`
- Identity preservation: unchanged nodes keep same references
- Identity preservation: unchanged container `value` keeps same reference
- Sibling identity when appending to arrays

**Number validation:**

- Valid: `0`, `-0`, `1`, `-1`, `1.5`, `1e10`, `1E10`, `1e+10`, `1e-10`, `1.5e10`
- Invalid (early rejection): `01`, `1.`, `.5`, `1e`, `+1`, `00`
- Edge: `1e308` (max finite), numbers near Number.MAX_SAFE_INTEGER

**Error handling:**

- Malformed JSON (unclosed containers)
- Trailing tokens after root value
- Invalid escape sequences
- Invalid unicode escapes
- Control characters in strings (with character code in error message)
- Invalid numbers
- Missing colons in objects
- Missing commas in arrays/objects
- Trailing commas
- Unexpected EOF

**Edge cases:**

- Duplicate object keys (last-wins)
- Deep nesting stress (100+ levels)
- All ASCII control characters (U+0000 through U+001F) in strings
- Empty string values
- Unicode escape sequences

### `@pretable/stream-adapter`

**TransactionBatcher:**

- Coalesces multiple `add`/`update`/`remove` calls into single RAF flush
- `flush()` applies immediately, cancels pending RAF
- `dispose()` cancels pending, clears buffers, subsequent calls are no-op
- Empty buffers do not trigger `applyTransaction`

**connectElementStream:**

- Complete objects arrive and are batched as adds
- Multiple elements within one frame are coalesced
- `done` resolves when iterable completes
- `done` rejects when iterable throws
- `dispose()` stops iteration and flushes

**connectPartialStream:**

- Progressive partials batched as updates
- Multiple partials within one frame are coalesced
- Requires `rowId` option

**parseElementStream:**

- Raw JSON array text chunks → yields complete element objects
- Handles chunk boundaries within elements
- Yields nothing until first element is complete

**parsePartialStream:**

- Raw JSON object text chunks → yields partial object snapshots
- Only yields when resolved value reference changes (identity-preserving)
- Handles chunk boundaries within the object

---

## Deferred

- Timer-based batcher (RAF-only for v1)
- Push-based sink API (AsyncIterable-only for v1)
- Error recovery/resume in JSON parser
- Persistent array structure for parser nodes (YAGNI at LLM rates)
- String fragment array optimization (YAGNI)
- WebSocket, Firebase, Supabase adapters (same batcher pattern, add later)
- Renaming all packages to `@cacheplane` org (separate effort)
