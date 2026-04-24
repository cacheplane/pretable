import { useCallback } from "react";

import type { ReplayEngine } from "../replay-engine";
import { useEngineState } from "../use-engine";
import { formatTime } from "../format";
import type { PlaybackSpeed } from "../types";

interface TransportBarProps {
  engine: ReplayEngine;
}

const SPEED_OPTIONS: PlaybackSpeed[] = [0.5, 1, 2, 4];

export function TransportBar({ engine }: TransportBarProps) {
  const state = useEngineState(engine);

  const onPlayPause = useCallback(() => {
    if (state.playing) engine.pause();
    else engine.play();
  }, [engine, state.playing]);

  const onSeek = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const pct = Number(event.currentTarget.value) / 1000;
      engine.seek(pct * state.totalDuration);
    },
    [engine, state.totalDuration],
  );

  const onSpeed = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      engine.setSpeed(Number(event.currentTarget.value) as PlaybackSpeed);
    },
    [engine],
  );

  const scrubValue =
    state.totalDuration > 0
      ? Math.min(1000, Math.round((state.clock / state.totalDuration) * 1000))
      : 0;

  return (
    <div className="transport-bar">
      <button
        className="transport-play"
        aria-label={state.playing ? "Pause" : "Play"}
        onClick={onPlayPause}
      >
        {state.playing ? "⏸" : "▶"}
      </button>
      <span className="transport-time">
        {formatTime(state.clock)} / {formatTime(state.totalDuration)}
      </span>
      <input
        className="transport-scrub"
        type="range"
        min={0}
        max={1000}
        value={scrubValue}
        onChange={onSeek}
        aria-label="Scrub timeline"
      />
      <span className="transport-phase" data-phase={state.phase}>
        {state.phase}
      </span>
      <select
        className="transport-speed"
        value={state.speed}
        onChange={onSpeed}
        aria-label="Playback speed"
      >
        {SPEED_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
    </div>
  );
}
