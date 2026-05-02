"use client";

import { PretableSurface } from "@pretable-internal/react-surface";
import { useEffect, useRef, useState } from "react";

import { type HeroEvent, heroEventLog } from "./heroGrid/eventLog";
import { createHeroReplay } from "./heroGrid/replay";
import styles from "./heroGrid/heroGrid.module.css";

const RATE_PER_SEC = 1000;
const VISIBLE_BUFFER_ROWS = 200;
const SEED_ROW_COUNT = 30;

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

function buildSeedRows(count: number): DisplayRow[] {
  return heroEventLog.slice(0, count).map((entry, index) => ({
    ...entry,
    __sequence: index,
    id: `seed-${index}`,
  }));
}

export function HeroGrid() {
  const [rows, setRows] = useState<DisplayRow[]>(() =>
    buildSeedRows(SEED_ROW_COUNT),
  );
  const [paused, setPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const reduce =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduce) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration snapshot for reduced-motion users
      setRows(
        heroEventLog.slice(0, 50).map((entry, index) => ({
          ...entry,
          __sequence: index,
          id: `seed-${index}`,
        })),
      );
      return;
    }

    let pending: DisplayRow[] = [];
    const replay = createHeroReplay({
      ratePerSec: RATE_PER_SEC,
      onEmit: (event: HeroEvent, sequence: number) => {
        pending.push({
          ...event,
          __sequence: sequence,
          id: `seq-${sequence}`,
        });
      },
    });

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

    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const onEnter = () => setPaused(true);
    const onLeave = () => setPaused(false);
    const el = containerRef.current;
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <section className={`hero ${styles.hero}`} ref={containerRef}>
      <div className={styles.topBar}>
        <span className={styles.dot}>●</span>
        <span className={styles.brand}>pretable.ai</span>
        <span className={styles.sep}>·</span>
        <span>events.stream</span>
        <span className={styles.spacer} />
        <span className={styles.metric}>3,000 rows · 9.3ms p95</span>
      </div>
      <div className={styles.gridFrame} data-paused={paused}>
        <PretableSurface
          ariaLabel="Pretable streaming demo"
          columns={columns}
          getRowId={(row: DisplayRow) => row.id}
          rows={rows}
          viewportHeight={520}
        />
      </div>
    </section>
  );
}
