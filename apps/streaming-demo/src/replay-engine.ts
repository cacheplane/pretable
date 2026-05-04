import {
  create,
  push,
  isArrayNode,
  isObjectNode,
  isComplete,
} from "@cacheplane/json-stream";
import type { StreamState } from "@cacheplane/json-stream";
import { createBatcher } from "@pretable/stream-adapter";
import type { TransactionBatcher } from "@pretable/stream-adapter";

import type {
  EngineState,
  ParserSnapshot,
  Phase1Entry,
  Phase2Entry,
  PlaybackSpeed,
  ReplayPhase,
  StockRow,
} from "./types";

const RECENT_EVENT_CAP = 8;

interface EngineOptions {
  phase1: Phase1Entry[];
  phase2: Phase2Entry[];
  grid: {
    applyTransaction(tx: {
      add?: StockRow[];
      update?: Partial<StockRow>[];
      remove?: string[];
    }): void;
  };
  /** For tests — allows synchronous `advanceTo` + `flush` without rAF. */
  disableRaf?: boolean;
}

export interface ReplayEngine {
  getState(): EngineState;
  subscribe(listener: () => void): () => void;
  play(): void;
  pause(): void;
  setSpeed(speed: PlaybackSpeed): void;
  seek(t: number): void;
  /** Test-only: advance clock synchronously and dispatch up to target time. */
  advanceTo(t: number): void;
  /** Test-only: flush pending batcher ops. */
  flush(): void;
  dispose(): void;
}

