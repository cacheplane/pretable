import { createColumnHelper, createLocalRowModel } from "@pretable/core";

interface Service {
  id: string;
  name: string;
  latencyMs: number;
}

const column = createColumnHelper<Service>();
const columns = [
  column.accessor("name", { type: "text", header: "Service" }),
  column.accessor("latencyMs", { type: "number", header: "Latency" }),
] as const;
const rows: readonly Service[] = [
  { id: "svc-1", name: "Search", latencyMs: 12 },
];
const rowModel = createLocalRowModel({ rows, columns });

/** Compile-time fixture for the indexed-range example in the headless guide. */
export function HeadlessGettingStartedRange() {
  const snapshot = rowModel.getState().snapshot;
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
