import { createColumnHelper } from "@pretable/core";

export interface MessageRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  tokens: number;
}

const column = createColumnHelper<MessageRow>();

export const columns = [
  column.accessor("role", { type: "enum", header: "Role" }),
  column.accessor("content", { type: "text", header: "Content" }),
  column.accessor("tokens", { type: "number", header: "Tokens" }),
] as const;
