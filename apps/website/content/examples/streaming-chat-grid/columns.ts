// @ts-nocheck — sample source for docs; not compiled as app code.
import type { PretableColumn } from "@pretable/react";

export interface ChatRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  tokens: number;
  latencyMs: number;
}

export const columns: PretableColumn<ChatRow>[] = [
  { id: "role", header: "Role", widthPx: 100 },
  { id: "content", header: "Content", widthPx: 480, wrap: true },
  { id: "tokens", header: "Tokens", widthPx: 80 },
  { id: "latencyMs", header: "Latency", widthPx: 100 },
];
