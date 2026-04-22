import { describe, expect, test } from "vitest";
import { create, resolve } from "../index";
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
    const nullNode: NullNode = { id: 0, kind: "null", parentId: null, status: "complete", value: null };
    const boolNode: BoolNode = { id: 1, kind: "boolean", parentId: null, status: "complete", value: true };
    const numberNode: NumberNode = { id: 2, kind: "number", parentId: null, status: "complete", value: 42, buffer: "42" };
    const stringNode: StringNode = { id: 3, kind: "string", parentId: null, status: "complete", value: "hello", buffer: "hello" };
    const arrayNode: ArrayNode = { id: 4, kind: "array", parentId: null, status: "complete", value: [1, 2, 3], children: [0, 1, 2] };
    const objectNode: ObjectNode = { id: 5, kind: "object", parentId: null, status: "complete", value: { a: 1 }, children: [0], keys: ["a"] };

    const nodes: AstNode[] = [nullNode, boolNode, numberNode, stringNode, arrayNode, objectNode];
    expect(nodes[0].kind).toBe("null");
    expect(nodes[1].kind).toBe("boolean");
    expect(nodes[2].kind).toBe("number");
    expect(nodes[3].kind).toBe("string");
    expect(nodes[4].kind).toBe("array");
    expect(nodes[5].kind).toBe("object");
  });
});

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
