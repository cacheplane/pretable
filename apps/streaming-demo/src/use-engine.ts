import { useSyncExternalStore } from "react";

import type { ReplayEngine } from "./replay-engine";
import type { EngineState } from "./types";

export function useEngineState(engine: ReplayEngine): EngineState {
  return useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => engine.getState(),
    () => engine.getState(),
  );
}
