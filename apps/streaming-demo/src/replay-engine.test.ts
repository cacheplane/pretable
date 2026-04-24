import { describe, expect, test } from "vitest";

import { createEngine } from "./replay-engine";
import type { Phase1Entry, Phase2Entry, StockRow } from "./types";

function fakePhase1(): Phase1Entry[] {
  const full = JSON.stringify([
    {
      id: "AAPL",
      symbol: "AAPL",
      name: "Apple",
      last: 100,
      change_pct: 1.0,
      volume: 1000,
      sector: "Tech",
      last_update: "14:00:00",
    },
    {
      id: "GOOGL",
      symbol: "GOOGL",
      name: "Alphabet",
      last: 140,
      change_pct: -0.5,
      volume: 2000,
      sector: "Tech",
      last_update: "14:00:00",
    },
  ]);
  return [
    { t: 0, type: "response.created" },
    { t: 0.1, type: "response.output_text.delta", delta: full },
    { t: 0.2, type: "response.output_text.done" },
  ];
}

function fakePhase2(): Phase2Entry[] {
  return [
    { t: 1.0, patches: [{ id: "AAPL", last: 101 }] },
    { t: 2.0, patches: [{ id: "GOOGL", last: 141 }] },
  ];
}

function collectGridOps(): {
  txs: Array<{
    add?: StockRow[];
    update?: Partial<StockRow>[];
    remove?: string[];
  }>;
  grid: {
    applyTransaction: (tx: {
      add?: StockRow[];
      update?: Partial<StockRow>[];
      remove?: string[];
    }) => void;
  };
} {
  const txs: Array<{
    add?: StockRow[];
    update?: Partial<StockRow>[];
    remove?: string[];
  }> = [];
  return {
    txs,
    grid: {
      applyTransaction(tx) {
        txs.push(tx);
      },
    },
  };
}

describe("replay engine", () => {
  test("advanceTo dispatches phase-1 chunks up to target time", () => {
    const { grid, txs } = collectGridOps();
    const engine = createEngine({
      phase1: fakePhase1(),
      phase2: fakePhase2(),
      grid,
    });

    engine.advanceTo(0.3);
    engine.flush();

    // One transaction should have run with the two parsed rows.
    const allAdds = txs.flatMap((t) => t.add ?? []);
    expect(allAdds).toHaveLength(2);
    expect(allAdds[0].symbol).toBe("AAPL");
    expect(allAdds[1].symbol).toBe("GOOGL");
  });

  test("advanceTo dispatches phase-2 batches once the clock reaches t", () => {
    const { grid, txs } = collectGridOps();
    const engine = createEngine({
      phase1: fakePhase1(),
      phase2: fakePhase2(),
      grid,
    });

    engine.advanceTo(1.5);
    engine.flush();

    const allUpdates = txs.flatMap((t) => t.update ?? []);
    expect(allUpdates).toEqual([{ id: "AAPL", last: 101 }]);
  });

  test("advanceTo to end dispatches every phase-1 and phase-2 entry", () => {
    const { grid, txs } = collectGridOps();
    const engine = createEngine({
      phase1: fakePhase1(),
      phase2: fakePhase2(),
      grid,
    });

    engine.advanceTo(3.0);
    engine.flush();

    const allAdds = txs.flatMap((t) => t.add ?? []);
    const allUpdates = txs.flatMap((t) => t.update ?? []);
    expect(allAdds).toHaveLength(2);
    expect(allUpdates).toHaveLength(2);
  });

  test("seek rewinds and re-replays deterministically", () => {
    const first = collectGridOps();
    const a = createEngine({
      phase1: fakePhase1(),
      phase2: fakePhase2(),
      grid: first.grid,
    });
    a.advanceTo(3.0);
    a.flush();
    const addsA = first.txs.flatMap((t) => t.add ?? []);
    const updsA = first.txs.flatMap((t) => t.update ?? []);

    const second = collectGridOps();
    const b = createEngine({
      phase1: fakePhase1(),
      phase2: fakePhase2(),
      grid: second.grid,
    });
    b.advanceTo(0.5);
    b.seek(3.0);
    b.flush();
    const addsB = second.txs.flatMap((t) => t.add ?? []);
    const updsB = second.txs.flatMap((t) => t.update ?? []);

    expect(addsB).toEqual(addsA);
    expect(updsB).toEqual(updsA);
  });

  test("state reflects phase transitions", () => {
    const { grid } = collectGridOps();
    const engine = createEngine({
      phase1: fakePhase1(),
      phase2: fakePhase2(),
      grid,
    });

    engine.advanceTo(0.05);
    expect(engine.getState().phase).toBe("fill");

    engine.advanceTo(1.5);
    expect(engine.getState().phase).toBe("live");

    engine.advanceTo(99);
    expect(engine.getState().phase).toBe("done");
  });

  test("subscribe fires when state changes", () => {
    const { grid } = collectGridOps();
    const engine = createEngine({
      phase1: fakePhase1(),
      phase2: fakePhase2(),
      grid,
    });

    let ticks = 0;
    const unsub = engine.subscribe(() => {
      ticks++;
    });

    engine.advanceTo(0.5);
    expect(ticks).toBeGreaterThan(0);

    unsub();
  });
});
