# `@cacheplane/json-stream` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a zero-dependency, isomorphic streaming incremental JSON parser that builds an AST with partial value extraction and identity preservation, published under `@cacheplane/json-stream`.

**Architecture:** Pure-function state machine with 11 mode handlers, each in its own focused function. State is an immutable `StreamState` containing a flat `nodes` array, a mode stack, and position tracking. `push()` / `finish()` / `resolve()` are the public API; internal mode handlers consume one character at a time from the chunk. Identity preservation is achieved by reusing object references for unchanged subtrees when propagating resolved values up the ancestor chain.

**Tech Stack:** TypeScript, vitest, tsup (bundling for publishable package), pnpm workspace

---

## File Structure

```
packages/json-stream/
  package.json                  # @cacheplane/json-stream, publishable, tsup + tsc
  tsconfig.json                 # extends ../../tsconfig.base.json, composite
  tsconfig.build.json           # emitDeclarationOnly for .d.ts alongside tsup
  tsup.config.ts                # ESM output, dts: false (tsc handles declarations)
  vitest.config.ts              # minimal, no aliases needed
  src/
    index.ts                    # public re-exports
    types.ts                    # StreamState, AstNode, all node types, StreamError, JsonValue
    guards.ts                   # isArrayNode, isObjectNode, etc. type guards
    create.ts                   # create() factory
    push.ts                     # push() entry point, delegates to mode handlers
    finish.ts                   # finish() — finalize incomplete numbers/literals, validate
    resolve.ts                  # resolve() — extract root node's resolved value
    identity.ts                 # propagateResolved, preserveArrayValue, preserveObjectValue
    nodes.ts                    # openNode, closePrimitive, closeContainer, replaceNode
    handlers/
      value.ts                  # Value mode — dispatch by first non-whitespace char
      string-value.ts           # StringValue mode — accumulate chars, handle escapes
      number-value.ts           # NumberValue mode — validate format incrementally
      literal-value.ts          # LiteralValue mode — match true/false/null char by char
      array-start.ts            # ArrayStart mode — transition to ArrayItemOrEnd
      array-item-or-end.ts      # ArrayItemOrEnd mode — ] for empty or dispatch Value
      object-start.ts           # ObjectStart mode — transition to ObjectKeyOrEnd
      object-key-or-end.ts      # ObjectKeyOrEnd mode — } for empty or start key string
      object-colon.ts           # ObjectColon mode — expect :
      separator.ts              # Separator mode — expect , or closing ] / }
      done.ts                   # Done mode — reject trailing non-whitespace
  __tests__/
    core-parsing.test.ts        # Complete values, empty containers, nested structures
    chunk-boundary.test.ts      # Strings/numbers/literals split across chunks
    streaming.test.ts           # Partial values, identity preservation
    numbers.test.ts             # Valid/invalid number formats, streaming rejection
    errors.test.ts              # All error conditions
    edge-cases.test.ts          # Duplicate keys, deep nesting, control chars, unicode
```

---

### Task 1: Package Scaffolding

**Files:**

- Create: `packages/json-stream/package.json`
- Create: `packages/json-stream/tsconfig.json`
- Create: `packages/json-stream/tsconfig.build.json`
- Create: `packages/json-stream/tsup.config.ts`
- Create: `packages/json-stream/vitest.config.ts`
- Create: `packages/json-stream/src/index.ts`
- Modify: `tsconfig.json` (root)
- Modify: `pnpm-workspace.yaml` (if needed — already includes `packages/*`)

- [ ] **Step 1: Create `packages/json-stream/package.json`**

```json
{
  "name": "@cacheplane/json-stream",
  "version": "0.0.0",
  "type": "module",
  "files": ["dist"],
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup && tsc -p tsconfig.build.json",
    "lint": "eslint src --ext .ts",
    "test": "vitest run",
    "typecheck": "tsc -b --pretty false"
  }
}
```

- [ ] **Step 2: Create `packages/json-stream/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.*", "src/**/__tests__/**"]
}
```

- [ ] **Step 3: Create `packages/json-stream/tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "composite": false,
    "emitDeclarationOnly": true,
    "noEmit": false
  }
}
```

- [ ] **Step 4: Create `packages/json-stream/tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
});
```

- [ ] **Step 5: Create `packages/json-stream/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({});
```

- [ ] **Step 6: Create placeholder `packages/json-stream/src/index.ts`**

```ts
export {};
```

- [ ] **Step 7: Add reference to root `tsconfig.json`**

Add to the `references` array in `tsconfig.json`:

```json
{
  "path": "./packages/json-stream"
}
```

- [ ] **Step 8: Install dependencies and verify**

```bash
pnpm install
cd packages/json-stream && pnpm test
```

Expected: 0 tests, pass (vitest run with no test files).

- [ ] **Step 9: Verify typecheck**

```bash
cd packages/json-stream && pnpm typecheck
```

Expected: clean, no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/json-stream tsconfig.json
git commit -m "feat(json-stream): scaffold @cacheplane/json-stream package"
```

---

### Task 2: Type Definitions

**Files:**

- Create: `packages/json-stream/src/types.ts`
- Modify: `packages/json-stream/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/json-stream/src/__tests__/core-parsing.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import type {
  AstNode,
  StreamState,
  StreamError,
  NullNode,
  BoolNode,
  NumberNode,
  StringNode,
  ArrayNode,
  ObjectNode,
  NodeStatus,
  JsonValue,
} from "../index";

