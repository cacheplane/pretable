"use client";

import { useControlState } from "./heroGrid/controlState";
import { useFrameStats } from "./heroGrid/useFrameStats";
import { TopControlBar } from "./TopControlBar";

export function HomeStreamHeader() {
  const { ratePerSec, isPlaying } = useControlState();
  const { fps, p95Ms } = useFrameStats();
  const eventsPerSec = isPlaying ? ratePerSec : 0;

  return <TopControlBar eventsPerSec={eventsPerSec} fps={fps} p95Ms={p95Ms} />;
}
