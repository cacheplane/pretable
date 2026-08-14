import { createColumnHelper } from "@pretable/core";

import type { Contact } from "./data";

const column = createColumnHelper<Contact>();

export const columns = [
  column.accessor("name", { type: "text", header: "Name" }),
  column.accessor("team", { type: "text", header: "Team" }),
] as const;
