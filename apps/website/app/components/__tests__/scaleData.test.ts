import { describe, expect, it } from "vitest";
import {
  COL_COUNT,
  ROW_COUNT,
  makeScaleColumns,
  makeScaleRows,
  synthCell,
} from "../showcase/scaleData";

describe("scaleData", () => {
  it("makes 2,500 lightweight rows keyed by index", () => {
    const rows = makeScaleRows();
    expect(rows).toHaveLength(ROW_COUNT);
    expect(rows[0]?.i).toBe(0);
    expect(rows[ROW_COUNT - 1]?.i).toBe(ROW_COUNT - 1);
  });

  it("makes a leading Row column plus 500 data columns", () => {
    const cols = makeScaleColumns();
    expect(cols).toHaveLength(COL_COUNT + 1);
    expect(cols[0]?.id).toBe("row");
    expect(cols[1]?.id).toBe("c1");
    expect(cols[1]?.header).toBe("C1");
    expect(cols[COL_COUNT]?.id).toBe(`c${COL_COUNT}`);
  });

  it("synthCell is deterministic and varies across cells", () => {
    expect(synthCell(5, 3)).toBe(synthCell(5, 3));
    expect(synthCell(5, 3)).not.toBe(synthCell(6, 3));
    expect(synthCell(5, 3)).not.toBe(synthCell(5, 4));
  });

  it("data column value accessors read synthCell for their column index", () => {
    const cols = makeScaleColumns();
    const c1 = cols[1]!;
    expect(c1.value?.({ i: 7 })).toBe(synthCell(7, 0));
  });
});
