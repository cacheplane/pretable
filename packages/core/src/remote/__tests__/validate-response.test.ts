import { describe, expect, it } from "vitest";
import { remoteAggregateDefinitionKey, remoteGroupId } from "../query";
import {
  createResponseValidator,
  validateSession,
  validateRemoteResult,
} from "../validate-response";
import type { PretableRemoteGroup, PretableRemoteRange } from "../types";
import {
  query,
  session,
  range,
  groupedQuery,
  aggregate,
  summary,
  type Row,
  type Columns,
} from "./fixtures/responses";

describe("response validation", () => {
  it("uses collision-safe declared aggregate definition identities", () => {
    expect(remoteAggregateDefinitionKey("a:b", "c", "d")).not.toBe(
      remoteAggregateDefinitionKey("a", "b:c", "d"),
    );
    const validator = createResponseValidator<Row, Columns>(
      groupedQuery,
      session,
    );
    expect(validator.acceptSummary("filtered", summary()).ok).toBe(true);
    expect(
      validator.acceptSummary("filtered", {
        ...summary(),
        values: { sum: { ...aggregate(), aggregateDefinitionKey: "other" } },
      }),
    ).toEqual({ ok: false, error: { code: "invalid-response" } });
  });
  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN])(
    "rejects invalid root count %s",
    (rootCount) => {
      expect(validateSession({ ...session, rootCount }, "query").ok).toBe(
        false,
      );
    },
  );
  it.each([
    { route: [{ columnId: "value", key: 1 }] },
    { sessionId: "other" },
    { resultToken: "other" },
    { queryKey: "other" },
    { start: 1 },
    { entries: [] },
    { siblingCount: 1 },
    {
      entries: [
        { kind: "leaf", id: 0, row: { value: 0 } },
        { kind: "leaf", id: 0, row: { value: 1 } },
      ],
    },
    {
      entries: [
        {
          kind: "group",
          id: "x",
          route: [],
          label: "x",
          childCount: 1,
          aggregates: {},
        },
      ],
    },
  ] as Partial<PretableRemoteRange<Row>>[])(
    "rejects malformed responses without partial acceptance: %j",
    (patch) => {
      const validator = createResponseValidator<Row, Columns>(query, session);
      expect(validator.acceptRange(range(), range(0, 2, patch)).ok).toBe(false);
      expect(validator.retention().nodes).toBe(0);
      expect(validator.acceptRange(range(), range()).ok).toBe(true);
    },
  );
  it("accepts only exact proven-end short ranges", () => {
    const validator = createResponseValidator<Row, Columns>(query, session);
    expect(validator.acceptRange(range(3, 8), range(3, 8)).ok).toBe(true);
    expect(validator.acceptRange(range(4, 8), range(4, 8)).ok).toBe(true);
    expect(
      validator.acceptRange(
        range(1, 3),
        range(1, 3, { entries: range(1, 2).entries }),
      ).ok,
    ).toBe(false);
  });
  it("detects contradictions across overlap, identity positions and counts", () => {
    for (const bad of [
      range(1, 3, {
        entries: [
          { kind: "leaf", id: 1, row: { value: 99 } },
          ...range(2, 3).entries,
        ],
      }),
      range(2, 3, { entries: range(0, 1).entries }),
      range(2, 3, { siblingCount: 5 }),
    ]) {
      const validator = createResponseValidator<Row, Columns>(query, session);
      expect(validator.acceptRange(range(), range()).ok).toBe(true);
      expect(validator.acceptRange(bad, bad)).toEqual({
        ok: false,
        error: { code: "consistency" },
      });
      expect(validator.retention().nodes).toBe(2);
    }
  });
  it("checks group level, typed route, canonical ID and child counts before children publish", () => {
    const parent = [{ columnId: "value", key: 1 }] as const;
    const group = {
      kind: "group" as const,
      id: remoteGroupId(parent),
      route: parent,
      label: "one",
      childCount: 2,
      aggregates: { sum: aggregate() },
    };
    const validator = createResponseValidator<Row, Columns>(groupedQuery, {
      ...session,
      rootCount: 1,
    });
    const root = range(0, 1, {
      rootCount: 1,
      siblingCount: 1,
      entries: [group],
    });
    expect(validator.acceptRange(root, root).ok).toBe(true);
    const child = range(0, 2, { rootCount: 1, route: parent, siblingCount: 2 });
    expect(validator.acceptRange(child, child).ok).toBe(true);
    expect(validator.acceptRange(child, { ...child, siblingCount: 3 })).toEqual(
      { ok: false, error: { code: "consistency" } },
    );
    expect(
      validator.acceptRange(child, {
        ...child,
        route: [{ columnId: "value", key: "1" }],
      }).ok,
    ).toBe(false);
  });
  it("compares plain wire values semantically, preserves undefined, and owns immutable copies", () => {
    const validator = createResponseValidator<Row, Columns>(query, session);
    const first = range(0, 1, {
      entries: [
        {
          kind: "leaf",
          id: 0,
          row: { value: 0, extra: { a: undefined, b: -0 } },
        },
      ],
    });
    const accepted = validator.acceptRange(first, first);
    expect(accepted.ok).toBe(true);
    (first.entries[0] as { row: Row }).row.value = 99;
    const reordered = range(0, 1, {
      entries: [
        {
          kind: "leaf",
          id: 0,
          row: { extra: { b: -0, a: undefined }, value: 0 },
        },
      ],
    });
    expect(validator.acceptRange(reordered, reordered).ok).toBe(true);
    expect(validator.acceptRange(first, first).ok).toBe(false);
    if (accepted.ok)
      expect(Object.isFrozen(accepted.value.entries[0])).toBe(true);
    const omitted = range(0, 1, {
      entries: [{ kind: "leaf", id: 0, row: { value: 0, extra: { b: 0 } } }],
    });
    expect(validator.acceptRange(omitted, omitted).ok).toBe(false);
  });
  it("rejects non-wire values and detects repeated summary contradictions separately by scope", () => {
    const validator = createResponseValidator<Row, Columns>(
      groupedQuery,
      session,
    );
    expect(validator.acceptSummary("filtered", summary()).ok).toBe(true);
    expect(
      validator.acceptSummary("all", { ...summary(8), scope: "all" }).ok,
    ).toBe(true);
    expect(validator.acceptSummary("filtered", summary(9))).toEqual({
      ok: false,
      error: { code: "consistency" },
    });
    expect(
      validator.acceptSummary("filtered", {
        ...summary(),
        values: { sum: { ...aggregate(), value: new Date() } },
      }).ok,
    ).toBe(false);
    validator.dispose();
    expect(validator.retention()).toEqual({
      nodes: 0,
      counts: 0,
      summaries: 0,
    });
  });
  it("releases range evidence and still checks provenance and exact root count on reacceptance", () => {
    const validator = createResponseValidator<Row, Columns>(query, session);
    expect(validator.acceptRange(range(), range()).ok).toBe(true);
    validator.releaseRange([], 0, 2);
    expect(validator.retention()).toEqual({
      nodes: 0,
      counts: 1,
      summaries: 0,
    });
    expect(
      validator.acceptRange(range(), range(0, 2, { resultToken: "other" })).ok,
    ).toBe(false);
    expect(
      validator.acceptRange(range(), range(0, 2, { siblingCount: 9 })).ok,
    ).toBe(false);
    expect(validator.acceptRange(range(), range()).ok).toBe(true);
  });
  it("rejects malformed group descriptors without admitting any preceding entry", () => {
    const route = [{ columnId: "value", key: 1 }];
    const group = {
      kind: "group" as const,
      id: remoteGroupId(route),
      route,
      label: "one",
      childCount: 2,
      aggregates: { sum: aggregate() },
    };
    const patches: Partial<PretableRemoteGroup>[] = [
      { childCount: -1 },
      { childCount: 1.5 },
      { id: "label" },
      { route: [] },
      { route: [{ columnId: "other", key: 1 }] },
      { aggregates: {} },
      {
        aggregates: {
          sum: { ...aggregate(), aggregateDefinitionKey: "1:value:sum" },
        },
      },
    ];
    for (const patch of patches) {
      const validator = createResponseValidator<Row, Columns>(
        groupedQuery,
        session,
      );
      const response = range(0, 1, { entries: [{ ...group, ...patch }] });
      expect(validator.acceptRange(response, response).ok).toBe(false);
      expect(validator.retention().nodes).toBe(0);
    }
  });
  it("counts separately retained overlapping payloads and rejects unsafe route keys", () => {
    const validator = createResponseValidator<Row, Columns>(query, session);
    expect(validator.acceptRange(range(0, 2), range(0, 2)).ok).toBe(true);
    expect(validator.acceptRange(range(1, 3), range(1, 3)).ok).toBe(true);
    expect(validator.retention().nodes).toBe(4);
    const invalid = range(0, 1, { route: [{ columnId: "value", key: NaN }] });
    expect(validator.acceptRange(invalid, invalid).ok).toBe(false);
  });
  it("treats summary aggregate ID lists as sets when comparing repeated answers", () => {
    const q = {
      ...groupedQuery,
      aggregates: [
        ...groupedQuery.aggregates,
        { columnId: "value" as const, id: "second" },
      ],
    };
    const validator = createResponseValidator<Row, Columns>(q, session);
    const response = {
      ...summary(),
      aggregateIds: ["sum", "second"],
      values: {
        ...summary().values,
        second: {
          ...aggregate(),
          aggregateDefinitionKey: remoteAggregateDefinitionKey(
            "1",
            "value",
            "second",
          ),
        },
      },
    };
    expect(validator.acceptSummary("filtered", response).ok).toBe(true);
    expect(
      validator.acceptSummary("filtered", {
        ...response,
        aggregateIds: ["second", "sum"],
      }).ok,
    ).toBe(true);
  });
  it("copies only the shallow success envelope without traversing payload", () => {
    let traversals = 0;
    const payload = Object.defineProperty({}, "row", {
      enumerable: true,
      get() {
        traversals++;
        throw new Error("payload accessor");
      },
    });
    const input = { ok: true, value: payload };
    const output = validateRemoteResult(input);
    expect(output).not.toBe(input);
    expect(output.ok).toBe(true);
    if (output.ok) expect(output.value).toBe(payload);
    expect(traversals).toBe(0);
  });
  it("rejects hidden, symbol, unknown and missing envelope fields", () => {
    const hidden = Object.defineProperty({ ok: true }, "value", {
      value: {},
      enumerable: false,
    });
    for (const input of [
      hidden,
      { ok: true, value: {}, [Symbol("unknown")]: 1 },
      { ok: true, value: {}, extra: 1 },
      { ok: true },
      { ok: false, error: { code: "transient" }, value: {} },
      Object.create({ ok: true, value: {} }),
    ]) {
      expect(validateRemoteResult(input)).toEqual({
        ok: false,
        error: { code: "invalid-response" },
      });
    }
  });
});

