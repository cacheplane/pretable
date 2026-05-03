"use client";

import { useControlState } from "./heroGrid/controlState";
import { useFps } from "./heroGrid/useFps";
import { TopControlBar } from "./TopControlBar";

const STATIC_P95_MS = 9.3;

export function HomeStreamHeader() {
  const { ratePerSec, isPlaying } = useControlState();
  const fps = useFps();
  const eventsPerSec = isPlaying ? ratePerSec : 0;

  return (
    <TopControlBar
      eventsPerSec={eventsPerSec}
      fps={fps}
      p95Ms={STATIC_P95_MS}
    />
  );
}
