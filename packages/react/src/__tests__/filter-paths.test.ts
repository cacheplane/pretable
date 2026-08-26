import { describe, expect, it } from "vitest";
import type {
  SurfaceFilterGroup,
  SurfaceFilterLeaf,
  SurfaceFilterNode,
} from "../filter-tree";
import {
  depthOf,
  depthOfTree,
  insertNode,
  removeNode,
  replaceNode,
  resolveNode,
  setGroupOp,
} from "../tool-panel/filters/filter-paths";

/**
 * Three root siblings so an off-by-one at the root is visible, a group in the
 * MIDDLE slot so "rebuilt the spine" and "rebuilt everything" disagree (`[0]`
 * and `[2]` are untouched bystanders of every write under `[1]`), and a
 * second group INSIDE it so every operation can be exercised two levels down
 * — a regression that quietly made one of them root-only would pass against a
 * one-level tree.
 *
 * Frozen because the module's contract is that these are never mutated: an
 * in-place write throws at the offending line instead of corrupting the
 * shared fixture and failing some later test for the wrong reason.
 */
const rootLeaf = Object.freeze<SurfaceFilterLeaf>({
  columnId: "a",
  operator: "contains",
  value: "x",
});
const nestedFirst = Object.freeze<SurfaceFilterLeaf>({
  columnId: "b",
  operator: "equals",
  value: 1,
});
const nestedSecond = Object.freeze<SurfaceFilterLeaf>({
  columnId: "c",
  operator: "equals",
  value: 2,
});
const deepLeaf = Object.freeze<SurfaceFilterLeaf>({
  columnId: "e",
  operator: "startsWith",
  value: "deep",
});
const innerGroup = Object.freeze<SurfaceFilterGroup>({
  op: "and",
  children: Object.freeze([deepLeaf]),
});
const group = Object.freeze<SurfaceFilterGroup>({
  op: "or",
  children: Object.freeze([nestedFirst, nestedSecond, innerGroup]),
});
const lastLeaf = Object.freeze<SurfaceFilterLeaf>({
  columnId: "d",
  operator: "isNotEmpty",
});
const tree: readonly SurfaceFilterNode[] = Object.freeze([
  rootLeaf,
  group,
  lastLeaf,
]);

const groupAt = (
  nodes: readonly SurfaceFilterNode[],
  ...path: number[]
): SurfaceFilterGroup => resolveNode(nodes, path) as SurfaceFilterGroup;

describe("resolveNode", () => {
  it("finds a root leaf, a root group and nodes two levels down", () => {
    expect(resolveNode(tree, [0])).toBe(rootLeaf);
    expect(resolveNode(tree, [1])).toBe(group);
    expect(resolveNode(tree, [1, 0])).toBe(nestedFirst);
    expect(resolveNode(tree, [1, 1])).toBe(nestedSecond);
    expect(resolveNode(tree, [1, 2])).toBe(innerGroup);
    expect(resolveNode(tree, [1, 2, 0])).toBe(deepLeaf);
    expect(resolveNode(tree, [2])).toBe(lastLeaf);
  });

  it("addresses no node for the empty path", () => {
    expect(resolveNode(tree, [])).toBeUndefined();
  });

  it("returns undefined for out-of-range segments", () => {
    expect(resolveNode(tree, [9])).toBeUndefined();
    expect(resolveNode(tree, [1, 9])).toBeUndefined();
    expect(resolveNode(tree, [1, 2, 9])).toBeUndefined();
    expect(resolveNode(tree, [-1])).toBeUndefined();
    expect(resolveNode(tree, [1, -1])).toBeUndefined();
  });

  it("returns undefined when a non-final segment addresses a leaf", () => {
    expect(resolveNode(tree, [0, 0])).toBeUndefined();
    expect(resolveNode(tree, [1, 0, 0])).toBeUndefined();
    expect(resolveNode(tree, [2, 0, 0])).toBeUndefined();
  });
});

