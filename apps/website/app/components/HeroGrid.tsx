"use client";

import { PretableSurface } from "@pretable-internal/react-surface";
import { useEffect, useRef, useState } from "react";

import { useControlState } from "./heroGrid/controlState";
import { type HeroEvent, heroEventLog } from "./heroGrid/eventLog";
import { createHeroReplay } from "./heroGrid/replay";
import styles from "./heroGrid/heroGrid.module.css";

const VISIBLE_BUFFER_ROWS = 200;

const columns = [
  { id: "timestamp", header: "Time", widthPx: 92, pinned: "left" as const },
  { id: "kind", header: "Kind", widthPx: 180 },
  { id: "message", header: "Message", widthPx: 420, wrap: true },
  { id: "status", header: "Status", widthPx: 80 },
  { id: "latencyMs", header: "Latency (ms)", widthPx: 110 },
];

interface DisplayRow {
  id: string;
  timestamp: string;
  kind: string;
  message: string;
  status: string;
  latencyMs: number;
  __sequence: number;
  [key: string]: unknown;
}

const seedRows = (): DisplayRow[] =>
  heroEventLog.slice(0, 30).map((entry, index) => ({
    ...entry,
    __sequence: index,
    id: `seed-${index}`,
  }));

export function HeroGrid() {
  const { ratePerSec, isPlaying } = useControlState();
  const [rows, setRows] = useState<DisplayRow[]>(seedRows);
  const replayRef = useRef<ReturnType<typeof createHeroReplay> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduce) return; // keep seed snapshot, no replay

    let pending: DisplayRow[] = [];
    const replay = createHeroReplay({
      ratePerSec,
      onEmit: (event: HeroEvent, sequence: number) => {
        pending.push({
          ...event,
          __sequence: sequence,
          id: `seq-${sequence}`,
        });
      },
    });
    replayRef.current = replay;

    let raf = 0;
    const loop = (timestampMs: number) => {
      replay.tickAtMs(timestampMs);
      if (pending.length > 0) {
        const batch = pending;
        pending = [];
        setRows((prev) => {
          const next = [...batch.reverse(), ...prev];
          return next.length > VISIBLE_BUFFER_ROWS
            ? next.slice(0, VISIBLE_BUFFER_ROWS)
            : next;
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      replayRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs once; ratePerSec changes handled by separate effect
  }, []);

  // React to ratePerSec changes
  useEffect(() => {
    replayRef.current?.setRate(ratePerSec);
  }, [ratePerSec]);

  // React to play/pause changes
  useEffect(() => {
    if (isPlaying) {
      replayRef.current?.resume(performance.now());
    } else {
      replayRef.current?.pause();
    }
  }, [isPlaying]);

  return (
    <section className={`hero ${styles.hero}`}>
      <PretableSurface<DisplayRow>
        ariaLabel="Pretable streaming demo"
        columns={columns}
        getRowId={(row) => row.id}
        rows={rows}
        viewportHeight={520}
      />
    </section>
  );
}
