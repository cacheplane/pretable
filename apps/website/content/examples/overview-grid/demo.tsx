"use client";

import { Pretable } from "@pretable/react";

import { columns } from "./columns";
import { customers } from "./data";

export default function Demo() {
  return (
    <Pretable
      ariaLabel="Customer accounts"
      rows={customers}
      columns={columns}
      getRowId={(row) => row.id}
    />
  );
}
