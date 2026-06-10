import { parseElementStream } from "@pretable/stream-adapter";
import type { PositionRow } from "./types";

export type TickRate = 10 | 60 | 250;
type Phase2Type = "tick" | "commentary" | "flag";

export interface PortfolioReplayOptions {
  recording: string;
  ratePerSec: TickRate;
  isPlaying: boolean;
  onTransaction: (tx: { add?: PositionRow[]; update?: Array<Partial<PositionRow> & { id: string }> }) => void;
}

export interface PortfolioReplay {
  setRate(rate: TickRate): void;
  setPlaying(playing: boolean): void;
  dispose(): void;
}

interface Phase2Event { t: number; type: Phase2Type; patches: Array<Partial<PositionRow> & { id: string }> }

/** LIGHT drops ~⅔ of ticks; PRODUCTION keeps all; HEAVY keeps all (engine dups for throughput). */
function tickAllowed(rate: TickRate, index: number): boolean {
  if (rate === 10) return index % 3 === 0;
  return true;
}

export function createPortfolioReplay(options: PortfolioReplayOptions): PortfolioReplay {
  let rate: TickRate = options.ratePerSec;
  let playing = options.isPlaying;
  let disposed = false;

  const lines = options.recording.split("\n").filter((l) => l.trim().length > 0);
  const phase1Deltas: string[] = [];
  const phase2Events: Phase2Event[] = [];

  for (const line of lines) {
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (!parsed || typeof parsed !== "object") continue;
    const ev = parsed as { type?: string; delta?: string; t?: number; patches?: unknown };
    if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") {
      phase1Deltas.push(ev.delta);
    } else if ((ev.type === "tick" || ev.type === "commentary" || ev.type === "flag") && Array.isArray(ev.patches) && typeof ev.t === "number") {
      // Recording emits seconds.
      phase2Events.push({ t: ev.t, type: ev.type, patches: ev.patches as Phase2Event["patches"] });
    }
  }
  phase2Events.sort((a, b) => a.t - b.t);
  const lastT = phase2Events.length > 0 ? phase2Events[phase2Events.length - 1].t : 0;
  const loopDuration = lastT + 3;

  // Phase 1
  (async () => {
    if (disposed) return;
    async function* gen(): AsyncIterable<string> {
      for (const d of phase1Deltas) { if (disposed) return; yield d; }
    }
    try {
      for await (const row of parseElementStream<PositionRow>(gen())) {
        if (disposed) return;
        options.onTransaction({ add: [row] });
      }
    } catch { /* resilient: swallow parse errors */ }
  })();

  // Phase 2 — rAF virtual clock
  let phase2Index = 0;
  let virtualT = 0;
  // -1 = needs (re)baseline. A real rAF timestamp can be 0 (and is in tests),
  // so don't overload 0 as the "uninitialized" sentinel.
  let lastWall = -1;
  let tickCounter = 0;
  let rafId: number | null = null;
  const hasRaf = typeof requestAnimationFrame !== "undefined";

  function tick(now: number) {
    if (disposed) return;
    if (!playing || lastWall < 0) { lastWall = now; rafId = requestAnimationFrame(tick); return; }
    virtualT += (now - lastWall) / 1000;
    lastWall = now;

    while (phase2Index < phase2Events.length && phase2Events[phase2Index].t <= virtualT) {
      const ev = phase2Events[phase2Index++];
      if (ev.type === "tick") {
        if (tickAllowed(rate, tickCounter++)) {
          options.onTransaction({ update: ev.patches });
          if (rate === 250) options.onTransaction({ update: ev.patches }); // HEAVY: double throughput
        }
      } else {
        options.onTransaction({ update: ev.patches }); // commentary + flag always fire
      }
    }

    if (virtualT >= loopDuration) { virtualT = 0; phase2Index = 0; }
    rafId = requestAnimationFrame(tick);
  }

  if (hasRaf) rafId = requestAnimationFrame(tick);

  return {
    setRate(r) { rate = r; },
    setPlaying(p) { playing = p; if (!p) lastWall = -1; },
    dispose() {
      disposed = true;
      if (rafId !== null && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(rafId);
      rafId = null;
    },
  };
}
