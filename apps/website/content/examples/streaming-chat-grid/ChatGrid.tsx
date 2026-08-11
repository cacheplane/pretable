// @ts-nocheck — sample source for docs; not compiled as app code.
"use client";

import { connectElementStream } from "@pretable/stream-adapter";
import { PretableSurface } from "@pretable/react";
import { createLocalRowModel } from "@pretable/core";
import { useEffect, useMemo } from "react";

import { columns, type ChatRow } from "./columns";
import { openai } from "./openai-client";

export function ChatGrid({ prompt }: { prompt: string }) {
  const rowModel = useMemo(
    () => createLocalRowModel({ rows: [], columns, getRowId: (row) => row.id }),
    [],
  );

  useEffect(() => {
    let disposed = false;
    let connection: ReturnType<typeof connectElementStream> | undefined;
    void (async () => {
      const stream = await openai.responses.stream({
        model: "gpt-5",
        input: prompt,
      });
      connection = connectElementStream(rowModel, stream);
      if (disposed) connection.dispose();
    })();
    return () => {
      disposed = true;
      connection?.dispose();
    };
  }, [prompt, rowModel]);

  useEffect(() => () => rowModel.dispose(), [rowModel]);

  return (
    <PretableSurface
      ariaLabel="Streaming chat"
      model={rowModel}
      viewportHeight={320}
    />
  );
}