describe("replaceNode", () => {
  const replacement: SurfaceFilterLeaf = {
    columnId: "z",
    operator: "startsWith",
    value: "q",
  };

  it("rebuilds only the spine", () => {
    const next = replaceNode(tree, [1, 0], replacement);
    expect(next).not.toBe(tree);
    expect(next[1]).not.toBe(group);
    expect(resolveNode(next, [1, 0])).toBe(replacement);
    // Siblings off the spine keep identity so React can skip them.
    expect(next[0]).toBe(rootLeaf);
    expect(next[2]).toBe(lastLeaf);
    expect(groupAt(next, 1).children[1]).toBe(nestedSecond);
    expect(groupAt(next, 1).children[2]).toBe(innerGroup);
    expect(groupAt(next, 1).op).toBe("or");
  });

  it("rebuilds only the spine three levels down", () => {
    const next = replaceNode(tree, [1, 2, 0], replacement);
    expect(resolveNode(next, [1, 2, 0])).toBe(replacement);
    expect(next[1]).not.toBe(group);
    expect(groupAt(next, 1, 2)).not.toBe(innerGroup);
    // Everything hanging off the spine at every level is untouched.
    expect(next[0]).toBe(rootLeaf);
    expect(next[2]).toBe(lastLeaf);
    expect(groupAt(next, 1).children[0]).toBe(nestedFirst);
    expect(groupAt(next, 1).children[1]).toBe(nestedSecond);
    expect(groupAt(next, 1, 2).op).toBe("and");
  });

  it("replaces a root node without touching its siblings", () => {
    const next = replaceNode(tree, [0], replacement);
    expect(next[0]).toBe(replacement);
    expect(next[1]).toBe(group);
    expect(next[2]).toBe(lastLeaf);
  });

  it("returns the input unchanged for a stale path", () => {
    expect(replaceNode(tree, [9], replacement)).toBe(tree);
    expect(replaceNode(tree, [1, 9], replacement)).toBe(tree);
    expect(replaceNode(tree, [1, 2, 9], replacement)).toBe(tree);
    expect(replaceNode(tree, [0, 0], replacement)).toBe(tree);
    expect(replaceNode(tree, [1, 0, 0], replacement)).toBe(tree);
    expect(replaceNode(tree, [-1], replacement)).toBe(tree);
    expect(replaceNode(tree, [], replacement)).toBe(tree);
  });
});

describe("removeNode", () => {
  it("removes one child and leaves the group standing", () => {
    const next = removeNode(tree, [1, 0]);
    expect(next).toHaveLength(3);
    expect(groupAt(next, 1).children).toEqual([nestedSecond, innerGroup]);
    expect(next[0]).toBe(rootLeaf);
    expect(next[2]).toBe(lastLeaf);
  });

  it("removes a node two levels down", () => {
    const next = removeNode(tree, [1, 2, 0]);
    expect(groupAt(next, 1, 2).children).toEqual([]);
    expect(groupAt(next, 1).children[0]).toBe(nestedFirst);
  });

  it("leaves an EMPTY group rather than tidying it away", () => {
    const emptied = removeNode(
      removeNode(removeNode(tree, [1, 2]), [1, 1]),
      [1, 0],
    );
    expect(emptied).toHaveLength(3);
    const survivor = groupAt(emptied, 1);
    expect(survivor.op).toBe("or");
    expect(survivor.children).toEqual([]);
  });

  it("removes a root node", () => {
    const next = removeNode(tree, [1]);
    expect(next).toEqual([rootLeaf, lastLeaf]);
    expect(next[0]).toBe(rootLeaf);
    expect(next[1]).toBe(lastLeaf);
  });

  it("returns the input unchanged for a stale path", () => {
    expect(removeNode(tree, [9])).toBe(tree);
    expect(removeNode(tree, [1, 9])).toBe(tree);
    expect(removeNode(tree, [1, 2, 9])).toBe(tree);
    expect(removeNode(tree, [0, 0])).toBe(tree);
    expect(removeNode(tree, [-1])).toBe(tree);
    expect(removeNode(tree, [])).toBe(tree);
  });
});

