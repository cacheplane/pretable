import { createColumnHelper } from "@pretable/core";

export interface ChatRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  tokens: number;
  latencyMs: number;
}

const column = createColumnHelper<ChatRow>();

export const columns = [
  column.accessor("role", { type: "enum", header: "Role" }),
  column.accessor("content", { type: "text", header: "Content" }),
  column.accessor("tokens", { type: "number", header: "Tokens" }),
  column.accessor("latencyMs", { type: "number", header: "Latency" }),
] as const;
