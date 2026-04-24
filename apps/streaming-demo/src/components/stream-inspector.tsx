import { ParserAstPanel } from "./parser-ast-panel";
import { StreamEventsPanel } from "./stream-events-panel";
import type { ReplayEngine } from "../replay-engine";

interface StreamInspectorProps {
  engine: ReplayEngine;
}

export function StreamInspector({ engine }: StreamInspectorProps) {
  return (
    <>
      <StreamEventsPanel engine={engine} />
      <ParserAstPanel engine={engine} />
    </>
  );
}
