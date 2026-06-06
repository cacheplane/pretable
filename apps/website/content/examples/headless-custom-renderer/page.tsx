import { useSyncExternalStore, useState } from "react";

import { createGrid } from "@pretable/core";

import { columns } from "./columns";
import { services } from "./data";

// A headless grid: @pretable/core owns sort/filter/selection state; you own
// every pixel of the render. snapshot.visibleRows is the filtered + sorted set.
export function ServicesTable() {
  const [grid] = useState(() =>
    createGrid({ columns, rows: services, getRowId: (r) => r.id }),
  );
  const snapshot = useSyncExternalStore(
    grid.subscribe,
    grid.getSnapshot,
    grid.getSnapshot,
  );

  return (
    <table>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.id} onClick={() => grid.setSort(c.id, "asc")}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {snapshot.visibleRows.map(({ id, row }) => (
          <tr key={id} onClick={() => grid.toggleRowSelection(id)}>
            {columns.map((c) => (
              <td key={c.id}>{String(row[c.id as keyof typeof row])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
