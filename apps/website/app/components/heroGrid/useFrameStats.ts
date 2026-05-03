"use client";

import { useEffect, useRef, useState } from "react";

const WINDOW_FRAMES = 60;
const UPDATE_INTERVAL_MS = 250;
const MIN_SAMPLES_FOR_P95 = 20;

export interface FrameStats {
  /** Frames per second from a sliding 60-frame window. Defaults to 60 before first sample. */
  fps: number;
  /** 95th-percentile frame interval (ms) from the same window. 0 until enough samples accumulate. */
  p95Ms: number;
}

/**
 * Live frame-rate + p95 frame interval observation.
 *
 * Measured via `requestAnimationFrame` deltas — the same path the bench uses.
 * Window: 60 frames. Updates published 4× per second.
 */
export function useFrameStats(): FrameStats {
  const [stats, setStats] = useState<FrameStats>({ fps: 60, p95Ms: 0 });
  const samplesRef = useRef<number[]>([]);
  const lastUpdateRef = useRef(0);
  const lastFrameRef = useRef(0);

  useEffect(() => {
    let raf = 0;
    const tick = (timestampMs: number) => {
      if (lastFrameRef.current !== 0) {
        const delta = timestampMs - lastFrameRef.current;
        const samples = samplesRef.current;
        samples.push(delta);
        if (samples.length > WINDOW_FRAMES) samples.shift();
      }
      lastFrameRef.current = timestampMs;

      if (timestampMs - lastUpdateRef.current >= UPDATE_INTERVAL_MS) {
        lastUpdateRef.current = timestampMs;
        const samples = samplesRef.current;
        if (samples.length > 0) {
          const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
          const fps = Math.round(1000 / avg);
          let p95Ms = 0;
          if (samples.length >= MIN_SAMPLES_FOR_P95) {
            const sorted = [...samples].sort((a, b) => a - b);
            const idx = Math.min(
              sorted.length - 1,
              Math.ceil(0.95 * sorted.length) - 1,
            );
            p95Ms = sorted[idx] ?? 0;
          }
          setStats({ fps, p95Ms });
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return stats;
}
