"use client";

import { useEffect, useRef, useState } from "react";

const WINDOW_FRAMES = 60;
const UPDATE_INTERVAL_MS = 250;

export function useFps(): number {
  const [fps, setFps] = useState(60);
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
          setFps(Math.round(1000 / avg));
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return fps;
}
