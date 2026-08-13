import { useSyncExternalStore } from "react";

import {
  createColumnHelper,
  createGrid,
  createLocalRowModel,
} from "@pretable/core";

/**
 * Compile-time fixture for the code fences on `headless/getting-started.mdx`.
 *
 * Each `// docs-fence:` marker below binds everything up to the next marker to
 * one fence on that page, and `docs-api-surface.test.ts` holds the two
 * together: a fence this file has stopped transcribing fails, and so does a
 * fence with no marker naming it. Everything above the first marker is the
 * shared preamble — the merged imports and the scaffolding a partial snippet
 * needs in order to compile at all.
 */

interface Service {
  id: string;
  name: string;
  latencyMs: number;
}

const rows: readonly Service[] = [
  { id: "svc-1", name: "Search", latencyMs: 12 },
];

// docs-fence: headless/getting-started.mdx#Create typed columns and a row model
const column = createColumnHelper<Service>();
const columns = [
  column.accessor("name", { type: "text", header: "Service" }),
  column.accessor("latencyMs", { type: "number", header: "Latency" }),
] as const;

const rowModel = createLocalRowModel({ rows, columns });

// docs-fence: headless/getting-started.mdx#Add UI state when needed
const grid = createGrid({ rowModel, columns });
grid.setFocus({ ref: { kind: "data", rowId: "svc-1" }, columnId: "name" });

export { grid };

// docs-fence: headless/getting-started.mdx#Subscribe
export function HeadlessGettingStartedRange() {
  const state = useSyncExternalStore(
    rowModel.subscribe,
    rowModel.getState,
    rowModel.getState,
  );
  const snapshot = state.snapshot;

  // docs-fence: headless/getting-started.mdx#Render an indexed range
  const start = 0;
  const end = Math.min(snapshot.visibleRowCount, 100);

  return (
    <tbody>
      {snapshot.range(start, end).map((entry) =>
        entry.kind === "data" ? (
          <tr key={entry.rowId}>
            <td>{entry.row.name}</td>
            <td>{entry.row.latencyMs}</td>
          </tr>
        ) : (
          <tr key={entry.groupId}>
            <th colSpan={2}>{String(entry.value)}</th>
          </tr>
        ),
      )}
    </tbody>
  );
}