describe("insertNode", () => {
  const fresh: SurfaceFilterLeaf = { columnId: "n", operator: "isEmpty" };

  it("inserts AT the path, pushing the occupant right", () => {
    const next = insertNode(tree, [1, 1], fresh);
    const children = groupAt(next, 1).children;
    expect(children).toEqual([nestedFirst, fresh, nestedSecond, innerGroup]);
    expect(children[0]).toBe(nestedFirst);
    expect(children[3]).toBe(innerGroup);
    expect(next[0]).toBe(rootLeaf);
    expect(next[2]).toBe(lastLeaf);
  });

  it("inserts two levels down", () => {
    expect(groupAt(insertNode(tree, [1, 2, 0], fresh), 1, 2).children).toEqual([
      fresh,
      deepLeaf,
    ]);
  });

  it("appends when the final index is past the end", () => {
    expect(groupAt(insertNode(tree, [1, 99], fresh), 1).children).toEqual([
      nestedFirst,
      nestedSecond,
      innerGroup,
      fresh,
    ]);
    expect(insertNode(tree, [99], fresh)).toEqual([
      rootLeaf,
      group,
      lastLeaf,
      fresh,
    ]);
  });

  it("inserts at the root, pushing later roots right", () => {
    expect(insertNode(tree, [1], fresh)).toEqual([
      rootLeaf,
      fresh,
      group,
      lastLeaf,
    ]);
  });

  it("returns the input unchanged when no parent list resolves", () => {
    // A group that has since been removed, a parent segment that is a leaf,
    // and the empty path, which has no final segment to be a slot.
    expect(insertNode(tree, [9, 0], fresh)).toBe(tree);
    expect(insertNode(tree, [0, 0], fresh)).toBe(tree);
    expect(insertNode(tree, [1, 0, 0], fresh)).toBe(tree);
    expect(insertNode(tree, [], fresh)).toBe(tree);
  });

  it("refuses a negative final index rather than prepending", () => {
    // Past-the-end appends because a drop past the last row means "last".
    // Below zero means nothing, so it must not silently become a prepend.
    expect(insertNode(tree, [-1], fresh)).toBe(tree);
    expect(insertNode(tree, [1, -5], fresh)).toBe(tree);
  });
});

describe("depthOf / depthOfTree", () => {
  it("counts root nodes as depth 0", () => {
    expect(depthOf([0])).toBe(0);
    expect(depthOf([1, 0])).toBe(1);
    expect(depthOf([1, 0, 2])).toBe(2);
  });

  it("reports the empty path as -1, distinct from a root node", () => {
    // So the containing-group gate — depthOf(groupPath) + 1 — comes out as 0
    // at the root, where the container has no path of its own.
    expect(depthOf([])).toBe(-1);
    expect(depthOf([]) + 1).toBe(0);
  });

  it("measures the deepest occupied level in the tree", () => {
    expect(depthOfTree([])).toBe(0);
    expect(depthOfTree([rootLeaf, lastLeaf])).toBe(0);
    expect(depthOfTree([rootLeaf, innerGroup])).toBe(1);
    expect(depthOfTree(tree)).toBe(2);
    expect(depthOfTree([{ op: "and", children: [group] }])).toBe(3);
  });

  it("counts an empty group's own depth, not a phantom child", () => {
    expect(depthOfTree([{ op: "and", children: [] }])).toBe(0);
    expect(
      depthOfTree([{ op: "and", children: [{ op: "or", children: [] }] }]),
    ).toBe(1);
  });
});

describe("setGroupOp", () => {
  it("flips one group and leaves everything else identical", () => {
    const next = setGroupOp(tree, [1], "and");
    expect(groupAt(next, 1).op).toBe("and");
    expect(groupAt(next, 1).children).toBe(group.children);
    expect(next[0]).toBe(rootLeaf);
    expect(next[2]).toBe(lastLeaf);
  });

  it("flips a NESTED group without touching its ancestors' siblings", () => {
    const next = setGroupOp(tree, [1, 2], "or");
    expect(groupAt(next, 1, 2).op).toBe("or");
    expect(groupAt(next, 1, 2).children).toBe(innerGroup.children);
    // The outer group is rebuilt (it is on the spine) but keeps its own op
    // and every child that is not the one being flipped.
    expect(groupAt(next, 1).op).toBe("or");
    expect(groupAt(next, 1).children[0]).toBe(nestedFirst);
    expect(groupAt(next, 1).children[1]).toBe(nestedSecond);
    expect(next[0]).toBe(rootLeaf);
    expect(next[2]).toBe(lastLeaf);
  });

  it("returns the input unchanged when the group already joins with op", () => {
    expect(setGroupOp(tree, [1], "or")).toBe(tree);
    expect(setGroupOp(tree, [1, 2], "and")).toBe(tree);
  });

  it("returns the input unchanged when the path is stale or not a group", () => {
    expect(setGroupOp(tree, [0], "and")).toBe(tree);
    expect(setGroupOp(tree, [9], "and")).toBe(tree);
    expect(setGroupOp(tree, [1, 0], "and")).toBe(tree);
    expect(setGroupOp(tree, [1, 2, 0], "or")).toBe(tree);
    expect(setGroupOp(tree, [], "and")).toBe(tree);
  });
});
