"use client";

import { connectElementStream } from "@pretable/stream-adapter";
import { PretableSurface } from "@pretable/react";
import { createLocalRowModel } from "@pretable/core";
import { useEffect, useMemo } from "react";

import { columns, type ChatRow } from "./columns";
import {
  responseEventsToChatRows,
  type ChatResponseEvent,
} from "./response-events-to-chat-rows";

export type OpenChatResponseEvents = (input: {
  readonly model: string;
  readonly prompt: string;
}) =>
  AsyncIterable<ChatResponseEvent> | Promise<AsyncIterable<ChatResponseEvent>>;

export function ChatGrid({
  prompt,
  openResponseEvents,
}: {
  prompt: string;
  openResponseEvents: OpenChatResponseEvents;
}) {
  const rowModel = useMemo(
    () => createLocalRowModel({ rows: [], columns, getRowId: (row) => row.id }),
    [],
  );

  useEffect(() => {
    let disposed = false;
    let connection: ReturnType<typeof connectElementStream> | undefined;
    void (async () => {
      const stream = await openResponseEvents({
        model: "gpt-5",
        prompt,
      });
      const rows: AsyncIterable<ChatRow> = responseEventsToChatRows(stream);
      connection = connectElementStream(rowModel, rows);
      if (disposed) connection.dispose();
    })();
    return () => {
      disposed = true;
      connection?.dispose();
    };
  }, [openResponseEvents, prompt, rowModel]);

  useEffect(() => () => rowModel.dispose(), [rowModel]);

  return (
    <PretableSurface
      ariaLabel="Streaming chat"
      model={rowModel}
      viewportHeight={320}
    />
  );
}
