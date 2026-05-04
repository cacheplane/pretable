import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { RaceRow } from "../types";

/** Deterministic seeded PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 0xc0ffee;

interface RacerDef {
  name: string;
  flag: string;
  skill: number; // higher = faster
}

const RACERS: RacerDef[] = [
  { name: "Marco Odermatt", flag: "🇨🇭", skill: 0.95 },
  { name: "Henrik Kristoffersen", flag: "🇳🇴", skill: 0.92 },
  { name: "Lucas Braathen", flag: "🇳🇴", skill: 0.91 },
  { name: "Alexis Pinturault", flag: "🇫🇷", skill: 0.9 },
  { name: "Loïc Meillard", flag: "🇨🇭", skill: 0.89 },
  { name: "Žan Kranjec", flag: "🇸🇮", skill: 0.88 },
  { name: "Filip Zubčić", flag: "🇭🇷", skill: 0.87 },
  { name: "Manuel Feller", flag: "🇦🇹", skill: 0.87 },
  { name: "Marco Schwarz", flag: "🇦🇹", skill: 0.86 },
  { name: "Stefan Brennsteiner", flag: "🇦🇹", skill: 0.85 },
  { name: "Justin Murisier", flag: "🇨🇭", skill: 0.85 },
  { name: "Thomas Tumler", flag: "🇨🇭", skill: 0.84 },
  { name: "Gino Caviezel", flag: "🇨🇭", skill: 0.84 },
  { name: "Atle Lie McGrath", flag: "🇳🇴", skill: 0.83 },
  { name: "Timon Haugan", flag: "🇳🇴", skill: 0.83 },
  { name: "River Radamus", flag: "🇺🇸", skill: 0.82 },
  { name: "Tommy Ford", flag: "🇺🇸", skill: 0.82 },
  { name: "Trevor Philp", flag: "🇨🇦", skill: 0.81 },
  { name: "Erik Read", flag: "🇨🇦", skill: 0.81 },
  { name: "Giovanni Borsotti", flag: "🇮🇹", skill: 0.8 },
  { name: "Luca De Aliprandini", flag: "🇮🇹", skill: 0.8 },
  { name: "Alex Vinatzer", flag: "🇮🇹", skill: 0.79 },
  { name: "Roland Leitinger", flag: "🇦🇹", skill: 0.79 },
  { name: "Patrick Feurstein", flag: "🇦🇹", skill: 0.78 },
  { name: "Fabio Gstrein", flag: "🇦🇹", skill: 0.78 },
  { name: "Joan Verdú", flag: "🇦🇩", skill: 0.77 },
  { name: "Albert Ortega", flag: "🇪🇸", skill: 0.77 },
  { name: "Raphaël Burtin", flag: "🇫🇷", skill: 0.76 },
  { name: "Steven Amiez", flag: "🇫🇷", skill: 0.75 },
  { name: "Tobias Kastlunger", flag: "🇮🇹", skill: 0.74 },
];

const COMMENTARY_PHRASES = [
  "Clean line through the pitch.",
  "Big push out of the start gate.",
  "Loses a tenth on the flats but recovers.",
  "Aggressive on the upper section.",
  "Skis it like a champion.",
  "Tactical run — patient through the turns.",
  "Pure speed on the bottom pitch.",
  "Battles back after a small bobble.",
  "Direct line — no wasted motion.",
  "Carrying serious speed into the finish.",
];

function emptyRow(racer: RacerDef, idx: number): RaceRow {
  return {
    id: String(idx + 1),
    bib: idx + 1,
    racer: `${racer.name} ${racer.flag}`,
    gate1: "",
    gate2: "",
    gate3: "",
    finish: "",
    delta: "",
    status: "dns",
    notes: "",
  };
}

function formatTime(totalSeconds: number): string {
  const mm = Math.floor(totalSeconds / 60);
  const rem = totalSeconds - mm * 60;
  const ss = Math.floor(rem);
  const cs = Math.round((rem - ss) * 100);
  // Handle rounding overflow.
  let outSs = ss;
  let outMm = mm;
  let outCs = cs;
  if (outCs === 100) {
    outCs = 0;
    outSs += 1;
  }
  if (outSs === 60) {
    outSs = 0;
    outMm += 1;
  }
  return `${String(outMm).padStart(2, "0")}:${String(outSs).padStart(2, "0")}.${String(outCs).padStart(2, "0")}`;
}

function formatDelta(deltaSeconds: number): string {
  if (deltaSeconds === 0) return "LEADER";
  const sign = deltaSeconds > 0 ? "+" : "-";
  const abs = Math.abs(deltaSeconds);
  return `${sign}${abs.toFixed(2)}`;
}

interface Phase1Event {
  type: "response.created" | "response.output_text.delta" | "response.completed";
  t: number;
  delta?: string;
}

interface Phase2Event {
  t: number;
  type: "update" | "rerank" | "commentary";
  patches: Array<Partial<RaceRow> & { id: string }>;
}

export function generateRaceRecording(): string {
  const rand = mulberry32(SEED);
  const lines: string[] = [];

  // ---- Phase 1: SSE-style starting list emission ----
  const startingList: RaceRow[] = RACERS.map((r, i) => emptyRow(r, i));
  const json = JSON.stringify(startingList);

  let t = 0;
  const phase1Created: Phase1Event = { type: "response.created", t };
  lines.push(JSON.stringify(phase1Created));

  let cursor = 0;
  while (cursor < json.length) {
    // chunk size 8-30 chars
    const size = 8 + Math.floor(rand() * 23);
    const chunk = json.slice(cursor, cursor + size);
    cursor += size;
    // 8-23ms advance
    t += 8 + Math.floor(rand() * 16);
    const ev: Phase1Event = {
      type: "response.output_text.delta",
      t,
      delta: chunk,
    };
    lines.push(JSON.stringify(ev));
  }

  t += 8 + Math.floor(rand() * 16);
  const phase1Done: Phase1Event = { type: "response.completed", t };
  lines.push(JSON.stringify(phase1Done));

  // ---- Phase 2: race narrative as transaction batches ----
  // Use real-life time scale, units = seconds. Stagger 4s per racer.
  // Each racer's run ~12s. Splits at 22%, 48%, 74%.
  // Time t is in milliseconds for events.
  let raceT = t + 500; // small gap

  interface RacerState {
    idx: number;
    def: RacerDef;
    startT: number; // ms when start gate fires
    runDuration: number; // seconds
    gate1S: number; // split times in seconds (run-relative)
    gate2S: number;
    gate3S: number;
    finishS: number;
    fate: "finish" | "DNF" | "DSQ";
    dnfGate?: 1 | 2 | 3;
  }

  const states: RacerState[] = RACERS.map((def, i) => {
    // skill 0.74-0.95. Base run 75-85s, scaled by skill.
    const base = 80; // seconds (real life)
    const skillFactor = 1.0 - (def.skill - 0.74) * 0.6; // higher skill -> smaller factor
    const noise = (rand() - 0.5) * 1.6; // ±0.8s
    const realRunSeconds = base * skillFactor + noise; // ~75-85s
    const compressed = realRunSeconds / 7; // ~10.7-12.1s

    const fateRoll = rand();
    let fate: "finish" | "DNF" | "DSQ" = "finish";
    let dnfGate: 1 | 2 | 3 | undefined;
    if (fateRoll < 0.05) {
      fate = "DNF";
      // pick gate 1 (40%), 2 (40%), 3 (20%)
      const gr = rand();
      dnfGate = gr < 0.4 ? 1 : gr < 0.8 ? 2 : 3;
    } else if (fateRoll < 0.06) {
      fate = "DSQ";
    }

    return {
      idx: i,
      def,
      startT: (4 + 4 * i) * 1000, // ms relative to phase 2 start
      runDuration: compressed,
      gate1S: compressed * 0.22,
      gate2S: compressed * 0.48,
      gate3S: compressed * 0.74,
      finishS: compressed,
      fate,
      dnfGate,
    };
  });

  // Build event timeline (ms-relative to phase 2 start), then sort and emit.
  interface RawEvent {
    t: number; // ms relative to phase 2 start
    kind: "start" | "gate1" | "gate2" | "gate3" | "finish" | "dnf" | "dsq" | "tick";
    racer: RacerState;
    tickProgress?: number; // 0..1 along run, for "tick" kind
  }
  const raw: RawEvent[] = [];

  // Track-position tick events (notes-field micro-updates) emitted at ~100ms cadence
  // between gates. They provide per-frame visual movement without flooding gate fields.
  for (const s of states) {
    raw.push({ t: s.startT, kind: "start", racer: s });
    // Tick cadence ~120ms while running. Skip the exact gate moments to avoid
    // colliding with gate updates. For DNF cases, only emit ticks up to the DNF gate.
    const dnfCutoffS =
      s.fate === "DNF"
        ? s.dnfGate === 1
          ? s.gate1S
          : s.dnfGate === 2
            ? s.gate2S
            : s.gate3S
        : s.finishS;
    const tickCount = Math.max(8, Math.floor((dnfCutoffS * 1000) / 110));
    for (let k = 1; k <= tickCount; k++) {
      const progress = (k / (tickCount + 1)) * (dnfCutoffS / s.finishS);
      const tMsRel = s.startT + dnfCutoffS * 1000 * (k / (tickCount + 1));
      raw.push({ t: tMsRel, kind: "tick", racer: s, tickProgress: progress });
    }
    if (s.fate === "DNF") {
      const gateMs = s.dnfGate === 1 ? s.gate1S * 1000 : s.dnfGate === 2 ? s.gate2S * 1000 : s.gate3S * 1000;
      // Push past-gates first if applicable
      if ((s.dnfGate ?? 1) >= 2) raw.push({ t: s.startT + s.gate1S * 1000, kind: "gate1", racer: s });
      if ((s.dnfGate ?? 1) >= 3) raw.push({ t: s.startT + s.gate2S * 1000, kind: "gate2", racer: s });
      // DNF event slightly after the gate they were heading toward
      raw.push({ t: s.startT + gateMs + 600, kind: "dnf", racer: s });
    } else if (s.fate === "DSQ") {
      // Run completes normally then DSQ flag at finish+small offset
      raw.push({ t: s.startT + s.gate1S * 1000, kind: "gate1", racer: s });
      raw.push({ t: s.startT + s.gate2S * 1000, kind: "gate2", racer: s });
      raw.push({ t: s.startT + s.gate3S * 1000, kind: "gate3", racer: s });
      raw.push({ t: s.startT + s.finishS * 1000, kind: "finish", racer: s });
      raw.push({ t: s.startT + s.finishS * 1000 + 1500, kind: "dsq", racer: s });
    } else {
      raw.push({ t: s.startT + s.gate1S * 1000, kind: "gate1", racer: s });
      raw.push({ t: s.startT + s.gate2S * 1000, kind: "gate2", racer: s });
      raw.push({ t: s.startT + s.gate3S * 1000, kind: "gate3", racer: s });
      raw.push({ t: s.startT + s.finishS * 1000, kind: "finish", racer: s });
    }
  }

  // Stable sort by (t, racer.idx, kindOrder)
  const kindOrder: Record<RawEvent["kind"], number> = {
    start: 0,
    tick: 1,
    gate1: 2,
    gate2: 3,
    gate3: 4,
    finish: 5,
    dnf: 6,
    dsq: 7,
  };
  raw.sort((a, b) => {
    if (a.t !== b.t) return a.t - b.t;
    if (a.racer.idx !== b.racer.idx) return a.racer.idx - b.racer.idx;
    return kindOrder[a.kind] - kindOrder[b.kind];
  });

  const phase2Events: Phase2Event[] = [];

  // Track finished racers and current leader run-time (seconds).
  interface FinishedRow {
    id: string;
    runSeconds: number;
  }
  const finished: FinishedRow[] = [];
  let leaderTime: number | null = null;

  for (const ev of raw) {
    const tMs = raceT + ev.t;
    const id = ev.racer.def === RACERS[ev.racer.idx] ? String(ev.racer.idx + 1) : String(ev.racer.idx + 1);

    if (ev.kind === "start") {
      phase2Events.push({
        t: tMs,
        type: "update",
        patches: [{ id, status: "running", notes: "·" }],
      });
    } else if (ev.kind === "tick") {
      // Progress-trail in notes: dots that grow as the racer moves down the course.
      const prog = ev.tickProgress ?? 0;
      const dots = "·".repeat(Math.max(1, Math.floor(prog * 14) + 1));
      phase2Events.push({
        t: tMs,
        type: "commentary",
        patches: [{ id, notes: dots }],
      });
    } else if (ev.kind === "gate1") {
      phase2Events.push({
        t: tMs,
        type: "update",
        patches: [{ id, gate1: formatTime(ev.racer.gate1S * 7) }],
      });
    } else if (ev.kind === "gate2") {
      phase2Events.push({
        t: tMs,
        type: "update",
        patches: [{ id, gate2: formatTime(ev.racer.gate2S * 7) }],
      });
    } else if (ev.kind === "gate3") {
      phase2Events.push({
        t: tMs,
        type: "update",
        patches: [{ id, gate3: formatTime(ev.racer.gate3S * 7) }],
      });
    } else if (ev.kind === "finish") {
      const finishSecondsReal = ev.racer.finishS * 7;
      const isNewLeader = leaderTime === null || finishSecondsReal < leaderTime;
      const prevLeader = leaderTime;
      if (isNewLeader) leaderTime = finishSecondsReal;
      const delta = isNewLeader ? 0 : finishSecondsReal - leaderTime!;

      phase2Events.push({
        t: tMs,
        type: "update",
        patches: [
          {
            id,
            finish: formatTime(finishSecondsReal),
            delta: formatDelta(delta),
            status: "finished",
          },
        ],
      });
      finished.push({ id, runSeconds: finishSecondsReal });

      // Rerank if new leader and there were prior finishers.
      if (isNewLeader && prevLeader !== null && finished.length > 1) {
        const rerankPatches = finished
          .filter((f) => f.id !== id)
          .map((f) => ({
            id: f.id,
            delta: formatDelta(f.runSeconds - leaderTime!),
          }));
        if (rerankPatches.length > 0) {
          phase2Events.push({
            t: tMs + 50,
            type: "rerank",
            patches: rerankPatches,
          });
        }
      }

      // Commentary stream — 30% chance, but stream multiple phrases for richness.
      if (rand() < 0.3) {
        const phrase = COMMENTARY_PHRASES[Math.floor(rand() * COMMENTARY_PHRASES.length)]!;
        const tokens = phrase.split(/(\s+)/).filter((s) => s.length > 0);
        // 10-15 patches — pad if needed by splitting longer tokens
        const pieces: string[] = [];
        for (const tk of tokens) pieces.push(tk);
        while (pieces.length < 10) {
          // split longest piece
          let longestIdx = 0;
          for (let i = 1; i < pieces.length; i++) {
            if (pieces[i]!.length > pieces[longestIdx]!.length) longestIdx = i;
          }
          const p = pieces[longestIdx]!;
          if (p.length < 2) break;
          const mid = Math.floor(p.length / 2);
          pieces.splice(longestIdx, 1, p.slice(0, mid), p.slice(mid));
        }
        const limited = pieces.slice(0, 15);
        let accum = "";
        let cT = tMs + 200;
        for (const piece of limited) {
          accum += piece;
          cT += 80 + Math.floor(rand() * 120);
          phase2Events.push({
            t: cT,
            type: "commentary",
            patches: [{ id, notes: accum }],
          });
        }
      }
    } else if (ev.kind === "dnf") {
      const gate = ev.racer.dnfGate ?? 1;
      phase2Events.push({
        t: tMs,
        type: "update",
        patches: [
          {
            id,
            status: "DNF",
            notes: `Out at gate ${gate}`,
          },
        ],
      });
    } else if (ev.kind === "dsq") {
      phase2Events.push({
        t: tMs,
        type: "update",
        patches: [
          {
            id,
            status: "DSQ",
            notes: "Under review — gate fault",
          },
        ],
      });
    }
  }

  // Sort phase 2 events by t ascending (stable) to emit in chronological order.
  phase2Events.sort((a, b) => a.t - b.t);

  for (const ev of phase2Events) {
    lines.push(JSON.stringify(ev));
  }

  return lines.join("\n") + "\n";
}

// CLI entrypoint
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("generate-race.ts")
) {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(here, "..", "recordings", "race.jsonl");
  mkdirSync(dirname(out), { recursive: true });
  const text = generateRaceRecording();
  writeFileSync(out, text);
  // eslint-disable-next-line no-console
  console.log(
    `wrote ${out} — ${text.length} bytes, ${text.split("\n").length - 1} lines`,
  );
}
