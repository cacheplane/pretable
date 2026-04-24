import type { ReplayEngine } from "../replay-engine";
import { useEngineState } from "../use-engine";

interface ParserAstPanelProps {
  engine: ReplayEngine;
}

export function ParserAstPanel({ engine }: ParserAstPanelProps) {
  const state = useEngineState(engine);

  if (state.phase === "live" || state.phase === "done") {
    return (
      <div className="inspector-panel">
        <div className="inspector-panel-header">Parser AST</div>
        <div className="inspector-panel-body">
          <div className="ast-phase2-badge">
            [phase 2 — parser idle, direct updates]
          </div>
          <div className="ast-stats">
            rows added: <strong>{state.stats.rowsAdded}</strong>
          </div>
          <div className="ast-stats">
            patches applied: <strong>{state.stats.patchesApplied}</strong>
          </div>
        </div>
      </div>
    );
  }

  const snap = state.parserSnapshot;

  return (
    <div className="inspector-panel">
      <div className="inspector-panel-header">
        Parser AST
        {snap && <span className="ast-mode-badge">{snap.mode}</span>}
      </div>
      <div className="inspector-panel-body">
        {!snap || snap.rootKind === "empty" ? (
          <span className="inspector-dim">parser idle…</span>
        ) : snap.rootKind === "array" ? (
          <>
            <div>
              array{" "}
              <span className="inspector-dim">
                ({snap.topLevelCompleted} / {snap.topLevelCount} items,
                {snap.topLevelCompleted === snap.topLevelCount
                  ? " complete"
                  : " incomplete"}
                )
              </span>
            </div>
            {snap.buildingRow && (
              <div className="ast-building">
                <div>
                  [{snap.topLevelCompleted}] object{" "}
                  <span className="inspector-dim">(building)</span>
                </div>
                {Object.entries(snap.buildingRow).map(([key, value]) => (
                  <div key={key} className="ast-field">
                    <span className="ast-key">"{key}":</span>{" "}
                    <span className="ast-value">{JSON.stringify(value)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <span className="inspector-dim">
            unexpected root kind: {snap.rootKind}
          </span>
        )}
      </div>
    </div>
  );
}