describe("types", () => {
  test("StreamState shape is importable and has correct structure", () => {
    const state: StreamState = {
      nodes: [],
      rootId: null,
      error: null,
      complete: false,
    };

    expect(state.nodes).toEqual([]);
    expect(state.rootId).toBeNull();
    expect(state.error).toBeNull();
    expect(state.complete).toBe(false);
  });

  test("AstNode discriminates on kind field", () => {
    const nullNode: NullNode = {
      id: 0,
      kind: "null",
      parentId: null,
      status: "complete",
      value: null,
    };

    const boolNode: BoolNode = {
      id: 1,
      kind: "boolean",
      parentId: null,
      status: "complete",
      value: true,
    };

    const numberNode: NumberNode = {
      id: 2,
      kind: "number",
      parentId: null,
      status: "complete",
      value: 42,
      buffer: "42",
    };

    const stringNode: StringNode = {
      id: 3,
      kind: "string",
      parentId: null,
      status: "complete",
      value: "hello",
      buffer: "hello",
    };

    const arrayNode: ArrayNode = {
      id: 4,
      kind: "array",
      parentId: null,
      status: "complete",
      value: [1, 2, 3],
      children: [0, 1, 2],
    };

    const objectNode: ObjectNode = {
      id: 5,
      kind: "object",
      parentId: null,
      status: "complete",
      value: { a: 1 },
      children: [0],
      keys: ["a"],
    };

    const nodes: AstNode[] = [
      nullNode,
      boolNode,
      numberNode,
      stringNode,
      arrayNode,
      objectNode,
    ];

    expect(nodes[0].kind).toBe("null");
    expect(nodes[1].kind).toBe("boolean");
    expect(nodes[2].kind).toBe("number");
    expect(nodes[3].kind).toBe("string");
    expect(nodes[4].kind).toBe("array");
    expect(nodes[5].kind).toBe("object");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/json-stream && pnpm test
```

Expected: FAIL — cannot import types from `../index`.

- [ ] **Step 3: Create `packages/json-stream/src/types.ts`**

```ts
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type NodeStatus = "complete" | "incomplete";

export interface StreamError {
  message: string;
  index: number;
  line: number;
  column: number;
}

export interface NullNode {
  id: number;
  kind: "null";
  parentId: number | null;
  status: NodeStatus;
  value: null | undefined;
}

export interface BoolNode {
  id: number;
  kind: "boolean";
  parentId: number | null;
  status: NodeStatus;
  value: boolean | undefined;
}

export interface NumberNode {
  id: number;
  kind: "number";
  parentId: number | null;
  status: NodeStatus;
  value: number | undefined;
  buffer: string;
}

export interface StringNode {
  id: number;
  kind: "string";
  parentId: number | null;
  status: NodeStatus;
  value: string | undefined;
  buffer: string;
}

export interface ArrayNode {
  id: number;
  kind: "array";
  parentId: number | null;
  status: NodeStatus;
  value: JsonValue[] | undefined;
  children: number[];
}

export interface ObjectNode {
  id: number;
  kind: "object";
  parentId: number | null;
  status: NodeStatus;
  value: Record<string, JsonValue> | undefined;
  children: number[];
  keys: string[];
}

export type AstNode =
  | NullNode
  | BoolNode
  | NumberNode
  | StringNode
  | ArrayNode
  | ObjectNode;

export type ParseMode =
  | "Value"
  | "StringValue"
  | "NumberValue"
  | "LiteralValue"
  | "ArrayItemOrEnd"
  | "ObjectKeyOrEnd"
  | "ObjectColon"
  | "Separator"
  | "Done"
  | "Error";

export interface StreamState {
  nodes: AstNode[];
  rootId: number | null;
  error: StreamError | null;
  complete: boolean;
}

export interface InternalState extends StreamState {
  nextId: number;
  mode: ParseMode;
  stack: number[];
  index: number;
  line: number;
  column: number;
  stringContext: "value" | "key" | null;
  stringEscape: boolean;
  stringUnicode: string | null;
  literalExpected: string | null;
  literalBuffer: string;
  pendingKey: string | null;
  pendingKeyOwner: number | null;
  currentNodeId: number | null;
  keyBuffer: string;
}
```

- [ ] **Step 4: Update `packages/json-stream/src/index.ts`**

```ts
export type {
  AstNode,
  ArrayNode,
  BoolNode,
  JsonValue,
  NodeStatus,
  NullNode,
  NumberNode,
  ObjectNode,
  StreamError,
  StreamState,
  StringNode,
} from "./types";
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd packages/json-stream && pnpm test
```

Expected: PASS — 2 tests passing.

- [ ] **Step 6: Commit**

```bash
git add packages/json-stream/src/types.ts packages/json-stream/src/index.ts packages/json-stream/src/__tests__/core-parsing.test.ts
git commit -m "feat(json-stream): add type definitions for AST nodes and stream state"
```

---

### Task 3: Type Guards

**Files:**

- Create: `packages/json-stream/src/guards.ts`
- Modify: `packages/json-stream/src/index.ts`
- Create: `packages/json-stream/src/__tests__/guards.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/json-stream/src/__tests__/guards.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import type { AstNode } from "../index";
import {
  isArrayNode,
  isObjectNode,
  isStringNode,
  isNumberNode,
  isBoolNode,
  isNullNode,
  isComplete,
} from "../index";

describe("type guards", () => {
  const nullNode: AstNode = {
    id: 0,
    kind: "null",
    parentId: null,
    status: "complete",
    value: null,
  };

  const boolNode: AstNode = {
    id: 1,
    kind: "boolean",
    parentId: null,
    status: "complete",
    value: true,
  };

  const numberNode: AstNode = {
    id: 2,
    kind: "number",
    parentId: null,
    status: "incomplete",
    value: undefined,
    buffer: "42",
  };

  const stringNode: AstNode = {
    id: 3,
    kind: "string",
    parentId: null,
    status: "complete",
    value: "hello",
    buffer: "hello",
  };

  const arrayNode: AstNode = {
    id: 4,
    kind: "array",
    parentId: null,
    status: "complete",
    value: [],
    children: [],
  };

  const objectNode: AstNode = {
    id: 5,
    kind: "object",
    parentId: null,
    status: "incomplete",
    value: undefined,
    children: [],
    keys: [],
  };

  test("isNullNode narrows to NullNode", () => {
    expect(isNullNode(nullNode)).toBe(true);
    expect(isNullNode(boolNode)).toBe(false);
    expect(isNullNode(arrayNode)).toBe(false);
  });

  test("isBoolNode narrows to BoolNode", () => {
    expect(isBoolNode(boolNode)).toBe(true);
    expect(isBoolNode(nullNode)).toBe(false);
  });

  test("isNumberNode narrows to NumberNode", () => {
    expect(isNumberNode(numberNode)).toBe(true);
    expect(isNumberNode(stringNode)).toBe(false);
  });

  test("isStringNode narrows to StringNode", () => {
    expect(isStringNode(stringNode)).toBe(true);
    expect(isStringNode(numberNode)).toBe(false);
  });

  test("isArrayNode narrows to ArrayNode", () => {
    expect(isArrayNode(arrayNode)).toBe(true);
    expect(isArrayNode(objectNode)).toBe(false);
  });

  test("isObjectNode narrows to ObjectNode", () => {
    expect(isObjectNode(objectNode)).toBe(true);
    expect(isObjectNode(arrayNode)).toBe(false);
  });

  test("isComplete checks status field", () => {
    expect(isComplete(nullNode)).toBe(true);
    expect(isComplete(numberNode)).toBe(false);
    expect(isComplete(objectNode)).toBe(false);
    expect(isComplete(stringNode)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/json-stream && pnpm test
```

Expected: FAIL — guard functions not exported.

- [ ] **Step 3: Create `packages/json-stream/src/guards.ts`**

```ts
import type {
  AstNode,
  ArrayNode,
  BoolNode,
  NullNode,
  NumberNode,
  ObjectNode,
  StringNode,
} from "./types";

export function isNullNode(node: AstNode): node is NullNode {
  return node.kind === "null";
}

export function isBoolNode(node: AstNode): node is BoolNode {
  return node.kind === "boolean";
}

export function isNumberNode(node: AstNode): node is NumberNode {
  return node.kind === "number";
}

export function isStringNode(node: AstNode): node is StringNode {
  return node.kind === "string";
}

export function isArrayNode(node: AstNode): node is ArrayNode {
  return node.kind === "array";
}

export function isObjectNode(node: AstNode): node is ObjectNode {
  return node.kind === "object";
}

export function isComplete(node: AstNode): boolean {
  return node.status === "complete";
}
```

- [ ] **Step 4: Add exports to `packages/json-stream/src/index.ts`**

Add to the existing exports:

```ts
export {
  isArrayNode,
  isBoolNode,
  isComplete,
  isNullNode,
  isNumberNode,
  isObjectNode,
  isStringNode,
} from "./guards";
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd packages/json-stream && pnpm test
```

Expected: PASS — all guard tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/json-stream/src/guards.ts packages/json-stream/src/__tests__/guards.test.ts packages/json-stream/src/index.ts
git commit -m "feat(json-stream): add type guard functions for AST nodes"
```

---

### Task 4: `create()`, `resolve()`, and Node Utilities

**Files:**

- Create: `packages/json-stream/src/create.ts`
- Create: `packages/json-stream/src/resolve.ts`
- Create: `packages/json-stream/src/nodes.ts`
- Create: `packages/json-stream/src/identity.ts`
- Modify: `packages/json-stream/src/index.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/json-stream/src/__tests__/core-parsing.test.ts`:

```ts
import { create, resolve } from "../index";

describe("create", () => {
  test("returns empty state with no nodes and no root", () => {
    const state = create();

    expect(state.nodes).toEqual([]);
    expect(state.rootId).toBeNull();
    expect(state.error).toBeNull();
    expect(state.complete).toBe(false);
  });
});

describe("resolve", () => {
  test("returns undefined for empty state", () => {
    const state = create();
    expect(resolve(state)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/json-stream && pnpm test
```

Expected: FAIL — `create` and `resolve` not exported.

- [ ] **Step 3: Create `packages/json-stream/src/nodes.ts`**

```ts
import type { AstNode, InternalState, StreamError } from "./types";

export function replaceNode(
  nodes: AstNode[],
  id: number,
  node: AstNode,
): AstNode[] {
  if (nodes[id] === node) {
    return nodes;
  }

  const next = nodes.slice();
  next[id] = node;
  return next;
}

export function createStreamError(
  message: string,
  index: number,
  line: number,
  column: number,
): StreamError {
  return { message, index, line, column };
}

export function toErrorState(
  state: InternalState,
  message: string,
): InternalState {
  return {
    ...state,
    error: createStreamError(message, state.index, state.line, state.column),
    mode: "Error",
    complete: false,
  };
}

export function afterValue(stack: number[]): {
  mode: "Done" | "Separator";
  complete: boolean;
} {
  if (stack.length === 0) {
    return { mode: "Done", complete: true };
  }

  return { mode: "Separator", complete: false };
}
```

- [ ] **Step 4: Create `packages/json-stream/src/identity.ts`**

```ts
import type { AstNode, ArrayNode, JsonValue, ObjectNode } from "./types";
import { replaceNode } from "./nodes";

export function preserveArrayValue(
  prev: JsonValue[] | undefined,
  next: JsonValue[],
): JsonValue[] {
  if (!prev || prev.length !== next.length) {
    return next;
  }

  for (let i = 0; i < prev.length; i += 1) {
    if (prev[i] !== next[i]) {
      return next;
    }
  }

  return prev;
}

export function preserveObjectValue(
  prev: Record<string, JsonValue> | undefined,
  keys: string[],
  next: Record<string, JsonValue>,
): Record<string, JsonValue> {
  if (!prev || Object.keys(prev).length !== keys.length) {
    return next;
  }

  for (const key of keys) {
    if (prev[key] !== next[key]) {
      return next;
    }
  }

  return prev;
}

export function recomputeContainerValue(
  node: AstNode,
  nodes: AstNode[],
): AstNode {
  if (node.kind === "array") {
    const values = node.children.map(
      (childId) => nodes[childId].value as JsonValue,
    );
    const resolved = preserveArrayValue(node.value, values);

    if (resolved === node.value) {
      return node;
    }

    return { ...node, value: resolved } as ArrayNode;
  }

  if (node.kind === "object") {
    const values: Record<string, JsonValue> = {};

    for (let i = 0; i < node.keys.length; i += 1) {
      const key = node.keys[i];
      values[key] = nodes[node.children[i]].value as JsonValue;
    }

    const resolved = preserveObjectValue(node.value, node.keys, values);

    if (resolved === node.value) {
      return node;
    }

    return { ...node, value: resolved } as ObjectNode;
  }

  return node;
}

export function propagateResolved(
  nodes: AstNode[],
  startParentId: number | null,
): AstNode[] {
  let nextNodes = nodes;
  let currentId = startParentId;

  while (currentId !== null) {
    const current = nextNodes[currentId];
    const updated = recomputeContainerValue(current, nextNodes);

    if (updated !== current) {
      nextNodes = replaceNode(nextNodes, currentId, updated);
    }

    currentId = updated.parentId;
  }

  return nextNodes;
}
```

- [ ] **Step 5: Create `packages/json-stream/src/create.ts`**

```ts
import type { InternalState } from "./types";

export function createInternal(): InternalState {
  return {
    nodes: [],
    rootId: null,
    error: null,
    complete: false,
    nextId: 0,
    mode: "Value",
    stack: [],
    index: 0,
    line: 1,
    column: 1,
    stringContext: null,
    stringEscape: false,
    stringUnicode: null,
    literalExpected: null,
    literalBuffer: "",
    pendingKey: null,
    pendingKeyOwner: null,
    currentNodeId: null,
    keyBuffer: "",
  };
}
```

- [ ] **Step 6: Create `packages/json-stream/src/resolve.ts`**

```ts
import type { JsonValue, StreamState } from "./types";

export function resolve(state: StreamState): JsonValue | undefined {
  if (state.rootId === null) {
    return undefined;
  }

  const root = state.nodes[state.rootId];

  if (!root) {
    return undefined;
  }

  return root.value as JsonValue | undefined;
}
```

- [ ] **Step 7: Update `packages/json-stream/src/index.ts`**

Add the new exports:

```ts
export { resolve } from "./resolve";
```

Also add a `create` function that returns the public `StreamState` shape. Add to `index.ts`:

```ts
import { createInternal } from "./create";
import type { StreamState } from "./types";

export function create(): StreamState {
  return createInternal();
}
```

The full `index.ts` should now be:

```ts
export type {
  AstNode,
  ArrayNode,
  BoolNode,
  JsonValue,
  NodeStatus,
  NullNode,
  NumberNode,
  ObjectNode,
  StreamError,
  StreamState,
  StringNode,
} from "./types";

export {
  isArrayNode,
  isBoolNode,
  isComplete,
  isNullNode,
  isNumberNode,
  isObjectNode,
  isStringNode,
} from "./guards";

export { resolve } from "./resolve";

import { createInternal } from "./create";
import type { StreamState } from "./types";

export function create(): StreamState {
  return createInternal();
}
```

- [ ] **Step 8: Run test to verify it passes**

```bash
cd packages/json-stream && pnpm test
```

Expected: PASS — all tests including new `create` and `resolve` tests.

- [ ] **Step 9: Commit**

```bash
git add packages/json-stream/src/create.ts packages/json-stream/src/resolve.ts packages/json-stream/src/nodes.ts packages/json-stream/src/identity.ts packages/json-stream/src/index.ts packages/json-stream/src/__tests__/core-parsing.test.ts
git commit -m "feat(json-stream): add create(), resolve(), node utilities, and identity preservation"
```

---

### Task 5: `push()` Entry Point and Value Mode Handler

**Files:**

- Create: `packages/json-stream/src/push.ts`
- Create: `packages/json-stream/src/handlers/value.ts`
- Create: `packages/json-stream/src/handlers/done.ts`
- Modify: `packages/json-stream/src/index.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/json-stream/src/__tests__/core-parsing.test.ts`:

```ts
import { create, push, finish, resolve } from "../index";

describe("push — complete primitives", () => {
  test("parses null in single chunk", () => {
    let state = create();
    state = push(state, "null");
    state = finish(state);

    expect(state.complete).toBe(true);
    expect(state.error).toBeNull();
    expect(resolve(state)).toBeNull();
  });

  test("parses true in single chunk", () => {
    let state = create();
    state = push(state, "true");
    state = finish(state);

    expect(resolve(state)).toBe(true);
  });

  test("parses false in single chunk", () => {
    let state = create();
    state = push(state, "false");
    state = finish(state);

    expect(resolve(state)).toBe(false);
  });

  test("skips leading whitespace before value", () => {
    let state = create();
    state = push(state, "  \n\t null");
    state = finish(state);

    expect(resolve(state)).toBeNull();
  });

  test("allows trailing whitespace after root value", () => {
    let state = create();
    state = push(state, "true  \n  ");
    state = finish(state);

    expect(state.complete).toBe(true);
    expect(resolve(state)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/json-stream && pnpm test
```

Expected: FAIL — `push` and `finish` not exported.

- [ ] **Step 3: Create `packages/json-stream/src/handlers/done.ts`**

```ts
import type { InternalState } from "../types";
import { toErrorState } from "../nodes";

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

export function handleDone(
  state: InternalState,
  chunk: string,
  pos: number,
): { state: InternalState; pos: number } {
  let s = state;
  let i = pos;

  while (i < chunk.length) {
    const ch = chunk[i];

    if (isWhitespace(ch)) {
      s = advancePosition(s, ch);
      i += 1;
      continue;
    }

    return {
      state: toErrorState(s, `Unexpected token '${ch}' after root value`),
      pos: i,
    };
  }

  return { state: s, pos: i };
}

function advancePosition(state: InternalState, ch: string): InternalState {
  return {
    ...state,
    index: state.index + 1,
    line: ch === "\n" ? state.line + 1 : state.line,
    column: ch === "\n" ? 1 : state.column + 1,
  };
}
```

- [ ] **Step 4: Create `packages/json-stream/src/handlers/value.ts`**

This is the dispatch handler that examines the first non-whitespace character and transitions to the appropriate mode. For this step, it only handles literals (true/false/null). Number, string, array, and object dispatch will be added in subsequent tasks.

```ts
import type { AstNode, InternalState } from "../types";
import { afterValue, replaceNode, toErrorState } from "../nodes";
import { propagateResolved } from "../identity";

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function advancePosition(state: InternalState, ch: string): InternalState {
  return {
    ...state,
    index: state.index + 1,
    line: ch === "\n" ? state.line + 1 : state.line,
    column: ch === "\n" ? 1 : state.column + 1,
  };
}

function openNode(
  state: InternalState,
  kind: AstNode["kind"],
): { state: InternalState; nodeId: number } {
  const id = state.nextId;
  const parentId = state.stack.length
    ? state.stack[state.stack.length - 1]
    : null;

  if (state.rootId !== null && parentId === null) {
    return {
      state: toErrorState(state, "Unexpected value after root"),
      nodeId: -1,
    };
  }

  let node: AstNode;

  switch (kind) {
    case "null":
      node = { id, kind, parentId, status: "incomplete", value: undefined };
      break;
    case "boolean":
      node = { id, kind, parentId, status: "incomplete", value: undefined };
      break;
    case "number":
      node = {
        id,
        kind,
        parentId,
        status: "incomplete",
        value: undefined,
        buffer: "",
      };
      break;
    case "string":
      node = {
        id,
        kind,
        parentId,
        status: "incomplete",
        value: undefined,
        buffer: "",
      };
      break;
    case "array":
      node = {
        id,
        kind,
        parentId,
        status: "incomplete",
        value: [],
        children: [],
      };
      break;
    case "object":
      node = {
        id,
        kind,
        parentId,
        status: "incomplete",
        value: {},
        children: [],
        keys: [],
      };
      break;
  }

  let nodes = state.nodes.slice();
  nodes[id] = node;

  let { stack, pendingKey, pendingKeyOwner } = state;

  if (parentId !== null) {
    const parent = nodes[parentId];

    if (parent.kind === "array") {
      const children = parent.children.concat(id);
      const updated = { ...parent, children };
      nodes = replaceNode(nodes, parentId, updated);
      nodes = propagateResolved(nodes, parentId);
    } else if (parent.kind === "object") {
      if (!pendingKey || pendingKeyOwner !== parentId) {
        return {
          state: toErrorState(state, "Missing key before value in object"),
          nodeId: -1,
        };
      }

      const keys = parent.keys.concat(pendingKey);
      const children = parent.children.concat(id);
      const updated = { ...parent, keys, children };
      nodes = replaceNode(nodes, parentId, updated);
      nodes = propagateResolved(nodes, parentId);
      pendingKey = null;
      pendingKeyOwner = null;
    }
  }

  if (kind === "array" || kind === "object") {
    stack = stack.concat(id);
  }

  return {
    state: {
      ...state,
      nodes,
      stack,
      rootId: state.rootId === null ? id : state.rootId,
      nextId: state.nextId + 1,
      pendingKey,
      pendingKeyOwner,
    },
    nodeId: id,
  };
}

function closePrimitive(
  state: InternalState,
  nodeId: number,
  value: null | boolean | number | string,
): InternalState {
  const node = state.nodes[nodeId];
  const updated = { ...node, status: "complete" as const, value } as AstNode;
  let nodes = replaceNode(state.nodes, nodeId, updated);
  nodes = propagateResolved(nodes, updated.parentId);

  return { ...state, nodes };
}

export { openNode, closePrimitive };

export function handleValue(
  state: InternalState,
  chunk: string,
  pos: number,
): { state: InternalState; pos: number } {
  let s = state;
  let i = pos;

  while (i < chunk.length) {
    const ch = chunk[i];

    if (isWhitespace(ch)) {
      s = advancePosition(s, ch);
      i += 1;
      continue;
    }

    if (ch === "t" || ch === "f" || ch === "n") {
      const expected = ch === "t" ? "true" : ch === "f" ? "false" : "null";
      const opened = openNode(s, ch === "n" ? "null" : "boolean");

      if (opened.state.error) {
        return { state: opened.state, pos: i };
      }

      s = {
        ...opened.state,
        mode: "LiteralValue",
        literalExpected: expected,
        literalBuffer: ch,
        currentNodeId: opened.nodeId,
      };

      if (expected.length === 1) {
        const result = afterValue(s.stack);
        s = finalizeLiteral(s, opened.nodeId, expected);

        if (s.error) {
          return { state: s, pos: i };
        }

        s = {
          ...s,
          mode: result.mode,
          complete: result.complete,
          literalExpected: null,
          literalBuffer: "",
          currentNodeId: null,
        };
      }

      s = advancePosition(s, ch);
      i += 1;
      return { state: s, pos: i };
    }

    if (ch === '"') {
      const opened = openNode(s, "string");

      if (opened.state.error) {
        return { state: opened.state, pos: i };
      }

      s = {
        ...opened.state,
        mode: "StringValue",
        stringContext: "value",
        stringEscape: false,
        stringUnicode: null,
        currentNodeId: opened.nodeId,
      };
      s = advancePosition(s, ch);
      i += 1;
      return { state: s, pos: i };
    }

    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      const opened = openNode(s, "number");

      if (opened.state.error) {
        return { state: opened.state, pos: i };
      }

      const node = opened.state.nodes[opened.nodeId];
      const updated = { ...node, buffer: ch };
      const nodes = replaceNode(opened.state.nodes, opened.nodeId, updated);

      s = {
        ...opened.state,
        nodes,
        mode: "NumberValue",
        currentNodeId: opened.nodeId,
      };
      s = advancePosition(s, ch);
      i += 1;
      return { state: s, pos: i };
    }

    if (ch === "[") {
      const opened = openNode(s, "array");

      if (opened.state.error) {
        return { state: opened.state, pos: i };
      }

      s = { ...opened.state, mode: "ArrayItemOrEnd" };
      s = advancePosition(s, ch);
      i += 1;
      return { state: s, pos: i };
    }

    if (ch === "{") {
      const opened = openNode(s, "object");

      if (opened.state.error) {
        return { state: opened.state, pos: i };
      }

      s = { ...opened.state, mode: "ObjectKeyOrEnd" };
      s = advancePosition(s, ch);
      i += 1;
      return { state: s, pos: i };
    }

    return {
      state: toErrorState(
        s,
        `Unexpected character '${ch}' (U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")})`,
      ),
      pos: i,
    };
  }

  return { state: s, pos: i };
}

function finalizeLiteral(
  state: InternalState,
  nodeId: number,
  expected: string,
): InternalState {
  if (expected === "true") {
    return closePrimitive(state, nodeId, true);
  }

  if (expected === "false") {
    return closePrimitive(state, nodeId, false);
  }

  return closePrimitive(state, nodeId, null);
}
```

- [ ] **Step 5: Create `packages/json-stream/src/push.ts`**

```ts
import type { InternalState, StreamState } from "./types";
import { handleDone } from "./handlers/done";
import { handleValue } from "./handlers/value";

export function pushInternal(
  state: InternalState,
  chunk: string,
): InternalState {
  if (state.error) {
    return state;
  }

  let s = state;
  let pos = 0;

  while (pos < chunk.length) {
    if (s.error) {
      break;
    }

    switch (s.mode) {
      case "Value":
      case "ArrayItemOrEnd":
      case "ObjectKeyOrEnd": {
        const result = handleValue(s, chunk, pos);
        s = result.state;
        pos = result.pos;
        break;
      }
      case "Done": {
        const result = handleDone(s, chunk, pos);
        s = result.state;
        pos = result.pos;
        break;
      }
      case "LiteralValue": {
        const result = handleLiteralValue(s, chunk, pos);
        s = result.state;
        pos = result.pos;
        break;
      }
      case "Error":
        return s;
      default:
        pos = chunk.length;
        break;
    }
  }

  return s;
}

function handleLiteralValue(
  state: InternalState,
  chunk: string,
  pos: number,
): { state: InternalState; pos: number } {
  let s = state;
  let i = pos;
  const expected = s.literalExpected!;

  while (i < chunk.length) {
    const ch = chunk[i];
    const position = s.literalBuffer.length;

    if (expected[position] !== ch) {
      return {
        state: {
          ...s,
          error: {
            message: `Expected '${expected}' but got '${s.literalBuffer + ch}'`,
            index: s.index,
            line: s.line,
            column: s.column,
          },
          mode: "Error",
          complete: false,
        },
        pos: i,
      };
    }

    const buffer = s.literalBuffer + ch;
    s = {
      ...s,
      literalBuffer: buffer,
      index: s.index + 1,
      line: s.line,
      column: s.column + 1,
    };
    i += 1;

    if (buffer.length === expected.length) {
      if (s.currentNodeId === null) {
        return {
          state: {
            ...s,
            error: {
              message: "Internal error: missing literal node",
              index: s.index,
              line: s.line,
              column: s.column,
            },
            mode: "Error",
            complete: false,
          },
          pos: i,
        };
      }

      s = finalizeLiteral(s, s.currentNodeId, expected);

      if (s.error) {
        return { state: s, pos: i };
      }

      const { mode, complete } = afterValueInternal(s.stack);

      s = {
        ...s,
        mode,
        complete,
        literalExpected: null,
        literalBuffer: "",
        currentNodeId: null,
      };

      return { state: s, pos: i };
    }
  }

  return { state: s, pos: i };
}

function finalizeLiteral(
  state: InternalState,
  nodeId: number,
  expected: string,
): InternalState {
  const { closePrimitive } = require("./handlers/value");

  if (expected === "true") {
    return closePrimitive(state, nodeId, true);
  }

  if (expected === "false") {
    return closePrimitive(state, nodeId, false);
  }

  return closePrimitive(state, nodeId, null);
}

function afterValueInternal(stack: number[]) {
  if (stack.length === 0) {
    return { mode: "Done" as const, complete: true };
  }

  return { mode: "Separator" as const, complete: false };
}
```

**IMPORTANT:** The above `push.ts` uses `require` which won't work in ESM. Instead, refactor to import `closePrimitive` statically. The final implementation should use a proper import. The `closePrimitive` function was exported from `handlers/value.ts` in step 4. Replace the `require` call:

```ts
import { closePrimitive } from "./handlers/value";
```

And remove the `finalizeLiteral` function from `push.ts`. Instead, inline the literal finalization or import a shared utility. The cleaner approach: move `closePrimitive` to `nodes.ts` and import from there in both files.

Revised approach — move `closePrimitive` to `nodes.ts`:

Add to `packages/json-stream/src/nodes.ts`:

```ts
import type { AstNode, InternalState } from "./types";
import { propagateResolved } from "./identity";

export function closePrimitive(
  state: InternalState,
  nodeId: number,
  value: null | boolean | number | string,
): InternalState {
  const node = state.nodes[nodeId];
  const updated = { ...node, status: "complete" as const, value } as AstNode;
  let nodes = replaceNode(state.nodes, nodeId, updated);
  nodes = propagateResolved(nodes, updated.parentId);

  return { ...state, nodes };
}
```

Then in `push.ts`, import `closePrimitive` from `./nodes` and `afterValue` from `./nodes`:

```ts
import { closePrimitive, afterValue } from "./nodes";
```

**NOTE:** There is a circular dependency risk: `nodes.ts` imports from `identity.ts`, and `identity.ts` imports from `nodes.ts` (`replaceNode`). To avoid this, keep `replaceNode` and `createStreamError`/`toErrorState`/`afterValue` in `nodes.ts` (no imports from `identity.ts`), and put `closePrimitive` in a separate file or in `identity.ts`. The simplest solution: `closePrimitive` lives in its own small file, or we combine `nodes.ts` and `identity.ts` into a single `internals.ts`.

**Revised file structure for Task 4+5:**

Merge `nodes.ts` and `identity.ts` into a single `internals.ts` that has no circular imports:

- `internals.ts` — `replaceNode`, `createStreamError`, `toErrorState`, `afterValue`, `preserveArrayValue`, `preserveObjectValue`, `recomputeContainerValue`, `propagateResolved`, `closePrimitive`, `closeContainer`, `openNode`

This avoids circular dependencies entirely. All internal helpers in one file.

The implementer should use their judgment on file organization to avoid circular imports. The key constraint: no circular dependencies between source files.

- [ ] **Step 6: Create `packages/json-stream/src/finish.ts`**

```ts
import type { InternalState, StreamState } from "./types";
import type { NumberNode } from "./types";

export function finishInternal(state: InternalState): InternalState {
  if (state.error) {
    return state;
  }

  if (state.mode === "Done") {
    return state;
  }

  if (state.mode === "Value" && state.rootId === null) {
    return {
      ...state,
      error: {
        message: "Unexpected end of input",
        index: state.index,
        line: state.line,
        column: state.column,
      },
      mode: "Error",
      complete: false,
    };
  }

  if (state.mode === "NumberValue" && state.currentNodeId !== null) {
    const node = state.nodes[state.currentNodeId] as NumberNode;
    const num = Number(node.buffer);

    if (!isValidNumberFormat(node.buffer)) {
      return {
        ...state,
        error: {
          message: `Invalid number '${node.buffer}'`,
          index: state.index,
          line: state.line,
          column: state.column,
        },
        mode: "Error",
        complete: false,
      };
    }

    // Import closePrimitive from internals and use it here
    // closePrimitive(state, state.currentNodeId, num)
    // Then set mode to Done, complete to true
    // The implementer will wire this up properly
  }

  if (state.mode === "LiteralValue") {
    return {
      ...state,
      error: {
        message: `Unexpected end of input while parsing '${state.literalExpected}'`,
        index: state.index,
        line: state.line,
        column: state.column,
      },
      mode: "Error",
      complete: false,
    };
  }

  // For any other incomplete state (open strings, containers, etc.)
  return {
    ...state,
    error: {
      message: "Unexpected end of input",
      index: state.index,
      line: state.line,
      column: state.column,
    },
    mode: "Error",
    complete: false,
  };
}

function isValidNumberFormat(buffer: string): boolean {
  return /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(buffer);
}
```

- [ ] **Step 7: Update `packages/json-stream/src/index.ts`**

The full `index.ts` should wrap `pushInternal` and `finishInternal` to accept/return the public `StreamState`:

```ts
export type {
  AstNode,
  ArrayNode,
  BoolNode,
  JsonValue,
  NodeStatus,
  NullNode,
  NumberNode,
  ObjectNode,
  StreamError,
  StreamState,
  StringNode,
} from "./types";

export {
  isArrayNode,
  isBoolNode,
  isComplete,
  isNullNode,
  isNumberNode,
  isObjectNode,
  isStringNode,
} from "./guards";

export { resolve } from "./resolve";

import { createInternal } from "./create";
import { pushInternal } from "./push";
import { finishInternal } from "./finish";
import type { InternalState, StreamState } from "./types";

export function create(): StreamState {
  return createInternal();
}

export function push(state: StreamState, chunk: string): StreamState {
  return pushInternal(state as InternalState, chunk);
}

export function finish(state: StreamState): StreamState {
  return finishInternal(state as InternalState);
}
```

- [ ] **Step 8: Run test to verify it passes**

```bash
cd packages/json-stream && pnpm test
```

Expected: PASS — all `push` tests for literals pass.

- [ ] **Step 9: Commit**

```bash
git add packages/json-stream/src/push.ts packages/json-stream/src/finish.ts packages/json-stream/src/handlers/ packages/json-stream/src/index.ts packages/json-stream/src/__tests__/core-parsing.test.ts
git commit -m "feat(json-stream): add push(), finish(), and literal parsing (true/false/null)"
```

---

### Task 6: String Value Mode Handler

**Files:**

- Create: `packages/json-stream/src/handlers/string-value.ts`
- Modify: `packages/json-stream/src/push.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/json-stream/src/__tests__/core-parsing.test.ts`:

```ts
describe("push — strings", () => {
  test("parses simple string", () => {
    let state = create();
    state = push(state, '"hello"');
    state = finish(state);

    expect(resolve(state)).toBe("hello");
  });

  test("parses empty string", () => {
    let state = create();
    state = push(state, '""');
    state = finish(state);

    expect(resolve(state)).toBe("");
  });

  test("parses string with escape sequences", () => {
    let state = create();
    state = push(state, '"hello\\nworld\\t!"');
    state = finish(state);

    expect(resolve(state)).toBe("hello\nworld\t!");
  });

  test("parses string with unicode escape", () => {
    let state = create();
    state = push(state, '"\\u0041"');
    state = finish(state);

    expect(resolve(state)).toBe("A");
  });

  test("parses string with escaped quotes", () => {
    let state = create();
    state = push(state, '"say \\"hi\\""');
    state = finish(state);

    expect(resolve(state)).toBe('say "hi"');
  });

  test("parses string with backslash escape", () => {
    let state = create();
    state = push(state, '"path\\\\to\\\\file"');
    state = finish(state);

    expect(resolve(state)).toBe("path\\to\\file");
  });

  test("parses string with solidus escape", () => {
    let state = create();
    state = push(state, '"a\\/b"');
    state = finish(state);

    expect(resolve(state)).toBe("a/b");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/json-stream && pnpm test
```

Expected: FAIL — string parsing not yet implemented in push loop.

- [ ] **Step 3: Create `packages/json-stream/src/handlers/string-value.ts`**

```ts
import type { InternalState, StringNode } from "../types";
// Import closePrimitive, replaceNode, propagateResolved, toErrorState from internals

const ESCAPE_MAP: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

function isHexDigit(ch: string): boolean {
  return (
    (ch >= "0" && ch <= "9") ||
    (ch >= "a" && ch <= "f") ||
    (ch >= "A" && ch <= "F")
  );
}

export function handleStringValue(
  state: InternalState,
  chunk: string,
  pos: number,
): { state: InternalState; pos: number } {
  let s = state;
  let i = pos;

  while (i < chunk.length) {
    const ch = chunk[i];

    // Unicode escape accumulation
    if (s.stringUnicode !== null) {
      if (!isHexDigit(ch)) {
        return {
          state: toErrorState(
            s,
            `Invalid unicode escape: expected hex digit, got '${ch}'`,
          ),
          pos: i,
        };
      }

      const nextUnicode = s.stringUnicode + ch;

      if (nextUnicode.length === 4) {
        const codePoint = Number.parseInt(nextUnicode, 16);
        s = appendStringFragment(s, String.fromCharCode(codePoint));
        s = { ...s, stringUnicode: null };
      } else {
        s = { ...s, stringUnicode: nextUnicode };
      }

      s = advancePosition(s, ch);
      i += 1;
      continue;
    }

    // Escape sequence
    if (s.stringEscape) {
      if (ch === "u") {
        s = { ...s, stringEscape: false, stringUnicode: "" };
        s = advancePosition(s, ch);
        i += 1;
        continue;
      }

      const mapped = ESCAPE_MAP[ch];

      if (!mapped) {
        return {
          state: toErrorState(s, `Invalid escape sequence '\\${ch}'`),
          pos: i,
        };
      }

      s = appendStringFragment(s, mapped);
      s = { ...s, stringEscape: false };
      s = advancePosition(s, ch);
      i += 1;
      continue;
    }

    // Backslash starts escape
    if (ch === "\\") {
      s = { ...s, stringEscape: true };
      s = advancePosition(s, ch);
      i += 1;
      continue;
    }

    // Closing quote
    if (ch === '"') {
      if (s.stringContext === "value") {
        // Close string node
        const nodeId = s.currentNodeId!;
        const node = s.nodes[nodeId] as StringNode;
        s = closePrimitive(s, nodeId, node.buffer);
        const { mode, complete } = afterValue(s.stack);
        s = {
          ...s,
          mode,
          complete,
          stringContext: null,
          stringEscape: false,
          stringUnicode: null,
          currentNodeId: null,
        };
      } else {
        // Close key string
        const topId = s.stack[s.stack.length - 1] ?? null;
        s = {
          ...s,
          pendingKey: s.keyBuffer,
          pendingKeyOwner: topId,
          keyBuffer: "",
          mode: "ObjectColon",
          stringContext: null,
          stringEscape: false,
          stringUnicode: null,
        };
      }

      s = advancePosition(s, ch);
      i += 1;
      return { state: s, pos: i };
    }

    // Control character check
    if (ch < " ") {
      const code = ch.charCodeAt(0);
      const hex = code.toString(16).toUpperCase().padStart(4, "0");
      const name = CONTROL_CHAR_NAMES[code] || "";
      const label = name ? ` (${name})` : "";
      return {
        state: toErrorState(
          s,
          `Invalid control character U+${hex}${label} in string at line ${s.line}, column ${s.column}`,
        ),
        pos: i,
      };
    }

    // Regular character
    s = appendStringFragment(s, ch);
    s = advancePosition(s, ch);
    i += 1;
  }

  return { state: s, pos: i };
}

const CONTROL_CHAR_NAMES: Record<number, string> = {
  0x00: "NULL",
  0x08: "BACKSPACE",
  0x09: "TAB",
  0x0a: "LINE FEED",
  0x0b: "VERTICAL TAB",
  0x0c: "FORM FEED",
  0x0d: "CARRIAGE RETURN",
  0x1b: "ESCAPE",
};

// The implementer must import and wire up:
// - toErrorState from internals
// - closePrimitive from internals
// - afterValue from internals
// - advancePosition (shared utility or local)
// - appendStringFragment: updates the string node's buffer and propagates
//
// appendStringFragment for "value" context:
//   const node = s.nodes[s.currentNodeId!] as StringNode;
//   const nextBuffer = node.buffer + fragment;
//   const updated = { ...node, buffer: nextBuffer, value: nextBuffer };
//   let nodes = replaceNode(s.nodes, s.currentNodeId!, updated);
//   nodes = propagateResolved(nodes, updated.parentId);
//   return { ...s, nodes };
//
// appendStringFragment for "key" context:
//   return { ...s, keyBuffer: s.keyBuffer + fragment };
```

- [ ] **Step 4: Wire `handleStringValue` into `push.ts`**

Add a `case "StringValue"` to the switch in `pushInternal`:

```ts
case "StringValue": {
  const result = handleStringValue(s, chunk, pos);
  s = result.state;
  pos = result.pos;
  break;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd packages/json-stream && pnpm test
```

Expected: PASS — all string tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/json-stream/src/handlers/string-value.ts packages/json-stream/src/push.ts packages/json-stream/src/__tests__/core-parsing.test.ts
git commit -m "feat(json-stream): add string value parsing with escape sequences and unicode"
```

---

### Task 7: Number Value Mode Handler with Streaming Validation

**Files:**

- Create: `packages/json-stream/src/handlers/number-value.ts`
- Modify: `packages/json-stream/src/push.ts`
- Create: `packages/json-stream/src/__tests__/numbers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/json-stream/src/__tests__/numbers.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { create, push, finish, resolve } from "../index";

describe("number parsing", () => {
  describe("valid numbers", () => {
    const valid = [
      ["0", 0],
      ["-0", -0],
      ["1", 1],
      ["-1", -1],
      ["42", 42],
      ["1.5", 1.5],
      ["-1.5", -1.5],
      ["1e10", 1e10],
      ["1E10", 1e10],
      ["1e+10", 1e10],
      ["1e-10", 1e-10],
      ["1.5e10", 1.5e10],
      ["1.5E-3", 1.5e-3],
      ["123456789", 123456789],
      ["1e308", 1e308],
    ] as const;

    for (const [input, expected] of valid) {
      test(`parses ${input}`, () => {
        let state = create();
        state = push(state, String(input));
        state = finish(state);

        expect(state.error).toBeNull();
        expect(resolve(state)).toBe(expected);
      });
    }
  });

  describe("invalid numbers — early rejection", () => {
    const invalid = [
      ["01", "leading zero"],
      ["00", "leading zero"],
      ["+1", "unexpected character"],
      [".5", "unexpected character"],
    ] as const;

    for (const [input, _reason] of invalid) {
      test(`rejects ${input}`, () => {
        let state = create();
        state = push(state, input);
        state = finish(state);

        expect(state.error).not.toBeNull();
      });
    }
  });

  describe("invalid numbers — rejected at finish", () => {
    const invalid = [
      ["1.", "trailing dot"],
      ["1e", "trailing exponent marker"],
      ["1e+", "trailing exponent sign"],
    ] as const;

    for (const [input, _reason] of invalid) {
      test(`rejects ${input}`, () => {
        let state = create();
        state = push(state, input);
        state = finish(state);

        expect(state.error).not.toBeNull();
      });
    }
  });

  test("number split across chunks", () => {
    let state = create();
    state = push(state, "1");
    state = push(state, "2");
    state = push(state, "3");
    state = push(state, ".4");
    state = push(state, "5");
    state = finish(state);

    expect(resolve(state)).toBe(123.45);
  });

  test("number terminated by non-number character", () => {
    let state = create();
    state = push(state, "[42]");
    state = finish(state);

    expect(resolve(state)).toEqual([42]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/json-stream && pnpm test
```

Expected: FAIL — number parsing not implemented.

- [ ] **Step 3: Create `packages/json-stream/src/handlers/number-value.ts`**

The number handler uses a state machine approach for streaming validation. Instead of accumulating the full buffer and validating with a regex at the end (like hashbrown), it validates format constraints as each character arrives. This allows early rejection of `01`, `00`, etc.

Number format state machine phases:

1. After `-`: expect digit
2. After `0` (as first digit): expect `.`, `e`/`E`, or end — NOT another digit (rejects `01`, `00`)
3. After `1-9`: accumulate digits
4. After `.`: expect at least one digit
5. After `e`/`E`: expect optional `+`/`-`, then at least one digit

```ts
import type { InternalState, NumberNode } from "../types";
// Import closePrimitive, replaceNode, afterValue, toErrorState from internals

type NumberPhase =
  | "start" // initial state, seen nothing or just -
  | "leading-zero" // saw 0 as first digit (after optional -)
  | "integer" // accumulating integer digits (first was 1-9)
  | "dot" // just saw .
  | "fraction" // accumulating fraction digits
  | "exp-marker" // just saw e/E
  | "exp-sign" // just saw +/- after e/E
  | "exponent"; // accumulating exponent digits

function classifyPhase(buffer: string): NumberPhase {
  if (buffer === "" || buffer === "-") return "start";

  const afterSign = buffer.startsWith("-") ? buffer.slice(1) : buffer;

  if (afterSign === "0") return "leading-zero";

  const dotIdx = afterSign.indexOf(".");
  const eIdx = afterSign.search(/[eE]/);

  if (eIdx !== -1) {
    const afterE = afterSign.slice(eIdx + 1);
    if (afterE === "") return "exp-marker";
    if (afterE === "+" || afterE === "-") return "exp-sign";
    return "exponent";
  }

  if (dotIdx !== -1) {
    const afterDot = afterSign.slice(dotIdx + 1);
    if (afterDot === "") return "dot";
    return "fraction";
  }

  return "integer";
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

export function handleNumberValue(
  state: InternalState,
  chunk: string,
  pos: number,
): { state: InternalState; pos: number } {
  let s = state;
  let i = pos;

  while (i < chunk.length) {
    const ch = chunk[i];
    const nodeId = s.currentNodeId!;
    const node = s.nodes[nodeId] as NumberNode;
    const phase = classifyPhase(node.buffer);

    // Check if this character can extend the number
    const canExtend = canAcceptChar(phase, ch);

    if (canExtend === "accept") {
      const updated = { ...node, buffer: node.buffer + ch };
      const nodes = replaceNode(s.nodes, nodeId, updated);
      s = { ...s, nodes };
      s = advancePosition(s, ch);
      i += 1;
      continue;
    }

    if (canExtend === "reject-early") {
      return {
        state: toErrorState(
          s,
          `Invalid number: unexpected '${ch}' in '${node.buffer + ch}'`,
        ),
        pos: i,
      };
    }

    // "terminate" — finalize the number, don't consume this character
    if (!isValidCompleteNumber(node.buffer)) {
      return {
        state: toErrorState(s, `Invalid number '${node.buffer}'`),
        pos: i,
      };
    }

    const value = Number(node.buffer);
    s = closePrimitive(s, nodeId, value);

    if (s.error) {
      return { state: s, pos: i };
    }

    s = { ...s, currentNodeId: null };
    const result = afterValue(s.stack);
    s = { ...s, mode: result.mode, complete: result.complete };

    // Don't advance i — the current character needs to be re-processed
    return { state: s, pos: i };
  }

  return { state: s, pos: i };
}

function canAcceptChar(
  phase: NumberPhase,
  ch: string,
): "accept" | "reject-early" | "terminate" {
  switch (phase) {
    case "start":
      if (isDigit(ch) || ch === "-") return "accept";
      return "terminate";

    case "leading-zero":
      if (ch === ".") return "accept";
      if (ch === "e" || ch === "E") return "accept";
      if (isDigit(ch)) return "reject-early"; // 01, 00, etc.
      return "terminate";

    case "integer":
      if (isDigit(ch)) return "accept";
      if (ch === ".") return "accept";
      if (ch === "e" || ch === "E") return "accept";
      return "terminate";

    case "dot":
      if (isDigit(ch)) return "accept";
      return "reject-early"; // 1. followed by non-digit

    case "fraction":
      if (isDigit(ch)) return "accept";
      if (ch === "e" || ch === "E") return "accept";
      return "terminate";

    case "exp-marker":
      if (isDigit(ch)) return "accept";
      if (ch === "+" || ch === "-") return "accept";
      return "reject-early"; // 1e followed by non-digit/sign

    case "exp-sign":
      if (isDigit(ch)) return "accept";
      return "reject-early"; // 1e+ followed by non-digit

    case "exponent":
      if (isDigit(ch)) return "accept";
      return "terminate";
  }
}

function isValidCompleteNumber(buffer: string): boolean {
  return /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(buffer);
}

// The implementer must import and wire up:
// - closePrimitive, replaceNode, afterValue, toErrorState from internals
// - advancePosition (shared utility)
```

- [ ] **Step 4: Wire `handleNumberValue` into `push.ts`**

Add to the switch:

```ts
case "NumberValue": {
  const result = handleNumberValue(s, chunk, pos);
  s = result.state;
  pos = result.pos;
  break;
}
```

- [ ] **Step 5: Update `finish.ts` for number finalization**

In `finishInternal`, when `mode === "NumberValue"`, validate and close the number using the same `isValidCompleteNumber` check and `closePrimitive`.

- [ ] **Step 6: Run test to verify it passes**

```bash
cd packages/json-stream && pnpm test
```

Expected: PASS — all number tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/json-stream/src/handlers/number-value.ts packages/json-stream/src/push.ts packages/json-stream/src/finish.ts packages/json-stream/src/__tests__/numbers.test.ts
git commit -m "feat(json-stream): add streaming number validation with early rejection"
```

---

### Task 8: Array and Separator Mode Handlers

**Files:**

- Create: `packages/json-stream/src/handlers/array-item-or-end.ts`
- Create: `packages/json-stream/src/handlers/separator.ts`
- Modify: `packages/json-stream/src/push.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/json-stream/src/__tests__/core-parsing.test.ts`:

```ts
describe("push — arrays", () => {
  test("parses empty array", () => {
    let state = create();
    state = push(state, "[]");
    state = finish(state);

    expect(resolve(state)).toEqual([]);
  });

  test("parses array with single element", () => {
    let state = create();
    state = push(state, "[1]");
    state = finish(state);

    expect(resolve(state)).toEqual([1]);
  });

  test("parses array with multiple elements", () => {
    let state = create();
    state = push(state, '[1, "two", true, null]');
    state = finish(state);

    expect(resolve(state)).toEqual([1, "two", true, null]);
  });

  test("parses nested arrays", () => {
    let state = create();
    state = push(state, "[[1, 2], [3, 4]]");
    state = finish(state);

    expect(resolve(state)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  test("parses array with whitespace", () => {
    let state = create();
    state = push(state, "[ 1 , 2 , 3 ]");
    state = finish(state);

    expect(resolve(state)).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/json-stream && pnpm test
```

Expected: FAIL — array parsing not yet wired up in push loop.

- [ ] **Step 3: Create `packages/json-stream/src/handlers/array-item-or-end.ts`**

```ts
import type { InternalState } from "../types";
// Import afterValue, toErrorState, closeContainer from internals

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

export function handleArrayItemOrEnd(
  state: InternalState,
  chunk: string,
  pos: number,
): { state: InternalState; pos: number } {
  let s = state;
  let i = pos;

  while (i < chunk.length) {
    const ch = chunk[i];

    if (isWhitespace(ch)) {
      s = advancePosition(s, ch);
      i += 1;
      continue;
    }

    if (ch === "]") {
      // Empty array — close it
      const nodeId = s.stack[s.stack.length - 1];
      s = closeContainer(s, nodeId);
      const stack = s.stack.slice(0, -1);
      const result = afterValue(stack);
      s = { ...s, stack, mode: result.mode, complete: result.complete };
      s = advancePosition(s, ch);
      i += 1;
      return { state: s, pos: i };
    }

    // Not ], so dispatch to Value mode for the first element
    s = { ...s, mode: "Value" };
    return { state: s, pos: i };
  }

  return { state: s, pos: i };
}
```

- [ ] **Step 4: Create `packages/json-stream/src/handlers/separator.ts`**

```ts
import type { InternalState } from "../types";
// Import afterValue, closeContainer, toErrorState from internals

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

export function handleSeparator(
  state: InternalState,
  chunk: string,
  pos: number,
): { state: InternalState; pos: number } {
  let s = state;
  let i = pos;

  while (i < chunk.length) {
    const ch = chunk[i];

    if (isWhitespace(ch)) {
      s = advancePosition(s, ch);
      i += 1;
      continue;
    }

    const topId = s.stack[s.stack.length - 1];
    const topNode = s.nodes[topId];

    if (ch === ",") {
      if (topNode.kind === "array") {
        s = { ...s, mode: "Value" };
      } else if (topNode.kind === "object") {
        s = { ...s, mode: "ObjectKeyOrEnd" };
      }

      s = advancePosition(s, ch);
      i += 1;
      return { state: s, pos: i };
    }

    if (ch === "]") {
      if (topNode.kind !== "array") {
        return {
          state: toErrorState(s, "Unexpected ']' in object"),
          pos: i,
        };
      }

      s = closeContainer(s, topId);
      const stack = s.stack.slice(0, -1);
      const result = afterValue(stack);
      s = { ...s, stack, mode: result.mode, complete: result.complete };
      s = advancePosition(s, ch);
      i += 1;
      return { state: s, pos: i };
    }

    if (ch === "}") {
      if (topNode.kind !== "object") {
        return {
          state: toErrorState(s, "Unexpected '}' in array"),
          pos: i,
        };
      }

      s = closeContainer(s, topId);
      const stack = s.stack.slice(0, -1);
      const result = afterValue(stack);
      s = { ...s, stack, mode: result.mode, complete: result.complete };
      s = advancePosition(s, ch);
      i += 1;
      return { state: s, pos: i };
    }

    return {
      state: toErrorState(s, `Expected ',' or closing bracket, got '${ch}'`),
      pos: i,
    };
  }

  return { state: s, pos: i };
}
```

- [ ] **Step 5: Add `closeContainer` to internals**

```ts
export function closeContainer(
  state: InternalState,
  nodeId: number,
): InternalState {
  const node = state.nodes[nodeId];
  const updated = { ...node, status: "complete" as const } as AstNode;
  let nodes = replaceNode(state.nodes, nodeId, updated);
  nodes = propagateResolved(nodes, updated.parentId);

  return { ...state, nodes };
}
```

- [ ] **Step 6: Wire handlers into `push.ts`**

Add cases to the switch:

```ts
case "ArrayItemOrEnd": {
  const result = handleArrayItemOrEnd(s, chunk, pos);
  s = result.state;
  pos = result.pos;
  break;
}
case "Separator": {
  const result = handleSeparator(s, chunk, pos);
  s = result.state;
  pos = result.pos;
  break;
}
```

- [ ] **Step 7: Run test to verify it passes**

```bash
cd packages/json-stream && pnpm test
```

Expected: PASS — all array tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/json-stream/src/handlers/array-item-or-end.ts packages/json-stream/src/handlers/separator.ts packages/json-stream/src/push.ts packages/json-stream/src/__tests__/core-parsing.test.ts
git commit -m "feat(json-stream): add array parsing with separator handling"
```

---

### Task 9: Object Mode Handlers

**Files:**

- Create: `packages/json-stream/src/handlers/object-key-or-end.ts`
- Create: `packages/json-stream/src/handlers/object-colon.ts`
- Modify: `packages/json-stream/src/push.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/json-stream/src/__tests__/core-parsing.test.ts`:

```ts
describe("push — objects", () => {
  test("parses empty object", () => {
    let state = create();
    state = push(state, "{}");
    state = finish(state);

    expect(resolve(state)).toEqual({});
  });

  test("parses object with single key", () => {
    let state = create();
    state = push(state, '{"a": 1}');
    state = finish(state);

    expect(resolve(state)).toEqual({ a: 1 });
  });

  test("parses object with multiple keys", () => {
    let state = create();
    state = push(state, '{"a": 1, "b": "two", "c": true}');
    state = finish(state);

    expect(resolve(state)).toEqual({ a: 1, b: "two", c: true });
  });

  test("parses nested objects", () => {
    let state = create();
    state = push(state, '{"outer": {"inner": 42}}');
    state = finish(state);

    expect(resolve(state)).toEqual({ outer: { inner: 42 } });
  });

  test("parses object with array value", () => {
    let state = create();
    state = push(state, '{"items": [1, 2, 3]}');
    state = finish(state);

    expect(resolve(state)).toEqual({ items: [1, 2, 3] });
  });

  test("parses complex nested structure", () => {
    let state = create();
    state = push(
      state,
      '{"users": [{"name": "Alice", "scores": [10, 20]}, {"name": "Bob", "scores": [30]}]}',
    );
    state = finish(state);

    expect(resolve(state)).toEqual({
      users: [
        { name: "Alice", scores: [10, 20] },
        { name: "Bob", scores: [30] },
      ],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/json-stream && pnpm test
```

Expected: FAIL — object parsing not yet wired up.

- [ ] **Step 3: Create `packages/json-stream/src/handlers/object-key-or-end.ts`**

```ts
import type { InternalState } from "../types";
// Import afterValue, closeContainer, toErrorState from internals

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

export function handleObjectKeyOrEnd(
  state: InternalState,
  chunk: string,
  pos: number,
): { state: InternalState; pos: number } {
  let s = state;
  let i = pos;

  while (i < chunk.length) {
    const ch = chunk[i];

    if (isWhitespace(ch)) {
      s = advancePosition(s, ch);
      i += 1;
      continue;
    }

    if (ch === "}") {
      const nodeId = s.stack[s.stack.length - 1];
      s = closeContainer(s, nodeId);
      const stack = s.stack.slice(0, -1);
      const result = afterValue(stack);
      s = { ...s, stack, mode: result.mode, complete: result.complete };
      s = advancePosition(s, ch);
      i += 1;
      return { state: s, pos: i };
    }

    if (ch === '"') {
      // Start reading key string
      s = {
        ...s,
        mode: "StringValue",
        stringContext: "key",
        stringEscape: false,
        stringUnicode: null,
        keyBuffer: "",
      };
      s = advancePosition(s, ch);
      i += 1;
      return { state: s, pos: i };
    }

    return {
      state: toErrorState(s, `Expected string key or '}', got '${ch}'`),
      pos: i,
    };
  }

  return { state: s, pos: i };
}
```

- [ ] **Step 4: Create `packages/json-stream/src/handlers/object-colon.ts`**

```ts
import type { InternalState } from "../types";
// Import toErrorState from internals

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

export function handleObjectColon(
  state: InternalState,
  chunk: string,
  pos: number,
): { state: InternalState; pos: number } {
  let s = state;
  let i = pos;

  while (i < chunk.length) {
    const ch = chunk[i];

    if (isWhitespace(ch)) {
      s = advancePosition(s, ch);
      i += 1;
      continue;
    }

    if (ch === ":") {
      s = { ...s, mode: "Value" };
      s = advancePosition(s, ch);
      i += 1;
      return { state: s, pos: i };
    }

    return {
      state: toErrorState(s, `Expected ':', got '${ch}'`),
      pos: i,
    };
  }

  return { state: s, pos: i };
}
```

- [ ] **Step 5: Wire handlers into `push.ts`**

Add cases to the switch:

```ts
case "ObjectKeyOrEnd": {
  const result = handleObjectKeyOrEnd(s, chunk, pos);
  s = result.state;
  pos = result.pos;
  break;
}
case "ObjectColon": {
  const result = handleObjectColon(s, chunk, pos);
  s = result.state;
  pos = result.pos;
  break;
}
```

Also update the separator handler's comma-in-object path: when comma is seen inside an object, the `handleSeparator` already transitions to `"ObjectKeyOrEnd"` which will be handled by the new handler on the next loop iteration.

- [ ] **Step 6: Run test to verify it passes**

```bash
cd packages/json-stream && pnpm test
```

Expected: PASS — all object tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/json-stream/src/handlers/object-key-or-end.ts packages/json-stream/src/handlers/object-colon.ts packages/json-stream/src/push.ts packages/json-stream/src/__tests__/core-parsing.test.ts
git commit -m "feat(json-stream): add object parsing with key/colon/value handling"
```

---

### Task 10: Chunk Boundary Tests

**Files:**

- Create: `packages/json-stream/src/__tests__/chunk-boundary.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/json-stream/src/__tests__/chunk-boundary.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { create, push, finish, resolve } from "../index";

describe("chunk boundary splitting", () => {
  test("string split across chunks", () => {
    let state = create();
    state = push(state, '"hel');
    state = push(state, 'lo"');
    state = finish(state);

    expect(resolve(state)).toBe("hello");
  });

  test("string escape split across chunks", () => {
    let state = create();
    state = push(state, '"a\\');
    state = push(state, 'nb"');
    state = finish(state);

    expect(resolve(state)).toBe("a\nb");
  });

  test("unicode escape split across chunks", () => {
    let state = create();
    state = push(state, '"\\u00');
    state = push(state, '41"');
    state = finish(state);

    expect(resolve(state)).toBe("A");
  });

  test("unicode escape split at every position", () => {
    const input = '"\\u0041"';

    for (let split = 1; split < input.length; split++) {
      let state = create();
      state = push(state, input.slice(0, split));
      state = push(state, input.slice(split));
      state = finish(state);

      expect(resolve(state)).toBe("A");
    }
  });

  test("literal split across chunks (t-r-u-e)", () => {
    let state = create();
    state = push(state, "t");
    state = push(state, "r");
    state = push(state, "u");
    state = push(state, "e");
    state = finish(state);

    expect(resolve(state)).toBe(true);
  });

  test("literal split across chunks (f-a-l-s-e)", () => {
    let state = create();
    state = push(state, "f");
    state = push(state, "a");
    state = push(state, "l");
    state = push(state, "s");
    state = push(state, "e");
    state = finish(state);

    expect(resolve(state)).toBe(false);
  });

  test("literal split across chunks (n-u-l-l)", () => {
    let state = create();
    state = push(state, "n");
    state = push(state, "u");
    state = push(state, "l");
    state = push(state, "l");
    state = finish(state);

    expect(resolve(state)).toBeNull();
  });

  test("number mantissa split", () => {
    let state = create();
    state = push(state, "12");
    state = push(state, "3.4");
    state = push(state, "5");
    state = finish(state);

    expect(resolve(state)).toBe(123.45);
  });

  test("number exponent boundary split", () => {
    let state = create();
    state = push(state, "1e");
    state = push(state, "+10");
    state = finish(state);

    expect(resolve(state)).toBe(1e10);
  });

  test("object key split across chunks", () => {
    let state = create();
    state = push(state, '{"hel');
    state = push(state, 'lo": 1}');
    state = finish(state);

    expect(resolve(state)).toEqual({ hello: 1 });
  });

  test("object key with escape across chunks", () => {
    let state = create();
    state = push(state, '{"a\\');
    state = push(state, 'nb": 1}');
    state = finish(state);

    expect(resolve(state)).toEqual({ "a\nb": 1 });
  });

  test("deep nesting across boundaries", () => {
    let state = create();
    state = push(state, "[[");
    state = push(state, "[1]");
    state = push(state, "]]");
    state = finish(state);

    expect(resolve(state)).toEqual([[[1]]]);
  });

  test("complete JSON parsed one character at a time", () => {
    const json = '{"a": [1, "b", true, null]}';
    let state = create();

    for (const ch of json) {
      state = push(state, ch);
    }

    state = finish(state);

    expect(state.error).toBeNull();
    expect(resolve(state)).toEqual({ a: [1, "b", true, null] });
  });

  test("complete JSON parsed in single chunk", () => {
    const json = '{"a": [1, "b", true, null]}';
    let state = create();
    state = push(state, json);
    state = finish(state);

    expect(resolve(state)).toEqual({ a: [1, "b", true, null] });
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

```bash
cd packages/json-stream && pnpm test
```

Expected: PASS — all chunk boundary tests pass (these exercise the already-implemented handlers).

- [ ] **Step 3: Commit**

```bash
git add packages/json-stream/src/__tests__/chunk-boundary.test.ts
git commit -m "test(json-stream): add chunk boundary splitting tests"
```

---

### Task 11: Streaming Behavior and Identity Preservation Tests

**Files:**

- Create: `packages/json-stream/src/__tests__/streaming.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/json-stream/src/__tests__/streaming.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import {
  create,
  push,
  finish,
  resolve,
  isArrayNode,
  isObjectNode,
} from "../index";
import type { ArrayNode, ObjectNode, StreamState } from "../index";

describe("streaming — partial values", () => {
  test("incomplete array exposes partial value", () => {
    let state = create();
    state = push(state, "[1, 2, ");

    expect(state.complete).toBe(false);
    expect(resolve(state)).toEqual([1, 2]);
  });

  test("incomplete object exposes partial value", () => {
    let state = create();
    state = push(state, '{"a": 1, "b":');

    expect(state.complete).toBe(false);
    expect(resolve(state)).toEqual({ a: 1 });
  });

  test("incomplete object with complete second value", () => {
    let state = create();
    state = push(state, '{"a": 1, "b": 2, "c":');

    expect(resolve(state)).toEqual({ a: 1, b: 2 });
  });

  test("array grows element by element", () => {
    let state = create();
    state = push(state, "[");
    expect(resolve(state)).toEqual([]);

    state = push(state, "1");
    // Number not yet terminated, so still []
    state = push(state, ",");
    expect(resolve(state)).toEqual([1]);

    state = push(state, "2");
    state = push(state, ",");
    expect(resolve(state)).toEqual([1, 2]);

    state = push(state, "3]");
    state = finish(state);
    expect(resolve(state)).toEqual([1, 2, 3]);
  });
});

describe("streaming — identity preservation", () => {
  test("unchanged nodes keep same references across pushes", () => {
    let state = create();
    state = push(state, "[1, 2");

    const node1Before = state.nodes[1]; // node for value 1

    state = push(state, ", 3");

    const node1After = state.nodes[1]; // should be same reference
    expect(node1After).toBe(node1Before);
  });

  test("unchanged container value keeps same reference", () => {
    let state = create();
    state = push(state, "[[1, 2], ");

    const innerArrayValue = (state.nodes[1] as ArrayNode).value;

    state = push(state, "[3, 4]]");
    state = finish(state);

    // Inner array [1, 2] was already complete — its value reference should be preserved
    const innerArrayValueAfter = (state.nodes[1] as ArrayNode).value;
    expect(innerArrayValueAfter).toBe(innerArrayValue);
  });

  test("sibling identity when appending to arrays", () => {
    let state = create();
    state = push(state, '["a", "b"');

    const nodeA = state.nodes[1]; // "a" node

    state = push(state, ', "c"]');
    state = finish(state);

    // "a" node should be the same reference
    expect(state.nodes[1]).toBe(nodeA);
  });

  test("root array value reference changes when new element is added", () => {
    let state = create();
    state = push(state, "[1,");

    const valueBefore = resolve(state);

    state = push(state, "2,");

    const valueAfter = resolve(state);
    expect(valueAfter).not.toBe(valueBefore);
    expect(valueAfter).toEqual([1, 2]);
  });

  test("root array value reference preserved when no change", () => {
    let state = create();
    state = push(state, "[1, 2, ");

    const valueBefore = resolve(state);

    // Push whitespace only — no structural change
    state = push(state, "  ");

    const valueAfter = resolve(state);
    expect(valueAfter).toBe(valueBefore);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd packages/json-stream && pnpm test
```

Expected: PASS — all streaming and identity tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/json-stream/src/__tests__/streaming.test.ts
git commit -m "test(json-stream): add streaming partial values and identity preservation tests"
```

---

### Task 12: Error Handling Tests

**Files:**

- Create: `packages/json-stream/src/__tests__/errors.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/json-stream/src/__tests__/errors.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { create, push, finish } from "../index";

describe("error handling", () => {
  test("trailing token after root value", () => {
    let state = create();
    state = push(state, "true false");

    expect(state.error).not.toBeNull();
    expect(state.error!.message).toContain("Unexpected");
  });

  test("invalid escape sequence", () => {
    let state = create();
    state = push(state, '"\\x"');

    expect(state.error).not.toBeNull();
    expect(state.error!.message).toContain("escape");
  });

  test("invalid unicode escape", () => {
    let state = create();
    state = push(state, '"\\uZZZZ"');

    expect(state.error).not.toBeNull();
    expect(state.error!.message).toContain("unicode");
  });

  test("control character in string includes char code", () => {
    let state = create();
    state = push(state, '"a\tb"');

    expect(state.error).not.toBeNull();
    expect(state.error!.message).toContain("U+0009");
    expect(state.error!.message).toContain("TAB");
  });

  test("null byte in string", () => {
    let state = create();
    state = push(state, '"a\0b"');

    expect(state.error).not.toBeNull();
    expect(state.error!.message).toContain("U+0000");
  });

  test("missing colon in object", () => {
    let state = create();
    state = push(state, '{"a" 1}');

    expect(state.error).not.toBeNull();
    expect(state.error!.message).toContain(":");
  });

  test("missing comma in array", () => {
    let state = create();
    state = push(state, "[1 2]");

    expect(state.error).not.toBeNull();
  });

  test("missing comma in object", () => {
    let state = create();
    state = push(state, '{"a": 1 "b": 2}');

    expect(state.error).not.toBeNull();
  });

  test("trailing comma in array", () => {
    let state = create();
    state = push(state, "[1,]");

    expect(state.error).not.toBeNull();
  });

  test("trailing comma in object", () => {
    let state = create();
    state = push(state, '{"a": 1,}');

    expect(state.error).not.toBeNull();
  });

  test("unexpected EOF — unclosed array", () => {
    let state = create();
    state = push(state, "[1, 2");
    state = finish(state);

    expect(state.error).not.toBeNull();
    expect(state.error!.message).toContain("end of input");
  });

  test("unexpected EOF — unclosed object", () => {
    let state = create();
    state = push(state, '{"a": 1');
    state = finish(state);

    expect(state.error).not.toBeNull();
  });

  test("unexpected EOF — unclosed string", () => {
    let state = create();
    state = push(state, '"hello');
    state = finish(state);

    expect(state.error).not.toBeNull();
  });

  test("unexpected EOF — empty input", () => {
    let state = create();
    state = finish(state);

    expect(state.error).not.toBeNull();
  });

  test("error includes line and column", () => {
    let state = create();
    state = push(state, '{\n  "a": 1,\n  "b": }');

    expect(state.error).not.toBeNull();
    expect(state.error!.line).toBe(3);
    expect(state.error!.column).toBeGreaterThan(1);
  });

  test("subsequent push after error returns same state", () => {
    let state = create();
    state = push(state, "tru!");

    const errorState = state;
    state = push(state, "e");

    expect(state).toBe(errorState);
  });

  test("error state has error.index pointing to offending character", () => {
    let state = create();
    state = push(state, '{"a": !}');

    expect(state.error).not.toBeNull();
    expect(state.error!.index).toBeGreaterThan(5);
  });

  test("invalid literal partial match", () => {
    let state = create();
    state = push(state, "tru!");

    expect(state.error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd packages/json-stream && pnpm test
```

Expected: PASS — all error tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/json-stream/src/__tests__/errors.test.ts
git commit -m "test(json-stream): add comprehensive error handling tests"
```

---

### Task 13: Edge Cases — Duplicate Keys, Deep Nesting, Control Characters

**Files:**

- Create: `packages/json-stream/src/__tests__/edge-cases.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/json-stream/src/__tests__/edge-cases.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { create, push, finish, resolve } from "../index";

describe("edge cases", () => {
  test("duplicate object keys — last wins", () => {
    let state = create();
    state = push(state, '{"a": 1, "a": 2}');
    state = finish(state);

    expect(resolve(state)).toEqual({ a: 2 });
  });

  test("duplicate object keys — three occurrences", () => {
    let state = create();
    state = push(state, '{"x": 1, "x": 2, "x": 3}');
    state = finish(state);

    expect(resolve(state)).toEqual({ x: 3 });
  });

  test("deep nesting stress — 100 levels of arrays", () => {
    const open = "[".repeat(100);
    const close = "]".repeat(100);
    const json = `${open}1${close}`;

    let state = create();
    state = push(state, json);
    state = finish(state);

    expect(state.error).toBeNull();
    expect(state.complete).toBe(true);

    // Verify innermost value
    let result = resolve(state);

    for (let i = 0; i < 100; i++) {
      expect(Array.isArray(result)).toBe(true);
      result = (result as unknown[])[0];
    }

    expect(result).toBe(1);
  });

  test("deep nesting stress — 100 levels of objects", () => {
    let json = "";

    for (let i = 0; i < 100; i++) {
      json += `{"k${i}":`;
    }

    json += "1";

    for (let i = 0; i < 100; i++) {
      json += "}";
    }

    let state = create();
    state = push(state, json);
    state = finish(state);

    expect(state.error).toBeNull();
    expect(state.complete).toBe(true);
  });

  test("all control characters U+0000 through U+001F rejected in strings", () => {
    for (let code = 0; code <= 0x1f; code++) {
      const ch = String.fromCharCode(code);
      let state = create();
      state = push(state, `"a${ch}b"`);

      expect(state.error).not.toBeNull();
      expect(state.error!.message).toContain(
        `U+${code.toString(16).toUpperCase().padStart(4, "0")}`,
      );
    }
  });

  test("empty string value", () => {
    let state = create();
    state = push(state, '""');
    state = finish(state);

    expect(resolve(state)).toBe("");
  });

  test("string with all JSON escape sequences", () => {
    let state = create();
    state = push(state, '"\\" \\\\ \\/ \\b \\f \\n \\r \\t"');
    state = finish(state);

    expect(resolve(state)).toBe('" \\ / \b \f \n \r \t');
  });

  test("unicode escape for non-ASCII", () => {
    let state = create();
    state = push(state, '"\\u00E9"');
    state = finish(state);

    expect(resolve(state)).toBe("\u00E9"); // é
  });

  test("unicode escape for null character is valid in escape form", () => {
    let state = create();
    state = push(state, '"\\u0000"');
    state = finish(state);

    expect(state.error).toBeNull();
    expect(resolve(state)).toBe("\u0000");
  });

  test("number at boundary of safe integer", () => {
    let state = create();
    state = push(state, "9007199254740991");
    state = finish(state);

    expect(resolve(state)).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("very large exponent", () => {
    let state = create();
    state = push(state, "1e308");
    state = finish(state);

    expect(resolve(state)).toBe(1e308);
    expect(Number.isFinite(resolve(state) as number)).toBe(true);
  });

  test("object with escaped key", () => {
    let state = create();
    state = push(state, '{"hello\\nworld": 1}');
    state = finish(state);

    expect(resolve(state)).toEqual({ "hello\nworld": 1 });
  });

  test("nested empty containers", () => {
    let state = create();
    state = push(state, '[[], {}, [{}], {"a": []}]');
    state = finish(state);

    expect(resolve(state)).toEqual([[], {}, [{}], { a: [] }]);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd packages/json-stream && pnpm test
```

Expected: PASS — all edge case tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/json-stream/src/__tests__/edge-cases.test.ts
git commit -m "test(json-stream): add edge case tests for duplicate keys, deep nesting, control chars"
```

---

### Task 14: Build Verification and Export Cleanup

**Files:**

- Modify: `packages/json-stream/src/index.ts` (if needed)
- No new files

- [ ] **Step 1: Run full test suite**

```bash
cd packages/json-stream && pnpm test
```

Expected: All tests pass.

- [ ] **Step 2: Run typecheck**

```bash
cd packages/json-stream && pnpm typecheck
```

Expected: No type errors.

- [ ] **Step 3: Run build**

```bash
cd packages/json-stream && pnpm build
```

Expected: Build succeeds, `dist/` contains `index.js` and `index.d.ts`.

- [ ] **Step 4: Verify exports**

```bash
ls packages/json-stream/dist/
```

Expected: `index.js`, `index.d.ts` (and possibly other .js/.d.ts files from tsup chunking).

- [ ] **Step 5: Run lint**

```bash
cd packages/json-stream && pnpm lint
```

Expected: No lint errors.

- [ ] **Step 6: Run monorepo-wide typecheck and test**

```bash
pnpm -r typecheck && pnpm -r test
```

Expected: All packages pass. No regressions.

- [ ] **Step 7: Commit (if any cleanup was needed)**

```bash
git add -A packages/json-stream
git commit -m "chore(json-stream): build verification and export cleanup"
```

---

### Task 15: Internal Type Hiding — Ensure `InternalState` Is Not Exported

**Files:**

- Modify: `packages/json-stream/src/index.ts`

- [ ] **Step 1: Verify `InternalState` is NOT in the public API**

Check that `index.ts` does NOT export `InternalState`, `ParseMode`, or any internal types. Only the types listed in the spec's API surface should be exported:

Public types: `StreamState`, `StreamError`, `AstNode`, `NullNode`, `BoolNode`, `NumberNode`, `StringNode`, `ArrayNode`, `ObjectNode`, `NodeStatus`, `JsonValue`

Public functions: `create`, `push`, `finish`, `resolve`, `isArrayNode`, `isObjectNode`, `isStringNode`, `isNumberNode`, `isBoolNode`, `isNullNode`, `isComplete`

- [ ] **Step 2: Write a type-level test**

Add to any test file:

```ts
test("public API shape", () => {
  // Verify all expected exports exist
  expect(typeof create).toBe("function");
  expect(typeof push).toBe("function");
  expect(typeof finish).toBe("function");
  expect(typeof resolve).toBe("function");
  expect(typeof isArrayNode).toBe("function");
  expect(typeof isObjectNode).toBe("function");
  expect(typeof isStringNode).toBe("function");
  expect(typeof isNumberNode).toBe("function");
  expect(typeof isBoolNode).toBe("function");
  expect(typeof isNullNode).toBe("function");
  expect(typeof isComplete).toBe("function");
});
```

- [ ] **Step 3: Run tests**

```bash
cd packages/json-stream && pnpm test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/json-stream/src/index.ts packages/json-stream/src/__tests__/
git commit -m "chore(json-stream): verify public API surface and hide internals"
```
