import { describe, expect, it } from "vitest";
import {
  canonicalRemoteRoute,
  remoteGroupId,
  remoteLeafId,
  prepareRemoteQuery,
} from "../query";
import type { PretableRemoteCapabilities, PretableRemoteQuery } from "../types";

type Columns = readonly [
  { id: "name"; accessor: () => string; type: "text" },
  { id: "amount"; accessor: () => number; type: "number" },
];
const capabilities: PretableRemoteCapabilities = {
  rangeAccess: "ordinal",
  exactCounts: true,
  consistency: "immutable",
  fields: {
    name: { type: "text", operators: ["equals", "contains"] },
    amount: { type: "number", operators: ["gt", "between"] },
  },
  aggregates: ["sum@1"],
  comparisons: ["binary@1", "binary@2"],
  search: true,
  summaries: { filtered: "same-version", all: "unavailable" },
  maxGroupDepth: 4,
  maxRangeSize: 100,
};
const query: PretableRemoteQuery<Columns> = {
  source: "orders",
  authScope: "opaque",
  schemaVersion: "1",
  registryVersion: "1",
  comparison: "binary@1",
  locale: "en",
  filters: [],
  rowGroups: [],
  sort: [],
  groupSort: [],
  aggregates: [],
  projection: ["name", "amount"],
};
const key = (q: PretableRemoteQuery<Columns>) => {
  const result = prepareRemoteQuery(q, capabilities);
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error("unexpected diagnostic");
  return result.queryKey;
};
describe("remote query identity", () => {
  it("distinguishes typed keys and delimiter-containing routes", () => {
    const keys = [null, "", 1, "1", "a/b", "a", false].map((value) =>
      canonicalRemoteRoute([{ columnId: "name", key: value }]),
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(canonicalRemoteRoute([{ columnId: "name", key: "a/b" }])).not.toBe(
      canonicalRemoteRoute([
        { columnId: "name", key: "a" },
        { columnId: "name", key: "b" },
      ]),
    );
    expect(remoteGroupId([])).not.toBe(remoteLeafId("[]"));
    expect(remoteLeafId(1)).not.toBe(remoteLeafId("1"));
  });
  it("ignores object property insertion order", () => {
    expect(key(query)).toBe(
      key(
        Object.fromEntries(
          Object.entries(query).reverse(),
        ) as unknown as PretableRemoteQuery<Columns>,
      ),
    );
  });
  it.each([
    { source: "other" },
    { authScope: "other" },
    { schemaVersion: "2" },
    { registryVersion: "2" },
    { comparison: "binary@2" },
    { locale: "de" },
    { search: "needle" },
    { projection: ["amount"] },
    { filters: [{ columnId: "amount", operator: "gt", value: 1 }] },
    {
      sort: [
        {
          columnId: "amount",
          direction: "desc",
          nulls: "first",
          comparison: "binary@1",
        },
      ],
    },
    {
      rowGroups: [{ columnId: "name" }],
      groupSort: [
        {
          level: 0,
          by: "key",
          direction: "asc",
          nulls: "last",
          comparison: "binary@1",
        },
      ],
    },
    { aggregates: [{ columnId: "amount", id: "sum@1" }] },
  ])("includes semantic dependency %j", (change) => {
    expect(
      key({ ...query, ...change } as PretableRemoteQuery<Columns>),
    ).not.toBe(key(query));
  });
  it("includes each group ordering semantic and nested filter operand", () => {
    const grouped: PretableRemoteQuery<Columns> = {
      ...query,
      rowGroups: [{ columnId: "name" }],
      aggregates: [{ columnId: "amount", id: "sum@1" }],
      groupSort: [
        {
          level: 0,
          by: "key",
          direction: "asc",
          nulls: "first",
          comparison: "binary@1",
        },
      ],
    };
    for (const sort of [
      { ...grouped.groupSort[0]!, direction: "desc" as const },
      { ...grouped.groupSort[0]!, nulls: "last" as const },
      { ...grouped.groupSort[0]!, comparison: "binary@2" },
      {
        ...grouped.groupSort[0]!,
        by: "aggregate" as const,
        aggregateId: "sum@1",
      },
    ])
      expect(key({ ...grouped, groupSort: [sort] })).not.toBe(key(grouped));
    expect(
      key({
        ...query,
        filters: [
          {
            op: "and",
            children: [{ columnId: "amount", operator: "gt", value: 1 }],
          },
        ],
      }),
    ).not.toBe(
      key({
        ...query,
        filters: [
          {
            op: "and",
            children: [{ columnId: "amount", operator: "gt", value: 2 }],
          },
        ],
      }),
    );
  });
  it("rejects conflicting implicit group ordering instead of guessing", () => {
    expect(
      prepareRemoteQuery(
        {
          ...query,
          rowGroups: [{ columnId: "name", direction: "desc" } as never],
          groupSort: [
            {
              level: 0,
              by: "key",
              direction: "asc",
              nulls: "last",
              comparison: "binary@1",
            },
          ],
        },
        capabilities,
      ).ok,
    ).toBe(false);
  });
  it("retains sort and projection order", () => {
    expect(key(query)).not.toBe(
      key({ ...query, projection: ["amount", "name"] }),
    );
  });
  it.each([
    { filters: [{ columnId: "name", operator: "unknown", value: "secret" }] },
    { filters: [{ columnId: "amount", operator: "gt", value: "secret" }] },
    { filters: [{ op: "xor", children: [] }] },
    { projection: ["unknown"] },
    { comparison: "unregistered" },
    { aggregates: [{ columnId: "amount", id: "unregistered" }] },
    { sort: [{ columnId: "amount", direction: "asc" }] },
    { search: () => "secret" },
    { extra: "secret" },
    { filters: null },
  ])(
    "rejects malformed or unsupported inputs without sensitive diagnostics %j",
    (change) => {
      const result = prepareRemoteQuery(
        { ...query, ...change } as unknown as PretableRemoteQuery<Columns>,
        capabilities,
      );
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("secret");
    },
  );
  it("rejects unsupported provider modes", () => {
    expect(
      prepareRemoteQuery(query, {
        ...capabilities,
        exactCounts: false,
      } as unknown as PretableRemoteCapabilities).ok,
    ).toBe(false);
  });
  it("rejects cycles, nonfinite keys and unsupported scalar values", () => {
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    expect(
      prepareRemoteQuery(
        {
          ...query,
          filters: cyclic,
        } as unknown as PretableRemoteQuery<Columns>,
        capabilities,
      ).ok,
    ).toBe(false);
    expect(() =>
      canonicalRemoteRoute([{ columnId: "name", key: NaN }]),
    ).toThrow();
    expect(() => remoteLeafId(undefined as never)).toThrow();
  });
});

describe("remote runtime data boundaries", () => {
  it.each([
    { comparisons: "binary@123" },
    { aggregates: "sum@1" },
    { comparisons: [1] },
    {
      fields: {
        name: { type: "bogus", operators: [] },
        amount: capabilities.fields.amount,
      },
    },
    {
      fields: {
        name: { type: "text", operators: "equals" },
        amount: capabilities.fields.amount,
      },
    },
    {
      fields: {
        name: { type: "text", operators: ["gt"] },
        amount: capabilities.fields.amount,
      },
    },
    { search: "false" },
    { summaries: { filtered: "same-version", all: true } },
  ])("rejects malformed capabilities %j", (change) => {
    expect(
      prepareRemoteQuery({ ...query, search: "needle" }, {
        ...capabilities,
        ...change,
      } as unknown as PretableRemoteCapabilities).ok,
    ).toBe(false);
  });
  it.each(["symbol", "hidden", "accessor", "subclass"])(
    "rejects %s array properties",
    (kind) => {
      const projection = ["name", "amount"];
      if (kind === "symbol")
        Object.defineProperty(projection, Symbol("extra"), { value: 1 });
      if (kind === "hidden")
        Object.defineProperty(projection, "extra", { value: 1 });
      if (kind === "accessor")
        Object.defineProperty(projection, "0", {
          get: () => "name",
          enumerable: true,
        });
      if (kind === "subclass")
        Object.setPrototypeOf(projection, Object.create(Array.prototype));
      expect(
        prepareRemoteQuery(
          { ...query, projection } as PretableRemoteQuery<Columns>,
          capabilities,
        ).ok,
      ).toBe(false);
    },
  );
  it("rejects query accessors without invoking them", () => {
    let reads = 0;
    const hostile = { ...query };
    Object.defineProperty(hostile, "source", {
      get: () => {
        reads++;
        return "orders";
      },
      enumerable: true,
    });
    expect(prepareRemoteQuery(hostile, capabilities).ok).toBe(false);
    expect(reads).toBe(0);
  });
  it("rejects hidden known query fields", () => {
    const hostile = { ...query };
    Object.defineProperty(hostile, "source", {
      value: "orders",
      enumerable: false,
    });
    expect(prepareRemoteQuery(hostile, capabilities).ok).toBe(false);
  });
  it("rejects malformed route arrays before mapping them", () => {
    const route: [] = [];
    Object.defineProperty(route, "extra", { value: 1 });
    expect(() => canonicalRemoteRoute(route)).toThrow();
  });
});
