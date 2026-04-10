import type { GridCoreFrame } from "@pretable-internal/grid-core";

export interface DomRenderSnapshot {
  frame: GridCoreFrame;
  nodeCount: number;
}
