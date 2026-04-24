import type { ReplayEngine } from "../replay-engine";
import { useEngineState } from "../use-engine";

interface StreamEventsPanelProps {
  engine: ReplayEngine;
}

export function StreamEventsPanel({ engine }: StreamEventsPanelProps) {
  const state = useEngineState(engine);

  if (state.phase === "live" || state.phase === "done") {
    return (
      <div className="inspector-panel">
        <div className="inspector-panel-header">
          Stream events ({state.stats.patchesApplied} patches)
        </div>
        <div className="inspector-panel-body inspector-phase2">
          {state.lastPatchBatch ? (
            <>
              <div className="phase2-badge">
                .patches ({state.lastPatchBatch.size} rows)
              </div>
              <pre className="phase2-sample">
                {JSON.stringify(state.lastPatchBatch.sample, null, 2)}
              </pre>
            </>
          ) : (
            <span className="inspector-dim">awaiting first batch…</span>
          )}
        </div>
      </div>
    );
  }

  const events = state.recentStreamEvents;
  const newest = events.length - 1;

  return (
    <div className="inspector-panel">
      <div className="inspector-panel-header">
        Stream events ({events.length} recent)
      </div>
      <div className="inspector-panel-body">
        {events.map((e, i) => {
          if (e.type === "response.output_text.delta") {
            return (
              <div
                key={i}
                className={`stream-event ${i === newest ? "stream-event-newest" : ""}`}
              >
                <span className="stream-event-type">.delta</span>
                <span className="stream-event-delta">
                  "{escapeForDisplay(e.delta)}"
                </span>
              </div>
            );
          }
          return (
            <div
              key={i}
              className={`stream-event ${i === newest ? "stream-event-newest" : ""}`}
            >
              <span className="stream-event-type stream-event-meta">
                [{e.type.replace("response.", "")}]
              </span>
            </div>
          );
        })}
        {events.length === 0 && (
          <span className="inspector-dim">waiting for first chunk…</span>
        )}
      </div>
    </div>
  );
}

function escapeForDisplay(s: string): string {
  return s.replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}
