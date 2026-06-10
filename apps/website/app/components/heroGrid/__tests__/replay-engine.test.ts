import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPortfolioReplay } from "../replay-engine";
import type { PositionRow } from "../types";

// Minimal recording: 2 rows via element stream + one tick + one commentary.
const RECORDING = [
  JSON.stringify({ type: "response.created", t: 0 }),
  JSON.stringify({
    type: "response.output_text.delta", t: 10,
    delta: JSON.stringify([
      { id: "AAA", symbol: "AAA", name: "Aaa", sector: "Technology", qty: 10, last: 100, mktValue: 1000, dayPnl: 0, dayPnlPct: 0, weight: 60, analyst: "", flag: "hold" },
      { id: "BBB", symbol: "BBB", name: "Bbb", sector: "Energy", qty: 5, last: 50, mktValue: 250, dayPnl: 0, dayPnlPct: 0, weight: 40, analyst: "", flag: "hold" },
    ]),
  }),
  JSON.stringify({ type: "response.completed", t: 20 }),
  JSON.stringify({ t: 0.4, type: "tick", patches: [{ id: "AAA", last: 101, mktValue: 1010, dayPnl: 10, dayPnlPct: 1 }] }),
  JSON.stringify({ t: 0.8, type: "commentary", patches: [{ id: "AAA", analyst: "Up on volume." }] }),
].join("\n") + "\n";

let rafCbs: Array<(t: number) => void>;
beforeEach(() => {
  rafCbs = [];
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => { rafCbs.push(cb); return rafCbs.length; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => vi.unstubAllGlobals());

function flushRaf(nowMs: number) {
  const cbs = rafCbs; rafCbs = [];
  for (const cb of cbs) cb(nowMs);
}

describe("createPortfolioReplay", () => {
  it("emits add transactions for each parsed row (Phase 1)", async () => {
    const adds: PositionRow[] = [];
    const replay = createPortfolioReplay({
      recording: RECORDING, ratePerSec: 60, isPlaying: true,
      onTransaction: (tx) => { if (tx.add) adds.push(...tx.add); },
    });
    await vi.waitFor(() => expect(adds.map((r) => r.id)).toEqual(["AAA", "BBB"]));
    replay.dispose();
  });

  it("drains tick + commentary patches on the virtual clock (Phase 2)", async () => {
    const updates: Array<Partial<PositionRow>> = [];
    const replay = createPortfolioReplay({
      recording: RECORDING, ratePerSec: 60, isPlaying: true,
      onTransaction: (tx) => { if (tx.update) updates.push(...tx.update); },
    });
    flushRaf(0);     // establish clock baseline
    flushRaf(1000);  // advance 1 virtual second → both t=0.4 and t=0.8 fire
    expect(updates.find((u) => (u as { last?: number }).last === 101)).toBeTruthy();
    expect(updates.find((u) => (u as { analyst?: string }).analyst === "Up on volume.")).toBeTruthy();
    replay.dispose();
  });
});
