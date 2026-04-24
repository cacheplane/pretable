import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PretableGrid } from "@pretable/react";

import { StreamingGrid } from "./components/streaming-grid";
import { StreamInspector } from "./components/stream-inspector";
import { TransportBar } from "./components/transport-bar";
import { createEngine, type ReplayEngine } from "./replay-engine";
import { loadPhase1, loadPhase2 } from "./recording-loader";
import type { Phase1Entry, Phase2Entry, StockRow } from "./types";

const PHASE1_URL = "/src/recordings/phase1.jsonl";
const PHASE2_URL = "/src/recordings/phase2.jsonl";

export function App() {
  const [loadError, setLoadError] = useState<string | null>(null);
  const [grid, setGrid] = useState<PretableGrid<StockRow> | null>(null);
  const [phase1, setPhase1] = useState<Phase1Entry[] | null>(null);
  const [phase2, setPhase2] = useState<Phase2Entry[] | null>(null);

  const gridSlotRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(400);

  // Measure available grid height once mounted, and on window resize.
  useLayoutEffect(() => {
    const slot = gridSlotRef.current;
    if (!slot) return;
    const measure = () => {
      setViewportHeight(slot.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    return () => observer.disconnect();
  }, []);

  // Load both recordings on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p1, p2] = await Promise.all([
          loadPhase1(PHASE1_URL),
          loadPhase2(PHASE2_URL),
        ]);
        if (cancelled) return;
        setPhase1(p1);
        setPhase2(p2);
      } catch (err) {
        if (!cancelled) {
          setLoadError((err as Error).message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onGridReady = useCallback((g: PretableGrid<StockRow>) => {
    setGrid(g);
  }, []);

  // Derive the engine synchronously once recordings + grid are ready.
  // Using useMemo (not state set inside an effect) keeps render flow clean
  // and avoids the react-hooks/set-state-in-effect lint trip.
  const engine: ReplayEngine | null = useMemo(() => {
    if (!phase1 || !phase2 || !grid) return null;
    return createEngine({ phase1, phase2, grid });
  }, [phase1, phase2, grid]);

  // Lifecycle effect: start playback when the engine becomes available,
  // dispose when it changes or the component unmounts.
  useEffect(() => {
    if (!engine) return;
    engine.play();
    return () => {
      engine.dispose();
    };
  }, [engine]);

  return (
    <div className="app-shell">
      <div className="app-header">
        <span className="app-title">pretable · streaming demo</span>
        <span className="app-meta">
          openai responses · stock ticker replay · prices fictional
        </span>
      </div>
      <div className="app-body">
        <div className="grid-slot" ref={gridSlotRef}>
          <StreamingGrid
            onGridReady={onGridReady}
            viewportHeight={viewportHeight}
          />
        </div>
        <div className="inspector-slot">
          {engine ? (
            <StreamInspector engine={engine} />
          ) : (
            <div className="inspector-loading">
              {loadError ? `error: ${loadError}` : "loading recordings…"}
            </div>
          )}
        </div>
      </div>
      <div className="transport-slot">
        {engine ? (
          <TransportBar engine={engine} />
        ) : (
          <div className="transport-loading">—</div>
        )}
      </div>
    </div>
  );
}
