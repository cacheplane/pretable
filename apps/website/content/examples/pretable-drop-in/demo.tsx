"use client";

import { Pretable } from "@pretable/react";

import { columns } from "./columns";
import { books } from "./data";

export default function Demo() {
  return (
    <Pretable
      ariaLabel="Library catalog"
      rows={books}
      columns={columns}
      getRowId={(row) => row.id}
    />
  );
}