it("preflights replacements without retaining refused evidence", () => {
  const v = createResponseValidator<Row, Columns>(query, session);
  expect(v.acceptRange(range(), range()).ok).toBe(true);
  expect(v.acceptRange(range(2, 4), range(2, 4), false).ok).toBe(true);
  expect(v.retention().nodes).toBe(2);
  expect(
    v.acceptRange(
      range(),
      range(0, 2, {
        entries: [
          { kind: "leaf", id: 0, row: { value: 999 } },
          range().entries[1]!,
        ],
      }),
      false,
    ),
  ).toEqual({ ok: false, error: { code: "consistency" } });
  expect(v.retention().nodes).toBe(2);
});

it("retains only admitted branch count evidence after parent payload eviction", () => {
  const v = createResponseValidator<Row, Columns>(groupedQuery, {
    ...session,
    rootCount: 1,
  });
  const route = [{ columnId: "value", key: 1 }];
  const root = {
    ...range(),
    rootCount: 1,
    siblingCount: 1,
    entries: [
      {
        kind: "group" as const,
        id: remoteGroupId(route),
        route,
        label: "one",
        childCount: 4,
        aggregates: { sum: aggregate() },
      },
    ],
  };
  expect(v.acceptRange(root, root).ok).toBe(true);
  v.retainTopology([{ route, childCount: 4 }]);
  v.releaseRange([], 0, 2);
  expect(v.retention()).toMatchObject({ nodes: 0, counts: 2 });
  const child = { ...range(), rootCount: 1, route };
  expect(v.validateRequest(child).ok).toBe(true);
  expect(v.acceptRange(child, child).ok).toBe(true);
});
