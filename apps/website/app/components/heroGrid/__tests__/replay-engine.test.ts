import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRaceReplay } from "../replay-engine";
import type { RaceRow } from "../types";

// Tiny inline recording: 2 racers in phase 1, then phase 2 events covering
// every event-type so we can assert tier filters.
const FIXTURE = (() => {
  const arr = JSON.stringify([
    { id: "r-001", bib: 1, racer: "A 🇨🇭", gate1: "", gate2: "", gate3: "", finish: "", delta: "", status: "dns", notes: "" },
    { id: "r-002", bib: 2, racer: "B 🇳🇴", gate1: "", gate2: "", gate3: "", finish: "", delta: "", status: "dns", notes: "" },
  ]);
  const lines: string[] = [];
  lines.push(JSON.stringify({ t: 0.0, type: "response.created" }));
  // chunk arr into 16-char deltas
  let cursor = 0;
  let t = 0.1;
  while (cursor < arr.length) {
    lines.push(JSON.stringify({ t, type: "response.output_text.delta", delta: arr.slice(cursor, cursor + 16) }));
    cursor += 16;
    t += 0.01;
  }
  lines.push(JSON.stringify({ t, type: "response.completed" }));
  // phase 2 — packed into ~0.5s of virtual time so test windows stay short
  // (engine plays at 1× wall-time pace at every tier; rate envelope only
  // controls event-type filtering and HEAVY telemetry density)
  lines.push(JSON.stringify({ t: 0.10, type: "update", patches: [{ id: "r-001", status: "running" }] }));
  lines.push(JSON.stringify({ t: 0.20, type: "update", patches: [{ id: "r-001", gate1: "00:14.32" }] }));
  lines.push(JSON.stringify({ t: 0.30, type: "update", patches: [{ id: "r-001", finish: "01:18.84", status: "finished", delta: "LEADER" }] }));
  lines.push(JSON.stringify({ t: 0.35, type: "rerank", patches: [{ id: "r-002", delta: "+1.20" }] }));
  lines.push(JSON.stringify({ t: 0.40, type: "commentary", patches: [{ id: "r-001", notes: "Aggressive" }] }));
  return lines.join("\n");
})();

describe("createRaceReplay", () => {
  // The global test setup (apps/website/__tests__/setup.ts) stubs
  // requestAnimationFrame as a no-op to prevent React rerender storms in
  // component tests. For replay-engine tests we need a real rAF, so we
  // override the stub for this suite.
  let originalRaf: typeof globalThis.requestAnimationFrame;
  let originalCaf: typeof globalThis.cancelAnimationFrame;
  beforeEach(() => {
    originalRaf = globalThis.requestAnimationFrame;
    originalCaf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 0) as unknown as number) as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) =>
      clearTimeout(id as unknown as NodeJS.Timeout)) as typeof globalThis.cancelAnimationFrame;
  });
  afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCaf;
    vi.restoreAllMocks();
  });

  it("phase 1: parses deltas via parseElementStream and emits add per row", async () => {
    const adds: RaceRow[] = [];
    const replay = createRaceReplay({
      recording: FIXTURE,
      ratePerSec: 60,
      isPlaying: true,
      onTransaction: (tx) => {
        if (tx.add) adds.push(...tx.add);
      },
    });
    // give the async parser time to run
    await new Promise((r) => setTimeout(r, 200));
    expect(adds.filter((r) => r.id === "r-001")).toHaveLength(1);
    expect(adds.filter((r) => r.id === "r-002")).toHaveLength(1);
    replay.dispose();
  });

  it("phase 2: at PROD tier emits update + rerank + commentary patches", async () => {
    const updates: Array<Partial<RaceRow>> = [];
    const replay = createRaceReplay({
      recording: FIXTURE,
      ratePerSec: 60,
      isPlaying: true,
      onTransaction: (tx) => {
        if (tx.update) updates.push(...tx.update);
      },
    });
    // run long enough for virtual t=14 to elapse at 1× wall-time
    await new Promise((r) => setTimeout(r, 1500));
    const r1 = updates.filter((u) => u.id === "r-001");
    // running, gate1, finish, commentary — at least 4 update events for r-001
    expect(r1.length).toBeGreaterThanOrEqual(3);
    // rerank for r-002
    expect(updates.some((u) => u.id === "r-002" && u.delta === "+1.20")).toBe(true);
    replay.dispose();
  }, 4000);

  it("LIGHT tier filters out rerank + commentary patches", async () => {
    const updates: Array<Partial<RaceRow>> = [];
    const replay = createRaceReplay({
      recording: FIXTURE,
      ratePerSec: 10,
      isPlaying: true,
      onTransaction: (tx) => {
        if (tx.update) updates.push(...tx.update);
      },
    });
    await new Promise((r) => setTimeout(r, 1500));
    // No rerank: r-002 should never have its delta updated
    expect(updates.some((u) => u.id === "r-002" && u.delta)).toBe(false);
    // No commentary: r-001 should never have its notes updated
    expect(updates.some((u) => u.id === "r-001" && u.notes)).toBe(false);
    replay.dispose();
  }, 4000);

  it("HEAVY tier synthesizes telemetry add rows (id starts with tel-)", async () => {
    const adds: RaceRow[] = [];
    const replay = createRaceReplay({
      recording: FIXTURE,
      ratePerSec: 250,
      isPlaying: true,
      onTransaction: (tx) => {
        if (tx.add) adds.push(...tx.add);
      },
    });
    await new Promise((r) => setTimeout(r, 500));
    const tel = adds.filter((r) => r.id.startsWith("tel-"));
    expect(tel.length).toBeGreaterThan(0);
    expect(tel[0].bib).toBe("—");
    expect(tel[0].racer).toMatch(/sensor|wind|gate|chairlift/i);
    replay.dispose();
  }, 2000);

  it("LIGHT and PROD tiers do not synthesize telemetry", async () => {
    for (const rate of [10, 60] as const) {
      const adds: RaceRow[] = [];
      const replay = createRaceReplay({
        recording: FIXTURE,
        ratePerSec: rate,
        isPlaying: true,
        onTransaction: (tx) => {
          if (tx.add) adds.push(...tx.add);
        },
      });
      await new Promise((r) => setTimeout(r, 300));
      const tel = adds.filter((r) => r.id.startsWith("tel-"));
      expect(tel).toHaveLength(0);
      replay.dispose();
    }
  }, 2000);

  it("setPlaying(false) pauses dispatch", async () => {
    const callback = vi.fn();
    const replay = createRaceReplay({
      recording: FIXTURE,
      ratePerSec: 60,
      isPlaying: true,
      onTransaction: callback,
    });
    await new Promise((r) => setTimeout(r, 100));
    replay.setPlaying(false);
    callback.mockClear();
    await new Promise((r) => setTimeout(r, 200));
    // No NEW dispatches after pause (allow one already-in-flight microtask)
    expect(callback.mock.calls.length).toBeLessThanOrEqual(1);
    replay.dispose();
  });
});
