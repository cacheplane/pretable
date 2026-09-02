import { describe, expect, it } from "vitest";
import {
  POSITION_COUNT,
  cleanPage,
  corruptPage,
  makePositionColumns,
  priceFor,
} from "../showcase/rejectedWritesData";

describe("rejectedWritesData", () => {
  it("cleanPage is deterministic per tick, same id set, fresh array identity", () => {
    const a = cleanPage(3);
    const b = cleanPage(3);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
    expect(a).toHaveLength(POSITION_COUNT);
    expect(new Set(a.map((row) => row.id)).size).toBe(POSITION_COUNT);
    expect(cleanPage(3).map((r) => r.id)).toEqual(
      cleanPage(4).map((r) => r.id),
    );
  });

  it("prices drift between ticks — the fixture can distinguish tick N from N+1", () => {
    // If every price were tick-invariant, the component test's "grid still
    // shows the pre-corruption page" assertion would pass vacuously.
    expect(cleanPage(3).map((r) => r.price)).not.toEqual(
      cleanPage(4).map((r) => r.price),
    );
    expect(priceFor("AAPL", 3)).not.toBe(priceFor("AAPL", 4));
  });

  it("corruptPage carries a duplicate id, and the two variants duplicate different ids", () => {
    const v0 = corruptPage(5, 0);
    const v1 = corruptPage(5, 1);
    const dupOf = (rows: readonly { id: string }[]) => {
      const seen = new Set<string>();
      for (const row of rows) {
        if (seen.has(row.id)) return row.id;
        seen.add(row.id);
      }
      return undefined;
    };
    expect(dupOf(v0)).toBeDefined();
    expect(dupOf(v1)).toBeDefined();
    expect(dupOf(v0)).not.toBe(dupOf(v1));
  });

  it("columns cover the row fields", () => {
    const ids = makePositionColumns().map((column) => column.id);
    expect(ids).toEqual(
      expect.arrayContaining(["ticker", "qty", "price", "value"]),
    );
  });
});