export function createEngine(options: EngineOptions): ReplayEngine {
  const { phase1, phase2, grid } = options;

  const phase1End = phase1.length > 0 ? phase1[phase1.length - 1].t : 0;
  const phase2End = phase2.length > 0 ? phase2[phase2.length - 1].t : phase1End;
  const totalDuration = Math.max(phase1End, phase2End);

  let parser: StreamState = create();
  let batcher: TransactionBatcher<StockRow> = createBatcher(grid);
  let phase1Index = 0;
  let phase2Index = 0;
  let yieldedChildCount = 0;
  let rowsAdded = 0;
  let patchesApplied = 0;
  let lastPatchBatch: EngineState["lastPatchBatch"] = null;
  const recent: Phase1Entry[] = [];

  let clock = 0;
  let speed: PlaybackSpeed = 1;
  let playing = false;
  let rafId: number | null = null;
  let lastRafTs: number | null = null;

  const listeners = new Set<() => void>();

  function currentPhase(): ReplayPhase {
    if (clock >= totalDuration) return "done";
    if (clock < phase1End) return "fill";
    return "live";
  }

  function computeParserSnapshot(): ParserSnapshot | null {
    if (currentPhase() !== "fill") return null;
    if (parser.rootId === null) {
      return {
        mode: "Value",
        rootKind: "empty",
        topLevelCount: 0,
        topLevelCompleted: 0,
        buildingRow: null,
      };
    }
    const root = parser.nodes[parser.rootId];
    if (!isArrayNode(root)) {
      return {
        mode: "Value",
        rootKind: "other",
        topLevelCount: 0,
        topLevelCompleted: 0,
        buildingRow: null,
      };
    }
    let completed = 0;
    let building: Partial<StockRow> | null = null;
    for (const childId of root.children) {
      const child = parser.nodes[childId];
      if (isComplete(child)) {
        completed++;
      } else if (isObjectNode(child) && child.value) {
        building = child.value as Partial<StockRow>;
      }
    }
    return {
      mode: "StringValue",
      rootKind: "array",
      topLevelCount: root.children.length,
      topLevelCompleted: completed,
      buildingRow: building,
    };
  }

  let cachedState: EngineState | null = null;
  function getState(): EngineState {
    if (cachedState) return cachedState;
    cachedState = {
      clock,
      speed,
      playing,
      phase: currentPhase(),
      totalDuration,
      recentStreamEvents: recent.slice(),
      lastPatchBatch,
      parserSnapshot: computeParserSnapshot(),
      stats: { rowsAdded, patchesApplied },
    };
    return cachedState;
  }

  function notify(): void {
    cachedState = null;
    for (const l of listeners) l();
  }

  function dispatchPhase1Up(toT: number): void {
    while (phase1Index < phase1.length && phase1[phase1Index].t <= toT) {
      const entry = phase1[phase1Index++];
      recent.push(entry);
      if (recent.length > RECENT_EVENT_CAP) recent.shift();

      if (entry.type === "response.output_text.delta") {
        parser = push(parser, entry.delta);
        yieldNewlyCompleteRows();
      }
    }
  }

  function yieldNewlyCompleteRows(): void {
    if (parser.rootId === null) return;
    const root = parser.nodes[parser.rootId];
    if (!isArrayNode(root)) return;
    while (yieldedChildCount < root.children.length) {
      const child = parser.nodes[root.children[yieldedChildCount]];
      if (!isComplete(child)) break;
      if (child.value !== undefined) {
        const row = child.value as Partial<StockRow> & { symbol: string };
        const full: StockRow = {
          id: row.symbol,
          symbol: row.symbol,
          name: row.name ?? "",
          last: row.last ?? 0,
          change_pct: row.change_pct ?? 0,
          volume: row.volume ?? 0,
          sector: row.sector ?? "",
          last_update: row.last_update ?? "",
        };
        batcher.add([full]);
        rowsAdded++;
      }
      yieldedChildCount++;
    }
  }

  function dispatchPhase2Up(toT: number): void {
    while (phase2Index < phase2.length && phase2[phase2Index].t <= toT) {
      const entry = phase2[phase2Index++];
      batcher.update(entry.patches);
      patchesApplied += entry.patches.length;
      lastPatchBatch = {
        size: entry.patches.length,
        sample: entry.patches[0] ?? {},
      };
    }
  }

  function reset(): void {
    batcher.dispose();
    batcher = createBatcher(grid);
    parser = create();
    phase1Index = 0;
    phase2Index = 0;
    yieldedChildCount = 0;
    rowsAdded = 0;
    patchesApplied = 0;
    lastPatchBatch = null;
    recent.length = 0;
  }

  function advanceTo(targetT: number): void {
    if (targetT < clock) {
      reset();
      clock = 0;
    }
    dispatchPhase1Up(targetT);
    dispatchPhase2Up(targetT);
    clock = targetT;
    notify();
  }

  function seek(t: number): void {
    reset();
    clock = 0;
    advanceTo(t);
  }

  function flush(): void {
    batcher.flush();
  }

  function raf(ts: number): void {
    if (lastRafTs === null) {
      lastRafTs = ts;
      rafId = requestAnimationFrame(raf);
      return;
    }
    const dt = ((ts - lastRafTs) / 1000) * speed;
    lastRafTs = ts;
    let next = clock + dt;
    if (next >= totalDuration) {
      next = totalDuration;
      advanceTo(next);
      // Brief visual pause then loop.
      playing = false;
      setTimeout(() => {
        seek(0);
        play();
      }, 1000);
      return;
    }
    advanceTo(next);
    if (playing) rafId = requestAnimationFrame(raf);
  }

  function play(): void {
    if (playing) return;
    playing = true;
    lastRafTs = null;
    if (!options.disableRaf) {
      rafId = requestAnimationFrame(raf);
    }
    notify();
  }

  function pause(): void {
    if (!playing) return;
    playing = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    notify();
  }

  function setSpeed(s: PlaybackSpeed): void {
    speed = s;
    notify();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function dispose(): void {
    pause();
    batcher.dispose();
    listeners.clear();
  }

  return {
    getState,
    subscribe,
    play,
    pause,
    setSpeed,
    seek,
    advanceTo,
    flush,
    dispose,
  };
}
