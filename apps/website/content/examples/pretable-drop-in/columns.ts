import { createColumnHelper } from "@pretable/core";

import type { Book } from "./data";

const column = createColumnHelper<Book>();

export const columns = [
  column.accessor("title", { type: "text", header: "Title" }),
  column.accessor("author", { type: "text", header: "Author" }),
  column.accessor("year", { type: "number", header: "Year" }),
] as const;
