// @ts-nocheck — sample source for docs; not compiled as app code.
"use client";

import { connectElementStream } from "@pretable/stream-adapter";
import { Pretable } from "@pretable/react";
import { useEffect, useState } from "react";

import { columns, type ChatRow } from "./columns";
import { openai } from "./openai-client";

export function ChatGrid({ prompt }: { prompt: string }) {
  const [rows, setRows] = useState<ChatRow[]>([]);

  useEffect(() => {
    void (async () => {
      const stream = await openai.responses.stream({
        model: "gpt-5",
        input: prompt,
      });
      connectElementStream(stream, {
        onElement: (row) => setRows((r) => [...r, row]),
      });
    })();
  }, [prompt]);

  return <Pretable rows={rows} columns={columns} getRowId={(r) => r.id} />;
}
