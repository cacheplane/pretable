import { describe, expectTypeOf, it } from "vitest";

import type { PretableQueryOptions } from "../use-pretable";

// A minimal column tuple: the union is generic over it, and these tests are
// about the query/onQueryChange pairing rather than about column inference.
const columns = [
  { id: "name", accessor: (row: { id: string; name: string }) => row.name },
] as const;

type Columns = typeof columns;
type Options = PretableQueryOptions<Columns>;

describe("query options", () => {
  it("accepts the controlled pair", () => {
    const controlled = {
      query: { filters: [], sort: [], rowGroups: [] },
      onQueryChange: () => {},
    } as const;
    expectTypeOf(controlled).toMatchTypeOf<Options>();
  });

  it("accepts neither", () => {
    expectTypeOf({} as const).toMatchTypeOf<Options>();
  });

  it("accepts notification without control", () => {
    // THE FEATURE. Fails today: the uncontrolled arm says
    // `onQueryChange?: never`, which forbids this.
    const observed = { onQueryChange: () => {} } as const;
    expectTypeOf(observed).toMatchTypeOf<Options>();
  });

  it("still rejects a query with no setter", () => {
    // @ts-expect-error -- `query` requires `onQueryChange`, as `value`
    // requires `onChange`. If this ever stops erroring, the
    // controlled-component guarantee has been lost.
    const broken: Options = { query: { filters: [], sort: [], rowGroups: [] } };
    void broken;
  });
});
