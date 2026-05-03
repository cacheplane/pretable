"use client";

import { PretableSurface } from "@pretable/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useControlState } from "./heroGrid/controlState";
import { type HeroEvent, heroEventLog } from "./heroGrid/eventLog";
import { createHeroReplay } from "./heroGrid/replay";
import styles from "./heroGrid/heroGrid.module.css";

const VISIBLE_BUFFER_ROWS = 200;
const FALLBACK_VIEWPORT_HEIGHT = 520;

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

  // Measure the bezel's inner surface so PretableSurface fills it. We use
  // useLayoutEffect for the first paint and a ResizeObserver for window
  // resizes / drawer state changes. SSR / jsdom (no ResizeObserver) falls
  // back to a fixed 520.
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(
    FALLBACK_VIEWPORT_HEIGHT,
  );

  useLayoutEffect(() => {
    const el = surfaceRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const next = Math.max(
        FALLBACK_VIEWPORT_HEIGHT,
        Math.round(el.clientHeight),
      );
      setViewportHeight((prev) => (prev === next ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    <section className={`hero ${styles.heroBackdrop}`}>
      <div className={styles.heroBezel} data-testid="hero-bezel">
        <div className={styles.heroSurface} ref={surfaceRef}>
          <PretableSurface<DisplayRow>
            ariaLabel="Pretable streaming demo"
            columns={columns}
            getRowId={(row) => row.id}
            rows={rows}
            viewportHeight={viewportHeight}
          />
        </div>
      </div>
    </section>
  );
}
