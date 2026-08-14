"use client";

import { PretableSurface } from "@pretable/react";

import { columns } from "./columns";
import { events } from "./data";

const VIEWPORT_HEIGHT = 260;

export function EventGrid() {
  return (
    <PretableSurface
      ariaLabel="Live events"
      rows={events}
      columns={columns}
      getRowId={(row) => row.id}
      viewportHeight={VIEWPORT_HEIGHT}
    />
  );
}
