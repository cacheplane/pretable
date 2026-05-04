import { parseElementStream } from "@pretable/stream-adapter";
import type { RaceRow } from "./types";

export type RaceRate = 10 | 60 | 250;

export interface RaceReplayOptions {
  recording: string;
  ratePerSec: RaceRate;
  isPlaying: boolean;
  onTransaction: (tx: {
    add?: RaceRow[];
    update?: Partial<RaceRow>[];
  }) => void;
}

export interface RaceReplay {
  setRate(rate: RaceRate): void;
  setPlaying(playing: boolean): void;
  dispose(): void;
}

interface Phase1Event {
  t: number;
  type: "response.created" | "response.output_text.delta" | "response.completed";
  delta?: string;
}

type Phase2Type = "update" | "rerank" | "commentary";

interface Phase2Event {
  t: number;
  type: Phase2Type;
  patches: Array<Partial<RaceRow> & { id: string }>;
}

const TELEMETRY_LABELS = [
  "Sensor: gate 4 wind",
  "Sensor: gate 6 snow temp",
  "Sensor: gate 9 spacing",
  "Sensor: chairlift 7",
  "Sensor: weather station",
];

const TELEMETRY_READINGS = [
  "12.4 km/h NW",
  "−3.2°C",
  "8.7 m spacing",
  "load 62%",
  "vis 4.1 km",
  "8.9 km/h N",
  "−4.0°C",
  "9.1 m spacing",
  "load 71%",
  "vis 3.8 km",
];

function tierAllows(rate: RaceRate, type: Phase2Type): boolean {
  if (type === "update") return true;
  return rate >= 60;
}

function padTel(n: number): string {
  return String(n).padStart(4, "0");
}

function synthesizeTelemetry(counter: number): RaceRow {
  const label = TELEMETRY_LABELS[counter % TELEMETRY_LABELS.length];
  const reading = TELEMETRY_READINGS[counter % TELEMETRY_READINGS.length];
  return {
    id: `tel-${padTel(counter)}`,
    bib: "—",
    racer: label,
    gate1: "",
    gate2: "",
    gate3: "",
    finish: "",
    delta: "",
    status: "running",
    notes: reading,
  };
}

export function createRaceReplay(options: RaceReplayOptions): RaceReplay {
  let rate: RaceRate = options.ratePerSec;
  let playing = options.isPlaying;
  let disposed = false;

  // Parse all lines once
  const lines = options.recording.split("\n").filter((l) => l.trim().length > 0);
  const phase1Deltas: string[] = [];
  const phase2Events: Phase2Event[] = [];

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const ev = parsed as { type?: string; delta?: string; t?: number; patches?: unknown };
    if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") {
      phase1Deltas.push(ev.delta);
    } else if (
      ev.type === "update" ||
      ev.type === "rerank" ||
      ev.type === "commentary"
    ) {
      if (Array.isArray(ev.patches) && typeof ev.t === "number") {
        phase2Events.push({
          t: ev.t,
          type: ev.type as Phase2Type,
          patches: ev.patches as Phase2Event["patches"],
        });
      }
    }
  }

  phase2Events.sort((a, b) => a.t - b.t);
  const lastPhase2T = phase2Events.length > 0 ? phase2Events[phase2Events.length - 1].t : 0;
  const loopDuration = lastPhase2T + 5;

  // Phase 1: kick off async parser immediately
  (async () => {
    if (disposed) return;
    async function* gen(): AsyncIterable<string> {
      for (const d of phase1Deltas) {
        if (disposed) return;
        yield d;
      }
    }
    try {
      for await (const row of parseElementStream<RaceRow>(gen())) {
        if (disposed) return;
        options.onTransaction({ add: [row] });
      }
    } catch {
      // swallow parse errors silently — replay engine should be resilient
    }
  })();

  // Phase 2: rAF-driven virtual clock
  let phase2Index = 0;
  let virtualT = 0;
  let lastWall = 0;
  let telCounter = 0;
  let nextTelT = 0;
  let rafId: number | null = null;

  const hasRaf = typeof requestAnimationFrame !== "undefined";

  function tick(now: number) {
    if (disposed) return;
    if (!playing) {
      lastWall = now;
      rafId = requestAnimationFrame(tick);
      return;
    }
    if (lastWall === 0) {
      lastWall = now;
      rafId = requestAnimationFrame(tick);
      return;
    }
    const dtWall = (now - lastWall) / 1000;
    lastWall = now;
    // Virtual time advances proportional to rate so the full recording plays
    // in real time at a tempo matching the configured event rate. PROD (60)
    // → 60× compression; HEAVY (250) → 250× compression; LIGHT (10) → 10×.
    const dt = dtWall * rate;
    virtualT += dt;

    // Drain phase 2 events
    while (
      phase2Index < phase2Events.length &&
      phase2Events[phase2Index].t <= virtualT
    ) {
      const ev = phase2Events[phase2Index++];
      if (tierAllows(rate, ev.type)) {
        options.onTransaction({ update: ev.patches });
      }
    }

    // HEAVY tier telemetry synthesis: 1 row per ~10ms of virtual time
    if (rate === 250) {
      while (nextTelT <= virtualT) {
        options.onTransaction({ add: [synthesizeTelemetry(telCounter++)] });
        nextTelT += 0.01;
      }
    }

    // Loop at end of recording
    if (virtualT >= loopDuration) {
      virtualT = 0;
      phase2Index = 0;
      nextTelT = 0;
      // telCounter keeps incrementing to keep IDs unique
    }

    rafId = requestAnimationFrame(tick);
  }

  if (hasRaf) {
    rafId = requestAnimationFrame(tick);
  }

  return {
    setRate(newRate: RaceRate) {
      rate = newRate;
    },
    setPlaying(p: boolean) {
      playing = p;
      if (!p) {
        // Reset wall reference so resume doesn't jump
        lastWall = 0;
      }
    },
    dispose() {
      disposed = true;
      if (rafId !== null && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(rafId);
      }
      rafId = null;
    },
  };
}
