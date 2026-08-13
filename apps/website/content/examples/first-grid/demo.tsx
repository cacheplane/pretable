"use client";

import { Pretable } from "@pretable/react";

import { columns } from "./columns";
import { people } from "./data";

export default function Demo() {
  return (
    <Pretable
      ariaLabel="Team roster"
      rows={people}
      columns={columns}
      getRowId={(r) => r.id}
    />
  );
}
