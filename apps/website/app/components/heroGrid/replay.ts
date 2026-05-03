import { heroEventLog, type HeroEvent } from "./eventLog";

export interface CreateHeroReplayOptions {
  ratePerSec: number;
  onEmit: (event: HeroEvent, sequence: number) => void;
}

export interface HeroReplay {
  tickAtMs(timestampMs: number): void;
  pause(timestampMs?: number): void;
  resume(timestampMs: number): void;
  setRate(ratePerSec: number): void;
}

export function createHeroReplay(options: CreateHeroReplayOptions): HeroReplay {
  let intervalMs = 1000 / options.ratePerSec;
  let lastTickMs: number | null = null;
  let backlog = 0;
  let paused = false;
  let sequence = 0;

  return {
    tickAtMs(timestampMs: number) {
      if (paused) return;
      if (lastTickMs === null) {
        lastTickMs = timestampMs;
        return;
      }
      const elapsed = timestampMs - lastTickMs;
      backlog += elapsed / intervalMs;
      while (backlog >= 1) {
        const event = heroEventLog[sequence % heroEventLog.length];
        if (event) options.onEmit(event, sequence);
        sequence += 1;
        backlog -= 1;
      }
      lastTickMs = timestampMs;
    },
    pause() {
      if (paused) return;
      paused = true;
    },
    resume(timestampMs: number) {
      if (!paused) return;
      paused = false;
      lastTickMs = timestampMs;
    },
    setRate(ratePerSec: number) {
      intervalMs = 1000 / ratePerSec;
    },
  };
}
