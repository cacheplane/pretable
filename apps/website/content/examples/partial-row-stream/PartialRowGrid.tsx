"use client";

import { connectPartialStream } from "@pretable/stream-adapter";
import { PretableSurface } from "@pretable/react";
import { createLocalRowModel } from "@pretable/core";
import { useEffect, useMemo } from "react";

import { columns, type MessageRow } from "./columns";
import { scriptedFirstReply, scriptedSecondReply } from "./scripted-partials";

export function PartialRowGrid() {
  const rowModel = useMemo(
    () =>
      createLocalRowModel({
        // "msg-1" is seeded here, before any stream connects — the "seed
        // the row first" pattern. connectPartialStream never creates a
        // row on its own; without a row to find, every partial for an
        // unseeded id is reported through onIssue instead of applied.
        rows: [{ id: "msg-1", role: "assistant", content: "", tokens: 0 }],
        columns,
        getRowId: (row) => row.id,
      }),
    [],
  );

  useEffect(() => {
    // "msg-1" already exists, so this connection only ever patches it.
    const seeded = connectPartialStream(rowModel, scriptedFirstReply(), {
      rowId: "msg-1",
    });

    // "msg-2" does not exist yet. The first partial for it is reported
    // through onIssue as an "unknown-update-id" issue; createRow then
    // turns that partial's accumulated changes into the new row. Every
    // later partial for "msg-2" is a normal update from there on.
    const created = connectPartialStream(rowModel, scriptedSecondReply(), {
      rowId: "msg-2",
      onIssue: (issue) => {
        console.warn(`[partial-row-stream] ${issue.code}: ${issue.rowId}`);
      },
      createRow: (partial, id): MessageRow => ({
        id,
        role: "assistant",
        content: partial.content ?? "",
        tokens: partial.tokens ?? 0,
      }),
    });

    return () => {
      seeded.dispose();
      created.dispose();
    };
  }, [rowModel]);

  useEffect(() => () => rowModel.dispose(), [rowModel]);

  return (
    <PretableSurface
      ariaLabel="Partial row stream"
      model={rowModel}
      viewportHeight={220}
    />
  );
}
