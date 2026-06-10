"use client";

import { useControlState } from "./heroGrid/controlState";
import { useFrameStats } from "./heroGrid/useFrameStats";
import { TopControlBar } from "./TopControlBar";

export function HomeStreamHeader() {
  const { ratePerSec, isPlaying } = useControlState();
  const { fps, p95Ms } = useFrameStats();
  const ticksPerSec = isPlaying ? ratePerSec : 0;
  return <TopControlBar ticksPerSec={ticksPerSec} fps={fps} p95Ms={p95Ms} />;
}
