import { describe, expect, test } from "vitest";
import { createGridCore } from "../index";

type R = {
  id: string;
};
const ids = ["a", "b", "c", "d", "e"];

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rank(p: unknown) {
  return p === "left" ? 0 : p === "right" ? 2 : 1;
}

describe("column array grouping invariant", () => {
  test("array order stays grouped across random mutations", () => {
    for (let seed = 0; seed < 400; seed += 1) {
      const rnd = mulberry(seed);
      const grid = createGridCore<R>({
        columns: ids.map((id) => ({ id, header: id, widthPx: 100 })),
        rows: [{ id: "r1" }],
        getRowId: (r) => r.id,
      });
      const trace: string[] = [];
      for (let step = 0; step < 25; step += 1) {
        const op = Math.floor(rnd() * 3);
        const id = ids[Math.floor(rnd() * ids.length)]!;
        if (op === 0) {
          const to = Math.floor(rnd() * ids.length);
          trace.push(`moveColumn(${id}, ${to})`);
          grid.moveColumn(id, to);
        } else if (op === 1) {
          const pin = [null, "left", "right"][Math.floor(rnd() * 3)] as
            null | "left" | "right";
          trace.push(`setColumnPinned(${id}, ${pin})`);
          grid.setColumnPinned(id, pin);
        } else {
          const shuffled = ids.slice().sort(() => rnd() - 0.5);
          trace.push(`setColumnOrder(${shuffled.join(",")})`);
          grid.setColumnOrder(shuffled);
        }
        const ranks = grid.options.columns.map((c) => rank(c.pinned));
        const sorted = ranks.slice().sort((x, y) => x - y);
        expect(
          ranks,
          `seed=${seed} step=${step}\n${trace.join("\n")}\ncols=${grid.options.columns
            .map((c) => `${c.id}:${c.pinned ?? "-"}`)
            .join(" ")}`,
        ).toEqual(sorted);
        expect(
          grid.options.columns
            .map((c) => c.id)
            .slice()
            .sort(),
        ).toEqual(ids.slice().sort());
      }
    }
  });
});
