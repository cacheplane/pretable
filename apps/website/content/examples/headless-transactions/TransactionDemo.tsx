"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

import {
  createLocalRowModel,
  type PretableMutationResult,
} from "@pretable/core";
import { useDisposeOnUnmount } from "@pretable/react";

import { columns } from "./columns";
import { tasks } from "./data";

// This id never exists in `tasks`, so every batch below reports exactly one
// "unknown-remove-id" issue — the non-fatal-issue half of the contract, next
// to the atomic-revision half.
const GHOST_ID = "task-ghost";

export function TransactionDemo() {
  const [rowModel] = useState(() =>
    createLocalRowModel({ columns, rows: tasks }),
  );
  useDisposeOnUnmount(rowModel);

  const readSnapshot = useCallback(
    () => rowModel.getState().snapshot,
    [rowModel],
  );
  const snapshot = useSyncExternalStore(
    rowModel.subscribe,
    readSnapshot,
    readSnapshot,
  );

  const [result, setResult] = useState<PretableMutationResult<string> | null>(
    null,
  );
  const [nextId, setNextId] = useState(5);

  const runBatch = () => {
    const openTask = snapshot
      .range(0, snapshot.visibleRowCount)
      .filter((entry) => entry.kind === "data")
      .map((entry) => entry.row)
      .find((task) => task.status === "open");

    // One call: add a row, update a row, and attempt to remove one that was
    // never there. All three land in the SAME revision, and the unknown
    // removal comes back as an issue rather than throwing.
    const outcome = rowModel.applyTransaction({
      add: [
        { id: `task-${nextId}`, title: `Follow-up ${nextId}`, status: "open" },
      ],
      update: openTask
        ? [{ id: openTask.id, changes: { status: "done" } }]
        : [],
      remove: [GHOST_ID],
    });

    setResult(outcome);
    setNextId((id) => id + 1);
  };

  const firstIssue = result?.issues[0];
  const issueText = firstIssue
    ? ` · ${result!.issues.length} issue: ${firstIssue.code} (${
        "rowId" in firstIssue ? firstIssue.rowId : firstIssue.groupId
      })`
    : "";

  return (
    <div>
      <button type="button" onClick={runBatch}>
        Apply batch: add one, complete one, remove one unknown
      </button>
      <p role="status" style={{ fontSize: 13, minHeight: 18 }}>
        {result
          ? `revision ${result.previousRevision} → ${result.revision} · ` +
            `${result.added} added, ${result.updated} updated, ${result.removed} removed` +
            issueText
          : "No batch applied yet."}
      </p>
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.id} scope="col">
                {c.header ?? c.id}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {snapshot
            .range(0, snapshot.visibleRowCount)
            .filter((entry) => entry.kind === "data")
            .map(({ rowId, row }) => (
              <tr key={rowId}>
                {columns.map((c) => (
                  <td key={c.id}>{String(c.accessor(row))}</td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
